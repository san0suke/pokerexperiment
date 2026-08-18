import type { NextFunction, Request, Response } from 'express';
import { verifyJwt } from './auth.service.js';

/** Guards REST routes. Expects `Authorization: Bearer <token>`. */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ message: 'Missing bearer token' });
    return;
  }

  try {
    const payload = verifyJwt(header.slice('Bearer '.length));
    req.user = { id: payload.sub, username: payload.username };
    next();
  } catch {
    res.status(401).json({ message: 'Invalid or expired token' });
  }
}
