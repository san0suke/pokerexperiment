import type { AuthenticatedUser } from '@poker/shared';

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

export {};
