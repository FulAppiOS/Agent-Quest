// Resolve the server host from the current browser URL when the env vars
// aren't set. This makes the app work transparently over LAN: if you open
// http://192.168.1.42:4445 from your phone, the client talks to
// http://192.168.1.42:4444 (same machine) instead of "localhost" (which on
// the phone means the phone itself).
function resolveHost(): string {
  if (typeof window === 'undefined') return 'localhost';
  return window.location.hostname || 'localhost';
}

const host = resolveHost();

export const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? `http://${host}:4444`;
export const WS_URL = import.meta.env.VITE_WS_URL ?? `ws://${host}:4444/ws`;
