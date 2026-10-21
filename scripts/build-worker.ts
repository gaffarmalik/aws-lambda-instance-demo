import { build } from "esbuild";
import { mkdirSync } from "node:fs";
mkdirSync("dist/worker", { recursive: true });
await build({
  entryPoints: ["api/src/lambda.ts"],
  outfile: "dist/worker/index.mjs",
  platform: "node",
  target: "node22",
  format: "esm",
  bundle: true,
  sourcemap: true,
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
});
console.log("Built dist/worker/index.mjs; Lambda handler: index.handler");
