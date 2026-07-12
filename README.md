# ListenBrainz for Roon

Companion **web UI** Roon extension that resolves ListenBrainz playlists /
recommendations and plays them into a Roon zone via Roon's own browse-search.
No MusicBrainz local endpoint — MBID→text goes to the public MusicBrainz API
(throttled to ~1 req/s, cached; most tracks ship their text inline anyway).

## Status

Feature-complete first pass: **pairing → companion web UI → ListenBrainz
"Created for you" playlists + Fresh Releases → eager metadata → lazy
browse-search → play/queue into a zone.** Tracks search Roon's Tracks
category; Fresh Releases search Albums and play the whole album. Verified
locally short of a real Core (see below).

### What's verified vs. not

Tested with a throwaway Node here (no Roon subscription on the build machine):

- ✅ Dependencies install (Roon libs from GitHub), all modules boot, no throws
- ✅ Web server serves the SPA + REST API; `/api/state`, static assets, guards
- ✅ Live ListenBrainz fetch + JSPF parse (real `createdfor` playlists/tracks)
- ✅ mDNS advertise + SOOD discovery start
- ❔ **Pairing, browse-search, and actual playback** — need a real Roon Core +
  Tidal/Qobuz subscription. This is the part to smoke-test on the target box
  (uncomment `RUN_DEMO=1` in `docker-compose.yml`, or just click Play in the UI).

The two most likely tuning points on first real run: Roon's browse category /
action labels ("Tracks", "Play Now") if localised, and matcher thresholds
against real search rows. Both are isolated in `match.js` / `roon-play.js`.

## Design

| Concern        | Decision                                                     |
|----------------|--------------------------------------------------------------|
| UX surface     | Companion web UI (SPA + REST/WS), served LAN-wide            |
| Metadata       | Eager — MBID→text for whole playlist on open (public MB, cached) |
| Roon match     | Lazy — browse-search on play/queue click                    |
| Core discovery | node-roon-api SOOD → **Enable** in Roon Settings → Extensions |
| UI discovery   | mDNS `_http._tcp` (Bonjour), bind `0.0.0.0`                  |
| Services       | Tidal / Qobuz / local only (no Deezer — Roon has no Deezer) |
| Matcher        | LBF core, retargeted to browse rows (no MBID gate)          |

## Run with Docker (recommended for handoff)

```sh
docker compose up -d --build
docker compose logs -f            # watch for "discovery started"
```

Then open **Roon → Settings → Extensions** and **Enable** "ListenBrainz for
Roon". Pairing is remembered across restarts (stored in the `roon-data` volume).

One-shot playback smoke test — uncomment `RUN_DEMO=1` (+ optional
`DEMO_ARTIST`/`DEMO_TITLE`) in `docker-compose.yml`, then `docker compose up -d`.

### Two hard requirements (baked into the compose file)

- **`network_mode: host`** — Roon's SOOD discovery and mDNS advertising use LAN
  broadcast/multicast, which bridged Docker networking blocks. Without host
  networking the extension never shows up in Roon.
  → Host networking is a **Linux** feature. On Docker Desktop for Mac/Windows it
  is limited; run this on the Linux box / NAS on the same LAN as the Core.
- **`roon-data` volume** — holds `config.json` (the pairing token). Drop it and
  you re-pair on every restart.

## Run with plain Node (dev)

Requires Node 20+ and `git` (the Roon libs install from GitHub, not npm).

```sh
npm install
npm start                          # pair — Enable in Roon → Settings → Extensions
npm run demo                       # after enabling: play a hardcoded track
DEMO_ARTIST="Bonobo" DEMO_TITLE="Kerala" npm run demo
```

The extension can run on any box on the LAN — SOOD finds the Core; you don't
configure its IP.

## Remote debugging

Everything the process logs (including the Roon library's output) goes to an
in-memory ring buffer (last 2000 lines, timestamped) served as plain text:

```sh
curl http://<host>:9330/log.txt
```

Verbose mode adds per-row **candidate score lines** for every Roon search —
the thing to grep when a track won't match:

```sh
# toggle at runtime, no restart:
curl -X POST http://<host>:9330/api/debug -H 'Content-Type: application/json' -d '{"on":true}'
# ...reproduce the failing Play click, then:
curl -s http://<host>:9330/log.txt | grep 'candidates Roon:'
```

Or start verbose from boot with `LBR_DEBUG=1` (already set in
`docker-compose.yml`). `/api/state` reports the current `debug` flag. The
buffer is in-memory only — a container restart clears it.

## Configuration

- **ListenBrainz username** — set in the web UI, or in Roon → Settings →
  Extensions → this extension. Env override: `LB_USER`.
- **`PORT`** — web UI port (default `9330`).

## Files

- `src/roon.js` — pairing, service registration, live zone tracking, persisted
  settings (username / default zone), status.
- `src/roon-play.js` — browse-search → best-match → transport action (lazy).
- `src/match.js` — folding matcher (accents, ligatures, feat./remaster, articles).
- `src/listenbrainz.js` — `createdfor` playlists + JSPF track parsing +
  `fresh_releases` (deduped by release group, newest first). Rows carry a
  Cover Art Archive thumbnail URL (`front-250`) that the browser loads
  directly — no server-side proxying or image libraries.
- `src/resolve.js` — eager MBID→text (public MB, throttled + cached).
- `src/server.js` — Express REST + WebSocket + static SPA.
- `src/mdns.js` — Bonjour `_http._tcp` advertising.
- `src/index.js` — entry; wires it all + optional `RUN_DEMO=1`.
- `public/` — the SPA (vanilla, no build step).

## Known follow-ups

- Verify browse-search/playback on a real Core; tune labels + thresholds.
- Add `Queue`-vs-`Play Now` UX polish and now-playing display over the WS channel.
- Consider persisting the resolver cache to the `roon-data` volume.
