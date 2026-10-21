import { errorProperty } from "./errors.ts";
import type { ObjectStore, PutOptions, StoredObject } from "./types.ts";
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  renameSync,
  linkSync,
  unlinkSync,
  existsSync,
} from "node:fs";
import { resolve, dirname, join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
export const conflict = (error: unknown): boolean =>
  errorProperty(error, "name") === "PreconditionFailed" ||
  errorProperty(error, "name") === "ConditionalRequestConflict" ||
  [409, 412].includes(
    Number(errorProperty(errorProperty(error, "$metadata"), "httpStatusCode")),
  );
const precondition = () =>
  Object.assign(new Error("Object already exists or has changed"), {
    name: "PreconditionFailed",
  });
export class LocalStore implements ObjectStore {
  readonly root: string;
  readonly bucket: string;
  constructor(root: string) {
    this.root = resolve(root);
    this.bucket = "local-demo";
    mkdirSync(this.root, { recursive: true });
  }
  path(key: string) {
    if (
      !/^(batches|status|processed|reports)\/[\w/.-]+\.json$/.test(key) ||
      key.includes("..")
    )
      throw new Error("Invalid object key");
    return join(this.root, key);
  }
  async get(key: string): Promise<StoredObject | null> {
    try {
      const body = readFileSync(this.path(key), "utf8");
      return {
        value: JSON.parse(body),
        etag: createHash("sha256").update(body).digest("hex"),
      };
    } catch (e) {
      if (errorProperty(e, "code") === "ENOENT") return null;
      throw e;
    }
  }
  async put(
    key: string,
    value: unknown,
    { ifNoneMatch, ifMatch }: PutOptions = {},
  ) {
    const path = this.path(key),
      body = JSON.stringify(value, null, 2);
    // No awaits in this critical section. One local worker is supported.
    if (ifMatch) {
      let current;
      try {
        current = createHash("sha256")
          .update(readFileSync(path, "utf8"))
          .digest("hex");
      } catch (e) {
        if (errorProperty(e, "code") !== "ENOENT") throw e;
      }
      if (current !== ifMatch) throw precondition();
    }
    mkdirSync(dirname(path), { recursive: true });
    const temp = `${path}.${randomUUID()}.tmp`;
    writeFileSync(temp, body);
    try {
      if (ifNoneMatch) linkSync(temp, path);
      else renameSync(temp, path);
    } catch (e) {
      if (errorProperty(e, "code") === "EEXIST") throw precondition();
      throw e;
    } finally {
      if (existsSync(temp)) unlinkSync(temp);
    }
    return { etag: createHash("sha256").update(body).digest("hex") };
  }
  async list(prefix: string): Promise<string[]> {
    const walk = (dir: string): string[] =>
      !existsSync(dir)
        ? []
        : readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
            entry.isDirectory()
              ? walk(join(dir, entry.name))
              : entry.name.endsWith(".json")
                ? [join(dir, entry.name).slice(this.root.length + 1)]
                : [],
          );
    return walk(join(this.root, prefix)).sort();
  }
}
export class S3Store implements ObjectStore {
  readonly bucket: string;
  readonly client: S3Client;
  constructor(bucket: string, region: string) {
    this.bucket = bucket;
    this.client = new S3Client({ region, maxAttempts: 3 });
  }
  async get(key: string): Promise<StoredObject | null> {
    try {
      const result = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      if (!result.Body || !result.ETag)
        throw new Error("S3 object response is missing its body or ETag.");
      return {
        value: JSON.parse(await result.Body.transformToString()) as unknown,
        etag: result.ETag,
      };
    } catch (e) {
      if (
        errorProperty(e, "name") === "NoSuchKey" ||
        errorProperty(errorProperty(e, "$metadata"), "httpStatusCode") === 404
      )
        return null;
      throw e;
    }
  }
  async put(
    key: string,
    value: unknown,
    { ifNoneMatch, ifMatch }: PutOptions = {},
  ) {
    const result = await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: JSON.stringify(value),
        ContentType: "application/json",
        ...(ifNoneMatch ? { IfNoneMatch: "*" } : {}),
        ...(ifMatch ? { IfMatch: ifMatch } : {}),
      }),
    );
    if (!result.ETag)
      throw new Error("S3 upload response is missing its ETag.");
    return { etag: result.ETag };
  }
  async list(prefix: string): Promise<string[]> {
    const keys: string[] = [];
    let token: string | undefined;
    do {
      const result = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: prefix,
          ContinuationToken: token,
        }),
      );
      keys.push(
        ...(result.Contents || [])
          .map((object) => object.Key)
          .filter(
            (key): key is string =>
              typeof key === "string" && key.endsWith(".json"),
          ),
      );
      token = result.IsTruncated ? result.NextContinuationToken : undefined;
    } while (token);
    return keys.sort();
  }
}
