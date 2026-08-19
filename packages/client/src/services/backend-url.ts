/**
 * Resolves where the backend lives.
 *
 * The client is served from whatever host the player typed — localhost on this
 * machine, a LAN IP from a phone, a Tailscale IP from outside. Hardcoding
 * "localhost" would break every case except the first, since on a phone
 * "localhost" is the phone itself. So we default to the same host the page came
 * from and only swap the port.
 *
 * Set VITE_API_URL / VITE_SOCKET_URL to override (e.g. when the backend is
 * deployed to a different domain than the client).
 */
const BACKEND_PORT = 3000;

function sameHostAs(page: Location, port: number): string {
  return `${page.protocol}//${page.hostname}:${port}`;
}

export const API_URL: string = import.meta.env.VITE_API_URL || sameHostAs(window.location, BACKEND_PORT);

export const SOCKET_URL: string =
  import.meta.env.VITE_SOCKET_URL || sameHostAs(window.location, BACKEND_PORT);
