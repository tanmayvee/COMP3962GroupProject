// Feature B: The Draw & Reminders
//
// TODO for person B:
//   POST /groups/:id/draw
// organizer draws names -> fills the assignments table,
// sets groups.drawn_at, emails everyone their pick
//   GET  /groups/:id/my-assignment - who am i buying for
// reminder emails before groups.exchange_date
//
// IMPORTANT: hints reads from the assignments table, so keep these columns:
//   assignments(id, group_id, giver_id, receiver_id)
// the seed data already has a finished draw so C can be tested in the meantime

const express = require('express');
const router = express.Router();

module.exports = router;
