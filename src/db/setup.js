// the "build tables" and "add fake data" logic
// used by app.js on first run, and by npm run db:reset

const fs = require('fs');
const path = require('path');
const db = require('./pool');
const { hashPassword } = require('../auth');
const { seedAccounts } = require('./seed-accounts');

async function resetSchema() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await db.query(sql);
  // log everyone out too, otherwise an old login could point at a different user after the reset
  // (.catch because the session table doesn't exist until the app has run once)
  await db.query('DELETE FROM session').catch(() => {});
  console.log('schema rebuilt');
}

// fake data: creates 4 users, one group and a fixed draw so hints work right away
async function seedData() {
  // alpha/bravo/charlie/delta, emails can be swapped for real ones with SEED_EMAILS (see seed-accounts.js)
  const users = seedAccounts();
  // same pass for everyone
  const ids = [];
  for (const { name, email } of users) {
    const { rows } = await db.query(
      'INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id',
      [name, email, hashPassword('password123')]
    );
    ids.push(rows[0].id);
  }

  //   "BCIT Squad Gift Exchange" (code 111111) - already drawn, so hints + reveal work right away
  const drawn = await makeGroup('BCIT Squad Gift Exchange', '111111', ids[0], true);

  // mock wishlist items for each user
  await db.query(
    `INSERT INTO wishlist_items (group_id, user_id, title) VALUES
     ($1, $2, 'Cozy socks'), ($1, $3, 'Mechanical keyboard keycaps'),
     ($1, $4, 'A good mystery novel'), ($1, $5, 'Plant for my desk')`,
    [drawn, ...ids]
  );

  // pretend feature B already ran on the drawn group: Alpha->Bravo->Charlie->Delta->Alpha for demonstration purposes, will remove later
  for (let i = 0; i < ids.length; i++) {
    await db.query(
      'INSERT INTO assignments (group_id, giver_id, receiver_id) VALUES ($1, $2, $3)',
      [drawn, ids[i], ids[(i + 1) % ids.length]]
    );
  }

  console.log(`seeded: ${users.map((u) => u.email).join(', ')} (password: password123)`);
  console.log('  "BCIT Squad Gift Exchange" (code 111111) already drawn');

  // makes a group with all 4 users in it, returns its id
  async function makeGroup(name, code, organizerId, alreadyDrawn) {
    const { rows: [group] } = await db.query(
      `INSERT INTO groups (name, join_code, organizer_id, budget, exchange_date, drawn_at)
       VALUES ($1, $2, $3, 30, '2026-12-18', ${alreadyDrawn ? 'now()' : 'NULL'})
       RETURNING id`,
      [name, code, organizerId]
    );
    for (const uid of ids) {
      await db.query('INSERT INTO group_members (group_id, user_id) VALUES ($1, $2)', [group.id, uid]);
    }
    return group.id;
  }
}

module.exports = { resetSchema, seedData };
