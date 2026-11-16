// Feature B: The Draw & Reminders
//
// handles the random assignment of secret santas within a group.
// uses a shuffled array into a ring buffer so nobody draws themselves,
// and everyone gives and receives exactly once. 
// once the draw happens, we lock it in, email everyone, and set up reminders!

const express = require('express');
const db = require('../../db/pool');
const storage = require('../../services/storage');
const { requireLogin, requireMember } = require('../../auth');
const emailService = require('../../services/email');
const reminderService = require('../../services/reminders');

const router = express.Router();
router.use(requireLogin);

// after a form post, save an error (if any) and go back to the page
function back(req, res, error) {
  if (error) req.session.error = error;
  res.redirect(`/groups/${req.group.id}/draw`);
}

// the draw

// draw page: who am i buying for and what do they want
router.get('/:id/draw', requireMember, async (req, res) => {
  // hasn't happened yet
  if (!req.group.drawn_at) {
    return res.render('draw', { group: req.group, assignment: null, wishlist: [] });
  }

  // find the logged-in user's giftee
  const { rows: assignmentRows } = await db.query(
    `SELECT u.id, u.name FROM assignments a
     JOIN users u ON u.id = a.receiver_id
     WHERE a.group_id = $1 AND a.giver_id = $2`,
    [req.group.id, req.user.id]
  );
  
  const giftee = assignmentRows[0];
  let wishlist = [];

  // pull their wishlist items if they have any
  if (giftee) {
    const { rows: wishlistRows } = await db.query(
      `SELECT title, link, image_key FROM wishlist_items 
       WHERE group_id = $1 AND user_id = $2
       ORDER BY created_at ASC`,
      [req.group.id, giftee.id]
    );
    wishlist = wishlistRows;
    // turn storage keys into viewable urls, same as the group page
    for (const item of wishlist) item.image_url = item.image_key ? await storage.getUrl(item.image_key) : null;
  }

  res.render('draw', { group: req.group, assignment: giftee, wishlist });
});

// organizer executes the draw
router.post('/:id/draw', requireMember, async (req, res) => {
  if (req.group.organizer_id !== req.user.id) return back(req, res, 'only the organizer can draw names');
  if (req.group.drawn_at) return back(req, res, 'names have already been drawn');

  const { rows: members } = await db.query(
    `SELECT u.id, u.name, u.email FROM group_members m
     JOIN users u ON u.id = m.user_id
     WHERE m.group_id = $1`,
    [req.group.id]
  );

  if (members.length < 3) return back(req, res, 'you need at least 3 members to draw names');

  // shuffle members (fisher-yates)
  const shuffled = [...members];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  // ring buffer: everyone gives to the next person, last person gives to the first
  const assignments = [];
  for (let i = 0; i < shuffled.length; i++) {
    assignments.push({
      giver: shuffled[i],
      receiver: shuffled[(i + 1) % shuffled.length] 
    });
  }

  // save to db in one transaction
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    // lock in drawn_at first, if a double click already did it this updates 0 rows and we stop
    const { rowCount } = await client.query(
      'UPDATE groups SET drawn_at = now() WHERE id = $1 AND drawn_at IS NULL',
      [req.group.id]
    );
    if (!rowCount) {
      await client.query('ROLLBACK');
      return back(req, res);
    }

    for (const pair of assignments) {
      await client.query(
        `INSERT INTO assignments (group_id, giver_id, receiver_id) VALUES ($1, $2, $3)`,
        [req.group.id, pair.giver.id, pair.receiver.id]
      );
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('draw transaction failed:', error);
    return back(req, res, 'an error occurred during the draw');
  } finally {
    client.release();
  }

  // fire off emails and schedule reminders
  for (const pair of assignments) {
    await emailService.sendDrawEmail(pair.giver, pair.receiver.name, req.group);
  }
  await reminderService.scheduleReminder(req.group, members.map((m) => m.email));

  back(req, res);
});

module.exports = router;
