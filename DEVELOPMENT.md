# Development notes

User-facing docs live in [README.md](README.md); this file is for working on
the extension itself.

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

## Files

- `src/roon.js` — pairing, service registration, live zone tracking, persisted
  settings (username / default zone), status.
- `src/roon-play.js` — browse-search → best-match → transport action (lazy).
  Search/browse calls are serialized: the `search` hierarchy is one shared
  server-side cursor per extension.
- `src/match.js` — folding matcher (accents, ligatures, feat./remaster, articles).
- `src/listenbrainz.js` — `createdfor` playlists + JSPF track parsing +
  `fresh_releases` (deduped by release group, newest first). Rows carry a
  Cover Art Archive thumbnail URL (`front-250`) that the browser loads
  directly — no server-side proxying or image libraries.
- `src/resolve.js` — eager MBID→text (public MB, throttled + cached; failures
  cached 5 min, successes for process lifetime).
- `src/server.js` — Express REST + WebSocket + static SPA.
- `src/log.js` — console tee into the `/log.txt` ring buffer.
- `src/mdns.js` — Bonjour `_http._tcp` advertising.
- `src/index.js` — entry; wires it all + optional `RUN_DEMO=1`.
- `public/` — the SPA (vanilla, no build step).

## Run with plain Node (no Docker)

Requires Node 20+ and `git` (the Roon libs install from GitHub, not npm).
Not needed for normal use — the Docker image installs its own dependencies.

```sh
npm install
npm start                          # pair — Enable in Roon → Settings → Extensions
npm run demo                       # after enabling: play a hardcoded track
DEMO_ARTIST="Bonobo" DEMO_TITLE="Kerala" npm run demo
```

The extension can run on any box on the LAN — SOOD finds the Core; you don't
configure its IP.

One-shot playback smoke test under Docker: uncomment `RUN_DEMO=1`
(+ optional `DEMO_ARTIST`/`DEMO_TITLE`) in `docker-compose.yml`, then
`docker compose up -d`.

## What's verified vs. not (as of 0.1.1)

Tested without a real Roon Core (none on the build machine):

- ✅ Dependencies install (Roon libs from GitHub), all modules boot, no throws
- ✅ Web server serves the SPA + REST API; `/api/state`, static assets, guards
- ✅ Live ListenBrainz fetch + JSPF parse (real `createdfor` playlists/tracks)
- ✅ mDNS advertise + SOOD discovery start
- ✅ Play path against a scripted fake Core: search `input`, category descent,
  action-list walk (`hint: "action_list"` gating), `is_error` handling,
  request serialization, resolver dedup/fail-TTL
- ❔ **Pairing, browse-search, and actual playback against a real Core** —
  needs a Roon subscription + Core. Smoke-test on the target box
  (`RUN_DEMO=1`, or just click Play in the UI).

The two most likely tuning points on first real run: Roon's browse category /
action labels ("Tracks", "Play Now") if localised, and matcher thresholds
against real search rows. Both are isolated in `match.js` / `roon-play.js`.

## Known follow-ups

- Verify browse-search/playback on a real Core; tune labels + thresholds.
- Now-playing display over the WS channel.
- Consider persisting the resolver cache to the `roon-data` volume.
- Promote the fake-Core smoke harness into a committed test (`npm test`).
