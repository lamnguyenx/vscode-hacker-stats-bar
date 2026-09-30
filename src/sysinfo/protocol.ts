/**
 * Pure wire-protocol logic for the iftopd client.
 *
 * Deliberately free of `vscode` and `net` imports so it can be unit-checked
 * with bun against the shipped source and reused by the E2E fixture daemon
 * (`tests/playwright/fixture.ts`). `src/sysinfo/portSpeed.ts` owns the socket
 * side and re-exports these helpers.
 *
 * Wire protocol (all integers little-endian):
 *   frame  = [len u16][type u8][payload...]      (len includes type + payload)
 *   snapshot payload = [ver u8][count u8] + count x 13 bytes:
 *     [local_port u16][remote_port u16][proto u8][up f32][down f32]
 */

export const FRAME_SNAPSHOT = 0x10;
export const PROTO_VERSION = 1;
export const SNAPSHOT_ENTRY_SIZE = 13;
export const MAX_FRAME_LEN = 65535;

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

/** Encodes a SNAPSHOT frame (length prefix + type byte + payload). */
export function encodeSnapshot(flows: PortFlow[]): Buffer {
  const payload = Buffer.alloc(2 + flows.length * SNAPSHOT_ENTRY_SIZE);
  payload[0] = PROTO_VERSION;
  payload[1] = flows.length;
  flows.forEach((f, i) => {
    const p = payload.slice(2 + i * SNAPSHOT_ENTRY_SIZE);
    p.writeUInt16LE(f.localPort, 0);
    p.writeUInt16LE(f.remotePort, 2);
    p[4] = f.proto;
    p.writeFloatLE(f.up, 5);
    p.writeFloatLE(f.down, 9);
  });
  const out = Buffer.alloc(3 + payload.length);
  out.writeUInt16LE(payload.length + 1, 0); // length includes type byte
  out[2] = FRAME_SNAPSHOT;
  payload.copy(out, 3);
  return out;
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
