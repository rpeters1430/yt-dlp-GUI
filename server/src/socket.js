const { Server } = require('socket.io');
const auth = require('./auth');

// Socket.IO server over the same session as the HTTP API. The handshake check alone isn't
// enough: a socket that's already connected would keep receiving every broadcast after its
// session is signed out (password change, logout), so those events re-check open sockets.
function createSocketServer(httpServer, { sessionMiddleware, onConnection }) {
  const io = new Server(httpServer);

  // Run the same session middleware over the handshake so an unauthenticated client can't
  // connect and read the job list (URLs, titles, file paths) without an auth-gated route.
  io.use((socket, next) => sessionMiddleware(socket.request, {}, next));
  io.use((socket, next) => {
    if (auth.validateSession(socket.request)) return next();
    next(new Error('unauthorized'));
  });
  if (onConnection) io.on('connection', onConnection);

  // A socket's session is a snapshot from its handshake; reload it from the store so the
  // session that made a change (which saved its new version) stays connected.
  function revalidateSockets() {
    for (const socket of io.sockets.sockets.values()) {
      const session = socket.request.session;
      if (!session || typeof session.reload !== 'function') {
        socket.disconnect(true);
        continue;
      }
      session.reload((err) => {
        if (err || !auth.validateSession(socket.request)) socket.disconnect(true);
      });
    }
  }
  auth.sessionEvents.on('changed', revalidateSockets);
  httpServer.on('close', () => auth.sessionEvents.off('changed', revalidateSockets));

  return io;
}

module.exports = { createSocketServer };
