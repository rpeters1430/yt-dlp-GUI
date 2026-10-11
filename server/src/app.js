const path = require('path');
const express = require('express');
const session = require('express-session');
const SqliteStoreFactory = require('connect-sqlite3');

const db = require('./db');

const sqliteSessionDb = {
  exec(sql, callback) {
    try {
      db.exec(sql);
      if (callback) callback(null);
    } catch (error) {
      if (callback) callback(error);
      else throw error;
    }
  },
  run(sql, params, callback) {
    try {
      if (typeof params === 'function') {
        callback = params;
        params = [];
      }
      const values = Array.isArray(params) ? params : params == null ? [] : [params];
      const result = db.prepare(sql).run(...values);
      if (callback) callback(null, result);
    } catch (error) {
      if (callback) callback(error);
      else throw error;
    }
  },
  get(sql, params, callback) {
    try {
      if (typeof params === 'function') {
        callback = params;
        params = [];
      }
      const values = Array.isArray(params) ? params : params == null ? [] : [params];
      const row = db.prepare(sql).get(...values);
      if (callback) callback(null, row);
    } catch (error) {
      if (callback) callback(error);
      else throw error;
    }
  },
  all(sql, params, callback) {
    try {
      if (typeof params === 'function') {
        callback = params;
        params = [];
      }
      const values = Array.isArray(params) ? params : params == null ? [] : [params];
      const isWrite = /^\s*(?:INSERT|UPDATE|DELETE|REPLACE)\b/i.test(sql);
      const rows = isWrite ? [] : db.prepare(sql).all(...values);
      if (isWrite) {
        db.prepare(sql).run(...values);
      }
      if (callback) callback(null, rows);
    } catch (error) {
      if (callback) callback(error);
      else throw error;
    }
  },
};

const authRoutes = require('./routes/auth');
const downloadsRoutes = require('./routes/downloads');
const { createWatchesRouter } = require('./routes/watches');
const settingsRoutes = require('./routes/settings');
const twitchRoutes = require('./routes/twitch');
const cleanupRoutes = require('./routes/cleanup');
const jellyfinRoutes = require('./routes/jellyfin');
const plexRoutes = require('./routes/plex');
const musicRoutes = require('./routes/music');
const sitesRoutes = require('./routes/sites');
const libraryRoutes = require('./routes/library');
const notificationsRoutes = require('./routes/notifications');
const lidarrRoutes = require('./routes/lidarr');

const SqliteStore = SqliteStoreFactory(session);

// Builds the Express app and its session middleware without starting anything, so the real
// wiring (session, auth, every router) can be exercised by tests. index.js adds the server,
// socket.io and the background jobs.
function createApp({ watchRepository, watchService, checkAllWatches }) {
  const app = express();

  // Readiness includes database access and does not create a login session.
  app.get('/api/health', (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      db.prepare('SELECT 1').get();
      res.json({ status: 'ok' });
    } catch {
      res.status(503).json({ status: 'unavailable' });
    }
  });

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
    store: new SqliteStore({ db: sqliteSessionDb, table: 'sessions', concurrentDb: true }),
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
  app.use(express.urlencoded({ extended: true }));
  app.use(sessionMiddleware);

  app.use('/api/auth', authRoutes);
  app.use('/api/downloads', downloadsRoutes);
  app.use('/api/watches', createWatchesRouter({
    repository: watchRepository,
    watchService,
    checkAllWatches,
  }));
  app.use('/api/settings', settingsRoutes);
  app.use('/api/twitch', twitchRoutes);
  app.use('/api/cleanup', cleanupRoutes);
  app.use('/api/jellyfin', jellyfinRoutes);
  app.use('/api/plex', plexRoutes);
  app.use('/api/music', musicRoutes);
  app.use('/api/sites', sitesRoutes);
  app.use('/api/library', libraryRoutes);
  app.use('/api/notifications', notificationsRoutes);
  app.use('/api/lidarr', lidarrRoutes);
  app.use('/api/torznab', lidarrRoutes);
  app.use('/api/v2', lidarrRoutes.qbitRouter || lidarrRoutes);

  const clientDist = path.join(__dirname, '..', '..', 'client', 'dist');
  app.use(express.static(clientDist));
  app.get('/*splat', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(clientDist, 'index.html'));
  });

  return { app, sessionMiddleware };
}

module.exports = { createApp };
