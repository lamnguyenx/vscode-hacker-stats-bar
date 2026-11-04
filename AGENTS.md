# AGENTS.md

## Project Structure

- `_submodules/` contains the extension repos as git submodules. This is the single source of truth; edit them here.
- `_refs/` contains read-only external references.

## Layout

- `src/` — the extension (`statsBar.ts`, `setting.ts`, `command.ts`, `utils.ts`, `sysinfo/`).
  - `src/sysinfo/protocol.ts` is the `iftopd` wire codec, kept free of `vscode`
    and `net` so it is unit-testable and reusable by the E2E fixture.
- `tests/units/` — pure-logic checks runnable with `bun` (no host, no compile).
- `tests/playwright/` — committed E2E suite (`@playwright/test`; REST Control
  arranges/acts, CDP asserts the status-bar DOM).
- `./exp` is scratch/output (Playwright artifacts), gitignored.

## Testing

```bash
make test-units        # bun pure-logic checks (format + iftopd protocol)
make typecheck-tests   # strict typecheck of tests/ + configs
make test-e2e          # Playwright E2E against running code-server (CDP 9024)
```

See `docs/important/testing/how-to-test.md` for build/install and the oracle design.
