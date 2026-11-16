// Feature C: Anonymous Hints & Gift Reveal
//
// every message belongs to an ASSIGNMENT (one santa -> giftee pair),
// and we just remember which side wrote it ('santa' or 'giftee').
// so when a giftee loads their messages, the server never has to send
// the santa's id or name until the group is revealed. 
// Anonymity on the backend too, not just hidden in UI :)

const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const path = require('path');
const db = require('../../db/pool');
const storage = require('../../services/storage');
const emailService = require('../../services/email');
const { requireLogin, requireMember } = require('../../auth');

const router = express.Router();
router.use(requireLogin);

// photos come in as a buffer in memory so we can hand them to the storage adapter
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB is plenty for a gift pic
  fileFilter: (req, file, cb) => cb(null, file.mimetype.startsWith('image/')),
});


// a group counts as revealed if the organizer clicked reveal, or the exchange date has arrived then we stamp it so it's official
async function isRevealed(group) {
  if (group.revealed_at) return true;
  // nothing to reveal if names were never drawn
  if (!group.drawn_at) return false;
  if (group.exchange_date && new Date(group.exchange_date) <= new Date()) {
    await db.query('UPDATE groups SET revealed_at = now() WHERE id = $1 AND revealed_at IS NULL', [group.id]);
    group.revealed_at = new Date();
    return true;
  }
  return false;
}

// the pair where i'm the santa
async function myAssignmentAsSanta(groupId, userId) {
  const { rows } = await db.query(
    `SELECT a.id, u.id AS giftee_id, u.name AS giftee_name
     FROM assignments a JOIN users u ON u.id = a.receiver_id
     WHERE a.group_id = $1 AND a.giver_id = $2`,
    [groupId, userId]
  );
  return rows[0] || null;
}

// the pair where i'm the giftee (we only pull giver info if revealed)
async function myAssignmentAsGiftee(groupId, userId, revealed) {
  const { rows } = await db.query(
    revealed
      ? `SELECT a.id, u.name AS santa_name FROM assignments a
         JOIN users u ON u.id = a.giver_id
         WHERE a.group_id = $1 AND a.receiver_id = $2`
      : `SELECT a.id FROM assignments a
         WHERE a.group_id = $1 AND a.receiver_id = $2`,
    [groupId, userId]
  );
  return rows[0] || null;
}

async function messagesFor(assignmentId, myRole) {
  const { rows } = await db.query(
    'SELECT id, from_role, body, created_at FROM hint_messages WHERE assignment_id = $1 ORDER BY created_at',
    [assignmentId]
  );
  // flip roles into "me"/"them" so the page doesn't have to think about it
  return rows.map((m) => ({ id: m.id, fromMe: m.from_role === myRole, body: m.body, createdAt: m.created_at }));
}

function cleanBody(body) {
  const text = (body || '').trim();
  if (!text) return { error: 'message is empty' };
  if (text.length > 500) return { error: 'keep it under 500 characters' };
  return { text };
}

// after a form post, save an error (if any) and go back to the page
function back(req, res, page, error) {
  if (error) req.session.error = error;
  res.redirect(`/groups/${req.group.id}/${page}`);
}

// hinting

// hints page: both of my chat threads
router.get('/:id/hints', requireMember, async (req, res) => {
  if (!req.group.drawn_at) return res.render('hints', { group: req.group, drawn: false });

  const revealed = await isRevealed(req.group);
  const asSanta = await myAssignmentAsSanta(req.group.id, req.user.id);
  const asGiftee = await myAssignmentAsGiftee(req.group.id, req.user.id, revealed);

  res.render('hints', {
    group: req.group,
    drawn: true,
    revealed,
    // thread 1: secretly talking to the person i'm buying for
    myGiftee: asSanta && {
      name: asSanta.giftee_name,
      messages: await messagesFor(asSanta.id, 'santa'),
    },
    // thread 2: my mystery santa talking to me
    mySanta: asGiftee && {
      name: revealed ? asGiftee.santa_name : null, // null until reveal
      messages: await messagesFor(asGiftee.id, 'giftee'),
    },
  });
});

// emails the other side of the chat when a new message comes in
// toRole 'giftee' = santa just sent a hint, so the giftee hears from "Your Secret Santa" (NO name in this one!)
// toRole 'santa'  = giftee just replied, the santa already knows who they're buying for so the name is fine
async function notifyNewMessage(req, assignmentId, toRole, text) {
  const { rows: [pair] } = await db.query(
    `SELECT g.name AS santa_name, g.email AS santa_email, r.name AS giftee_name, r.email AS giftee_email
     FROM assignments a
     JOIN users g ON g.id = a.giver_id
     JOIN users r ON r.id = a.receiver_id
     WHERE a.id = $1`,
    [assignmentId]
  );
  // link back to the hints page, works on localhost and on the real server
  const link = `${req.protocol}://${req.get('host')}/groups/${req.group.id}/hints`;

  const message = toRole === 'giftee'
    ? {
      to: pair.giftee_email,
      subject: 'Your Secret Santa sent you a message',
      greeting: `Hi ${pair.giftee_name},`,
      intro: `Your Secret Santa in "${req.group.name}" just sent you a message:`,
      action: 'Reply to your Santa',
    }
    : {
      to: pair.santa_email,
      subject: `${pair.giftee_name} replied to your hint`,
      greeting: `Hi ${pair.santa_name},`,
      intro: `${pair.giftee_name} (who you're buying for in "${req.group.name}") just replied:`,
      action: 'Reply without giving yourself away',
    };

  try {
    await emailService.send({
      to: message.to,
      subject: message.subject,
      body: emailService.letter(message.greeting, [message.intro, '', `"${text}"`, '', `${message.action}: ${link}`]),
    });
  } catch (err) {
    // the message is already saved, so a failed email shouldn't stop the chat
    console.error('hint email failed:', err.message);
  }
}

// santa sends a hint/question to their giftee
router.post('/:id/hints', requireMember, async (req, res) => {
  const { text, error } = cleanBody(req.body.body);
  if (error) return back(req, res, 'hints', error);

  // server figures out who your giftee is, you can't pick a target yourself
  const a = await myAssignmentAsSanta(req.group.id, req.user.id);
  if (!a) return back(req, res, 'hints', "names haven't been drawn yet");

  await db.query(
    `INSERT INTO hint_messages (assignment_id, from_role, body) VALUES ($1, 'santa', $2)`,
    [a.id, text]
  );
  await notifyNewMessage(req, a.id, 'giftee', text);
  back(req, res, 'hints');
});

// giftee replies back to their (still mystery) santa
router.post('/:id/hints/reply', requireMember, async (req, res) => {
  const { text, error } = cleanBody(req.body.body);
  if (error) return back(req, res, 'hints', error);

  const a = await myAssignmentAsGiftee(req.group.id, req.user.id, false);
  if (!a) return back(req, res, 'hints', "names haven't been drawn yet");

  await db.query(
    `INSERT INTO hint_messages (assignment_id, from_role, body) VALUES ($1, 'giftee', $2)`,
    [a.id, text]
  );
  await notifyNewMessage(req, a.id, 'santa', text);
  back(req, res, 'hints');
});

// reveal

// reveal page: status, who had who, and the photo wall
// pairs and photos only get loaded once the group is actually revealed
router.get('/:id/reveal', requireMember, async (req, res) => {
  const revealed = await isRevealed(req.group);
  const page = {
    group: req.group,
    isOrganizer: req.group.organizer_id === req.user.id,
    drawn: !!req.group.drawn_at,
    revealed,
    pairs: [],
    photos: [],
  };
  if (!revealed) return res.render('reveal', page);

  const { rows: pairs } = await db.query(
    `SELECT g.name AS santa, r.name AS giftee
     FROM assignments a
     JOIN users g ON g.id = a.giver_id
     JOIN users r ON r.id = a.receiver_id
     WHERE a.group_id = $1 ORDER BY g.name`,
    [req.group.id]
  );

  // photo wall
  const { rows } = await db.query(
    `SELECT p.id, p.s3_key, p.caption, u.name AS uploader
     FROM gift_photos p JOIN users u ON u.id = p.uploader_id
     WHERE p.group_id = $1 ORDER BY p.created_at DESC`,
    [req.group.id]
  );
  // turn storage keys into viewable urls - local path now, presigned S3 url later
  const photos = await Promise.all(
    rows.map(async (p) => ({ caption: p.caption, uploader: p.uploader, url: await storage.getUrl(p.s3_key) }))
  );

  res.render('reveal', { ...page, pairs, photos });
});

// organizer pulls the curtain
router.post('/:id/reveal', requireMember, async (req, res) => {
  if (req.group.organizer_id !== req.user.id) return back(req, res, 'reveal', 'only the organizer can reveal');
  if (!req.group.drawn_at) return back(req, res, 'reveal', 'draw names first');
  await db.query('UPDATE groups SET revealed_at = COALESCE(revealed_at, now()) WHERE id = $1', [req.group.id]);
  back(req, res, 'reveal');
});

// photo wall upload
router.post('/:id/photos', requireMember, upload.single('photo'), async (req, res) => {
  // no posting gift pics before the reveal
  if (!(await isRevealed(req.group))) return back(req, res, 'reveal', 'photo wall opens after the reveal');
  if (!req.file) return back(req, res, 'reveal', 'attach an image file');

  // random file name so people can't guess
  const ext = path.extname(req.file.originalname).toLowerCase() || '.jpg';
  const key = `groups/${req.group.id}/photos/${crypto.randomUUID()}${ext}`;
  await storage.save(key, req.file.buffer, req.file.mimetype);

  const caption = (req.body.caption || '').trim().slice(0, 200) || null;
  await db.query(
    'INSERT INTO gift_photos (group_id, uploader_id, s3_key, caption) VALUES ($1, $2, $3, $4)',
    [req.group.id, req.user.id, key, caption]
  );
  back(req, res, 'reveal');
});

module.exports = router;
