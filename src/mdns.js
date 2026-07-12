// Layer 2 discovery: advertise the web UI over mDNS/Bonjour so it's findable on
// the LAN without typing an IP — the RoPieee-style bit. Roon knows nothing about
// this; it's purely for humans/companions to find the page. Needs host
// networking to reach the LAN multicast group (same requirement as SOOD).

const { Bonjour } = require("bonjour-service");

let instance = null;
let service = null;

function advertise(port, name = "ListenBrainz for Roon") {
    instance = new Bonjour();
    service = instance.publish({
        name,
        type: "http",                                   // _http._tcp
        port,
        txt: { path: "/", role: "roon-listenbrainz" },
    });
    console.log(`[mdns] advertising "${name}" as _http._tcp on port ${port}`);
}

function stop() {
    try { service && service.stop(); } catch { /* ignore */ }
    try { instance && instance.destroy(); } catch { /* ignore */ }
}

module.exports = { advertise, stop };
