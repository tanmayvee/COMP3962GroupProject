// the "build tables" and "add fake data" logic
// used by app.js on first run, and by npm run db:reset

const fs = require('fs');
const path = require('path');
const db = require('./pool');
const { hashPassword } = require('../auth');

async function resetSchema() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await db.query(sql);
  console.log('schema rebuilt');
}

// fake data: creates 4 users, one group and a fixed draw so hints work right away
async function seedData() {
  const users = [
    ['Alpha', 'alpha@example.com'],
    ['Bravo', 'bravo@example.com'],
    ['Charlie', 'charlie@example.com'],
    ['Delta', 'delta@example.com'],
  ];
  // same pass for everyone
  const ids = [];
  for (const [name, email] of users) {
    const { rows } = await db.query(
      'INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id',
      [name, email, hashPassword('password123')]
    );
    ids.push(rows[0].id);
  }

  // Alpha is organizer (change NULL to now() on line 36 for the default draw)
  const { rows: [group] } = await db.query(
    `INSERT INTO groups (name, join_code, organizer_id, budget, exchange_date, drawn_at)
     VALUES ('BCIT Squad Gift Exchange', 'SANTA1', $1, 30, '2026-12-18', NULL)
     RETURNING id`,
    [ids[0]]
  );

  for (const uid of ids) {
    await db.query('INSERT INTO group_members (group_id, user_id) VALUES ($1, $2)', [group.id, uid]);
  }

  // mock wishlist items for each user
  await db.query(
    `INSERT INTO wishlist_items (group_id, user_id, title) VALUES
     ($1, $2, 'Cozy socks'), ($1, $3, 'Mechanical keyboard keycaps'),
     ($1, $4, 'A good mystery novel'), ($1, $5, 'Plant for my desk')`,
    [group.id, ...ids]
  );

  // for-loop commented out now that we have the draw route, preserved for reference
  // pretend feature B already ran: Alpha->Bravo->Charlie->Delta->Alpha
  // for (let i = 0; i < ids.length; i++) {
  //   await db.query(
  //     'INSERT INTO assignments (group_id, giver_id, receiver_id) VALUES ($1, $2, $3)',
  //     [group.id, ids[i], ids[(i + 1) % ids.length]]
  //   );
  // }

  console.log('seeded: alpha/bravo/charlie/delta@example.com (password: password123), draw done');
}

module.exports = { resetSchema, seedData };
