// npm run db:reset -> wipes the db, rebuilds tables, adds fresh seed data
// works whether or not `npm run dev` is running in another terminal
const db = require('./pool');
const { startLocalDb } = require('./local-db');
const { resetSchema, seedData } = require('./setup');

(async () => {
  const local = await startLocalDb();
  await resetSchema();
  await seedData();
  await db.pool.end();
  await local.stop();
})().catch((err) => {
  console.error('reset failed:', err.message);
  process.exit(1);
});
