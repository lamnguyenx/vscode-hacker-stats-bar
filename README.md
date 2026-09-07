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

## Port Speed

Shows the aggregated upload/download of a port (or any BPF filter) captured
by the [iftopd](https://github.com/lamnt45/iftopd) daemon (run as root or
with `CAP_NET_RAW`; the extension itself needs no privileges):

```sh
sudo systemctl start iftopd    # daemon, filter e.g. "tcp port 8140"
```

Then add `portSpeed` to `statsBar.modules` and configure:

- `statsBar.portSpeed.socketPath` — iftopd socket, default `/tmp/iftopd.sock`
- `statsBar.portSpeed.name` — label shown on the bar, e.g. `Port 8140`
- `statsBar.portSpeed.format` — display format (default: `${name}: $(arrow-up) ${up} ${up-unit} $(arrow-down) ${down} ${down-unit}`)

The status bar item's tooltip lists the individual flows (local port ->
remote port, proto, up/down). If the daemon is unreachable the entry shows
`-` and a one-time notification is raised; the extension reconnects
automatically every 5 seconds.

## Extension Settings

You can visit this extension page in vscode to see detail

## Display Format

You can use `$(icon-name)` to show icon, visit this site [https://microsoft.github.io/vscode-codicons/dist/codicon.html](https://microsoft.github.io/vscode-codicons/dist/codicon.html) to find icon name

### Cpu Load

- ${percent}

### Loadavg

- ${1}
- ${5}
- ${15}

### Uptime

- ${days}
- ${hours}
- ${minutes}

### Network Speed

- ${up}
- ${up-unit}
- ${down}
- ${down-unit}

### Port Speed

- ${name}
- ${up}
- ${up-unit}
- ${down}
- ${down-unit}

### Memory Usage

- ${used}
- ${total}
- ${percent}
- ${pressurePercent}
- ${unit}

## Thanks

- [systeminformation](https://systeminformation.io)
