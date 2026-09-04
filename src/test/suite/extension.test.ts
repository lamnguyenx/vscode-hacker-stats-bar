import * as assert from 'assert';

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import * as vscode from 'vscode';
import * as net from 'net';
import {
  aggregate,
  consumeFrames,
  decodeSnapshot,
  getPortSpeed,
  portSpeedInit,
  portSpeedRelease,
  PortFlow
} from '../../sysinfo/portSpeed';
// import * as myExtension from '../../extension';

function encodeSnapshot(flows: PortFlow[]): Buffer {
  const payload = Buffer.alloc(2 + flows.length * 13);
  payload[0] = 1; // protocol version
  payload[1] = flows.length;
  flows.forEach((f, i) => {
    const p = payload.slice(2 + i * 13);
    p.writeUInt16LE(f.localPort, 0);
    p.writeUInt16LE(f.remotePort, 2);
    p[4] = f.proto;
    p.writeFloatLE(f.up, 5);
    p.writeFloatLE(f.down, 9);
  });
  const out = Buffer.alloc(3 + payload.length);
  out.writeUInt16LE(payload.length + 1, 0); // length includes type byte
  out[2] = 0x10; // SNAPSHOT
  payload.copy(out, 3);
  return out;
}

suite('Extension Test Suite', () => {
  vscode.window.showInformationMessage('Start all tests.');

  test('Sample test', () => {
    assert.strictEqual(-1, [1, 2, 3].indexOf(5));
    assert.strictEqual(-1, [1, 2, 3].indexOf(0));
  });
});

suite('PortSpeed protocol', () => {
  test('decodeSnapshot parses entries', () => {
    const flows = [
      { localPort: 8140, remotePort: 47992, proto: 6, up: 1024.5, down: 2048.25 },
      { localPort: 8140, remotePort: 47993, proto: 17, up: 0, down: 1 }
    ];
    const payload = encodeSnapshot(flows).slice(3);
    const got = decodeSnapshot(payload);
    assert.strictEqual(got.length, 2);
    assert.deepStrictEqual(got[0], flows[0]);
    assert.deepStrictEqual(got[1], flows[1]);
  });

  test('decodeSnapshot handles empty snapshot', () => {
    const got = decodeSnapshot(encodeSnapshot([]).slice(3));
    assert.strictEqual(got.length, 0);
  });

  test('decodeSnapshot rejects bad version', () => {
    assert.throws(() => decodeSnapshot(Buffer.from([99, 0])));
  });

  test('decodeSnapshot rejects length mismatch', () => {
    assert.throws(() => decodeSnapshot(Buffer.from([1, 3, 0, 0])));
  });

  test('consumeFrames splits multiple frames and keeps partial tail', () => {
    const f1 = encodeSnapshot([{ localPort: 1, remotePort: 2, proto: 6, up: 1, down: 2 }]);
    const f2 = encodeSnapshot([{ localPort: 3, remotePort: 4, proto: 6, up: 3, down: 4 }]);
    const frames: { type: number; payload: Buffer }[] = [];
    const rest = consumeFrames(Buffer.concat([f1, f2, f2.slice(0, 5)]), frames);
    assert.strictEqual(frames.length, 2);
    assert.deepStrictEqual(decodeSnapshot(frames[0].payload), [
      { localPort: 1, remotePort: 2, proto: 6, up: 1, down: 2 }
    ]);
    assert.strictEqual(rest.length, 5); // partial third frame
  });

  test('consumeFrames drops desynced stream', () => {
    const frames: { type: number; payload: Buffer }[] = [];
    const rest = consumeFrames(Buffer.from([0x00, 0x00, 0x10]), frames);
    assert.strictEqual(frames.length, 0);
    assert.strictEqual(rest.length, 0);
  });

  test('aggregate sums up and down', () => {
    const data = aggregate([
      { localPort: 8140, remotePort: 1, proto: 6, up: 100, down: 50 },
      { localPort: 8140, remotePort: 2, proto: 6, up: 25, down: 75 },
      { localPort: 8140, remotePort: 3, proto: 17, up: 0, down: 0 }
    ]);
    assert.strictEqual(data.up, 125);
    assert.strictEqual(data.down, 125);
    assert.strictEqual(data.flows.length, 3);
  });
});

suite('PortSpeed daemon client', () => {
  test('connects to a fake iftopd and aggregates its snapshot', async () => {
    const flows: PortFlow[] = [{ localPort: 8140, remotePort: 47992, proto: 6, up: 100, down: 50 }];
    const server = net.createServer(sock => {
      sock.write(encodeSnapshot(flows));
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
    const port = (server.address() as net.AddressInfo).port;

    portSpeedInit(`127.0.0.1:${port}`);
    try {
      let data;
      const deadline = Date.now() + 3000;
      while (!data && Date.now() < deadline) {
        data = await getPortSpeed();
        if (!data) {
          await new Promise(r => setTimeout(r, 50));
        }
      }
      assert.ok(data, 'expected snapshot data from fake daemon');
      assert.strictEqual(data.up, 100);
      assert.strictEqual(data.down, 50);
      assert.strictEqual(data.flows.length, 1);
      assert.strictEqual(data.flows[0].localPort, 8140);
    } finally {
      portSpeedRelease();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  }).timeout(10000);
});
