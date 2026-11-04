# Port speed

Show the aggregated upload/download of a port, captured by the `iftopd` daemon.

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
