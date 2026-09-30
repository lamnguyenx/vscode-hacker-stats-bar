NAME    := $(shell node -p "require('./package.json').name")
VERSION := $(shell node -p "require('./package.json').version")
PUB     := $(shell node -p "require('./package.json').publisher")
EXT_ID  := $(PUB).$(NAME)-$(VERSION)
VSIX    := build/$(EXT_ID).vsix

CDP_PORT ?= 9024

.PHONY: build install install-code install-code-server vsix clean test-units typecheck-tests test-e2e

build: vsix

install: install-code install-code-server

install-code: build
	code --install-extension $(VSIX) --force

install-code-server: build
	code-server --install-extension $(VSIX) --force

vsix:
	npm install --no-audit --no-fund
	npm run compile
	mkdir -p build
	npx vsce package -o $(VSIX)

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
## current VSIX installed — see docs/important/how-to-test.md.
test-e2e:
	CDP_PORT=$(CDP_PORT) npx playwright test --config playwright.config.ts
