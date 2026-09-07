const path = require('path');
const express = require('express');
const session = require('express-session');
const SqliteStoreFactory = require('better-sqlite3-session-store');
const http = require('http');
const { Server } = require('socket.io');

const db = require('./db');
const auth = require('./auth');
const queue = require('./services/queue');
const scheduler = require('./services/scheduler');

const authRoutes = require('./routes/auth');
const downloadsRoutes = require('./routes/downloads');
const watchesRoutes = require('./routes/watches');
const settingsRoutes = require('./routes/settings');
const twitchRoutes = require('./routes/twitch');

const PORT = process.env.PORT || 3000;
const SqliteStore = SqliteStoreFactory(session);

auth.ensureBootstrapAdmin();

const app = express();

// Set TRUST_PROXY=1 when running behind a reverse proxy that terminates TLS, so
// express-session sees the proxy's forwarded HTTPS scheme and the `secure` cookie flag
// below actually gets sent. Set COOKIE_SECURE=1 once the app is reachable over HTTPS
// (directly or via that proxy) — it defaults off so plain-HTTP LAN deployments still work.
if (process.env.TRUST_PROXY === '1' || process.env.TRUST_PROXY === 'true') {
  app.set('trust proxy', 1);
}
const cookieSecure = process.env.COOKIE_SECURE === '1' || process.env.COOKIE_SECURE === 'true';

// Held in its own variable (rather than inline in app.use) so socket.io can run the same
// middleware over its handshake below and see the same req.session as the HTTP API.
const sessionMiddleware = session({
  store: new SqliteStore({ client: db, expired: { clear: true, intervalMs: 900000 } }),
  // Falls back to a secret persisted in the DB (generated once, on first boot) rather than
  // a hardcoded string, so an unset SESSION_SECRET env var can no longer let anyone forge
  // a session cookie against a known signing key.
  secret: process.env.SESSION_SECRET || db.getOrCreateSessionSecret(),
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 30 * 24 * 60 * 60 * 1000,
    httpOnly: true,
    // 'lax' withholds the cookie on cross-site POST/fetch requests (only same-site or
    // top-level GET navigations carry it), which combined with express.json() requiring
    // an application/json body — forcing a CORS preflight with no server exemptions for it
    // that a naive cross-site <form> can't send — is the app's CSRF defense.
    sameSite: 'lax',
    secure: cookieSecure,
  },
});

app.use(express.json());
app.use(sessionMiddleware);

app.use('/api/auth', authRoutes);
app.use('/api/downloads', downloadsRoutes);
app.use('/api/watches', watchesRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/twitch', twitchRoutes);

const clientDist = path.join(__dirname, '..', '..', 'client', 'dist');
app.use(express.static(clientDist));
app.get('/*splat', (req, res, next) => {
  if (req.path.startsWith('/api')) return next();
  res.sendFile(path.join(clientDist, 'index.html'));
});

const server = http.createServer(app);
const io = new Server(server);

// Run the same session middleware over the socket.io handshake so an unauthenticated
// client can't connect and read the full job list (URLs, titles, file paths) over the
// socket without ever hitting an auth-gated HTTP route.
io.use((socket, next) => sessionMiddleware(socket.request, {}, next));
io.use((socket, next) => {
  if (socket.request.session && socket.request.session.userId) return next();
  next(new Error('unauthorized'));
});

io.on('connection', (socket) => {
  socket.emit('jobs:init', queue.listJobs());
});

queue.init(io);
scheduler.init(io);
scheduler.start();

server.listen(PORT, () => {
  console.log(`yt-dlp GUI server listening on port ${PORT}`);
});
