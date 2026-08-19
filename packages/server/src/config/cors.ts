/**
 * Which browser origins may talk to this server.
 *
 * With CORS_ORIGIN set, only those exact origins are allowed (comma-separated) —
 * that is what production should use. With it unset, we run in "local network"
 * mode: any origin on loopback, a private LAN range, or Tailscale is allowed, so
 * the game can be opened from a phone on the same network without editing config
 * every time an IP changes.
 */

const PRIVATE_HOST_PATTERNS: RegExp[] = [
  /^localhost$/i,
  /^127\.\d+\.\d+\.\d+$/, // loopback
  /^10\.\d+\.\d+\.\d+$/, // private class A
  /^192\.168\.\d+\.\d+$/, // private class C
  /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/, // private class B
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d+\.\d+$/, // CGNAT — Tailscale
  /^\[::1\]$/, // IPv6 loopback
  /\.local$/i, // mDNS hostnames
];

function isPrivateOrigin(origin: string): boolean {
  let hostname: string;
  try {
    // URL keeps brackets off IPv6 hosts, so re-add them to match the pattern above.
    const url = new URL(origin);
    hostname = url.hostname.includes(':') ? `[${url.hostname}]` : url.hostname;
  } catch {
    return false;
  }
  return PRIVATE_HOST_PATTERNS.some((pattern) => pattern.test(hostname));
}

export function buildCorsOriginCheck(configured: string | undefined) {
  const allowlist = (configured ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

  return (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
    // Same-origin requests and non-browser clients (curl, the smoke test) send no Origin.
    if (!origin) {
      callback(null, true);
      return;
    }

    const allowed = allowlist.length > 0 ? allowlist.includes(origin) : isPrivateOrigin(origin);

    if (allowed) {
      callback(null, true);
    } else {
      callback(new Error(`Origin not allowed by CORS: ${origin}`));
    }
  };
}

export const isPrivateOriginForTesting = isPrivateOrigin;
