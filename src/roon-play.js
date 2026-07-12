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

const { scoreRow } = require("./match");
const logger = require("./log");

const HIER = "search";
const THRESHOLD = 0.62;

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
    const scored = rows.map(row => ({ row, ...scoreRow(row, { artist, title }) }));
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

    // 5-6. open the winner WITH the zone and walk down to the requested action.
    // A track usually opens straight onto an action list (Play Now / Queue…).
    // An album opens its album PAGE first — whose "Play Album" row then opens
    // the action list — so allow a couple of descents before giving up.
    let key = hit.row.item_key;
    for (let depth = 0; depth < 3; depth++) {
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
        const items = (await load(core)).items;
        logger.debug(`action level ${depth}:`, items.map(i => i.title).slice(0, 8).join(" | "));

        // ONLY the exact requested action — silently downgrading "Queue" to
        // "Play Now" would interrupt what the user is listening to.
        const chosen = findCategory(items, action);
        if (chosen) {
            await browse(core, { item_key: chosen.item_key, zone_or_output_id: zoneOrOutputId });
            console.log(`[play] executed "${chosen.title}"`);
            return { ok: true, matched: hit.row.title, action: chosen.title };
        }
        // …otherwise descend through the album page's play entry. Only rows
        // hinted action_list (they OPEN an action list) qualify — a bare title
        // match like /^play/ would swallow the "Play Now" ACTION and execute
        // it, silently downgrading the requested action after all.
        const lists = items.filter(i => (i.hint || "") === "action_list");
        const descend = lists.find(i => /^play\b/i.test(i.title || "")) || lists[0];
        if (!descend) {
            console.warn(`[play] action "${action}" not offered for "${query}"`);
            return { ok: false, reason: "no-action", candidates: items.map(i => i.title).slice(0, 8) };
        }
        key = descend.item_key;
    }
    return { ok: false, reason: "no-action", candidates: [] };
}

module.exports = { searchAndPlay };
