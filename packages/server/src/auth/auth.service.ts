import bcrypt from 'bcryptjs';
import jwt, { type SignOptions } from 'jsonwebtoken';
import type { PublicUser } from '@poker/shared';
import { prisma } from '../db/prisma.js';
import { env } from '../config/env.js';

const SALT_ROUNDS = 10;

export interface JwtPayload {
  sub: string;
  username: string;
}

type UserRow = {
  id: string;
  username: string;
  email: string;
  chips: bigint;
};

function toPublicUser(user: UserRow): PublicUser {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    chips: Number(user.chips),
  };
}

export function signJwt(user: { id: string; username: string }): string {
  const payload: JwtPayload = { sub: user.id, username: user.username };
  // Cast: expiresIn comes from env as a plain string ("24h"), which the types model as a literal union.
  const options: SignOptions = { expiresIn: env.jwtExpiresIn as SignOptions['expiresIn'] };
  return jwt.sign(payload, env.jwtSecret, options);
}

export function verifyJwt(token: string): JwtPayload {
  return jwt.verify(token, env.jwtSecret) as JwtPayload;
}

export async function createUser(input: {
  username: string;
  email: string;
  password: string;
}): Promise<PublicUser> {
  const existing = await prisma.user.findFirst({
    where: { OR: [{ username: input.username }, { email: input.email }] },
  });
  if (existing) {
    throw new Error('Username or email already taken');
  }

  const passwordHash = await bcrypt.hash(input.password, SALT_ROUNDS);
  const user = await prisma.user.create({
    data: { username: input.username, email: input.email, passwordHash },
  });
  return toPublicUser(user);
}

export async function validateCredentials(
  username: string,
  password: string,
): Promise<PublicUser | null> {
  const user = await prisma.user.findUnique({ where: { username } });
  if (!user) {
    return null;
  }
  const matches = await bcrypt.compare(password, user.passwordHash);
  return matches ? toPublicUser(user) : null;
}
