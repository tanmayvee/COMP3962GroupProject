// Feature A: Groups & Wishlists
//
// make a group, share the join code, everyone adds what they want.
// tables: groups, group_members, wishlist_items
// (requireLogin goes on each route since this router is mounted at '/',
//  a router.use() here would also catch things like /health)

const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const path = require('path');
const db = require('../../db/pool');
const storage = require('../../services/storage');
const emailService = require('../../services/email');
const reminderService = require('../../services/reminders');
const { requireLogin, requireMember } = require('../../auth');

const router = express.Router();

// Copied over photo upload function
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB is plenty for a gift pic
  fileFilter: (req, file, cb) => cb(null, file.mimetype.startsWith('image/')),
});

// After form post, save errors (if they occur), go back to page
function back(req, res, to, error) {
  if (error) req.session.error = error;
  res.redirect(to);
}

// same thing but for a green success message (fades out on its own)
function done(req, res, to, notice) {
  req.session.notice = notice;
  res.redirect(to);
}

// Join code function, simple 6 digit code like most 2fa random numbers
function makeJoinCode() {
  return crypto.randomInt(0, 1000000).toString().padStart(6, '0');
}

// a day as "YYYY-MM-DD" in local time, same format the date input sends
function dayString(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const today = () => dayString(new Date());
const tomorrow = () => { const d = new Date(); d.setDate(d.getDate() + 1); return dayString(d); };

// checks the group fields (create + edit), returns the cleaned values or an error
function cleanGroupFields(body) {
  const name = (body.name || '').trim();
  const budget = body.budget === undefined || body.budget === '' ? null : Number(body.budget);
  const exchangeDate = body.exchange_date || null;

  if (!name) return { error: 'Enter Group Name' };
  if (name.length > 80) return { error: 'Keep the group name under 80 characters' };
  // Number('abc') is NaN, which postgres can't store, so catch it here
  if (budget !== null && !(budget >= 0 && budget <= 10000)) return { error: 'Budget should be a number between 0 and 10000' };
  if (exchangeDate && !/^\d{4}-\d{2}-\d{2}$/.test(exchangeDate)) return { error: 'Pick a real exchange date' };
  // today or earlier would count as exchange day already, which auto reveals everyone
  if (exchangeDate && exchangeDate <= today()) return { error: 'Pick an exchange date after today' };
  return { name, budget, exchangeDate };
}

// ome page: my groups + the create/join forms
// logged out? show the landing page instead of bouncing straight to login
router.get('/', (req, res, next) => (req.session.userId ? next() : res.render('landing')), requireLogin, async (req, res) => {
  const { rows } = await db.query(
    `SELECT g.id, g.name, g.exchange_date, g.drawn_at, g.revealed_at, g.organizer_id = $1 AS is_organizer,
            (SELECT count(*) FROM group_members WHERE group_id = g.id)::int AS member_count
     FROM groups g
     JOIN group_members m ON m.group_id = g.id
     WHERE m.user_id = $1 ORDER BY g.created_at DESC`,
    [req.user.id]
  );
  res.render('home', { groups: rows, user: req.user, minDate: tomorrow() });
});

// Group creation, making first member the organizer
router.post('/groups', requireLogin, async (req, res) => {
  const { name, budget, exchangeDate, error } = cleanGroupFields(req.body);
  if (error) return back(req, res, '/', error);

  // codes are random, so on the rare chance of a duplicate just try again
  for (let tries = 0; tries < 5; tries++) {
    try {
      const { rows } = await db.query(
        `WITH g AS (
           INSERT INTO groups (name, budget, exchange_date, join_code, organizer_id)
           VALUES ($1, $2, $3, $4, $5) RETURNING id, organizer_id
         )
         INSERT INTO group_members (group_id, user_id) SELECT id, organizer_id FROM g RETURNING group_id`,
        [name, budget, exchangeDate, makeJoinCode(), req.user.id]
      );
      return res.redirect(`/groups/${rows[0].group_id}`);
    } catch (err) {
      if (err.code !== '23505') throw err; // 23505 = duplicate join code, anything else is a real error
    }
  }
  back(req, res, '/', "Couldn't make a join code, try again");
});

// Group join via code
router.post('/groups/join', requireLogin, async (req, res) => {
  const code = (req.body.code || '').trim();
  const { rows } = await db.query('SELECT id, drawn_at FROM groups WHERE join_code = $1', [code]);
  const group = rows[0];
  if (!group) return back(req, res, '/', 'No group found with that code');

  // just go there if already in it (even after the draw)
  const { rows: already } = await db.query(
    'SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2',
    [group.id, req.user.id]
  );
  if (already.length) return res.redirect(`/groups/${group.id}`);
  if (group.drawn_at) return back(req, res, '/', 'Names have already been drawn for that group');

  await db.query(
    'INSERT INTO group_members (group_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
    [group.id, req.user.id]
  );
  res.redirect(`/groups/${group.id}`);
});

// Group page
router.get('/groups/:id', requireLogin, requireMember, async (req, res) => {
  const { rows: members } = await db.query(
    `SELECT u.id, u.name FROM group_members m
     JOIN users u ON u.id = m.user_id
     WHERE m.group_id = $1 ORDER BY m.joined_at`,
    [req.group.id]
  );
  const { rows: items } = await db.query(
    'SELECT id, user_id, title, link, image_key FROM wishlist_items WHERE group_id = $1 ORDER BY created_at',
    [req.group.id]
  );

  // turn storage keys into viewable urls
  for (const i of items) i.image_url = i.image_key ? await storage.getUrl(i.image_key) : null;
  for (const m of members) m.items = items.filter((i) => i.user_id === m.id);

  res.render('group', {
    group: req.group,
    members,
    isOrganizer: req.group.organizer_id === req.user.id,
    minDate: tomorrow(),
    // pre-fills the edit form's date box
    exchangeDateValue: req.group.exchange_date ? dayString(req.group.exchange_date) : '',
  });
});

// organizer edits the name, budget or exchange date
router.post('/groups/:id/edit', requireLogin, requireMember, async (req, res) => {
  const here = `/groups/${req.group.id}`;
  if (req.group.organizer_id !== req.user.id) return back(req, res, here, 'Only the organizer can edit the group');
  const { name, budget, exchangeDate, error } = cleanGroupFields(req.body);
  if (error) return back(req, res, here, error);

  await db.query(
    'UPDATE groups SET name = $1, budget = $2, exchange_date = $3 WHERE id = $4',
    [name, budget, exchangeDate, req.group.id]
  );

  // names already drawn + new date = the reminder has to move too
  const oldDate = req.group.exchange_date ? dayString(req.group.exchange_date) : null;
  if (req.group.drawn_at && !req.group.revealed_at && exchangeDate !== oldDate) {
    const { rows } = await db.query(
      'SELECT u.email FROM users u JOIN group_members m ON m.user_id = u.id WHERE m.group_id = $1',
      [req.group.id]
    );
    // on aws this should replace the old schedule instead of adding a second one
    await reminderService.scheduleReminder({ ...req.group, name, exchange_date: exchangeDate }, rows.map((r) => r.email));
  }
  done(req, res, here, 'Group updated');
});

// organizer deletes the whole group
// the ON DELETE CASCADEs in schema.sql clean up members, wishlists, the draw, hints and photos with it
router.post('/groups/:id/delete', requireLogin, requireMember, async (req, res) => {
  if (req.group.organizer_id !== req.user.id) return back(req, res, `/groups/${req.group.id}`, 'Only the organizer can delete the group');
  // uploaded photo files stay in /uploads (or S3) for now, only the database rows go
  await db.query('DELETE FROM groups WHERE id = $1 AND organizer_id = $2', [req.group.id, req.user.id]);
  done(req, res, '/', `"${req.group.name}" was deleted`);
});

// anyone but the organizer can leave, as long as names aren't drawn yet
router.post('/groups/:id/leave', requireLogin, requireMember, async (req, res) => {
  const here = `/groups/${req.group.id}`;
  if (req.group.organizer_id === req.user.id) return back(req, res, here, "The organizer can't leave, delete the group instead");
  if (req.group.drawn_at) return back(req, res, here, "Names are already drawn, you can't leave now");

  // take my wishlist with me, then remove me from the group
  await db.query(
    `WITH gone AS (DELETE FROM wishlist_items WHERE group_id = $1 AND user_id = $2)
     DELETE FROM group_members WHERE group_id = $1 AND user_id = $2`,
    [req.group.id, req.user.id]
  );
  done(req, res, '/', `You left "${req.group.name}"`);
});

// add a wishlist item (photo is optional)
router.post('/groups/:id/wishlist', requireLogin, requireMember, upload.single('photo'), async (req, res) => {
  const here = `/groups/${req.group.id}`;
  const title = (req.body.title || '').trim();
  const link = (req.body.link || '').trim() || null;

  if (!title) return back(req, res, here, 'Enter an item name');
  if (title.length > 120) return back(req, res, here, 'Keep the item name under 120 characters');
  // the link ends up in an <a href>, so only allow http(s)
  if (link && !/^https?:\/\//i.test(link)) return back(req, res, here, 'links need to start with http:// or https://');

  let imageKey = null;
  if (req.file) {
    const ext = path.extname(req.file.originalname).toLowerCase() || '.jpg';
    imageKey = `wishlist/${req.group.id}/${crypto.randomUUID()}${ext}`;
    await storage.save(imageKey, req.file.buffer, req.file.mimetype);
  }

  await db.query(
    'INSERT INTO wishlist_items (group_id, user_id, title, link, image_key) VALUES ($1, $2, $3, $4, $5)',
    [req.group.id, req.user.id, title, link, imageKey]
  );
  done(req, res, here, `Added "${title}" to your wishlist`);
});

// delete one of my items (user_id in the WHERE means you can't delete anyone else's)
router.post('/groups/:id/wishlist/:itemId/delete', requireLogin, requireMember, async (req, res) => {
  // item ids are numbers, anything else would just error in postgres
  if (!/^\d+$/.test(req.params.itemId)) return back(req, res, `/groups/${req.group.id}`);
  await db.query(
    'DELETE FROM wishlist_items WHERE id = $1 AND group_id = $2 AND user_id = $3',
    [req.params.itemId, req.group.id, req.user.id]
  );
  back(req, res, `/groups/${req.group.id}`);
});

// invite by email, goes through the email service (terminal now, SES later)
router.post('/groups/:id/invite', requireLogin, requireMember, async (req, res) => {
  const here = `/groups/${req.group.id}`;
  const to = (req.body.email || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return back(req, res, here, "That email doesn't look right");
  // nobody can join once names are drawn, so an invite would be useless
  if (req.group.drawn_at) return back(req, res, here, 'Names are already drawn, nobody else can join');

  await emailService.send({
    to,
    subject: `${req.user.name} invited you to "${req.group.name}" on Secret Santa`,
    body: emailService.letter('Hi there,', [
      `${req.user.name} invited you to join the "${req.group.name}" gift exchange!`,
      req.group.budget ? `The budget is $${Number(req.group.budget)}.` : null,
      '',
      `To join, log in and enter this code: ${req.group.join_code}`,
    ]),
  });
  done(req, res, here, `Invite sent to ${to}`);
});

module.exports = router;
