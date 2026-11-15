// Overhead 3D — Cloudflare Worker.
// Serves the app (public/) and relays the data APIs the browser can't call directly (no CORS):
//   GET /api/aircraft?lat=..&lon=..&nm=..   live aircraft near a point (ADS-B Exchange v2 format)
//   GET /api/adsbdb/aircraft/{hex}          aircraft details + photo (adsbdb)
//   GET /api/adsbdb/callsign/{callsign}     flight route (adsbdb)
//   GET /api/config                         browser config (Cesium ion token from the ION_TOKEN secret)
// Everything else falls through to the static assets.

const FEEDS = [
  ["airplanes.live", (la, lo, nm) => `https://api.airplanes.live/v2/point/${la}/${lo}/${nm}`],
  ["adsb.lol", (la, lo, nm) => `https://api.adsb.lol/v2/lat/${la}/lon/${lo}/dist/${nm}`],
  ["adsb.fi", (la, lo, nm) => `https://opendata.adsb.fi/api/v2/lat/${la}/lon/${lo}/dist/${nm}`],
];
const UA = { "User-Agent": "Overhead3D/1.0 (personal flight viewer)", Accept: "application/json" };

const json = (body, status = 200, extra = {}) =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...extra },
  });

async function aircraft(url) {
  const lat = Number(url.searchParams.get("lat")), lon = Number(url.searchParams.get("lon"));
  const nm = Math.min(250, Math.max(1, Math.round(Number(url.searchParams.get("nm")) || 50)));
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return json({ error: "lat and lon are required" }, 400);
  }
  // Round the point so nearby requests share the edge cache (≈1 km).
  const la = lat.toFixed(2), lo = lon.toFixed(2);
  const errors = [];
  for (const [name, build] of FEEDS) {
    try {
      const r = await fetch(build(la, lo, nm), { headers: UA, cf: { cacheTtl: 5, cacheEverything: true } });
      if (!r.ok) { errors.push(`${name}: HTTP ${r.status}`); continue; }
      const body = await r.text();
      const parsed = JSON.parse(body);
      if (!Array.isArray(parsed.ac) && !Array.isArray(parsed.aircraft)) { errors.push(`${name}: unexpected response`); continue; }
      return json(body, 200, { "Cache-Control": "no-store", "X-Upstream": name });
    } catch (e) {
      errors.push(`${name}: ${e.message}`);
    }
  }
  return json({ error: "All flight feeds failed", details: errors }, 502);
}

async function adsbdb(url) {
  const path = url.pathname.slice("/api/adsbdb/".length);
  if (!/^(aircraft|callsign)\/[A-Za-z0-9-]{2,12}$/.test(path)) return json({ error: "bad path" }, 400);
  const r = await fetch(`https://api.adsbdb.com/v0/${path}`, { headers: UA, cf: { cacheTtl: 86400, cacheEverything: true } });
  return json(await r.text(), r.status, { "Cache-Control": r.ok ? "public, max-age=86400" : "no-store" });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method !== "GET") return json({ error: "method not allowed" }, 405);
    try {
      if (url.pathname === "/api/aircraft") return await aircraft(url);
      if (url.pathname.startsWith("/api/adsbdb/")) return await adsbdb(url);
      // Public, browser-side config. ION_TOKEN is a Worker secret (set in the Cloudflare dashboard, not in git);
      // Cesium ion tokens are meant for browsers, so restrict it to this site's URL in the ion dashboard.
      if (url.pathname === "/api/config") return json({ ionToken: env.ION_TOKEN || null }, 200, { "Cache-Control": "no-store" });
      if (url.pathname.startsWith("/api/")) return json({ error: "not found" }, 404);
    } catch (e) {
      return json({ error: e.message }, 500);
    }
    return env.ASSETS.fetch(request);
  },
};
