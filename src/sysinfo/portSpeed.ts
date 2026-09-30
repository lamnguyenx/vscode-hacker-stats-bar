import * as net from 'net';
import * as vscode from 'vscode';
import { FRAME_SNAPSHOT, aggregate, consumeFrames, decodeSnapshot } from './protocol';
import type { PortSpeedData } from './protocol';

export { aggregate, consumeFrames, decodeSnapshot, encodeSnapshot } from './protocol';
export type { PortFlow, PortSpeedData } from './protocol';

/**
 * Client for the iftopd daemon (https://github.com/lamnt45/iftopd or
 * ~/git/iftopd). Connects to the daemon's Unix socket (or TCP endpoint),
 * reads SNAPSHOT frames and exposes the aggregated up/down rates for the
 * ports matching the daemon's capture filter.
 *
 * The byte-level protocol lives in `./protocol` (vscode-free, unit-tested).
 */

const DEFAULT_SOCKET = '/tmp/iftopd.sock';
const RECONNECT_DELAY = 5000;

let socket: net.Socket | null = null;
let buffer: Buffer = Buffer.alloc(0);
let reconnectTimer: NodeJS.Timeout | null = null;
let socketPath = '';
let lastData: PortSpeedData | undefined;
let warned = false;
let released = true;

/**
 * Stores the socket endpoint and (re)connects if it changed since the last
 * connection. Idempotent: safe to call on every settings change.
 */
export function portSpeedInit(path: string) {
  const nextPath = path || DEFAULT_SOCKET;
  if (nextPath === socketPath && socket) {
    return;
  }
  socketPath = nextPath;
  released = false;
  warned = false;
  disconnect();
  ensureConnected();
}

/** Disconnects and stops all timers. Called on deactivate. */
export function portSpeedRelease() {
  released = true;
  disconnect();
}

export async function getPortSpeed(): Promise<PortSpeedData | undefined> {
  if (released) {
    return undefined;
  }
  ensureConnected();
  return lastData;
}

function ensureConnected() {
  if (socket || reconnectTimer) {
    return;
  }
  connect();
}

function connect() {
  const path = socketPath;
  const { port, host } = parseEndpoint(path);
  socket = port !== undefined && host !== undefined ? net.connect(port, host) : net.connect(path);

  socket.on('connect', () => {
    warned = false;
    buffer = Buffer.alloc(0);
  });

  socket.on('data', chunk => {
    const part: Buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
    buffer = buffer.length > 0 ? Buffer.concat([buffer, part]) : part;
    const frames: { type: number; payload: Buffer }[] = [];
    buffer = consumeFrames(buffer, frames);
    frames.forEach(f => {
      if (f.type === FRAME_SNAPSHOT) {
        try {
          lastData = aggregate(decodeSnapshot(f.payload));
        } catch (err) {
          // ignore malformed frames
        }
      }
    });
  });

  socket.on('error', () => {
    // 'close' follows and triggers the reconnect
  });

  socket.on('close', () => {
    socket = null;
    if (released) {
      return;
    }
    warnOnce();
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, RECONNECT_DELAY);
  });
}

function disconnect() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (socket) {
    socket.removeAllListeners();
    socket.destroy();
    socket = null;
  }
  buffer = Buffer.alloc(0);
  lastData = undefined;
}

/** Endpoint parse: "host:port" => TCP, anything else => Unix socket path. */
function parseEndpoint(path: string): { port?: number; host?: string } {
  const match = /^(\S+?):(\d+)$/.exec(path.trim());
  if (!match) {
    return {};
  }
  const host = match[1];
  const port = Number(match[2]);
  return port > 0 && port <= 65535 ? { port, host } : {};
}

function warnOnce() {
  if (warned) {
    return;
  }
  warned = true;
  vscode.window.showWarningMessage(
    `Cannot connect to iftopd at ${socketPath}. Start the daemon, e.g.: sudo systemctl start iftopd`
  );
}
