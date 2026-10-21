import { statusSchema } from "@feedback/contracts";
import { readObject } from "./types.ts";
import { errorMessage } from "./errors.ts";
import { setTimeout as delay } from "node:timers/promises";
import { configuration, dependencies } from "./config.ts";
import { processBatch } from "./worker.ts";
import { batchIdFromKey } from "./domain.ts";
const config = configuration();
if (config.mode !== "local")
  throw new Error(
    "Local worker only supports DEMO_MODE=local. In AWS mode, S3 invokes Lambda. Use npm run dev:aws.",
  );
const { store, model } = dependencies(config);
let running = true;
process.on("SIGINT", () => {
  running = false;
});
process.on("SIGTERM", () => {
  running = false;
});
console.log(
  "Local worker: filesystem event simulation + rule-based model (not AWS).",
);
while (running) {
  try {
    for (const key of await store.list("batches/")) {
      const batchId = batchIdFromKey(key);
      if (!batchId) continue;
      const status = (
        await readObject(store, `status/${batchId}.json`, statusSchema)
      )?.value;
      if (status?.state === "completed") continue;
      if (
        status?.state === "failed" &&
        Date.now() - Date.parse(status.updatedAt) < 10000
      )
        continue;
      try {
        await processBatch({
          store,
          model,
          key,
          requestSize: config.requestSize,
        });
        console.log(`Processed ${batchId}`);
      } catch (e) {
        console.error(`Failed ${batchId}: ${errorMessage(e)}`);
      }
    }
  } catch (e) {
    console.error(`Worker poll failed: ${errorMessage(e)}`);
  }
  await delay(1000);
}
