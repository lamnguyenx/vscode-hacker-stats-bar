/**
 * Fake iftopd daemon for the Stats Bar E2E suite.
 *
 * The `portSpeed` module talks to the real `iftopd` over a Unix socket or a
 * `host:port` TCP endpoint. To keep the test self-contained we start a tiny
 * TCP server on the runner host that speaks the same SNAPSHOT wire protocol
 * with **deterministic** flows. Because code-server runs with
 * `network_mode: host`, the extension host (inside the container) reaches the
 * runner's `127.0.0.1` directly.
 *
 * The frame codec is imported from the shipped `src/sysinfo/protocol.ts`, so
 * the fixture and the extension cannot drift apart.
 */
import * as net from 'node:net';
import { encodeSnapshot, type PortFlow } from '../../src/sysinfo/protocol';

/** 1 KB/s up, 2 KB/s down — small enough for exact `formatBytes` assertions. */
export const DEFAULT_FLOWS: PortFlow[] = [
	{ localPort: 8140, remotePort: 47992, proto: 6, up: 1024, down: 2048 },
];

export interface Iftopd {
	readonly port: number;
	/** `host:port` value for `statsBar.portSpeed.socketPath`. */
	readonly endpoint: string;
	/** Change the snapshot the daemon keeps broadcasting. */
	setFlows(flows: PortFlow[]): void;
	stop(): Promise<void>;
}

/** Start a fake daemon broadcasting a SNAPSHOT frame every 250 ms. */
export async function startIftopd(flows: PortFlow[] = DEFAULT_FLOWS): Promise<Iftopd> {
	let current = flows;
	const sockets = new Set<net.Socket>();

	const server = net.createServer((sock) => {
		sockets.add(sock);
		sock.on('error', () => undefined);
		sock.on('close', () => sockets.delete(sock));
		sock.write(encodeSnapshot(current));
	});

	await new Promise<void>((resolve, reject) => {
		server.once('error', reject);
		server.listen(0, '127.0.0.1', () => resolve());
	});
	const port = (server.address() as net.AddressInfo).port;

	const timer = setInterval(() => {
		const frame = encodeSnapshot(current);
		for (const sock of sockets) sock.write(frame);
	}, 250);

	return {
		port,
		endpoint: `127.0.0.1:${port}`,
		setFlows(next: PortFlow[]) {
			current = next;
		},
		async stop() {
			clearInterval(timer);
			for (const sock of sockets) sock.destroy();
			await new Promise<void>((resolve) => server.close(() => resolve()));
		},
	};
}

/**
 * A `host:port` endpoint that is definitely not listening: bind a port, note
 * it, then release it. Used to force a *fresh* reconnect (and the one-time
 * warning) without relying on a well-known closed port.
 */
export async function closedEndpoint(): Promise<string> {
	const server = net.createServer();
	await new Promise<void>((resolve, reject) => {
		server.once('error', reject);
		server.listen(0, '127.0.0.1', () => resolve());
	});
	const port = (server.address() as net.AddressInfo).port;
	await new Promise<void>((resolve) => server.close(() => resolve()));
	return `127.0.0.1:${port}`;
}
