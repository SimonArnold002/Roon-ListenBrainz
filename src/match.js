// Text matcher for scoring Roon browse rows against a {artist, title} target.
//
// Roon rows carry only title + subtitle(artist) + an opaque item_key — NO MBIDs —
// so this folding matcher is the ONLY gate on playback. It is a JS port of the
// spirit of LBF's shared matcher: normalise aggressively, compare on token
// containment, score artist and title separately, then combine.

function fold(s) {
    return (s || "")
        .toString()
        .toLowerCase()
        // expand ligatures/special letters that NFKD leaves intact
        .replace(/æ/g, "ae").replace(/œ/g, "oe").replace(/ø/g, "o").replace(/ß/g, "ss")
        .replace(/ł/g, "l").replace(/đ/g, "d").replace(/[þ]/g, "th").replace(/ð/g, "d")
        .normalize("NFKD").replace(/[̀-ͯ]/g, "")   // strip accents
        .replace(/\(.*?\)|\[.*?\]|\{.*?\}/g, " ")            // drop (feat…)/[remaster]
        .replace(/\b(feat|ft|featuring|with|remaster(ed)?|remix|version|edit|mono|stereo|deluxe|bonus|live|explicit)\b/g, " ")
        .replace(/&/g, " and ")
        .replace(/[^a-z0-9]+/g, " ")
        .replace(/\b(the|a|an)\b/g, " ")                     // drop leading articles
        .replace(/\s+/g, " ")
        .trim();
}

function tokens(s) { return fold(s).split(" ").filter(Boolean); }

// Fraction of the wanted tokens present in the candidate (containment, not order).
function containment(candTokens, wantTokens) {
    if (!wantTokens.length) return 0;
    const set = new Set(candTokens);
    let hit = 0;
    for (const t of wantTokens) if (set.has(t)) hit++;
    return hit / wantTokens.length;
}

// 0..1 similarity for one field, with an exact-fold bonus.
function fieldScore(cand, want) {
    const c = fold(cand), w = fold(want);
    if (!w) return 0;
    if (c === w) return 1;
    const ct = tokens(cand), wt = tokens(want);
    const fwd = containment(ct, wt);          // all of what we want is present
    const rev = containment(wt, ct);          // candidate isn't wildly longer
    return Math.min(fwd, 0.5 + rev / 2) * fwd; // reward complete + tight matches
}

// Combined score for a browse row. Title weighted over artist.
function scoreRow(row, target) {
    const t = fieldScore(row.title, target.title);
    const a = fieldScore(row.subtitle, target.artist);
    return { score: t * 0.6 + a * 0.4, t, a };
}

// Pick the best row at or above threshold. Returns { row, score } or null.
function pickBest(rows, target, threshold = 0.62) {
    let best = null, bestScore = -1;
    for (const row of rows) {
        const { score } = scoreRow(row, target);
        if (score > bestScore) { bestScore = score; best = row; }
    }
    return best && bestScore >= threshold ? { row: best, score: bestScore } : null;
}

module.exports = { fold, tokens, scoreRow, pickBest };
