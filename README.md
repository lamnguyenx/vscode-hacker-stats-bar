# Hacker Stats Bar

[![Visual Studio Marketplace Version](https://img.shields.io/visual-studio-marketplace/v/lamnguyenx.hacker-stats-bar)](https://marketplace.visualstudio.com/items?itemName=lamnguyenx.hacker-stats-bar)
[![Visual Studio Marketplace Last Updated](https://img.shields.io/visual-studio-marketplace/last-updated/lamnguyenx.hacker-stats-bar)](https://marketplace.visualstudio.com/items?itemName=lamnguyenx.hacker-stats-bar)
[![Visual Studio Marketplace Rating](https://img.shields.io/visual-studio-marketplace/r/lamnguyenx.hacker-stats-bar)](https://marketplace.visualstudio.com/items?itemName=lamnguyenx.hacker-stats-bar)
[![Visual Studio Marketplace Installs](https://img.shields.io/visual-studio-marketplace/i/lamnguyenx.hacker-stats-bar)](https://marketplace.visualstudio.com/items?itemName=lamnguyenx.hacker-stats-bar)

A vscode extension to show system stats in status bar

<img width="1136" alt="Xnip2021-08-28_19-30-23" src="https://user-images.githubusercontent.com/19601720/131216513-6e0d5619-4767-40aa-8c2d-782ee732d987.png">
<img width="1136" alt="Xnip2021-08-28_19-29-25" src="https://user-images.githubusercontent.com/19601720/131216521-92007920-daba-48db-873d-9410177ddf0e.png">

## Features

- Support show cpu load, loadavg, network speed, memory usage, uptime and port speed
- Support custom display format, order and priority
- Support copy ip to clipboard
- Support change loacation and refresh interval

## Quick start

```bash
make build      # npm install + compile + package *.vsix
make install    # build + install into VS Code and code-server
```

The extension settings are contributed by the extension itself; open **Settings**
and search for `statsBar` to see them.

## Docs

### [Usage](docs/important/usage/)

- [Port speed](docs/important/usage/port-speed.md): set up the `iftopd` daemon, the `statsBar.portSpeed.*` settings, and the tooltip/fallback behavior.
- [Display format](docs/important/usage/display-format.md): the `$(icon-name)` syntax and the placeholders each module exposes.

### [Testing](docs/important/testing/)

- [How to test Hacker Stats Bar](docs/important/testing/how-to-test.md): the bun pure-logic checks, the committed Playwright suite, and the status-bar / `iftopd` oracles.

## Thanks

- [systeminformation](https://systeminformation.io)
