// Feature A: Groups & Wishlists
//
// TODO for person A:
//   POST /groups - create a group (name, budget, exchange date) + join code
//   POST /groups/join - join with a code
//   GET  /groups/:id - group details + members
//   POST /groups/:id/wishlist - add a wishlist item
// (tables are already in schema.sql: groups, group_members, wishlist_items)
//
// the one route here is just a placeholder so the home page can list groups and people can click into the hints/reveal pages. feel free to replace it

const express = require('express');
const db = require('../../db/pool');
const { requireLogin } = require('../../auth');

const router = express.Router();

// placeholder: home page with the groups i'm in
// (requireLogin goes on each route here since this router is mounted at '/')
router.get('/', requireLogin, async (req, res) => {
  const { rows } = await db.query(
    `SELECT g.id, g.name FROM groups g
     JOIN group_members m ON m.group_id = g.id
     WHERE m.user_id = $1 ORDER BY g.created_at DESC`,
    [req.user.id]
  );
  res.render('home', { groups: rows });
});

module.exports = router;
