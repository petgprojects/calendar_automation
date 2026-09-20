import { build } from "esbuild";
import { mkdir, copyFile } from "node:fs/promises";
await mkdir("dist/renderer", { recursive: true });
await build({
  entryPoints: ["src/electron/main.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  external: ["electron"],
  outfile: "dist/electron/main.cjs",
});
await build({
  entryPoints: ["src/electron/preload.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  external: ["electron"],
  outfile: "dist/electron/preload.cjs",
});
await build({
  entryPoints: ["src/renderer/app.ts"],
  bundle: true,
  platform: "browser",
  outfile: "dist/renderer/app.js",
});
for (const name of ["index.html", "style.css"])
  await copyFile(`src/renderer/${name}`, `dist/renderer/${name}`);
