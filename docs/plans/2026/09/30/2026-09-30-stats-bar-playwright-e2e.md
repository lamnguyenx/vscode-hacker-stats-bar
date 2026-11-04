# Stats Bar: committed bun pure-logic checks + Playwright E2E suite

**Date:** 2026-09-30
**Status:** DONE — `bun` units pass, `npm run typecheck:tests` clean,
`npm run lint` 0 errors, `make test-e2e` → **11 passed** (~50 s), and
`Machine/settings.json` is byte-identical before/after a run.
**Scope:** `src/sysinfo/protocol.ts` (new), `src/sysinfo/portSpeed.ts`,
`src/test/**` (removed), `tests/units/*` (new), `tests/playwright/*` (new),
`playwright.config.ts` (new), `tsconfig.tests.json` (new), `tsconfig.json`,
`package.json`, `package-lock.json`, `Makefile`, `.gitignore`, `.vscodeignore`,
`docs/important/testing/how-to-test.md` (new), `AGENTS.md` (new), and the meta repo's
`docs/important/testing/how-to-test-all.md` reference map.

---

## 0. Session summary

One session gave *Hacker Stats Bar* the same two-layer test setup as its
counterparts (`hacker-browser`, `hacker-path-picker`,
`hacker-terminal-enhanced`):

| Phase | Delivered |
| --- | --- |
| **Pure logic** | Extracted the `iftopd` wire codec into a `vscode`-free `src/sysinfo/protocol.ts`; `tests/units/{format,portspeed}_check.ts` |
| **E2E core** | `@playwright/test` project (`rest.ts`, `workbench.ts`, `fixture.ts`, `stats-bar.spec.ts`), `playwright.config.ts`, `tsconfig.tests.json` |
| **Oracle** | Unique **format markers** (`SBCPU`, `SBNET`, …) to isolate our items in the shared status bar; a fake `iftopd` TCP daemon for exact `portSpeed` rates + tooltip; notification toasts + the real browser clipboard for `CopyIp` |
| **Hygiene** | Global/machine settings snapshot/restore, verified by `md5sum` of `Machine/settings.json`; Playwright artifacts under gitignored `exp/playwright` |
| **Legacy** | Removed the default `vscode-test`/mocha scaffold; its protocol tests were migrated into the bun units |
| **Docs** | `docs/important/testing/how-to-test.md`, `AGENTS.md`, meta reference map |

---

## 1. Problem

The extension shipped only the **default `vscode-test` scaffold**
(`src/test/{runTest.ts,suite/index.ts,suite/extension.test.ts}`) — a placeholder
"Sample test", the old `PortSpeed protocol` mocha cases, and a fake-daemon test
that required downloading VS Code. There was no `tests/` tree, no
`playwright.config.ts`, and no committed browser-level coverage of the one thing
the extension actually produces: **status-bar items**.

## 2. Goal

A committed, runnable suite in the modern repo style:

- **bun** pure-logic checks against the shipped sources (no host, no compile),
- **`@playwright/test`** E2E where REST Control arranges/acts and CDP asserts,
- plus docs that match the code-server topology.

## 3. Design

```
Layer          Needs                        How
-----------------------------------------------------------------------------
Pure logic     bun only                     import src/utils + src/sysinfo/protocol
E2E (act)      code-server + REST Control   executeCommand / custom.eval + settings
E2E (assert)   CDP browser (Playwright)     .statusbar-item DOM + notifications + clipboard
```

### Why `portSpeed.ts` was split

`src/sysinfo/portSpeed.ts` imported `vscode` (for the one-time reconnect
warning), so bun could not import it. The byte-level codec — `encodeSnapshot`,
`decodeSnapshot`, `aggregate`, `consumeFrames`, the frame constants and types —
moved to **`src/sysinfo/protocol.ts`**, which imports only `Buffer`.
`portSpeed.ts` imports it and re-exports the public names, so existing callers
keep working. This mirrors path-picker's `truncateLeft → src/text.ts`
extraction, and lets the **E2E fixture reuse the shipped encoder** so the fake
daemon and the extension cannot disagree about the wire format.

### The oracle: the status bar is shared, so brand it

The bar already carries Git, Problems, the REST Control port, other extensions.
A status item is also invisible to the extension-host API, so the DOM is the
only oracle. Live values (cpu %, memory, uptime) cannot be pinned. Two tricks:

1. **Marker formats.** Before asserting, the suite sets
   `statsBar.<module>.format` to a string starting with a unique marker
   (`SBCPU ${percent}%`, `SBNET ${up} ${up-unit}`, …). Items are then found by
   text and matched structurally (`/^SBCPU \d+%$/`).
2. **Deterministic `portSpeed`.** `tests/playwright/fixture.ts` starts a TCP
   daemon on the runner host that broadcasts SNAPSHOT frames every 250 ms with
   fixed flows (1024 up / 2048 down → `1KB/s` / `2KB/s`). The extension's
   `socketPath` accepts `host:port`; code-server runs `network_mode: host`, so
   the container reaches the runner's `127.0.0.1`.

Item identification has one wrinkle: when a module has no value yet,
`formatRes` returns the literal `-` and **ignores the custom format** — so the
disconnected `portSpeed` item is found by `aria-label` ending `, PortSpeed`
instead of by marker.

### Files

- `tests/units/format_check.ts` — `formatBytes`, `formatTimes`, `formatByDict`.
- `tests/units/portspeed_check.ts` — encode/decode round-trip, frame splitting,
  desync drop, aggregation, malformed payloads.
- `tests/playwright/rest.ts` — REST Control client (`HACKER_REST_CONTROL_PORT`).
- `tests/playwright/workbench.ts` — `connectWorkbench()`, status-item helpers,
  marker formats, settings snapshot/restore, notifications, clipboard.
- `tests/playwright/fixture.ts` — the fake `iftopd` daemon + `closedEndpoint()`.
- `tests/playwright/stats-bar.spec.ts` — 11 tests.
- `playwright.config.ts`, `tsconfig.tests.json`.

### Tests

| # | Test | Assert |
| --- | --- | --- |
| 1 | installed and contributes every command | extension id + all 15 `StatsBar.*` commands |
| 2 | one status item per configured module, in order | markers match configured modules (see Trial B) |
| 3 | each module format substitutes its variables | structural regex per module + default tooltip |
| 4 | configured module order drives the item order | custom order renders accordingly |
| 5 | `statsBar.location` moves items left/right | alignment + order on both sides |
| 6 | a format change is applied live | `onDidChangeConfiguration` restarts the items |
| 7 | Disable/EnableNetworkSpeed | both the config value and the item toggle |
| 8 | DisableAll / EnableAll | zero items, then all baseline items back |
| 9 | `StatsBar.CopyIp` | toast `The IP … was copied successfully` + browser clipboard |
| 10 | portSpeed renders daemon rates + flow tooltip | exact `SBPORT Port 8140 1KB/s 2KB/s` + `8140 -> 47992 TCP` |
| 11 | portSpeed unreachable | item `-`, one-time `Cannot connect to iftopd` toast |

## 4. Trials, errors and lessons learnt

These cost real time; recording them so the next person skips them.

### A. Installed into the wrong code-server data dir (twice-distinct profiles)

The compose file mounts the repo's
`exp/code-server/.local/share/code-server` to `/home/lamnt45/.local/share/code-server`
**inside the container**, but the host `code-server --install-extension` writes
to the literal path it is given. Passing the container-style
`/home/lamnt45/.local/share/code-server` therefore edited a **different,
separately-running host code-server profile**, while the container kept loading
the old `njzy.stats-bar-0.5.2`. Only installing to the **host mount source**
(`…/exp/code-server/.local/share/code-server`) made the container see it.

The host profile mutation was undone at the end: the accidental
`lamnguyenx.hacker-stats-bar` install was removed and `njzy.stats-bar` was
reinstalled there. *Lessons: pass the mount source, not the container path; and
before touching installs, identify every code-server data dir in play (there
were two, one of them also running).*

### B. Right-aligned status items render in reverse creation order

Test 2 expected the DOM order to equal the configured `modules` order and got
the exact reverse:

```
Right ["SBUP","SBMEM","SBNET","SBLD","SBCPU"]   ← reverse
Left  ["SBCPU","SBLD","SBNET","SBMEM","SBUP"]   ← configured order
```

Probed directly (a tiny throwaway script) before changing the test. The right
section is laid out right-to-left, so a right-aligned bar shows the configured
modules in reverse; the left section preserves order. Fixed with an
`expectedMarkers(modules, location)` helper and kept as a real assertion.
*Lesson: status-bar order is an alignment artifact — assert it, don't assume it.*

### C. REST Control serializes falsy results as `null`

`getStatsConfigGlobal('enabled')` returned `null` after `DisableAll` instead of
`false`, because the server does `JSON.stringify(data || null)`. Fixed by
returning a wrapper: `` ({ value: …inspect(key)?.globalValue }) ``, which is
always truthy. *Lesson: any oracle that can legitimately be `false`/`0`/`''`
must be boxed through the REST boundary.*

### D. `@types/node` 26 + TypeScript 5.5 broke the old `Buffer` typing

`let buffer = Buffer.alloc(0)` inferred `Buffer<ArrayBuffer>`, and the socket
`'data'` event now types its argument as `string | NonSharedBuffer`:

```
error TS2322: Type 'string | NonSharedBuffer' is not assignable to type 'Buffer<ArrayBuffer>'.
```

Fixed by annotating `let buffer: Buffer` and normalizing the chunk
(`typeof chunk === 'string' ? Buffer.from(chunk) : chunk`). *Lesson: modernizing
`@types/node` is a source change, not just a tooling bump.*

### E. Prettier 2.x cannot parse inline `type` import modifiers

`import { …, type PortSpeedData } from './protocol'` (TS 4.5 syntax) made
`eslint-plugin-prettier` (Prettier 2.3) fail with a **parse error**. Split into
a separate `import type { PortSpeedData } from './protocol'`. *Lesson: match new
syntax to the repo's pinned formatter, or bump the whole toolchain.*

### F. `statsBar.*` are `machine-overridable` — writes don't go to `User/settings.json`

The settings are declared `scope: machine-overridable`. Under code-server,
`ConfigurationTarget.Global` writes land in
`<user-data-dir>/Machine/settings.json`, and `inspect().globalValue` reflects
them. The snapshot/restore helper already worked once this was understood; the
correct check is a **checksum of `Machine/settings.json`**, not of
`User/settings.json`. This is now documented and verified.

### G. A throwaway probe polluted the machine settings

An ad-hoc order-probe script wrote marker formats and never restored them, so
the **next suite run's `beforeAll` snapshot captured the polluted state** and
faithfully restored *that* at the end. The true original had to be written back
explicitly through the API, then confirmed by re-running the suite and
checksumming. *Lesson: scratch probes that mutate settings must use the same
snapshot/restore discipline as the suite — or run before the suite snapshots.*

### H. Disconnected `portSpeed` has no marker

`formatRes` returns `-` when there is no data and never touches the custom
format, so a marker-based lookup misses the unreachable-daemon item. It is found
by `aria-label` ending `, PortSpeed`.

### I. The one-time warning needs a fresh endpoint

`warnOnce` resets only when `portSpeedInit` sees a *new* socket path.
Re-selecting the baseline dead port produced no warning; the test allocates a
**newly closed port** via `closedEndpoint()` so a reconnect actually re-warns.

### J. The extension id differs across forks

The container had `njzy.stats-bar` (old fork, same `StatsBar.*` command ids)
while this checkout publishes `lamnguyenx.hacker-stats-bar`. The suite targets
the latter (`STATS_BAR_EXT_ID` override), and the stale fork was uninstalled.

### K. Clipboard works here (unlike path-picker)

`StatsBar.CopyIp` writes via `vscode.env.clipboard.writeText`; the suite grants
Playwright clipboard permissions and reads the value back from
`navigator.clipboard.readText()` in the page, comparing it to the IP parsed out
of the toast. This mirrors what worked in `hacker-terminal-enhanced`; the
path-picker note about a hanging **host-side** `readText()` does not apply to
the browser-side read.

## 5. Verification

```sh
cd _submodules/vscode-hacker-stats-bar
npm install
npm run compile          # clean
npm run lint             # 0 errors (2 pre-existing warnings)
make test-units          # format_check + portspeed_check -> all passed
make typecheck-tests     # clean

make build               # -> build/lamnguyenx.hacker-stats-bar-2026.9.3.vsix

# container code-server data dir == the repo's exp mount source
UD=/home/lamnt45/git/vscode-hacker-meta/exp/code-server/.local/share/code-server
code-server --uninstall-extension njzy.stats-bar --user-data-dir "$UD" --extensions-dir "$UD/extensions"
code-server --install-extension build/lamnguyenx.hacker-stats-bar-2026.9.3.vsix --force \
  --user-data-dir "$UD" --extensions-dir "$UD/extensions"
# reload the workbench tab, then:
make test-e2e            # 11 passed (~50s)
```

Run history / observations on the reference stack:

- First E2E: 7 passed, stopped at test 2 (Trial B).
- Second E2E: 7 passed, stopped at test 8 (Trial C).
- Third E2E: **11 passed (32.5 s)**.
- After rebuilding from the final source and reloading: **11 passed (50.3 s)**,
  `Machine/settings.json` md5 unchanged before/after.
- Pure logic: both unit files pass; `typecheck:tests` and `compile` clean.

## 6. Follow-ups

- **Priority ordering** (`statsBar.priority`) is not asserted: the workbench
  interleaves foreign status items whose relative order is not stable. Could be
  covered by asserting only relative order among our own items under distinct
  priorities.
- **Refresh timing** (`statsBar.refreshInterval`) is pinned to the 1000 ms
  minimum but not asserted directly.
- **Real `iftopd` / Unix socket** is not exercised end to end — only the wire
  protocol (bun) and the TCP transport (E2E).
- **Dev-host (Option B)** is documented but not committed; helpers assume the
  runner and extension host reach the same `127.0.0.1`.
- The legacy `vscode-test` scaffold was removed rather than kept side by side;
  if anyone still wants `npm test` to run VS Code's own test harness, it would
  need to be reintroduced deliberately.

## 7. Lessons (consolidated)

### Environment & installs

- **Pass the host mount source to `--user-data-dir`, not the container path.**
  Multiple code-server profiles can coexist; verify which one a running host
  actually loads (`vscode.extensions.getExtension(id)`) instead of listing a dir.
- **Clean up accidental profile changes.** A mistaken install into another
  profile was undone by uninstalling the wrong extension and reinstalling the
  original there.

### Test design

- **Brand a shared chrome surface.** Unique format markers turned a noisy status
  bar into a deterministic oracle without touching the extension.
- **Reuse the shipped codec in fixtures.** The fake daemon imports
  `encodeSnapshot`, so protocol drift is impossible.
- **Box falsy values across the REST boundary.**
- **Assert alignment-aware order** (right bar = reverse) rather than assuming
  left-to-right.
- **For "no data" states, identify by tooltip/aria, not by format marker** — the
  format is not applied when there is no value.

### Source structuring

- **Extract pure logic out of `vscode`-importing modules** so `bun` can test it;
  re-export to keep callers stable.
- **Modern `@types/node` is a compile-time behavior change** (generic `Buffer`,
  `data` event unions); budget for it.
- **Match new syntax to the pinned formatter** (no inline `type` imports under
  Prettier 2.x).

### State hygiene

- **`machine-overridable` settings live in `Machine/settings.json`.** Snapshot
  `inspect().globalValue`, restore with `update(…, undefined)` to remove, and
  prove it with an md5 before/after.
- **Scratch probes must not leak settings**, or the suite will *correctly*
  snapshot and preserve the pollution.
