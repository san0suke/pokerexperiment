import cors from 'cors';
import express from 'express';
import { env } from './config/env.js';
import { buildCorsOriginCheck } from './config/cors.js';
import { authRouter } from './auth/auth.routes.js';
import { requireAuth } from './auth/auth.middleware.js';

export function createApp() {
  const app = express();

  app.use(cors({ origin: buildCorsOriginCheck(env.corsOrigin) }));
  app.use(express.json());

  app.get('/health', (_req, res) => res.json({ status: 'ok' }));

  app.use('/auth', authRouter);

  // Sanity check that the JWT flow works end to end.
  app.get('/me', requireAuth, (req, res) => res.json({ user: req.user }));

  return app;
}
