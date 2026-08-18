import type { ExtendedError, Socket } from 'socket.io';
import { verifyJwt } from '../auth/auth.service.js';

/** Rejects the handshake unless `socket.handshake.auth.token` carries a valid JWT. */
export function socketAuthMiddleware(
  socket: Socket,
  next: (err?: ExtendedError) => void,
): void {
  const token = socket.handshake.auth?.token;
  if (typeof token !== 'string' || token.length === 0) {
    next(new Error('Authentication token required'));
    return;
  }

  try {
    const payload = verifyJwt(token);
    socket.data.user = { id: payload.sub, username: payload.username };
    next();
  } catch {
    next(new Error('Invalid or expired token'));
  }
}
