// ListenBrainz REST — lifted in spirit from LBF. Pulls the user's "Created for
// you" playlists (Weekly Jams, Weekly Exploration, Daily Jams, …) and their
// tracks. JSPF gives us title (track) + creator (artist) inline, plus the
// recording MBID in `identifier` — so most tracks need no MBID→text lookup.

const BASE = "https://api.listenbrainz.org/1";

const MBID_RE = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;

function mbidFrom(identifier) {
    const ids = Array.isArray(identifier) ? identifier : [identifier];
    for (const s of ids) {
        const m = typeof s === "string" && s.match(MBID_RE);
        if (m) return m[1];
    }
    return null;
}

async function getJSON(url) {
    const r = await fetch(url, { headers: { Accept: "application/json" } });
    if (!r.ok) throw new Error(`ListenBrainz ${r.status} for ${url}`);
    return r.json();
}

function summarize(pl) {
    return {
        id:         mbidFrom(pl.identifier),
        title:      pl.title || "(untitled)",
        annotation: (pl.annotation || "").replace(/<[^>]+>/g, "").trim(),
        // The createdfor listing ships empty track arrays and no count, so this
        // is usually null; the real count only appears once the playlist is opened.
        trackCount: (Array.isArray(pl.track) && pl.track.length) ? pl.track.length : null,
        date:       pl.date || null,
    };
}

async function getCreatedForPlaylists(username, count = 25) {
    const j = await getJSON(`${BASE}/user/${encodeURIComponent(username)}/playlists/createdfor?count=${count}`);
    return (j.playlists || []).map(p => summarize(p.playlist || {})).filter(p => p.id);
}

// Cover Art Archive thumbnail from a release MBID. The browser loads these
// directly (front-250 redirects to the archive.org file) — no proxying and no
// image libraries server-side; 404s for artless releases are handled in the UI.
function caaUrl(releaseMbid) {
    return releaseMbid ? `https://coverartarchive.org/release/${releaseMbid}/front-250` : null;
}

function toTrack(t) {
    const meta = t.extension?.["https://musicbrainz.org/doc/jspf#track"]?.additional_metadata || {};
    return {
        mbid:   mbidFrom(t.identifier),   // recording MBID
        title:  t.title  || "",
        artist: t.creator || "",
        album:  t.album  || "",
        art:    caaUrl(meta.caa_release_mbid),
    };
}

async function getPlaylist(id) {
    const j = await getJSON(`${BASE}/playlist/${id}`);
    const pl = j.playlist || {};
    return {
        id,
        title:      pl.title || "(untitled)",
        annotation: (pl.annotation || "").replace(/<[^>]+>/g, "").trim(),
        tracks:     (pl.track || []).map(toTrack),
    };
}

// Fresh Releases: recent/upcoming releases from artists in the user's listen
// history. Everything needed is inline (artist, release name, date, type) —
// no MBID→text resolution required. Sorted newest first, deduped by
// release-group so multi-edition releases show once.
async function getFreshReleases(username, days = 14) {
    const j = await getJSON(`${BASE}/user/${encodeURIComponent(username)}/fresh_releases?days=${days}`);
    const seen = new Set();
    return ((j.payload || {}).releases || [])
        .filter(r => {
            const key = r.release_group_mbid || r.release_mbid || (r.artist_credit_name + r.release_name);
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        })
        .map(r => ({
            artist: r.artist_credit_name || "",
            title:  r.release_name || "",
            date:   r.release_date || null,
            type:   [r.release_group_primary_type, r.release_group_secondary_type].filter(Boolean).join(" / ") || null,
            mbid:   r.release_group_mbid || r.release_mbid || null,
            art:    caaUrl(r.caa_release_mbid || r.release_mbid),
        }))
        .filter(r => r.artist && r.title)
        .sort((a, b) => (b.date || "").localeCompare(a.date || ""));
}

module.exports = { getCreatedForPlaylists, getPlaylist, getFreshReleases, mbidFrom };
