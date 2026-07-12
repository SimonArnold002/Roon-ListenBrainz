// Companion web UI: Express REST + WebSocket state push + static SPA.
// The browser talks only to this server; this server talks to Roon.
//
//   metadata = EAGER  (enrichAll on playlist open)
//   match    = LAZY   (searchAndPlay only on a play/queue click)

const path = require("path");
const http = require("http");
const express = require("express");
const { WebSocketServer } = require("ws");

const { getCore, getZones, getSetting, setSetting } = require("./roon");
const { searchAndPlay } = require("./roon-play");
const lb = require("./listenbrainz");
const resolve = require("./resolve");
const logger = require("./log");

function createServer() {
    const app = express();
    app.use(express.json());
    app.use(express.static(path.join(__dirname, "..", "public")));

    app.get("/api/state", (req, res) => {
        const core = getCore();
        res.json({
            paired:      !!core,
            core:        core ? core.display_name : null,
            username:    getSetting("lb_username") || null,
            defaultZone: getSetting("default_zone")?.output_id || getSetting("default_zone") || null,
            zones:       getZones().map(z => ({ id: z.zone_id, name: z.display_name })),
            debug:       logger.isDebug(),
        });
    });

    // Remote debugging: curl http://<host>:9330/log.txt  (LMS log.txt habit).
    app.get("/log.txt", (req, res) => {
        res.type("text/plain").send(logger.dump());
    });

    // Toggle verbose logging at runtime: curl -X POST http://<host>:9330/api/debug -d '{"on":true}' -H 'Content-Type: application/json'
    app.post("/api/debug", (req, res) => {
        logger.setDebug(!!(req.body || {}).on);
        res.json({ ok: true, debug: logger.isDebug() });
    });

    app.post("/api/config", (req, res) => {
        const { username } = req.body || {};
        if (typeof username === "string") setSetting("lb_username", username.trim());
        res.json({ ok: true, username: getSetting("lb_username") || null });
    });

    app.get("/api/playlists", async (req, res) => {
        const u = getSetting("lb_username");
        if (!u) return res.status(400).json({ error: "no-username" });
        try { res.json(await lb.getCreatedForPlaylists(u)); }
        catch (e) { res.status(502).json({ error: String(e.message || e) }); }
    });

    app.get("/api/fresh", async (req, res) => {
        const u = getSetting("lb_username");
        if (!u) return res.status(400).json({ error: "no-username" });
        try { res.json(await lb.getFreshReleases(u)); }
        catch (e) { res.status(502).json({ error: String(e.message || e) }); }
    });

    app.get("/api/playlist/:id", async (req, res) => {
        try {
            const pl = await lb.getPlaylist(req.params.id);
            await resolve.enrichAll(pl.tracks);          // eager metadata
            res.json(pl);
        } catch (e) { res.status(502).json({ error: String(e.message || e) }); }
    });

    app.post("/api/play", async (req, res) => {
        const core = getCore();
        if (!core) return res.status(409).json({ error: "not-paired" });
        const { artist, title, zone, action, kind } = req.body || {};
        if (!zone) return res.status(400).json({ error: "no-zone" });
        if (!artist || !title) return res.status(400).json({ error: "no-metadata" });
        try {
            const r = await searchAndPlay(core, { artist, title }, zone, action || "Play Now",
                                          kind === "album" ? "album" : "track");
            res.json(r);
        } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
    });

    const httpServer = http.createServer(app);
    const wss = new WebSocketServer({ server: httpServer, path: "/ws" });
    wss.on("connection", ws => ws.send(JSON.stringify({ type: "hello" })));

    function broadcast(obj) {
        const s = JSON.stringify(obj);
        for (const c of wss.clients) if (c.readyState === 1) c.send(s);
    }

    return { httpServer, broadcast };
}

module.exports = { createServer };
