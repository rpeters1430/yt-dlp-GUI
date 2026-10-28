const http = require('http');

const db = require('./db');
const { createApp } = require('./app');
const { createSocketServer } = require('./socket');
const auth = require('./auth');
const queue = require('./services/queue');
const scheduler = require('./services/scheduler');
const cleanup = require('./services/cleanup');
const jellyfinSync = require('./services/jellyfinSync');
const plexSync = require('./services/plexSync');
const dependencyUpdater = require('./services/dependencyUpdater');
const ytdlp = require('./services/ytdlp');
const notify = require('./services/notify');
const { createRepository } = require('./services/watch/repository');
const { createWatchService } = require('./services/watch/service');

const PORT = process.env.PORT || 3000;

// Node exits on an unhandled rejection by default, which would take every running download
// down with it over one stray promise (a media-server or network call during an outage).
process.on('unhandledRejection', (reason) => {
  console.error('[server] Unhandled promise rejection:', reason instanceof Error ? reason.stack : reason);
});

auth.ensureBootstrapAdmin();

// Socket.IO is created further down; watch updates are dropped until it exists.
let io = null;
const watchRepository = createRepository(db);
function emitWatchUpdate(watchId) {
  if (!io) return;
  try {
    const watch = watchRepository.getWatch(watchId);
    if (watch) io.emit('watch:update', watch);
  } catch (e) {
    console.error(`[watch] #${watchId} update broadcast failed: ${e.message}`);
  }
}
const watchService = createWatchService({ repository: watchRepository, ytdlp, queue, notify, emitWatchUpdate });
queue.setWatchItemListener((itemId, status, info) => {
  const item = watchRepository.applyDownloadState(itemId, status, info);
  if (item) {
    console.log(`[watch] #${item.watch_id} item ${itemId} (${item.video_id}) download ${info.downloadId} -> ${status}`);
    emitWatchUpdate(item.watch_id);
  }
});

const { app, sessionMiddleware } = createApp({ watchRepository, watchService, checkAllWatches: scheduler.checkAllWatches });

const server = http.createServer(app);
io = createSocketServer(server, {
  sessionMiddleware,
  onConnection(socket) {
    socket.emit('jobs:init', queue.listJobs());
    socket.emit('jobs:counts', queue.getStatusCounts());
  },
});

queue.init(io);
scheduler.init(watchService);
scheduler.start();
cleanup.init(io);
cleanup.start();
require('./services/linkGrabberCrawls').init(io);
const linkGrabberWatches = require('./services/linkGrabberWatches');
linkGrabberWatches.init(io);
linkGrabberWatches.start();
jellyfinSync.start();
plexSync.start();
dependencyUpdater.start();
require('./services/solverrProxy').start();
// Reads per-site feature support (e.g. --live-from-start) from the installed yt-dlp.
require('./services/siteProfiles').refreshYtdlpFacts();
// Log which JS runtimes yt-dlp can actually use for YouTube, so a missing one shows up in `docker logs`.
ytdlp.detectJsRuntimes().then((found) => {
  if (!found || found === 'none') {
    console.warn('[ytdlp:js] yt-dlp found no usable JS runtime; YouTube downloads may fail or lose formats');
  } else {
    console.log(`[ytdlp:js] JS runtimes available to yt-dlp: ${found}`);
  }
}).catch(() => {});

server.listen(PORT, () => {
  console.log(`yt-dlp GUI server listening on port ${PORT}`);
});
