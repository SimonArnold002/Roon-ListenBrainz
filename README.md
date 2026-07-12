# ListenBrainz for Roon

A Roon extension that brings your [ListenBrainz](https://listenbrainz.org)
recommendations into Roon. Browse the playlists ListenBrainz creates for you —
**Weekly Jams, Weekly Exploration, Daily Jams** — and **Fresh Releases** from
artists you listen to, then play or queue any of them into a Roon zone. All
from a simple web page that works on any phone, tablet, or computer on your
network.

Tracks are found through Roon's own search, so they play from whatever your
Roon already has: your local library, Tidal, or Qobuz.

## What you need

- A **Roon Core** on your network.
- A **ListenBrainz account** (free) that has some listening history — that's
  what the playlists and Fresh Releases are generated from.
- A **Linux box or NAS with Docker** on the same network as the Core (a
  Raspberry Pi is fine). It must run Linux: the extension relies on Docker's
  host networking, which Docker Desktop for Mac/Windows doesn't fully support.

## Install

```sh
git clone https://github.com/SimonArnold002/Roon-ListenBrainz.git
cd Roon-ListenBrainz
docker compose up -d --build
```

Everything runs inside the container — no Node, npm, or other tools needed on
the host.

Then authorize it in Roon: **Roon → Settings → Extensions → Enable**
"ListenBrainz for Roon". Pairing is remembered across restarts.

## Use

Open **`http://<host>:9330`** in a browser (`<host>` is the machine running
the container; the page is also discoverable via Bonjour as "ListenBrainz for
Roon").

1. Enter your ListenBrainz username and press **Save**.
2. Pick a **zone** — where the music should come out.
3. Click a playlist (or **Fresh Releases**) and use **Play** / **Queue** on
   any row. Fresh Releases rows play the whole album.

A default zone can be set in **Roon → Settings → Extensions → ListenBrainz
for Roon**.

### Options (environment variables, set in `docker-compose.yml`)

- `LB_USER` — fix the ListenBrainz username here instead of the web UI.
- `PORT` — web UI port (default `9330`).
- `LBR_DEBUG=1` — verbose logging from startup (on by default in the compose
  file).

## Updating

```sh
git pull && docker compose up -d --build
```

## Troubleshooting

**The extension never appears in Roon → Settings → Extensions.** Roon
discovery needs LAN broadcast/multicast, which only works with Docker's
`network_mode: host` on a Linux host (already set in the compose file). Make
sure the container runs on Linux, on the same network/VLAN as the Core.

**A track or album shows "no match".** Roon's search found nothing close
enough in your library/services — most often the release simply isn't on your
Tidal/Qobuz or in your library.

**Playback problems / anything odd.** Everything the extension logs is
readable remotely:

```sh
curl http://<host>:9330/log.txt
```

Verbose mode adds a per-row candidate score line for every search — the thing
to check when a track won't match. Toggle it at runtime:

```sh
curl -X POST http://<host>:9330/api/debug -H 'Content-Type: application/json' -d '{"on":true}'
curl -s http://<host>:9330/log.txt | grep 'candidates Roon:'
```

**Re-pairing on every restart.** The `roon-data` volume holds the pairing
token — don't delete it.

---

Developer documentation (architecture, file map, running without Docker) is in
[DEVELOPMENT.md](DEVELOPMENT.md).
