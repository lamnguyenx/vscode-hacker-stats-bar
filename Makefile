NAME    := $(shell node -p "require('./package.json').name")
VERSION := $(shell node -p "require('./package.json').version")
PUB     := $(shell node -p "require('./package.json').publisher")
EXT_ID  := $(PUB).$(NAME)-$(VERSION)
VSIX    := build/$(EXT_ID).vsix

# Inputs that decide whether the VSIX is stale: `$(VSIX)` depends on these,
# so make skips npm install/compile/pack while the VSIX is newer than all of
# them (same mtime rule as the meta repo's `make install-ssh`). Generated
# trees (out/, build/, node_modules/) are deliberately absent.
SOURCES := $(shell find src -type f 2>/dev/null) \
	package.json package-lock.json tsconfig.json

CDP_PORT ?= 9024

.PHONY: build install install-code install-code-server vsix clean test-units typecheck-tests test-e2e

build vsix: $(VSIX)

install: install-code install-code-server

install-code: build
	code --install-extension $(VSIX) --force

install-code-server: build
	code-server --install-extension $(VSIX) --force

$(VSIX): $(SOURCES)
	npm install --no-audit --no-fund
	npm run compile
	mkdir -p build
	npx vsce package -o $@

clean:
	rm -rf build out

## Pure-logic checks (bun; no dev host, no compile).
test-units:
	bun tests/units/format_check.ts
	bun tests/units/portspeed_check.ts

## Strict typecheck of the committed test suite.
typecheck-tests:
	npx tsc -p tsconfig.tests.json

## Playwright E2E (REST Control arranges/acts; CDP browser asserts).
## Requires code-server + the CDP browser + REST Control to be running, and the
## current VSIX installed — see docs/important/testing/how-to-test.md.
test-e2e:
	CDP_PORT=$(CDP_PORT) npx playwright test --config playwright.config.ts
