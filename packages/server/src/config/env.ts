import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
// .env lives at the monorepo root so client and server share one file.
config({ path: resolve(here, '../../../../.env') });

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const env = {
  port: Number(process.env.PORT ?? 3000),
  databaseUrl: required('DATABASE_URL'),
  jwtSecret: required('JWT_SECRET'),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '24h',
  // Undefined means "allow local network origins" — see buildCorsOriginCheck.
  corsOrigin: process.env.CORS_ORIGIN,
  // 0.0.0.0 so other devices on the network can reach the API and the socket.
  host: process.env.HOST ?? '0.0.0.0',
};
