// one shared postgres connection pool for the whole app
// locally it points at the bundled postgres, on AWS it'll point at RDS - same code either way
require('dotenv').config();
const { Pool } = require('pg');

// RDS only accepts encrypted connections, so turn on SSL when we're not on the bundled local db.
// rejectUnauthorized: false = encrypted but we don't check RDS's certificate (fine for a class project,
// a real app would load AWS's certificate bundle instead)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DB_MODE === 'external' ? { rejectUnauthorized: false } : false,
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool,
};
