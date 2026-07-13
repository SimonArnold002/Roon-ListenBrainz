// Roon pairing + service registration + live zone tracking + persisted settings.
//
// node-roon-api speaks Roon's SOOD discovery, so once start() runs the extension
// broadcasts itself and appears under Roon -> Settings -> Extensions with an
// Enable button. That click is the authorization on the Core. We never hardcode
// the Core's IP. Settings (ListenBrainz username, default zone) persist to
// config.json in the cwd — which the Docker image mounts on a volume.

const RoonApi          = require("node-roon-api");
const RoonApiStatus    = require("node-roon-api-status");
const RoonApiTransport = require("node-roon-api-transport");
const RoonApiBrowse    = require("node-roon-api-browse");
const RoonApiImage     = require("node-roon-api-image");
const RoonApiSettings  = require("node-roon-api-settings");

let core = null;
let zones = [];
const coreListeners = [];
const zoneListeners = [];

function fire(list, arg) { for (const fn of list) { try { fn(arg); } catch (e) { console.error(e); } } }

function onCore(fn)     { coreListeners.push(fn); if (core) fn(core); }
function onZones(fn)    { zoneListeners.push(fn); }

function getCore()  { return core; }
function getZones() { return zones; }

const roon = new RoonApi({
    extension_id:    "com.simon.listenbrainz",
    display_name:    "ListenBrainz for Roon",
    display_version: "0.1.2",
    publisher:       "Simon Arnold",
    email:           "simon.arnold@unionvfx.com",

    core_paired: function (core_) {
        core = core_;
        console.log("[roon] paired with Core:", core.display_name);
        core.services.RoonApiTransport.subscribe_zones((cmd, data) => {
            if (cmd === "Subscribed" && data.zones) {
                zones = data.zones;
            } else if (cmd === "Changed") {
                if (data.zones_added)   for (const z of data.zones_added)   upsertZone(z);
                if (data.zones_changed) for (const z of data.zones_changed) upsertZone(z);
                if (data.zones_removed) zones = zones.filter(z => !data.zones_removed.includes(z.zone_id));
            }
            fire(zoneListeners, zones);
        });
        fire(coreListeners, core);
    },

    core_unpaired: function (core_) {
        console.log("[roon] unpaired from Core:", core_ && core_.display_name);
        core = null; zones = [];
        fire(coreListeners, null);
        fire(zoneListeners, zones);
    },
});

function upsertZone(z) {
    const i = zones.findIndex(x => x.zone_id === z.zone_id);
    if (i >= 0) zones[i] = z; else zones.push(z);
}

// --- settings ---------------------------------------------------------------
// Env vars win over the Roon-persisted values (handy for Docker).
const ENV_MAP = { lb_username: "LB_USER" };

// load_config re-reads + re-parses config.json synchronously on every call, and
// /api/state hits getSetting several times per request — cache the parsed
// settings and invalidate only where this process writes them.
let settingsCache = null;
function readSettings() {
    if (!settingsCache) settingsCache = roon.load_config("settings") || {};
    return settingsCache;
}

function envOverride(key) { return (ENV_MAP[key] && process.env[ENV_MAP[key]]) || null; }

function getSetting(key) {
    return envOverride(key) ?? readSettings()[key];
}

function setSetting(key, value) {
    const s = { ...readSettings(), [key]: value };
    roon.save_config("settings", s);
    settingsCache = s;
    svc_settings.update_settings(makeSettingsLayout(s));
}

function makeSettingsLayout(values) {
    values = values || readSettings();
    return {
        values,
        layout: [
            { type: "string", title: "ListenBrainz username", setting: "lb_username" },
            { type: "zone",   title: "Default zone",          setting: "default_zone" },
        ],
        has_error: false,
    };
}

const svc_status = new RoonApiStatus(roon);
const svc_settings = new RoonApiSettings(roon, {
    get_settings: (cb) => cb(makeSettingsLayout()),
    save_settings: (req, isdryrun, settings) => {
        const l = makeSettingsLayout(settings.values);
        req.send_complete(l.has_error ? "NotValid" : "Success", { settings: l });
        if (!isdryrun && !l.has_error) {
            roon.save_config("settings", l.values);
            settingsCache = l.values;
        }
    },
});

roon.init_services({
    required_services: [RoonApiTransport, RoonApiBrowse, RoonApiImage],
    provided_services: [svc_status, svc_settings],
});

svc_status.set_status("Starting up...", false);

function start() {
    roon.start_discovery();
    svc_status.set_status("Waiting to be enabled in Roon -> Settings -> Extensions", false);
    console.log("[roon] discovery started - Enable the extension in Roon Settings.");
}

function setStatus(msg, isError = false) { svc_status.set_status(msg, isError); }

module.exports = {
    roon, start, setStatus,
    onCore, onZones,
    getCore, getZones, getSetting, setSetting, envOverride,
};
