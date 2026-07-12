// Entry point: start Roon discovery, bring up the web server, advertise over
// mDNS, and push live zone/pairing state to connected browsers.
//
//   npm start   -> pair + serve web UI on $PORT (default 9330)
//   RUN_DEMO=1  -> also fire one hardcoded search-and-play after pairing
//
// The web UI can run on any box on the LAN; SOOD finds the Core. In Docker this
// requires network_mode: host (LAN broadcast/multicast for SOOD + mDNS).

require("./log");   // first, so the console tee catches everything incl. Roon lib output

const { start, onCore, onZones, getZones, setStatus } = require("./roon");
const { searchAndPlay } = require("./roon-play");
const { createServer } = require("./server");
const mdns = require("./mdns");

const PORT = parseInt(process.env.PORT || "9330", 10);

start();

const { httpServer, broadcast } = createServer();
httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`[web] listening on http://0.0.0.0:${PORT}`);
    mdns.advertise(PORT);
});

// Push state to browsers whenever pairing or zones change.
onCore(core => {
    setStatus(core ? "Paired - web UI ready" : "Waiting to be enabled in Roon Settings", false);
    broadcast({ type: "state" });
});
onZones(() => broadcast({ type: "state" }));

// Optional one-shot playback smoke test.
if (process.env.RUN_DEMO === "1") {
    const track = {
        artist: process.env.DEMO_ARTIST || "Radiohead",
        title:  process.env.DEMO_TITLE  || "Reckoner",
    };
    onCore(async core => {
        if (!core) return;
        await new Promise(r => setTimeout(r, 1500));
        const zones = getZones();
        if (!zones.length) { console.error("[demo] no zones available"); return; }
        try {
            console.log("[demo] result:", await searchAndPlay(core, track, zones[0].zone_id, "Play Now"));
        } catch (e) { console.error("[demo] error:", e); }
    });
}

process.on("SIGTERM", () => { mdns.stop(); process.exit(0); });
process.on("SIGINT",  () => { mdns.stop(); process.exit(0); });
