# Pathfinder

An Arma 3 dedicated server for the homelab, with an admin page to start and
stop it, to set its mods from an Arma 3 Launcher preset, and to manage its
missions and config files.

One container runs the admin page (Rust backend, TypeScript frontend). The
admin page runs SteamCMD and the Arma server as child processes. It is
deployed to the homelab's k3s cluster by
[homelab-apps](https://github.com/markusa380/homelab-apps)
(`modules/apps/arma.nix`).

## Using it

Admin page: `http://192.168.0.159:8302` (LAN only). Game server:
`192.168.0.159:2302`. The server's state shows at the top of every tab.

- **Server** tab:
  - **Start:** updates the server and the mods with SteamCMD, then starts the
    server. The first start downloads the server (about 10 GB) and every mod.
  - **Stop:** stops the server gracefully, and kills it after 30 seconds.
  - **Log:** the output of SteamCMD and the server, last 2000 lines. Errors
    and warnings are highlighted.
- **Mods** tab: in the Arma 3 Launcher, open *Mods*, then *Preset* → *Export
  to file* (or export the list of mods), and upload the HTML file. Local mods
  and DLCs are left out. The new mods apply at the next start.
- **Missions** tab: upload (several at once), download and delete mission
  `.pbo` files, up to 512 MB each. Names are stored in lower case, because Arma
  on Linux looks files up in lower case.
- **Config** tab: upload and download `server.cfg`, `basic.cfg`, the
  difficulty profile and the CBA settings. Changes apply at the next start.

A restart of the pod (for example a deploy) stops the server.

## Files on the homelab

Everything is in `/srv/k8s/arma` (`/data` in the container). Files belong to
UID 1000.

The config files and missions can also be managed on the admin page:

| Path | Contents |
|---|---|
| `server/mpmissions/` | Missions (`.pbo`) |
| `config/server.cfg` | [Server config](https://community.bistudio.com/wiki/server.cfg), passed as `-config` |
| `config/basic.cfg` | [Network config](https://community.bistudio.com/wiki/basic.cfg), passed as `-cfg` |
| `home/.local/share/Arma 3 - Other Profiles/server/server.Arma3Profile` | [Difficulty profile](https://community.bistudio.com/wiki/server.armaprofile). Arma on Linux ignores `-profiles` |
| `server/userconfig/cba_settings.sqf` | [CBA settings](https://github.com/CBATeam/CBA_A3/wiki/CBA-Settings-System). The server starts with `-filePatching` if it exists |

The rest is managed by the server:

| Path | Contents |
|---|---|
| `server/` | The server, installed by SteamCMD |
| `workshop/` | Downloaded mods, as SteamCMD keeps them |
| `server/mods/` | Lower-case symlinks to the mods, rebuilt at each start |
| `modset.json` | The mods of the last uploaded preset |
| `home/` | `$HOME` of SteamCMD and the server |

## Development

```sh
nix develop
cd backend && cargo test
cd frontend && npm ci && npm run typecheck
```

Run locally: start the backend with `DATA_DIR`, `STEAMCMD`, `STEAM_USER` and
`STEAM_PASSWORD` set, then `npm run dev` in `frontend/` for the page on
`http://localhost:8000`.

| Variable | Default | |
|---|---|---|
| `STEAM_USER`, `STEAM_PASSWORD` | | A Steam account that owns Arma 3 (Workshop downloads need it), without Steam Guard |
| `DATA_DIR` | `/data` | |
| `STEAMCMD` | `/opt/steamcmd/steamcmd.sh` | |
| `PORT` | `8302` | Admin page |
| `GAME_PORT` | `2302` | Arma uses this port and the next four |
| `STATIC_DIR` | `static` | The built frontend |

## Deploying

Every push to `main` builds the image `arma` and deploys it through
[homelab-ci](https://github.com/markusa380/homelab-ci).
