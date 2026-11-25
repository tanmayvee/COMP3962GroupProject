// starts a real postgres that comes bundled with npm (the embedded-postgres package)
// so nobody has to install postgres or docker. data lives in the .localdb/ folder
//
// only used when DB_MODE=embedded in .env. on AWS we set DB_MODE=external
// and point DATABASE_URL at RDS instead, so this file just gets skipped

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const EmbeddedPostgres = require('embedded-postgres').default;

const DATA_DIR = path.join(__dirname, '..', '..', '.localdb');

// pull user/pass/port/db name out of DATABASE_URL so there's one place to change them
function parseUrl() {
  const url = new URL(process.env.DATABASE_URL);
  return {
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    port: Number(url.port) || 5432,
    database: url.pathname.slice(1),
  };
}

// checks if a postgres already answering on that port
async function alreadyRunning() {
  const client = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 1000 });
  try {
    await client.connect();
    await client.end();
    return true;
  } catch {
    return false;
  }
}

// returns { firstRun, stop() }. stop() is a no-op if we didn't start it ourselves
async function startLocalDb() {
  if (process.env.DB_MODE !== 'embedded') return { firstRun: false, stop: async () => {} };
  if (await alreadyRunning()) return { firstRun: false, stop: async () => {} };

  const { user, password, port, database } = parseUrl();
  const firstRun = !fs.existsSync(path.join(DATA_DIR, 'PG_VERSION'));

  const pg = new EmbeddedPostgres({
    databaseDir: DATA_DIR,
    user,
    password,
    port,
    persistent: true,      // keep data between runs
    onLog: () => {},       // postgres is chatty, keep the terminal clean
  });

  if (firstRun) {
    console.log('first run: setting up the local database...');
    await pg.initialise();
  }
  await pg.start();
  if (firstRun) await pg.createDatabase(database);

  console.log(`local postgres running on port ${port}`);
  return { firstRun, stop: () => pg.stop() };
}

module.exports = { startLocalDb };
