const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const db = require('./db');

function ensureBootstrapAdmin() {
  const count = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
  if (count > 0) return;

  const username = process.env.ADMIN_USER || 'admin';
  // No fixed fallback password: an unset ADMIN_PASSWORD gets a random one printed once,
  // instead of a well-known default that's a walk-in door on any exposed instance.
  const generated = !process.env.ADMIN_PASSWORD;
  const password = process.env.ADMIN_PASSWORD || crypto.randomBytes(9).toString('base64url');
  const hash = bcrypt.hashSync(password, 10);
  db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(username, hash);

  if (generated) {
    console.log('='.repeat(64));
    console.log(`Bootstrap admin user created: ${username}`);
    console.log(`Generated password (change it after logging in): ${password}`);
    console.log('This password is only shown here — it is not recoverable later.');
    console.log('='.repeat(64));
  } else {
    console.log(`Bootstrap admin user created: ${username}`);
  }
}

// Fixed hash to compare against when the username doesn't exist, so a login attempt for a
// nonexistent user takes about as long as one for a real user with a wrong password —
// bcrypt.compareSync is otherwise skipped entirely for an unknown username, which is a
// measurable timing difference an attacker can use to enumerate valid usernames.
const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-constant-time-login', 10);

// A session's stored sessionVersion must match the user's current session_version in the
// DB. changePassword() bumps that counter, so any other session issued before the change
// stops validating here — this is how a password change invalidates other logged-in
// sessions without needing a server-side session registry.
function validateSession(req) {
  if (!req.session || !req.session.userId) return null;
  const user = db.prepare('SELECT id, username, session_version FROM users WHERE id = ?').get(req.session.userId);
  if (!user || user.session_version !== req.session.sessionVersion) return null;
  return user;
}

function requireAuth(req, res, next) {
  const user = validateSession(req);
  if (!user) {
    if (req.session) req.session.destroy(() => {});
    return res.status(401).json({ error: 'Not authenticated' });
  }
  req.currentUser = user;
  next();
}

function login(username, password) {
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user) {
    bcrypt.compareSync(password, DUMMY_HASH);
    return null;
  }
  if (!bcrypt.compareSync(password, user.password_hash)) return null;
  return user;
}

function changePassword(userId, newPassword) {
  const hash = bcrypt.hashSync(newPassword, 10);
  db.prepare('UPDATE users SET password_hash = ?, session_version = session_version + 1 WHERE id = ?').run(hash, userId);
  return db.prepare('SELECT session_version FROM users WHERE id = ?').get(userId).session_version;
}

module.exports = { ensureBootstrapAdmin, requireAuth, validateSession, login, changePassword };
