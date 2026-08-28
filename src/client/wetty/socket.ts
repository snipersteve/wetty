import { io, type Socket } from 'socket.io-client';

export const trim = (str: string): string => str.replace(/\/*$/, '');

const socketBase = trim(window.location.pathname).replace(/ssh\/[^/]+$/, '');
export const socket: Socket = io(window.location.origin, {
  path: `${trim(socketBase)}/socket.io`,
  // Connected explicitly from wetty.ts once the bundled font is ready, so
  // the terminal opens with correct cell metrics and no early frames are
  // missed.
  autoConnect: false,
  // Phones drop and regain connectivity constantly (screen off, app
  // switch, Wi-Fi ⇄ cellular). Retry quickly and keep retrying forever;
  // the multiplexer session survives on the server, so a reconnect is
  // just a re-attach.
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 500,
  reconnectionDelayMax: 3000,
  randomizationFactor: 0.3,
  timeout: 8000,
});
