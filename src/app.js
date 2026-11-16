// main server
// each feature lives in src/features/<name>/routes.js so we don't step on each other

require('dotenv').config();
const path = require('path');
const express = require('express');
const session = require('express-session');
const db = require('./db/pool');

const app = express();

// pages are ejs templates in /views
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));

app.use(express.urlencoded({ extended: false })); // reads normal html form posts
app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret',
  resave: false,
  saveUninitialized: false,
}));

// css + locally uploaded files
app.use(express.static(path.join(__dirname, '..', 'public')));
if (process.env.STORAGE_DRIVER !== 'aws') {
  app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));
}

// stuff every page can use
// user is filled in by requireLogin, error is a one-time message saved before a redirect
app.use((req, res, next) => {
  res.locals.user = null;
  res.locals.error = req.session.error || null;
  delete req.session.error;
  next();
});

// login/logout
app.use('/', require('./auth').router);

// features
app.use('/', require('./features/groups/routes'));          // A: groups & wishlists (home page for now)
app.use('/groups', require('./features/draw/routes'));      // B: draw & reminders
app.use('/groups', require('./features/hints/routes'));     // C: hints & reveal

// health check - good later for aws integration, but also just a nice sanity check for local dev
app.get('/health', (req, res) => res.json({ ok: true }));

// anything that didn't match a route
app.use((req, res) => res.status(404).render('error', { message: 'page not found' }));

// catch-all error so the server doesn't just die on a bad query
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).render('error', { message: 'something broke on the server' });
});

// start up
// local dev: boot the bundled postgres first and build + seed it on the very first run
// on AWS (DB_MODE=external) startLocalDb does nothing and we just connect to RDS
const { startLocalDb } = require('./db/local-db');
const { resetSchema, seedData } = require('./db/setup');

(async () => {
  const localDb = await startLocalDb();
  if (localDb.firstRun) {
    await resetSchema();
    await seedData();
  }

  const port = process.env.PORT || 3000;
  const server = app.listen(port, () => console.log(`Secret Santa running at http://localhost:${port}`));

  // shut postgres down cleanly on ctrl+c, or when --watch restarts us after a save
  const shutdown = async () => {
    server.close();
    await db.pool.end().catch(() => {});
    await localDb.stop().catch(() => {});
    process.exit(0);
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
})().catch((err) => {
  // some startup errors (like the bundled postgres failing) come through with no message
  console.error('startup failed:', (err && err.message) || err || 'unknown error');
  console.error("if it's the database, make sure the app isn't already running in another terminal (port 5433)");
  process.exit(1);
});
