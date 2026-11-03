# mock: the demo server

`demo-server.mjs` plays a ThermoBox REST server, in memory, with simulated devices that report
every 30 s: to develop and try the client without Java, MySQL or boxes. Not the real server:
nothing is kept when it stops, the rules are simplified; the JSON follows the DTOs of the server.

```bash
npm run demo                    # this server on :8080 + ng serve (proxy /api → :8080), stopped together
npm run mock                    # this server alone, on :8080
node mock/demo-server.mjs --port 4510 --api v1 --seed huge
```

| Option | Default | What it does |
| --- | --- | --- |
| `--port <n>` | `8080` (or `PORT`) | the port of the API |
| `--api v2\|v1\|old` | `v2` | the server played: `v2` a 26.12 server (both APIs), `v1` a 26.11 server (French API and `/api/server`), `old` an older one (French API only) |
| `--seed demo\|huge` | `demo` | `demo`: a few buildings and rooms; `huge`: the large set of the server (10 buildings, 320 rooms, 960 devices, 30 days of measurements every 10 minutes, 500 accounts `user001`… / `user1234`, 20 groups) |
| `--app <folder>` | – | also serves a built client from that folder (`dist/Thermobox-Ng-Client/browser`) on the same port |

Accounts:

| Username | Password | Role |
| --- | --- | --- |
| `admin` | `admin1234` | administrator |
| `gestion` | `gestion1234` | manager |
| `lecteur` | `lecteur1234` | viewer, building A only |
| `camille` | `camille1234` | viewer, building B through the group « Équipe bâtiment B » |
| `nouveau` | `Prov-2026-demo` | provisional password (asked to change it) |

## With another platform

`npm run demo` serves the web build. To look at another platform in the browser against the demo
server:

```bash
npm run mock                                 # in one terminal
npx ng serve --configuration linux           # in another: windows, macos, android, ios too
```

A desktop build in a browser lacks what Tauri gives (its window, its menus): use
`npm run desktop` for the real app ([docs/desktop.md](../docs/desktop.md)).
