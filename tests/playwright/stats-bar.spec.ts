import { test, expect, type Browser, type Page } from '@playwright/test';
import { restCmd, restEval } from './rest';
import { DEFAULT_FLOWS, closedEndpoint, startIftopd, type Iftopd } from './fixture';
import {
	BASELINE_MODULES,
	EXT_ID,
	clearNotifications,
	connectWorkbench,
	expectedMarkers,
	grantClipboard,
	getStatsConfigGlobal,
	markerAria,
	markerText,
	markers,
	portSpeedItemText,
	readClipboard,
	resetStatsBar,
	restoreStatsConfig,
	setStatsConfig,
	snapshotStatsConfig,
	statsItems,
	toastText,
} from './workbench';

/**
 * Stats Bar — code-server E2E (CDP browser on `CDP_PORT`).
 *
 * Arrange/act is REST Control only; Playwright asserts the status-bar DOM.
 * The bar is shared with the workbench and other extensions, so every module
 * under test is given a unique format marker (`SBCPU`, `SBNET`, …) and asserted
 * through that. Live values (cpu %, memory, uptime) are matched structurally;
 * the `portSpeed` values come from a deterministic fake iftopd daemon.
 *
 * Prereqs: code-server up with `lamnguyenx.hacker-stats-bar` installed (`make
 * build` + install + reload tab; see `docs/important/testing/how-to-test.md`) and the
 * CDP browser reachable on 9024.
 */

test.describe.configure({ mode: 'serial' });

const ALL_COMMANDS = [
	'StatsBar.CopyIp',
	'StatsBar.EnableAll',
	'StatsBar.DisableAll',
	'StatsBar.EnableCpuLoad',
	'StatsBar.DisableCpuLoad',
	'StatsBar.EnableNetworkSpeed',
	'StatsBar.DisableNetworkSpeed',
	'StatsBar.EnableLoadavg',
	'StatsBar.DisableLoadavg',
	'StatsBar.EnableMemoUsage',
	'StatsBar.DisableMemoUsage',
	'StatsBar.EnableUptime',
	'StatsBar.DisableUptime',
	'StatsBar.EnablePortSpeed',
	'StatsBar.DisablePortSpeed',
];

let browser: Browser;
let page: Page;
/** Global-scope settings this suite changes; restored in `afterAll`. */
let originals: Record<string, unknown> = {};

test.beforeAll(async () => {
	({ browser, page } = await connectWorkbench());

	// Snapshot Global-scope settings *before* touching anything, then force
	// activation (the extension is `onStartupFinished`, but a just-reloaded host
	// may not have run it yet).
	originals = await snapshotStatsConfig();
	await restEval(`(async () => {
		const ext = vscode.extensions.getExtension(${JSON.stringify(EXT_ID)});
		if (!ext) throw new Error('not installed: ' + ${JSON.stringify(EXT_ID)});
		await ext.activate();
		return ext.isActive;
	})()`);
});

test.beforeEach(async () => {
	await clearNotifications();
	await resetStatsBar();
});

test.afterAll(async () => {
	try {
		await restoreStatsConfig(originals);
		await clearNotifications();
	} finally {
		await browser.close();
	}
});

test('is installed and contributes every documented command', async () => {
	const extId = await restEval<string | null>(
		`vscode.extensions.getExtension(${JSON.stringify(EXT_ID)})?.id ?? null`
	);
	expect(extId, `${EXT_ID} is not installed in this code-server`).toBe(EXT_ID);

	const commands = await restEval<string[]>('vscode.commands.getCommands(true)');
	for (const cmd of ALL_COMMANDS) {
		expect(commands, `missing ${cmd}`).toContain(cmd);
	}
});

test('renders one status item per configured module, in order', async () => {
	await expect.poll(() => markers(page)).toEqual(expectedMarkers(BASELINE_MODULES, 'Right'));
});

test('each module format substitutes its variables', async () => {
	await expect.poll(() => markerText(page, 'SBCPU')).toMatch(/^SBCPU \d+%$/);
	await expect.poll(() => markerText(page, 'SBLD')).toMatch(/^SBLD \d+\.\d+ \d+\.\d+ \d+\.\d+$/);
	await expect.poll(() => markerText(page, 'SBNET')).toMatch(/^SBNET \d+ (KB|MB|GB)\/s$/);
	await expect.poll(() => markerText(page, 'SBMEM')).toMatch(/^SBMEM \d+\.\d+\/\d+\.\d+GB\/\d+%$/);
	await expect.poll(() => markerText(page, 'SBUP')).toMatch(/^SBUP \d+ \d+ \d+$/);

	// Non-portSpeed items default their tooltip to the module name.
	await expect.poll(() => markerAria(page, 'SBCPU')).toContain(', CpuLoad');
	await expect.poll(() => markerAria(page, 'SBNET')).toContain(', NetworkSpeed');
});

test('the configured module order drives the item order', async () => {
	const selected = ['uptime', 'cpuLoad', 'networkSpeed'] as const;
	await resetStatsBar({ modules: [...selected] });
	await expect.poll(() => markers(page)).toEqual(expectedMarkers([...selected], 'Right'));
});

test('statsBar.location moves the items between left and right', async () => {
	const allOnSide = async (side: 'left' | 'right') => {
		const items = await statsItems(page);
		return items.length === BASELINE_MODULES.length && items.every((i) => i[side]);
	};

	await resetStatsBar({ location: 'Left' });
	await expect.poll(() => allOnSide('left')).toBe(true);
	await expect.poll(() => markers(page)).toEqual(expectedMarkers(BASELINE_MODULES, 'Left'));

	await resetStatsBar({ location: 'Right' });
	await expect.poll(() => allOnSide('right')).toBe(true);
	await expect.poll(() => markers(page)).toEqual(expectedMarkers(BASELINE_MODULES, 'Right'));
});

test('a format change is applied live', async () => {
	await setStatsConfig('cpuLoad.format', 'SBCPU-LIVE ${percent}%');
	await expect.poll(() => markerText(page, 'SBCPU-LIVE')).toMatch(/^SBCPU-LIVE \d+%$/);
});

test('Disable/EnableNetworkSpeed toggle both the config and the item', async () => {
	await restCmd('StatsBar.DisableNetworkSpeed');
	await expect.poll(() => markers(page)).not.toContain('SBNET');
	expect(await getStatsConfigGlobal<string[]>('modules')).not.toContain('networkSpeed');

	await restCmd('StatsBar.EnableNetworkSpeed');
	await expect.poll(() => markers(page)).toContain('SBNET');
	expect(await getStatsConfigGlobal<string[]>('modules')).toContain('networkSpeed');
});

test('DisableAll / EnableAll hide and restore every item', async () => {
	await restCmd('StatsBar.DisableAll');
	await expect.poll(async () => (await statsItems(page)).length).toBe(0);
	expect(await getStatsConfigGlobal('enabled')).toBe(false);

	await restCmd('StatsBar.EnableAll');
	await expect.poll(async () => (await statsItems(page)).length).toBe(BASELINE_MODULES.length);
	expect(await getStatsConfigGlobal('enabled')).toBe(true);
});

test('StatsBar.CopyIp copies the IP and echoes it in a notification', async () => {
	await grantClipboard(page);
	// Sentinel so a stale clipboard can never satisfy the assertion.
	await page.evaluate(() => navigator.clipboard.writeText('__NOT_COPIED__'));

	await restCmd('StatsBar.CopyIp');

	await expect.poll(() => toastText(page), { timeout: 10000 }).toContain('was copied successfully');
	const text = await toastText(page);
	const match = /The IP (\S+) was copied successfully/.exec(text);
	expect(match, `unexpected CopyIp notification: ${text}`).not.toBeNull();

	// The notification is the user-visible echo; the clipboard proves the payload.
	await expect.poll(() => readClipboard(page), { timeout: 8000 }).toBe(match![1]);
});

test('portSpeed renders daemon rates and a per-flow tooltip', async () => {
	const daemon: Iftopd = await startIftopd(DEFAULT_FLOWS);
	try {
		await resetStatsBar({
			modules: ['portSpeed'],
			'portSpeed.socketPath': daemon.endpoint,
			'portSpeed.name': 'Port 8140',
		});

		// 1024 B/s -> 1 KB/s, 2048 B/s -> 2 KB/s (formatBytes rounds to whole units).
		await expect
			.poll(() => markerText(page, 'SBPORT'), { timeout: 15000 })
			.toBe('SBPORT Port 8140 1KB/s 2KB/s');

		const aria = await markerAria(page, 'SBPORT');
		expect(aria).toContain('8140 -> 47992 TCP');
		expect(aria).toContain('1 KB/s');
		expect(aria).toContain('2 KB/s');
	} finally {
		await daemon.stop();
	}
});

test('portSpeed shows "-" and warns when the daemon is unreachable', async () => {
	// A *fresh* closed endpoint (different from the baseline) guarantees a new
	// reconnect attempt, hence the one-time warning.
	const dead = await closedEndpoint();
	await resetStatsBar({ modules: ['portSpeed'], 'portSpeed.socketPath': dead });

	await expect.poll(() => portSpeedItemText(page), { timeout: 10000 }).toBe('-');
	await expect.poll(() => toastText(page), { timeout: 10000 }).toContain('Cannot connect to iftopd');
});
