import type { z } from "zod";
import type { Feedback, ExplanationContext, Answer } from "@feedback/contracts";
export interface StoredObject<T = unknown> {
  value: T;
  etag: string;
}
export interface PutOptions {
  ifNoneMatch?: boolean;
  ifMatch?: string;
}
export interface ObjectStore {
  readonly bucket: string;
  get(key: string): Promise<StoredObject | null>;
  put(
    key: string,
    value: unknown,
    options?: PutOptions,
  ): Promise<{ etag: string }>;
  list(prefix: string): Promise<string[]>;
}
export interface FeedbackModel {
  readonly id: string;
  classify(records: Feedback[], signal?: AbortSignal): Promise<unknown>;
  explain(context: ExplanationContext, signal?: AbortSignal): Promise<Answer>;
}
export async function readObject<T>(
  store: ObjectStore,
  key: string,
  schema: z.ZodType<T>,
): Promise<StoredObject<T> | null> {
  const object = await store.get(key);
  return object
    ? { value: schema.parse(object.value), etag: object.etag }
    : null;
}
