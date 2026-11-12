// one shared postgres connection pool for the whole app
// locally it points at the bundled postgres, on AWS it'll point at RDS - same code either way
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool,
};
