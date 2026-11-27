# Overhead 3D

Live aircraft around you on a 3D globe, at their real altitude, drawn as 3D models of each aircraft type.

**Live:** https://overhead.matchbox-devops.workers.dev

- **Live positions and aircraft types:** [airplanes.live](https://airplanes.live), with [adsb.lol](https://adsb.lol) and [adsb.fi](https://adsb.fi) as fallbacks.
- **Photo, owner and route for the plane you tap:** [adsbdb](https://www.adsbdb.com).
- **Globe:** [CesiumJS](https://cesium.com/platform/cesiumjs/), with free Esri satellite imagery or OpenStreetMap. Terrain and HD imagery are optional and use a free [Cesium ion](https://ion.cesium.com) token, entered in the app's ⚙ Settings.
- **Polling:** The app only fetches data while it's open and on screen.

## How it runs

Everything is one free Cloudflare Worker:

| Path | What it does |
| --- | --- |
| `public/index.html` | The app, served as static assets |
| `public/aircraft-models.js` | Builds a 3D model for each aircraft type (glTF), in the browser or in Node |
| `public/models/` | One detailed, compressed model file per aircraft type, plus `manifest.json` |
| `tools/build-models.mjs` | Bakes `public/models/` from `aircraft-models.js` |
| `src/worker.js` | Relays `/api/aircraft` and `/api/adsbdb/*`. Browsers block those APIs when a web page calls them directly. |
| `wrangler.jsonc` | Worker config |

## Deploy (one time, works from a phone)

1. In the Cloudflare dashboard, go to **Workers & Pages → Create → Import a repository**.
2. Connect GitHub if asked, then pick **unscripted/overhead**.
3. Keep the detected settings (deploy command `npx wrangler deploy`) and select **Deploy**.

Every push to `main` redeploys automatically (Cloudflare account: Matchbox DevOps).

## Local development

```sh
npx wrangler dev
```

## Aircraft models

Each ICAO type code has a model file in `public/models/<TYPE>.glb`. The files are generated from the type data in `public/aircraft-models.js`, which sets dimensions, wingtips, engines, gear and helicopter rotors. To change a model, edit that file and rebuild:

```sh
cd tools && npm install && npm run build-models          # all types
npm run build-models -- B738 A20N EC35                    # just these
```

The files use a neutral tail color that the app recolors for each airline. Retractable landing gear sits in a node named `gear`, which the app hides in flight.
