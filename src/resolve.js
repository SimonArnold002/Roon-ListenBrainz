// Eager metadata: ensure every track has artist + title text before the UI
// renders. ListenBrainz JSPF usually supplies both inline, so this is cheap —
// the MBID→text lookup only fires for tracks missing text.
//
// No MusicBrainz local endpoint (by design). Resolution order:
//   1. hosted API (LMS-community), if HOSTED_API_BASE is configured
//   2. public MusicBrainz WS/2 (rate-limited to ~1 req/s, no mirror needed)
// Results are cached in-memory for the process lifetime.

const UA = "roon-listenbrainz/0.1.0 ( simon.arnold@unionvfx.com )";
const HOSTED_API_BASE = process.env.HOSTED_API_BASE || null; // e.g. https://api.lms-community.org

const cache = new Map();      // mbid -> {artist,title} | null

// crude 1.1s throttle so we never trip public MB's rate limit
let mbChain = Promise.resolve();
function mbThrottle() {
    const wait = mbChain.then(() => new Promise(r => setTimeout(r, 1100)));
    mbChain = wait;
    return wait;
}

async function hostedLookup(mbid) {
    if (!HOSTED_API_BASE) return null;
    try {
        const r = await fetch(`${HOSTED_API_BASE.replace(/\/$/, "")}/recording/${mbid}`, {
            headers: { Accept: "application/json", "User-Agent": UA },
        });
        if (!r.ok) return null;
        const j = await r.json();
        const artist = j.artist || j["artist-credit-phrase"] || (j["artist-credit"] || []).map(a => a.name).join(", ");
        const title = j.title || j.name;
        return artist && title ? { artist, title } : null;
    } catch { return null; }
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

async function lookupRecording(mbid) {
    if (cache.has(mbid)) return cache.get(mbid);
    let meta = await hostedLookup(mbid);
    if (!meta) meta = await mbLookup(mbid);
    cache.set(mbid, meta);
    return meta;
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

// Eager: resolve the whole playlist up front. Tracks that already have text
// resolve instantly; only the gaps hit the network (serialised by the throttle).
async function enrichAll(tracks) {
    for (const t of tracks) await enrich(t);
    return tracks;
}

module.exports = { enrich, enrichAll, lookupRecording };
