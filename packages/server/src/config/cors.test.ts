import { describe, expect, it } from 'vitest';
import { buildCorsOriginCheck } from './cors.js';

/** Runs the express/socket.io style callback and returns whether the origin was allowed. */
function allows(configured: string | undefined, origin: string | undefined): boolean {
  const check = buildCorsOriginCheck(configured);
  let allowed = false;
  check(origin, (err, result) => {
    allowed = !err && result === true;
  });
  return allowed;
}

describe('CORS in local-network mode (CORS_ORIGIN unset)', () => {
  it('allows localhost on any port', () => {
    expect(allows(undefined, 'http://localhost:5173')).toBe(true);
    expect(allows(undefined, 'http://localhost:4000')).toBe(true);
  });

  it('allows private LAN addresses', () => {
    expect(allows(undefined, 'http://192.168.0.190:5173')).toBe(true);
    expect(allows(undefined, 'http://10.0.0.5:5173')).toBe(true);
    expect(allows(undefined, 'http://172.16.3.4:5173')).toBe(true);
    expect(allows(undefined, 'http://127.0.0.1:5173')).toBe(true);
  });

  it('allows Tailscale CGNAT addresses', () => {
    expect(allows(undefined, 'http://100.90.212.19:5173')).toBe(true);
    expect(allows(undefined, 'http://100.64.0.1:5173')).toBe(true);
    expect(allows(undefined, 'http://100.127.255.254:5173')).toBe(true);
  });

  it('allows requests with no Origin header (curl, native apps)', () => {
    expect(allows(undefined, undefined)).toBe(true);
  });

  it('rejects public internet origins', () => {
    expect(allows(undefined, 'http://evil.com')).toBe(false);
    expect(allows(undefined, 'https://example.com')).toBe(false);
    expect(allows(undefined, 'http://8.8.8.8')).toBe(false);
  });

  it('rejects public addresses that merely start with private-looking digits', () => {
    // 172.15 and 172.32 sit outside the private 172.16-31 block.
    expect(allows(undefined, 'http://172.15.0.1:5173')).toBe(false);
    expect(allows(undefined, 'http://172.32.0.1:5173')).toBe(false);
    // 100.128+ is outside the CGNAT block.
    expect(allows(undefined, 'http://100.128.0.1:5173')).toBe(false);
    expect(allows(undefined, 'http://100.63.0.1:5173')).toBe(false);
  });

  it('is not fooled by a private address embedded in a public hostname', () => {
    expect(allows(undefined, 'http://192.168.0.1.evil.com')).toBe(false);
    expect(allows(undefined, 'http://localhost.evil.com')).toBe(false);
  });

  it('rejects malformed origins', () => {
    expect(allows(undefined, 'not-a-url')).toBe(false);
  });
});

describe('CORS in allowlist mode (CORS_ORIGIN set)', () => {
  it('allows only the exact origins listed', () => {
    expect(allows('https://poker.com', 'https://poker.com')).toBe(true);
    expect(allows('https://poker.com', 'https://other.com')).toBe(false);
  });

  it('supports a comma-separated list', () => {
    const list = 'https://poker.com, https://www.poker.com';
    expect(allows(list, 'https://poker.com')).toBe(true);
    expect(allows(list, 'https://www.poker.com')).toBe(true);
    expect(allows(list, 'https://sneaky.com')).toBe(false);
  });

  it('stops trusting the local network once an allowlist is set', () => {
    expect(allows('https://poker.com', 'http://192.168.0.190:5173')).toBe(false);
  });
});
