import { configuration, dependencies } from "./config.ts";
import { Collector } from "./collector.ts";
import { createApp } from "./app.ts";
const config = configuration(),
  { store, model } = dependencies(config);
const collector = new Collector(store, { maxBuffer: config.maxBuffer });
const app = createApp({ store, model, collector, config });
const host = process.env.HOST || "127.0.0.1";
if (!["127.0.0.1", "localhost", "::1"].includes(host))
  throw new Error(
    "This unauthenticated teaching server must bind to loopback.",
  );
const server = app.listen(Number(process.env.PORT || 3001), host, () => {
  console.log(
    `Collection API: http://${host}:${process.env.PORT || 3001} (${config.mode})`,
  );
  console.log(
    "ONE collector process only. Restarting loses unexported feedback. Production needs durable collection storage.",
  );
});
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    console.log(
      `Stopping: ${collector.records.length} unexported feedback records will be lost.`,
    );
    collector.close();
    server.close();
  });
