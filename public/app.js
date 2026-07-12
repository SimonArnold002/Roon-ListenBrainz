"use strict";
const $ = sel => document.querySelector(sel);
const el = (tag, props = {}, kids = []) => {
  const n = Object.assign(document.createElement(tag), props);
  for (const k of [].concat(kids)) n.append(k);
  return n;
};

let state = { paired: false, zones: [], username: null, defaultZone: null };
let currentPlaylist = null;

async function api(path, opts) {
  const r = await fetch(path, opts);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || r.status);
  return j;
}

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove("show"), 2600);
}

// --- state / header ---------------------------------------------------------
async function refreshState() {
  try { state = await api("/api/state"); } catch { return; }
  const s = $("#status");
  if (!state.paired) { s.textContent = "not enabled in Roon"; s.className = "status bad"; }
  else { s.textContent = "paired · " + state.core; s.className = "status ok"; }

  if (document.activeElement !== $("#username")) $("#username").value = state.username || "";

  const z = $("#zone");
  const keep = z.value;
  z.innerHTML = "";
  if (!state.zones.length) z.append(el("option", { textContent: "— no zones —", value: "" }));
  for (const zo of state.zones) z.append(el("option", { textContent: zo.name, value: zo.id }));
  if (state.zones.some(zo => zo.id === keep)) z.value = keep;
  else if (state.defaultZone && state.zones.some(zo => zo.id === state.defaultZone)) z.value = state.defaultZone;
}

// --- playlists --------------------------------------------------------------
async function loadPlaylists() {
  const list = $("#playlistList");
  list.innerHTML = "";
  if (!state.username) { list.append(el("li", { className: "muted", textContent: "set a username above" })); return; }

  // Fresh Releases is a fixed feed, not a playlist — always at the top.
  const fresh = el("li", {}, [
    el("div", { textContent: "Fresh Releases" }),
    el("div", { className: "count", textContent: "New releases from artists you listen to." }),
  ]);
  fresh.onclick = () => selectFresh(fresh);
  list.append(fresh);

  list.append(el("li", { className: "muted", textContent: "loading…" }));
  try {
    const pls = await api("/api/playlists");
    list.innerHTML = "";
    list.append(fresh);
    if (!pls.length) { list.append(el("li", { className: "muted", textContent: "no playlists" })); return; }
    for (const p of pls) {
      const li = el("li", {}, [
        el("div", { textContent: p.title }),
        p.annotation ? el("div", { className: "count", textContent: p.annotation }) : "",
      ]);
      li.onclick = () => selectPlaylist(p, li);
      list.append(li);
    }
  } catch (e) {
    list.innerHTML = "";
    list.append(el("li", { className: "muted", textContent: "error: " + e.message }));
  }
}

// --- tracks -----------------------------------------------------------------
async function selectPlaylist(p, li) {
  currentPlaylist = p.id;
  [...$("#playlistList").children].forEach(c => c.classList.remove("active"));
  li && li.classList.add("active");
  $("#tracksTitle").textContent = p.title;
  const ol = $("#trackList");
  ol.innerHTML = "";
  ol.append(el("li", { className: "muted", textContent: "resolving metadata…" }));
  try {
    const pl = await api("/api/playlist/" + p.id);   // eager metadata happens server-side
    ol.innerHTML = "";
    pl.tracks.forEach(t => ol.append(trackRow(t)));
  } catch (e) {
    ol.innerHTML = "";
    ol.append(el("li", { className: "muted", textContent: "error: " + e.message }));
  }
}

async function selectFresh(li) {
  currentPlaylist = "__fresh__";
  [...$("#playlistList").children].forEach(c => c.classList.remove("active"));
  li && li.classList.add("active");
  $("#tracksTitle").textContent = "Fresh Releases";
  const ol = $("#trackList");
  ol.innerHTML = "";
  ol.append(el("li", { className: "muted", textContent: "loading releases…" }));
  try {
    const rels = await api("/api/fresh");
    ol.innerHTML = "";
    if (!rels.length) { ol.append(el("li", { className: "muted", textContent: "no fresh releases" })); return; }
    rels.forEach(r => ol.append(trackRow(r, "album")));
  } catch (e) {
    ol.innerHTML = "";
    ol.append(el("li", { className: "muted", textContent: "error: " + e.message }));
  }
}

function trackRow(t, kind = "track") {
  const res = el("span", { className: "res" });
  const play = el("button", { textContent: "Play", disabled: !state.paired });
  const queue = el("button", { className: "ghost", textContent: "Queue", disabled: !state.paired });
  // Cover Art Archive thumbnail; the ♪ placeholder shows until it loads and
  // stays if the release has no art (CAA 404s are normal, not errors).
  const art = el("div", { className: "art" });
  if (t.art) {
    const img = el("img", { src: t.art, loading: "lazy", alt: "" });
    img.onerror = () => img.remove();
    art.append(img);
  }

  // Albums (Fresh Releases) show artist · date · type on the subtitle line.
  const sub = kind === "album"
    ? [t.artist, t.date, t.type].filter(Boolean).join(" · ")
    : (t.artist || "");
  const meta = el("div", { className: "tk" + (t.unresolved ? " unresolved" : "") }, [
    el("div", { className: "t", textContent: t.title || "(unknown)" }),
    el("div", { className: "a", textContent: sub }),
  ]);
  const act = async (action, btn) => {
    const zone = $("#zone").value;
    if (!zone) return toast("Pick a zone first");
    res.textContent = "…"; res.className = "res";
    play.disabled = queue.disabled = true;
    try {
      const r = await api("/api/play", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ artist: t.artist, title: t.title, zone, action, kind }),
      });
      if (r.ok) { res.textContent = "✓ " + (r.matched || "playing"); res.className = "res ok"; }
      else { res.textContent = "no match"; res.className = "res bad"; toast("No Roon match: " + t.artist + " – " + t.title); }
    } catch (e) { res.textContent = "error"; res.className = "res bad"; toast(e.message); }
    finally { play.disabled = queue.disabled = !state.paired; }
  };
  play.onclick = () => act("Play Now", play);
  queue.onclick = () => act("Queue", queue);
  return el("li", {}, [art, meta, res, el("div", { className: "row-actions" }, [play, queue])]);
}

// --- events -----------------------------------------------------------------
$("#saveUser").onclick = async () => {
  await api("/api/config", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: $("#username").value.trim() }),
  });
  await refreshState();
  await loadPlaylists();
  toast("Saved");
};

function connectWS() {
  const ws = new WebSocket((location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/ws");
  ws.onmessage = ev => { try { if (JSON.parse(ev.data).type === "state") refreshState(); } catch {} };
  ws.onclose = () => setTimeout(connectWS, 2000);
}

(async function init() {
  await refreshState();
  await loadPlaylists();
  connectWS();
})();
