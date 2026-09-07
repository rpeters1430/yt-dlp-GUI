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

const PORT = process.env.PORT || 3000;
const SqliteStore = SqliteStoreFactory(session);

auth.ensureBootstrapAdmin();

const app = express();
app.use(express.json());
app.use(session({
  store: new SqliteStore({ client: db, expired: { clear: true, intervalMs: 900000 } }),
  secret: process.env.SESSION_SECRET || 'change-this-secret-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 30 * 24 * 60 * 60 * 1000 },
}));

app.use('/api/auth', authRoutes);
app.use('/api/downloads', downloadsRoutes);
app.use('/api/watches', watchesRoutes);
app.use('/api/settings', settingsRoutes);

const clientDist = path.join(__dirname, '..', '..', 'client', 'dist');
app.use(express.static(clientDist));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) return next();
  res.sendFile(path.join(clientDist, 'index.html'));
});

const server = http.createServer(app);
const io = new Server(server);

io.on('connection', (socket) => {
  socket.emit('jobs:init', queue.listJobs());
});

queue.init(io);
scheduler.start();

server.listen(PORT, () => {
  console.log(`yt-dlp GUI server listening on port ${PORT}`);
});
