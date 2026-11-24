// Bakes one compressed, high-detail model file per aircraft type into public/models/.
//   cd tools && npm install && npm run build-models            (all types)
//   npm run build-models -- B738 A20N EC35                      (some types)
// Each file has a neutral "livery" material (the app recolors it per airline), retractable
// landing gear in a node named "gear" (hidden in flight), and spinning rotors/propellers.
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { KHRDracoMeshCompression, ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { weld, dedup, prune, draco } from "@gltf-transform/functions";
import draco3d from "draco3dgltf";
import validator from "gltf-validator";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const AM = require(join(here, "../public/aircraft-models.js"));
const out = join(here, "../public/models");
mkdirSync(out, { recursive: true });

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  "draco3d.encoder": await draco3d.createEncoderModule(), "draco3d.decoder": await draco3d.createDecoderModule(),
});
const only = process.argv.slice(2).map(s => s.toUpperCase());
const manifestPath = join(out, "manifest.json");
const manifest = existsSync(manifestPath) && only.length ? JSON.parse(readFileSync(manifestPath, "utf8")) : { version: 1, types: {} };
let total = 0, failed = 0;
for (const [code, [fam, L, b]] of Object.entries(AM.T)) {
  if (only.length && !only.includes(code)) continue;
  const info = {};
  const raw = AM.glb(fam, L, b, "ffffff", { code, hq: true, gearPart: true, info });
  const tris = AM.triangles(fam, L, b, { code, hq: true, gearPart: true });
  const doc = await io.readBinary(raw);
  await doc.transform(dedup(), weld(), prune(), draco({ method: "edgebreaker", quantizePosition: 14, quantizeNormal: 10 }));
  const bytes = await io.writeBinary(doc);
  const report = await validator.validateBytes(bytes);
  const errors = report.issues.messages.filter(m => m.severity === 0);
  if (errors.length) { failed++; console.error(code, errors.slice(0, 3).map(e => `${e.code} ${e.pointer}`)); }
  writeFileSync(join(out, `${code}.glb`), bytes);
  manifest.types[code] = { gearLift: +info.gearLift.toFixed(3), tris, kb: Math.round(bytes.length / 1024) };
  total += bytes.length;
}
writeFileSync(manifestPath, JSON.stringify(manifest, null, 1) + "\n");
console.log(`${Object.keys(manifest.types).length} types in manifest, wrote ${(total / 1048576).toFixed(1)} MB${failed ? `, ${failed} with validator errors` : ""}`);
if (failed) process.exit(1);
