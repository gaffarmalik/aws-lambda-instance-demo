import { configuration, dependencies } from "./config.ts";
import { makeHandler } from "./worker.ts";
const config = configuration({ ...process.env, DEMO_MODE: "aws" });
export const handler = makeHandler({
  ...dependencies(config),
  requestSize: config.requestSize,
});
