const express = require('express');
const rateLimit = require('express-rate-limit');
const auth = require('../auth');

const router = express.Router();

// Login has no other brute-force defense (bcrypt alone isn't slow enough to matter against
// a networked attacker), so cap attempts per source IP: 10 tries per 15 minutes. Only
// failed attempts count against the limit (skipSuccessfulRequests) so a legitimate user
// isn't locked out by their own successful login.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { error: 'Too many login attempts. Try again later.' },
});

router.post('/login', loginLimiter, (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

  const user = auth.login(username, password);
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });

  // Regenerate the session id on login (not just reuse the pre-login one) to close the
  // session-fixation window where an attacker who planted a session id before login could
  // otherwise inherit the now-authenticated session.
  req.session.regenerate((err) => {
    if (err) return res.status(500).json({ error: 'Login failed' });
    req.session.userId = user.id;
    req.session.username = user.username;
    req.session.sessionVersion = user.session_version;
    res.json({ username: user.username });
  });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

router.get('/me', (req, res) => {
  const user = auth.validateSession(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  res.json({ username: user.username });
});

router.post('/change-password', auth.requireAuth, (req, res) => {
  const { newPassword } = req.body || {};
  if (!newPassword || newPassword.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }
  const newVersion = auth.changePassword(req.session.userId, newPassword);
  // Keep the session that made the change itself alive — only *other* sessions (issued
  // before this change) fail validateSession() on their next request.
  req.session.sessionVersion = newVersion;
  res.json({ ok: true });
});

module.exports = router;
