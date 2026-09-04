import * as net from 'net';
import * as vscode from 'vscode';

/**
 * Client for the iftopd daemon (https://github.com/lamnt45/iftopd or
 * ~/git/iftopd). Connects to the daemon's Unix socket (or TCP endpoint),
 * reads SNAPSHOT frames and exposes the aggregated up/down rates for the
 * ports matching the daemon's capture filter.
 *
 * Wire protocol (all integers little-endian):
 *   frame  = [len u16][type u8][payload...]      (len includes type + payload)
 *   snapshot payload = [ver u8][count u8] + count x 13 bytes:
 *     [local_port u16][remote_port u16][proto u8][up f32][down f32]
 */

const DEFAULT_SOCKET = '/tmp/iftopd.sock';
const RECONNECT_DELAY = 5000;

const FRAME_SNAPSHOT = 0x10;
const PROTO_VERSION = 1;
const SNAPSHOT_ENTRY_SIZE = 13;
const MAX_FRAME_LEN = 65535;

export interface PortFlow {
  localPort: number;
  remotePort: number;
  proto: number; // 6 = TCP, 17 = UDP
  up: number; // bytes/sec
  down: number; // bytes/sec
}

export interface PortSpeedData {
  up: number;
  down: number;
  flows: PortFlow[];
}

let socket: net.Socket | null = null;
let buffer = Buffer.alloc(0);
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

/** Parses the SNAPSHOT frame payload into flows. */
export function decodeSnapshot(payload: Buffer): PortFlow[] {
  if (payload.length < 2) {
    throw new Error('snapshot payload too short');
  }
  if (payload[0] !== PROTO_VERSION) {
    throw new Error('unsupported protocol version');
  }
  const count = payload[1];
  if (payload.length !== 2 + count * SNAPSHOT_ENTRY_SIZE) {
    throw new Error('snapshot payload length mismatch');
  }
  const flows: PortFlow[] = [];
  for (let i = 0; i < count; i++) {
    const p = payload.slice(2 + i * SNAPSHOT_ENTRY_SIZE);
    flows.push({
      localPort: p.readUInt16LE(0),
      remotePort: p.readUInt16LE(2),
      proto: p[4],
      up: p.readFloatLE(5),
      down: p.readFloatLE(9)
    });
  }
  return flows;
}

/** Sums up/down over all flows (top-N snapshot from the daemon). */
export function aggregate(flows: PortFlow[]): PortSpeedData {
  let up = 0;
  let down = 0;
  flows.forEach(f => {
    up += f.up;
    down += f.down;
  });
  return { up, down, flows };
}

/**
 * Consumes all complete frames from a byte buffer, appending them to out.
 * Returns the remaining (partial) bytes. Drops the buffer entirely if the
 * stream is desynchronized (invalid length).
 */
export function consumeFrames(buf: Buffer, out: { type: number; payload: Buffer }[]): Buffer {
  let rest = buf;
  while (rest.length >= 3) {
    const len = rest.readUInt16LE(0);
    if (len < 1 || len > MAX_FRAME_LEN) {
      return Buffer.alloc(0);
    }
    if (rest.length < 3 + len - 1) {
      break;
    }
    out.push({ type: rest[2], payload: rest.slice(3, 3 + len - 1) });
    rest = rest.slice(3 + len - 1);
  }
  return rest;
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
    buffer = buffer.length > 0 ? Buffer.concat([buffer, chunk]) : chunk;
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
