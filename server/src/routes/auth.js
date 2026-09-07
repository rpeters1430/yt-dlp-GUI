const express = require('express');
const auth = require('../auth');

const router = express.Router();

router.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

  const user = auth.login(username, password);
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });

  req.session.userId = user.id;
  req.session.username = user.username;
  res.json({ username: user.username });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

router.get('/me', (req, res) => {
  if (!req.session || !req.session.userId) return res.status(401).json({ error: 'Not authenticated' });
  res.json({ username: req.session.username });
});

router.post('/change-password', auth.requireAuth, (req, res) => {
  const { newPassword } = req.body || {};
  if (!newPassword || newPassword.length < 4) {
    return res.status(400).json({ error: 'Password must be at least 4 characters' });
  }
  auth.changePassword(req.session.userId, newPassword);
  res.json({ ok: true });
});

module.exports = router;
