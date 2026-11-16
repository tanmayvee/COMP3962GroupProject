// Feature A: Groups & Wishlists
//
// TODO for person A:
//   POST /groups - create a group (name, budget, exchange date) + join code
//   POST /groups/join - join with a code
//   GET  /groups/:id - group details + members
//   POST /groups/:id/wishlist - add a wishlist item
// (tables are already in schema.sql: groups, group_members, wishlist_items)

const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const path = require('path');
const db = require('../../db/pool');
const storage = require('../../services/storage');
const { requireLogin, requireMember } = require('../../auth');


const router = express.Router();
router.use(requireLogin);

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

// Join code function, simple 6 digit code like most 2fa random numbers
function makeJoinCode() {
  return crypto.randomInt(0, 1000000).toString().padStart(6, '0');
}

// ome page: my groups + the create/join forms
router.get('/', requireLogin, async (req, res) => {
  const { rows } = await db.query(
    `SELECT g.id, g.name, g.exchange_date, g.drawn_at FROM groups g
     JOIN group_members m ON m.group_id = g.id
     WHERE m.user_id = $1 ORDER BY g.created_at DESC`,
    [req.user.id]
  );
  res.render('home', { groups: rows, user: req.user });
});

// Group creation, making first member the organizer
router.post('/groups', requireLogin, async (req, res) => {
  const name = (req.body.name || '').trim();
  if (!name) return back(req, res, '/', 'Enter Group Name');

  const { rows } = await db.query(
    `WITH g AS (
       INSERT INTO groups (name, budget, exchange_date, join_code, organizer_id)
       VALUES ($1, $2, $3, $4, $5) RETURNING id, organizer_id
     )
     INSERT INTO group_members (group_id, user_id) SELECT id, organizer_id FROM g RETURNING group_id`,
    [name, req.body.budget || null, req.body.exchange_date || null, makeJoinCode(), req.user.id]
  );
  res.redirect(`/groups/${rows[0].group_id}`);
});

// Group join via code
router.post('/groups/join', requireLogin, async (req, res) => {
  const code = (req.body.code || '').trim();
  const { rows } = await db.query('SELECT id, drawn_at FROM groups WHERE join_code = $1', [code]);
  const group = rows[0];
  if (!group) return back(req, res, '/', 'No group found with that code');
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
  });
});

// add a wishlist item (photo is optional)
router.post('/groups/:id/wishlist', requireLogin, requireMember, upload.single('photo'), async (req, res) => {
  const here = `/groups/${req.group.id}`;
  const title = (req.body.title || '').trim();
  const link = (req.body.link || '').trim() || null;

  if (!title) return back(req, res, here, 'Enter item neck');
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
  back(req, res, here);
});

// delete one of my items (user_id in the WHERE means you can't delete anyone else's)
router.post('/groups/:id/wishlist/:itemId/delete', requireLogin, requireMember, async (req, res) => {
  await db.query(
    'DELETE FROM wishlist_items WHERE id = $1 AND group_id = $2 AND user_id = $3',
    [req.params.itemId, req.group.id, req.user.id]
  );
  back(req, res, `/groups/${req.group.id}`);
});

// invite by email - no mail server yet, so it just prints to the terminal
router.post('/groups/:id/invite', requireLogin, requireMember, async (req, res) => {
  console.log(
    `\n--- INVITE EMAIL ---\n` +
    `To: ${req.body.email}\n` +
    `${req.user.name} invited you to "${req.group.name}". Join with code ${req.group.join_code}\n` +
    `--------------------\n`
  );
  back(req, res, `/groups/${req.group.id}`);
});

module.exports = router;
