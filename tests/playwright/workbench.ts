/**
 * Workbench + status-bar helpers for the Stats Bar E2E suite.
 *
 * Division of labour (meta repo `how-to-test-all.md` §3):
 *   REST Control → arrange + act   (enable/disable modules, change settings,
 *                                    invoke commands)
 *   CDP/Playwright → assert only    (the status-bar items the extension renders)
 *
 * Unlike a webview extension there is no iframe and no OOPIF here: the stats
 * bar items are ordinary status-bar DOM in the top-level workbench page, so
 * plain Playwright locators/`page.evaluate` see them.
 *
 * Identifying our items: the status bar is shared with other extensions and
 * the workbench itself. Every module under test is given a unique format
 * **marker** (e.g. `SBCPU`) via `statsBar.<module>.format`, so an item can be
 * found by its rendered text regardless of the live system values.
 */
import { chromium, expect, type Browser, type Page } from '@playwright/test';
import { restAvailable, restCmd, restEval } from './rest';

export const CDP_PORT = process.env.CDP_PORT || '9024';
export const CDP_ENDPOINT = `http://127.0.0.1:${CDP_PORT}`;
export const CODE_SERVER_URL =
	process.env.CODE_SERVER_URL ||
	'https://localhost:9620/?folder=/home/lamnt45/git/vscode-hacker-meta';

/** The extension under test (override for a fork). */
export const EXT_ID = process.env.STATS_BAR_EXT_ID || 'lamnguyenx.hacker-stats-bar';

export interface Workbench {
	browser: Browser;
	page: Page;
}

/** Connect to the already-running CDP browser and return the code-server tab. */
export async function connectWorkbench(): Promise<Workbench> {
	const browser = await chromium.connectOverCDP(CDP_ENDPOINT);
	const context = browser.contexts()[0];
	if (!context) throw new Error(`no browser context on ${CDP_ENDPOINT}`);

	const page =
		context.pages().find((p) => p.url().includes('localhost:9620')) ?? (await context.newPage());
	if (!page.url().includes('localhost:9620')) {
		await page.goto(CODE_SERVER_URL, { waitUntil: 'domcontentloaded' });
	}
	await page.locator('.monaco-workbench').waitFor({ timeout: 30000 });
	return { browser, page };
}

/** Reload the workbench (restarts the extension host) and wait until it is back. */
export async function reloadWorkbench(page: Page): Promise<void> {
	await page.reload({ waitUntil: 'domcontentloaded' });
	await page.locator('.monaco-workbench').waitFor({ timeout: 30000 });
	await waitForRest();
}

/** Poll until the REST Control endpoint answers again (e.g. after a reload). */
export async function waitForRest(timeoutMs = 30000): Promise<void> {
	await expect
		.poll(() => restAvailable().catch(() => false), { timeout: timeoutMs, intervals: [500, 1000, 2000] })
		.toBe(true);
}

// ---------------------------------------------------------------------------
// Status-bar oracle
// ---------------------------------------------------------------------------

/** Unique text marker per module, injected through `statsBar.<module>.format`. */
export const MODULE_MARKERS = {
	cpuLoad: 'SBCPU',
	loadavg: 'SBLD',
	networkSpeed: 'SBNET',
	memoUsage: 'SBMEM',
	uptime: 'SBUP',
	portSpeed: 'SBPORT',
} as const;

export type StatsModuleName = keyof typeof MODULE_MARKERS;

/** Modules that always have a value on Linux (portSpeed needs its daemon). */
export const BASELINE_MODULES: StatsModuleName[] = [
	'cpuLoad',
	'loadavg',
	'networkSpeed',
	'memoUsage',
	'uptime',
];

export const ALL_MODULES: StatsModuleName[] = Object.keys(MODULE_MARKERS) as StatsModuleName[];

/** Formats carrying the markers; `${...}` is the extension's display-format syntax. */
export const FORMATS: Record<StatsModuleName, string> = {
	cpuLoad: 'SBCPU ${percent}%',
	loadavg: 'SBLD ${1} ${5} ${15}',
	networkSpeed: 'SBNET ${up} ${up-unit}',
	memoUsage: 'SBMEM ${used}/${total}${unit}/${percent}%',
	uptime: 'SBUP ${days} ${hours} ${minutes}',
	portSpeed: 'SBPORT ${name} ${up}${up-unit} ${down}${down-unit}',
};

/** A closed TCP port, used as the "daemon unreachable" endpoint. */
export const DEAD_ENDPOINT = '127.0.0.1:1';

export interface StatusItem {
	text: string;
	aria: string;
	left: boolean;
	right: boolean;
}

/** All status-bar items, normalized (visible text, aria-label, alignment). */
export function statusItems(page: Page): Promise<StatusItem[]> {
	return page.evaluate(() =>
		[...document.querySelectorAll('.statusbar-item')].map((e) => ({
			text: (e.textContent || '').replace(/\s+/g, ' ').trim(),
			aria: e.querySelector('.statusbar-item-label')?.getAttribute('aria-label') || '',
			left: e.classList.contains('left'),
			right: e.classList.contains('right'),
		}))
	);
}

export interface StatsItem extends StatusItem {
	/** The module whose marker this item carries. */
	module: StatsModuleName;
	/** The text marker itself (`SB…`). */
	marker: string;
}

/** The stats-bar items we injected markers into, in DOM order. */
export async function statsItems(page: Page): Promise<StatsItem[]> {
	const items = await statusItems(page);
	const names = Object.keys(MODULE_MARKERS) as StatsModuleName[];
	const out: StatsItem[] = [];
	for (const item of items) {
		const module = names.find((name) => item.text.startsWith(MODULE_MARKERS[name]));
		if (module) out.push({ ...item, module, marker: MODULE_MARKERS[module] });
	}
	return out;
}

/** The markers currently rendered, in DOM order. */
export async function markers(page: Page): Promise<string[]> {
	return (await statsItems(page)).map((i) => i.marker);
}

/**
 * The DOM order a set of modules renders in. The status bar lays the right
 * section out right-to-left, so a right-aligned bar shows the configured
 * modules in reverse; the left section preserves the configured order.
 */
export function expectedMarkers(modules: StatsModuleName[], location: 'Left' | 'Right'): string[] {
	const ordered = modules.map((name) => MODULE_MARKERS[name]);
	return location === 'Right' ? [...ordered].reverse() : ordered;
}

/** Rendered text of the first item whose text contains `marker`. */
export function markerText(page: Page, marker: string): Promise<string | null> {
	return page.evaluate((m) => {
		const el = [...document.querySelectorAll('.statusbar-item')].find((e) =>
			(e.textContent || '').includes(m)
		);
		return el ? (el.textContent || '').replace(/\s+/g, ' ').trim() : null;
	}, marker);
}

/** aria-label (visible text + tooltip) of the first item containing `marker`. */
export function markerAria(page: Page, marker: string): Promise<string | null> {
	return page.evaluate((m) => {
		const el = [...document.querySelectorAll('.statusbar-item')].find((e) =>
			(e.textContent || '').includes(m)
		);
		return el?.querySelector('.statusbar-item-label')?.getAttribute('aria-label') ?? null;
	}, marker);
}

/** Text of the portSpeed item when it has no data (tooltip defaults to `PortSpeed`). */
export function portSpeedItemText(page: Page): Promise<string | null> {
	return page.evaluate(() => {
		const el = [...document.querySelectorAll('.statusbar-item')].find((e) =>
			(e.querySelector('.statusbar-item-label')?.getAttribute('aria-label') || '').endsWith(', PortSpeed')
		);
		return el ? (el.textContent || '').replace(/\s+/g, ' ').trim() : null;
	});
}

// ---------------------------------------------------------------------------
// Settings — Global scope, snapshot/restore so a run never mutates the profile.
// ---------------------------------------------------------------------------

export const CONFIG_KEYS = [
	'enabled',
	'location',
	'modules',
	'refreshInterval',
	'priority',
	'cpuLoad.format',
	'loadavg.format',
	'networkSpeed.format',
	'memoUsage.format',
	'uptime.format',
	'portSpeed.socketPath',
	'portSpeed.name',
	'portSpeed.format',
];

/** Global-scope values (or absent) of every `statsBar.*` key the suite touches. */
export function snapshotStatsConfig(): Promise<Record<string, unknown>> {
	return restEval<Record<string, unknown>>(`(() => {
		const cfg = vscode.workspace.getConfiguration('statsBar');
		const out = {};
		for (const k of ${JSON.stringify(CONFIG_KEYS)}) out[k] = cfg.inspect(k)?.globalValue;
		return out;
	})()`);
}

/** Restore the snapshot: set each key, or remove it when it was absent. */
export async function restoreStatsConfig(snapshot: Record<string, unknown>): Promise<void> {
	const payload = JSON.stringify(snapshot);
	await restEval(`(async () => {
		const cfg = vscode.workspace.getConfiguration('statsBar');
		const G = vscode.ConfigurationTarget.Global;
		const snap = JSON.parse(${JSON.stringify(payload)});
		for (const k of ${JSON.stringify(CONFIG_KEYS)}) {
			const v = snap[k];
			await cfg.update(k, v === null || v === undefined ? undefined : v, G);
		}
		return true;
	})()`);
	await new Promise((r) => setTimeout(r, 500));
}

/**
 * Read the Global-scope value of a `statsBar.*` key.
 *
 * Wrapped in an object because REST Control serializes a falsy result
 * (`false`, `0`, `''`) as `null`.
 */
export async function getStatsConfigGlobal<T = unknown>(key: string): Promise<T | undefined> {
	const res = await restEval<{ value: T | undefined }>(
		`({ value: vscode.workspace.getConfiguration('statsBar').inspect(${JSON.stringify(key)})?.globalValue })`
	);
	return res?.value;
}

/** Write several `statsBar.*` keys at Global scope in one round-trip. */
export async function setStatsConfigMap(map: Record<string, unknown>): Promise<void> {
	await restEval(`(async () => {
		const cfg = vscode.workspace.getConfiguration('statsBar');
		const G = vscode.ConfigurationTarget.Global;
		const map = ${JSON.stringify(map)};
		for (const k of Object.keys(map)) await cfg.update(k, map[k], G);
		return true;
	})()`);
	await new Promise((r) => setTimeout(r, 400));
}

/** Write one `statsBar.*` key at Global scope. */
export function setStatsConfig(key: string, value: unknown): Promise<void> {
	return setStatsConfigMap({ [key]: value });
}

/**
 * Put the bar in a known state: enabled, right-aligned, the baseline modules in
 * a fixed order, a fast refresh, and the marker formats. `overrides` wins.
 */
export async function resetStatsBar(overrides: Record<string, unknown> = {}): Promise<void> {
	await setStatsConfigMap({
		enabled: true,
		location: 'Right',
		refreshInterval: 1000,
		priority: -1,
		modules: BASELINE_MODULES,
		'cpuLoad.format': FORMATS.cpuLoad,
		'loadavg.format': FORMATS.loadavg,
		'networkSpeed.format': FORMATS.networkSpeed,
		'memoUsage.format': FORMATS.memoUsage,
		'uptime.format': FORMATS.uptime,
		'portSpeed.socketPath': DEAD_ENDPOINT,
		'portSpeed.name': 'Port 8140',
		'portSpeed.format': FORMATS.portSpeed,
		...overrides,
	});
}

// ---------------------------------------------------------------------------
// Notifications + clipboard
// ---------------------------------------------------------------------------

/** Remove leftover notification toasts. */
export function clearNotifications(): Promise<any> {
	return restCmd('notifications.clearAll').catch(() => undefined);
}

/** Concatenated text of the visible notification toasts. */
export function toastText(page: Page): Promise<string> {
	return page
		.locator('.notifications-toasts')
		.allTextContents()
		.then((parts) => parts.join(' ').replace(/\s+/g, ' ').trim());
}

/** Allow the test to read back the real browser clipboard. */
export async function grantClipboard(page: Page): Promise<void> {
	const origin = new URL(page.url()).origin;
	await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
}

/** Read the real browser clipboard (requires {@link grantClipboard}). */
export function readClipboard(page: Page): Promise<string> {
	return page.evaluate(() => navigator.clipboard.readText());
}
