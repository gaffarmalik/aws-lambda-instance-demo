import { fileURLToPath } from "node:url";
import { z } from "zod";
import { LocalStore, S3Store } from "./store.ts";
import { BedrockModel, LocalModel } from "./model.ts";
export function configuration(env = process.env) {
  const mode = z.enum(["local", "aws"]).parse(env.DEMO_MODE || "local");
  const region = env.AWS_REGION || "us-east-1";
  const requestSize = z.coerce
    .number()
    .int()
    .min(1)
    .max(20)
    .parse(env.MODEL_REQUEST_SIZE || 10);
  if (mode === "aws" && (!env.S3_BUCKET || !env.BEDROCK_MODEL_ID))
    throw new Error("AWS mode requires S3_BUCKET and BEDROCK_MODEL_ID.");
  return {
    mode,
    region,
    requestSize,
    bucket: env.S3_BUCKET,
    modelId: env.BEDROCK_MODEL_ID,
    dataDir:
      env.LOCAL_DATA_DIR ||
      fileURLToPath(new URL("../../.demo-data/", import.meta.url)),
    maxBuffer: z.coerce
      .number()
      .int()
      .min(200)
      .max(100000)
      .parse(env.MAX_BUFFER_SIZE || 10000),
  };
}
export type Configuration = ReturnType<typeof configuration>;
export function dependencies(config: Configuration) {
  return {
    store:
      config.mode === "aws"
        ? new S3Store(z.string().min(1).parse(config.bucket), config.region)
        : new LocalStore(config.dataDir),
    model:
      config.mode === "aws"
        ? new BedrockModel(
            z.string().min(1).parse(config.modelId),
            config.region,
          )
        : new LocalModel(),
  };
}
