# Pathfinder

An Arma 3 dedicated server for the homelab, with an admin page to start and
stop it and to set its mods from an Arma 3 Launcher preset.

One container runs the admin page (Rust backend, TypeScript frontend). The
admin page runs SteamCMD and the Arma server as child processes. It is
deployed to the homelab's k3s cluster by
[homelab-apps](https://github.com/markusa380/homelab-apps)
(`modules/apps/arma.nix`).

## Using it

Admin page: `http://192.168.0.159:8302` (LAN only). Game server:
`192.168.0.159:2302`.

- **Mods:** in the Arma 3 Launcher, open *Mods*, then *Preset* → *Export to
  file*, and upload the HTML file. Local mods and DLCs in the preset are left
  out. The new mods apply at the next start.
- **Start:** updates the server and the mods with SteamCMD, then starts the
  server. The first start downloads the server (about 10 GB) and every mod.
- **Stop:** stops the server gracefully, and kills it after 30 seconds.

A restart of the pod (for example a deploy) stops the server.

## Files on the homelab

Everything is in `/srv/k8s/arma` (`/data` in the container):

| Path | Contents |
|---|---|
| `config/server.cfg` | [Server config](https://community.bistudio.com/wiki/server.cfg), passed as `-config` if it exists |
| `config/basic.cfg` | [Network config](https://community.bistudio.com/wiki/basic.cfg), passed as `-cfg` if it exists |
| `profiles/home/server/server.Arma3Profile` | [Difficulty settings](https://community.bistudio.com/wiki/server.armaprofile) |
| `server/mpmissions/` | Missions (`.pbo`) |
| `server/` | The server, installed by SteamCMD |
| `workshop/` | Downloaded mods, as SteamCMD keeps them |
| `mods/` | Lower-case symlinks to the mods, rebuilt at each start |
| `modset.json` | The mods of the last uploaded preset |
| `home/` | SteamCMD's own files |

Files belong to UID 1000.

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
