// The make-or-break piece: drive Roon's OWN search via roon-api-browse, pick the
// best-matching track, then execute a play/queue action into a zone.
//
// Roon's browse hierarchy is a stateful cursor. To play one track/album we:
//   1. browse(search, pop_all, input=query)              -> reset + search
//   2. load                                              -> category headers (Tracks/Albums/Artists)
//   3. browse(item_key = category header) + load         -> rows ("Tracks" for
//      playlist tracks, "Albums" for Fresh Releases)
//   4. score rows against {artist,title}, pick winner    -> match.js folding matcher
//   5. browse(item_key = winner, zone_or_output_id)      -> returns an action list
//      (albums may need one more hop: the album page's "Play Album" entry)
//   6. browse(item_key = requested action)               -> executes it
//
// Rows carry only title + subtitle (artist) + an opaque item_key. There are NO
// MBIDs here, so the text matcher in scoreRows() is the ONLY gate. That is the
// part most likely to need tuning.

const { scoreRow, fold } = require("./match");
const logger = require("./log");

const HIER = "search";
const THRESHOLD = 0.62;
const MAX_DEPTH = 6;

// Roon's transport verbs. Rows carry hint "action", but a row titled with one of
// these is an action whatever the hint says — never descend into it looking for
// a way down, or asking to Queue could execute Play Now instead.
const ACTION_TITLES = new Set(["play now", "add next", "queue", "start radio", "shuffle"]);

// Roon renders linked artists as "[[328570|The Rolling Stones]]" (album rows do;
// track rows send plain text). The matcher strips bracketed text — that's how it
// drops "[remaster]" — so leaving the markup in wipes the whole artist field and
// costs 0.4 of the score. Unwrap to the bare name before anything reads the row.
function unlink(s) {
    return (s || "").replace(/\[\[\d+\|([^\]|]+)\]\]/g, "$1");
}

function cleanRow(row) {
    return { ...row, title: unlink(row.title), subtitle: unlink(row.subtitle) };
}

function browse(core, opts) {
    return new Promise((resolve, reject) => {
        core.services.RoonApiBrowse.browse({ hierarchy: HIER, ...opts }, (err, body) =>
            err ? reject(new Error(err)) : resolve(body));
    });
}

function load(core, opts = {}) {
    return new Promise((resolve, reject) => {
        core.services.RoonApiBrowse.load({ hierarchy: HIER, offset: 0, count: 100, ...opts }, (err, body) =>
            err ? reject(new Error(err)) : resolve(body));
    });
}

// Find the row that acts as a category header (e.g. "Tracks") in a result list.
function findCategory(items, name) {
    return items.find(i => (i.title || "").toLowerCase() === name.toLowerCase()) || null;
}

// The "search" hierarchy is ONE server-side cursor per extension — a second
// search started mid-flight resets it and the first request reads the second's
// rows. Serialise every searchAndPlay through this chain.
let chain = Promise.resolve();
function searchAndPlay(...args) {
    const run = chain.then(() => doSearchAndPlay(...args));
    chain = run.then(() => {}, () => {});
    return run;
}

// kind: "track" (playlist rows) walks the Tracks category; "album" (Fresh
// Releases) walks Albums instead — same search, same matcher, different rows.
async function doSearchAndPlay(core, { artist, title }, zoneOrOutputId, action = "Play Now", kind = "track") {
    if (!core) throw new Error("Not paired with a Roon Core");

    const query = `${artist} ${title}`;
    console.log(`[play] search (${kind}): "${query}" -> zone ${zoneOrOutputId} (${action})`);

    // 1-2. search + load top level
    await browse(core, { pop_all: true, input: query });
    let top = await load(core);

    // 3. descend into the right category if present, else use what we have
    logger.debug(`categories for "${query}":`, top.items.map(i => i.title).join(" | "));
    const cat = findCategory(top.items, kind === "album" ? "Albums" : "Tracks");
    let rows = top.items;
    if (cat) {
        await browse(core, { item_key: cat.item_key });
        rows = (await load(core)).items;
    }

    // 4. score every row ONCE — the debug log lines and the pick share the pass.
    // The grep-able candidates line (same habit as the LMS plugins' debug logs).
    const scored = rows.map(cleanRow).map(row => ({ row, ...scoreRow(row, { artist, title }) }));
    if (logger.isDebug()) {
        for (const s of scored)
            logger.debug(`candidates Roon: ${s.score.toFixed(2)} (t=${s.t.toFixed(2)} a=${s.a.toFixed(2)}) "${s.row.title}" — "${s.row.subtitle}"`);
    }
    let hit = null;
    for (const s of scored) if (!hit || s.score > hit.score) hit = s;
    if (!hit || hit.score < THRESHOLD) {
        console.warn(`[play] no confident match for "${query}"`);
        return { ok: false, reason: "no-match", candidates: rows.slice(0, 5).map(r => `${r.title} — ${r.subtitle}`) };
    }
    console.log(`[play] matched: "${hit.row.title}" — ${hit.row.subtitle} (score ${hit.score.toFixed(2)})`);

    // 5-6. Open the winner WITH the zone and walk down until Roon offers the
    // action rows. The depth varies by kind: a track goes row -> (version) ->
    // action list, while an album goes row -> version -> album page -> action
    // list, and the intermediate rows are hinted "list", not "action_list". So
    // don't hard-code a shape: descend until items carrying hint "action"
    // appear, and pick the requested one from those.
    let key = hit.row.item_key;
    for (let depth = 0; depth < MAX_DEPTH; depth++) {
        const r = await browse(core, { item_key: key, zone_or_output_id: zoneOrOutputId });
        if (r.action === "message") {
            // Roon replied with a user-facing message — is_error says whether
            // the request actually happened.
            if (r.is_error) {
                console.warn(`[play] Roon error for "${query}": ${r.message}`);
                return { ok: false, reason: "roon-error", message: r.message || "Roon reported an error" };
            }
            return { ok: true, matched: hit.row.title, message: r.message };
        }
        if (r.action !== "list") {
            // Roon acted immediately (none) — treat as executed.
            return { ok: true, matched: hit.row.title };
        }
        const items = ((await load(core)).items || []).map(cleanRow);
        logger.debug(`level ${depth}:`, items.map(i => `${i.title}[${i.hint || "-"}]`).slice(0, 10).join(" | "));

        // Are we at the action list? Then take ONLY the exact action asked for —
        // silently downgrading "Queue" to "Play Now" would interrupt playback.
        const actions = items.filter(i => (i.hint || "") === "action");
        const exact = items.find(i => (i.title || "").toLowerCase() === action.toLowerCase());
        if (exact) {
            await browse(core, { item_key: exact.item_key, zone_or_output_id: zoneOrOutputId });
            console.log(`[play] executed "${exact.title}"`);
            return { ok: true, matched: hit.row.title, action: exact.title };
        }
        if (actions.length) {
            console.warn(`[play] action "${action}" not offered for "${query}"`);
            return { ok: false, reason: "no-action", candidates: actions.map(i => i.title) };
        }

        // Not there yet — step toward it: an explicit play entry, else the row
        // that still names what we matched (the version/album page), else the
        // only way forward. Never step into another transport verb: on a Core
        // that omits the "action" hint that would execute Play Now when the
        // user asked to Queue.
        const openable = items.filter(i => !ACTION_TITLES.has((i.title || "").toLowerCase()));
        const next = openable.find(i => /^play\b/i.test(i.title || "")) ||
                     openable.find(i => fold(i.title) === fold(hit.row.title)) ||
                     (openable.length === 1 ? openable[0] : null);
        if (!next) {
            console.warn(`[play] no way down to an action list for "${query}"`);
            return { ok: false, reason: "no-action", candidates: items.map(i => i.title).slice(0, 8) };
        }
        key = next.item_key;
    }
    console.warn(`[play] gave up descending for "${query}"`);
    return { ok: false, reason: "no-action", candidates: [] };
}

module.exports = { searchAndPlay };
