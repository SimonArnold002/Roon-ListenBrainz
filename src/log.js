// Remote-friendly logging: everything that hits the console is also kept in an
// in-memory ring buffer, served as plain text at /log.txt — so a remote user
// can just `curl http://<host>:9330/log.txt` (same habit as LMS's log.txt).
//
// Levels: normal lines always logged; debug() lines only when debug mode is on
// (env LBR_DEBUG=1, or toggled at runtime via POST /api/debug).

const util = require("util");

const MAX_LINES = 2000;
const buffer = [];

let debugOn = process.env.LBR_DEBUG === "1";

function ts() { return new Date().toISOString(); }

function fmt(a) {
    if (typeof a === "string") return a;
    if (a instanceof Error) return a.stack || a.message;
    // JSON.stringify throws on circular structures / BigInt — and we're inside
    // the patched console, so a throw here escapes from the caller's log line.
    try { return JSON.stringify(a); } catch { return util.inspect(a, { depth: 4 }); }
}

function push(level, args) {
    const line = `${ts()} [${level}] ` + args.map(fmt).join(" ");
    buffer.push(line);
    if (buffer.length > MAX_LINES) buffer.splice(0, buffer.length - MAX_LINES);
    return line;
}

// Tee the plain console too, so existing console.* calls (ours and the Roon
// lib's "Setting up sood" etc.) land in the buffer without touching each file.
for (const [method, level] of [["log", "info"], ["warn", "warn"], ["error", "error"]]) {
    const orig = console[method].bind(console);
    console[method] = (...args) => { push(level, args); orig(...args); };
}

function debug(...args) {
    if (!debugOn) return;
    console.log("[debug]", ...args);
}

function setDebug(on) {
    debugOn = !!on;
    console.log(`[log] debug mode ${debugOn ? "ON" : "off"}`);
}

function isDebug() { return debugOn; }
function dump()    { return buffer.join("\n") + "\n"; }

module.exports = { debug, setDebug, isDebug, dump };
