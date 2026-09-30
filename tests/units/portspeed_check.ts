#!/usr/bin/env bun
/**
 * Pure-logic check of the iftopd wire protocol (`src/sysinfo/protocol.ts`).
 * No vscode and no socket — run with `bun tests/units/portspeed_check.ts`.
 */
import assert from 'node:assert';
import {
  FRAME_SNAPSHOT,
  aggregate,
  consumeFrames,
  decodeSnapshot,
  encodeSnapshot,
  type PortFlow
} from '../../src/sysinfo/protocol';

const section = (name: string): void => console.log(`\n== ${name} ==`);

const FLOWS: PortFlow[] = [
  { localPort: 8140, remotePort: 47992, proto: 6, up: 1024.5, down: 2048.25 },
  { localPort: 8140, remotePort: 47993, proto: 17, up: 0, down: 1 }
];

section('encodeSnapshot writes a framed SNAPSHOT');
const frame = encodeSnapshot(FLOWS);
assert.strictEqual(frame[2], FRAME_SNAPSHOT);
assert.strictEqual(frame.readUInt16LE(0), frame.length - 2); // len includes type byte
assert.strictEqual(frame.length, 3 + 2 + FLOWS.length * 13);
console.log('ok - length prefix and frame type');

section('decodeSnapshot round-trips entries and 32-bit floats');
assert.deepStrictEqual(decodeSnapshot(frame.slice(3)), FLOWS);
console.log('ok - flows survive encode/decode');

section('decodeSnapshot handles an empty snapshot');
assert.deepStrictEqual(decodeSnapshot(encodeSnapshot([]).slice(3)), []);
console.log('ok - zero flows');

section('decodeSnapshot rejects malformed payloads');
assert.throws(() => decodeSnapshot(Buffer.from([99, 0])), /protocol version/);
assert.throws(() => decodeSnapshot(Buffer.from([1, 3, 0, 0])), /length mismatch/);
assert.throws(() => decodeSnapshot(Buffer.from([1])), /too short/);
console.log('ok - bad version / length / short payload');

section('consumeFrames splits multiple frames and keeps a partial tail');
const f1 = encodeSnapshot([{ localPort: 1, remotePort: 2, proto: 6, up: 1, down: 2 }]);
const f2 = encodeSnapshot([{ localPort: 3, remotePort: 4, proto: 6, up: 3, down: 4 }]);
const frames: { type: number; payload: Buffer }[] = [];
const rest = consumeFrames(Buffer.concat([f1, f2, f2.slice(0, 5)]), frames);
assert.strictEqual(frames.length, 2);
assert.strictEqual(frames[0].type, FRAME_SNAPSHOT);
assert.deepStrictEqual(decodeSnapshot(frames[0].payload), [
  { localPort: 1, remotePort: 2, proto: 6, up: 1, down: 2 }
]);
assert.strictEqual(rest.length, 5);
console.log('ok - two frames and a 5-byte tail');

section('consumeFrames drops a desynchronized stream');
const dropped: { type: number; payload: Buffer }[] = [];
const left = consumeFrames(Buffer.from([0x00, 0x00, 0x10]), dropped);
assert.strictEqual(dropped.length, 0);
assert.strictEqual(left.length, 0);
console.log('ok - invalid length resets the buffer');

section('aggregate sums up and down over all flows');
const data = aggregate([
  { localPort: 8140, remotePort: 1, proto: 6, up: 100, down: 50 },
  { localPort: 8140, remotePort: 2, proto: 6, up: 25, down: 75 },
  { localPort: 8140, remotePort: 3, proto: 17, up: 0, down: 0 }
]);
assert.strictEqual(data.up, 125);
assert.strictEqual(data.down, 125);
assert.strictEqual(data.flows.length, 3);
console.log('ok - totals + flow list');

console.log('\nportspeed_check: all checks passed');
