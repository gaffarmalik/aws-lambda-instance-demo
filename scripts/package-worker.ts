import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";
const output = resolve("dist/worker.zip");
// Recreate this generated artifact so obsolete bundle formats cannot remain in the archive.
if (existsSync(output)) unlinkSync(output);
execFileSync(
  "zip",
  ["-j", output, "dist/worker/index.mjs", "dist/worker/index.mjs.map"],
  { stdio: "inherit" },
);
const sha256 = createHash("sha256")
  .update(readFileSync(output))
  .digest("base64");
writeFileSync("dist/worker-sha256.txt", sha256 + "\n");
console.log(`CodeSha256: ${sha256}`);
