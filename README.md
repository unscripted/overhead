# Overhead 3D

Live aircraft around you on a 3D globe, at their real altitude, drawn as 3D models of each aircraft type.

- **Live positions and aircraft types:** [airplanes.live](https://airplanes.live), with [adsb.lol](https://adsb.lol) and [adsb.fi](https://adsb.fi) as fallbacks.
- **Photo, owner and route for the plane you tap:** [adsbdb](https://www.adsbdb.com).
- **Globe:** [CesiumJS](https://cesium.com/platform/cesiumjs/), with free Esri satellite imagery or OpenStreetMap. Terrain and HD imagery are optional and use a free [Cesium ion](https://ion.cesium.com) token, entered in the app's ⚙ Settings.
- **Polling:** The app only fetches data while it's open and on screen.

## How it runs

Everything is one free Cloudflare Worker:

| Path | What it does |
| --- | --- |
| `public/index.html` | The app, served as static assets |
| `src/worker.js` | Relays `/api/aircraft` and `/api/adsbdb/*`. Browsers block those APIs when a web page calls them directly. |
| `wrangler.jsonc` | Worker config |

## Deploy (one time, works from a phone)

1. In the Cloudflare dashboard, go to **Workers & Pages → Create → Import a repository**.
2. Connect GitHub if asked, then pick **unscripted/overhead**.
3. Keep the detected settings (deploy command `npx wrangler deploy`) and select **Deploy**.

Every push to `main` then redeploys automatically. The app lives at `https://overhead.<your-subdomain>.workers.dev`.

## Local development

```sh
npx wrangler dev
```
