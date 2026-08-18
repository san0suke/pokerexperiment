import { Router } from 'express';
import type { AuthResponse } from '@poker/shared';
import { createUser, signJwt, validateCredentials } from './auth.service.js';

export const authRouter = Router();

authRouter.post('/register', async (req, res) => {
  const { username, email, password } = req.body ?? {};

  if (typeof username !== 'string' || username.length < 3) {
    return res.status(400).json({ message: 'Username must be at least 3 characters' });
  }
  if (typeof email !== 'string' || !email.includes('@')) {
    return res.status(400).json({ message: 'A valid email is required' });
  }
  if (typeof password !== 'string' || password.length < 6) {
    return res.status(400).json({ message: 'Password must be at least 6 characters' });
  }

  try {
    const user = await createUser({ username, email, password });
    const response: AuthResponse = { token: signJwt(user), user };
    return res.status(201).json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Registration failed';
    return res.status(409).json({ message });
  }
});

authRouter.post('/login', async (req, res) => {
  const { username, password } = req.body ?? {};

  if (typeof username !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ message: 'Username and password are required' });
  }

  const user = await validateCredentials(username, password);
  if (!user) {
    return res.status(401).json({ message: 'Invalid username or password' });
  }

  const response: AuthResponse = { token: signJwt(user), user };
  return res.json(response);
});
