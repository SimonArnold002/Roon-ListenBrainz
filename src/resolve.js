// Eager metadata: ensure every track has artist + title text before the UI
// renders. ListenBrainz JSPF usually supplies both inline, so this is cheap —
// the MBID→text lookup only fires for tracks missing text.
//
// Lookups go to public MusicBrainz WS/2 (no local mirror by design), with
// request starts spaced ~1.1s apart so we never trip its rate limit.
// Successes are cached for the process lifetime; failures only briefly — a
// transient network blip must not pin a track as unresolved until restart.

const UA = "roon-listenbrainz/0.1.2 ( simon.arnold@unionvfx.com )";

const FAIL_TTL_MS = 5 * 60 * 1000;
const cache = new Map();      // mbid -> { meta } (success) | { failedUntil } (failure)
const inflight = new Map();   // mbid -> Promise — dedupes concurrent lookups of one mbid

// crude throttle: each MB request starts >=1.1s after the previous one STARTED;
// the first goes immediately.
let mbChain = Promise.resolve();
function mbThrottle() {
    const gate = mbChain;
    mbChain = mbChain.then(() => new Promise(r => setTimeout(r, 1100)));
    return gate;
}

async function mbLookup(mbid) {
    await mbThrottle();
    try {
        const r = await fetch(`https://musicbrainz.org/ws/2/recording/${mbid}?fmt=json&inc=artist-credits`, {
            headers: { Accept: "application/json", "User-Agent": UA },
        });
        if (!r.ok) return null;
        const j = await r.json();
        const artist = (j["artist-credit"] || []).map(ac => ac.name + (ac.joinphrase || "")).join("").trim();
        const title = j.title;
        return artist && title ? { artist, title } : null;
    } catch { return null; }
}

function lookupRecording(mbid) {
    const c = cache.get(mbid);
    if (c) {
        if (c.meta) return Promise.resolve(c.meta);
        if (Date.now() < c.failedUntil) return Promise.resolve(null);
        cache.delete(mbid);   // failure TTL expired — retry
    }
    let p = inflight.get(mbid);
    if (!p) {
        p = mbLookup(mbid).then(meta => {
            cache.set(mbid, meta ? { meta } : { failedUntil: Date.now() + FAIL_TTL_MS });
            inflight.delete(mbid);
            return meta;
        });
        inflight.set(mbid, p);
    }
    return p;
}

async function enrich(track) {
    if (track.artist && track.title) return track;   // JSPF already had text
    if (!track.mbid) { track.unresolved = true; return track; }
    const meta = await lookupRecording(track.mbid);
    if (meta) {
        track.artist = track.artist || meta.artist;
        track.title  = track.title  || meta.title;
    }
    if (!track.artist || !track.title) track.unresolved = true;
    return track;
}

// Eager: resolve the whole playlist up front, in parallel. Tracks with inline
// text or cached lookups resolve instantly; only real MB lookups queue behind
// the shared throttle.
async function enrichAll(tracks) {
    await Promise.all(tracks.map(t => enrich(t)));
    return tracks;
}

module.exports = { enrich, enrichAll };
