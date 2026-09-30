# How to test Hacker Stats Bar

Transferable rules live in the meta repo's
[`docs/important/how-to-test-all.md`](../../../docs/important/how-to-test-all.md).
This file is the **stats-bar-specific** pipeline: it is a status-bar extension,
so the oracle is the workbench status-bar DOM, and the `portSpeed` module talks
to the `iftopd` daemon (replaced by a deterministic fake in the suite).

## Layers

| Layer | Needs | Command | What it covers |
| --- | --- | --- | --- |
| Pure logic | `bun` only | `make test-units` | `src/utils.ts` formatting, the `iftopd` wire protocol (`src/sysinfo/protocol.ts`) |
| Typecheck | `npm install` | `make typecheck-tests` | `tests/` + `playwright.config.ts` (strict) |
| E2E | code-server + REST Control + CDP browser | `make test-e2e` | status-bar items, commands, settings, `portSpeed` daemon |

## Environment (code-server, Option A)

The reference stack is code-server in Docker on nuc, driven from a CDP browser
on pp. See the meta repo's
[`dev-code-on-nuc-test-on-pp.md`](../../../docs/important/dev-code-on-nuc-test-on-pp.md)
for the tunnels. The suite needs:

- the CDP browser on `CDP_PORT` (default `9024`),
- REST Control on `HACKER_REST_CONTROL_PORT` (default `40620`),
- code-server on `https://localhost:9620` with the current VSIX installed.

`vscode.workspace.isTrusted` must be `true` — an untrusted workspace disables
every user extension and REST Control never binds.

## Build & install (into the container's code-server)

The container mounts `exp/code-server/.local/share/code-server` from the repo,
so install with explicit dirs. Note: `--user-data-dir` must be the **host
mount source** (the `exp/…` path), not the container path
`/home/lamnt45/.local/share/code-server` — the host CLI writes to the literal
path it is given:

```sh
cd _submodules/vscode-hacker-stats-bar
make build                     # -> build/lamnguyenx.hacker-stats-bar-<version>.vsix

UD=/home/lamnt45/git/vscode-hacker-meta/exp/code-server/.local/share/code-server
EXT=$UD/extensions
code-server --uninstall-extension njzy.stats-bar \
  --user-data-dir "$UD" --extensions-dir "$EXT"   # drop any stale fork
code-server --install-extension build/lamnguyenx.hacker-stats-bar-*.vsix --force \
  --user-data-dir "$UD" --extensions-dir "$EXT"
```

Then **reload the code-server tab** so the workbench starts a fresh extension
host. Verify the loaded identity, not the directory listing:

```sh
curl -s http://127.0.0.1:40620/ -H 'Content-Type: application/json' \
  -d '{"command":"custom.eval","args":["vscode.extensions.getExtension(\"lamnguyenx.hacker-stats-bar\")?.id ?? null"]}'
```

## Run

```sh
make test-units          # bun pure-logic checks
make typecheck-tests     # strict tsc over tests/ + configs
make test-e2e            # Playwright; CDP_PORT=9024 by default
```

## The oracle: status-bar items

The extension renders one `StatusBarItem` per configured module. In the
workbench these are `.statusbar-item` elements; a status item is **not** a
notification and is not visible to the extension host API, so the DOM is the
only oracle.

The status bar is shared (Git, Problems, other extensions), and live values
(cpu %, memory, uptime) cannot be pinned. Two rules make the assertions
deterministic:

1. **Marker formats.** Every module is given a unique format via
   `statsBar.<module>.format`, e.g. `SBCPU ${percent}%`, so an item is found by
   its rendered text (`markers()` / `markerText()` in `tests/playwright/workbench.ts`).
   Structural regexes assert the substitutions; the values themselves are live.
2. **A fake daemon for `portSpeed`.** `tests/playwright/fixture.ts` starts a TCP
   server (the extension's `socketPath` accepts `host:port`) that broadcasts
   SNAPSHOT frames built by the **shipped** `encodeSnapshot`, so the byte
   protocol cannot drift. Because code-server runs with `network_mode: host`,
   the extension host reaches the runner's `127.0.0.1` directly. With fixed
   flows the rendered text and per-flow tooltip are asserted exactly.

Other echoes used:

- **Commands** mutate `statsBar.*` Global settings; the suite reads them back
  (`getStatsConfigGlobal`) *and* asserts the item appeared/disappeared. That
  round-trip is the strongest assertion.
- **`StatsBar.CopyIp`** shows an information toast (`The IP … was copied
  successfully`). The suite reads the IP out of the toast and compares it to the
  real browser clipboard (`context.grantPermissions`), mirroring
  `vscode-hacker-terminal-enhanced`.
- **Unreachable daemon** renders `-` and raises a one-time warning toast
  (`Cannot connect to iftopd …`). The suite uses a freshly closed port so the
  reconnect actually re-warns.

## State hygiene

Every `statsBar.*` setting is declared **`machine-overridable`**, so under
code-server writes via `ConfigurationTarget.Global` land in
`<user-data-dir>/Machine/settings.json` (not `User/settings.json`) and
`inspect().globalValue` reflects them. The suite snapshots every key in
`beforeAll` and restores it (removing keys that were absent) in `afterAll`, so
a run — even a failing one — never edits the developer's profile. Verify by
checksumming `Machine/settings.json` before and after a run. `beforeEach` calls
`resetStatsBar()` plus `notifications.clearAll`.

The extension id differs across forks (`njzy.stats-bar`, `lamnguyenx.hacker-stats-bar`);
override with `STATS_BAR_EXT_ID`.

## Known limits (manual)

- **Priority ordering** (`statsBar.priority`) is not asserted: the workbench
  interleaves items from many extensions and the relative order of foreign items
  is not stable.
- **Refresh timing** (`statsBar.refreshInterval`) is not asserted directly; the
  suite pins it to the 1000 ms minimum and relies on polling.
- The **daemon warning is one-time per reconnect**; a test that changes the
  socket path is required to re-trigger it.
- The real `iftopd`/Unix socket is never exercised end to end (only the wire
  protocol and the TCP transport are).
