// simple email + password login

const crypto = require('crypto');
const express = require('express');
const db = require('./db/pool');

// helpers

// stored as "salt:hash" so each password gets its own random salt
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function checkPassword(password, stored) {
  const [salt, hash] = (stored || '').split(':');
  if (!salt || !hash) return false;
  const attempt = crypto.scryptSync(password, salt, 64);
  // timingSafeEqual so you can't guess the hash by timing how long a wrong one takes
  return crypto.timingSafeEqual(attempt, Buffer.from(hash, 'hex'));
}

// middleware

// put this on any route that needs a logged-in user -> gives you req.user
// not logged in? you get sent to the login page
async function requireLogin(req, res, next) {
  if (!req.session.userId) return res.redirect('/login');
  const { rows } = await db.query('SELECT id, name, email FROM users WHERE id = $1', [req.session.userId]);
  if (!rows[0]) return res.redirect('/login');
  req.user = rows[0];
  res.locals.user = rows[0]; // so the header can show "logged in as X"
  next();
}

// makes sure you're in the group from :id in the url -> gives you req.group
async function requireMember(req, res, next) {
  // ids are numbers, anything else (like /groups/abc) would just error in postgres
  if (!/^\d+$/.test(req.params.id)) return res.status(404).render('error', { message: 'group not found' });
  const { rows } = await db.query(
    `SELECT g.* FROM groups g
     JOIN group_members m ON m.group_id = g.id
     WHERE g.id = $1 AND m.user_id = $2`,
    [req.params.id, req.user.id]
  );
  if (!rows[0]) return res.status(404).render('error', { message: 'group not found' });
  req.group = rows[0];
  next();
}

// routes

const router = express.Router();

router.get('/login', (req, res) => {
  if (req.session.userId) return res.redirect('/');
  res.render('login');
});

router.post('/login', async (req, res) => {
  const email = (req.body.email || '').trim().toLowerCase();
  const { rows: [user] } = await db.query('SELECT * FROM users WHERE email = $1', [email]);
  // same error either way so people can't fish for which emails exist
  if (!user || !checkPassword(req.body.password || '', user.password_hash)) {
    req.session.error = 'wrong email or password';
    return res.redirect('/login');
  }
  req.session.userId = user.id;
  res.redirect('/');
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

module.exports = { router, requireLogin, requireMember, hashPassword };
