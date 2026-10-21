import type { Context, S3Event } from "aws-lambda";
import { processedSchema, statusSchema } from "@feedback/contracts";
import type {
  ProcessedBatch,
  ClassifiedFeedback,
  Classification,
  BatchStatus,
} from "@feedback/contracts";
import { readObject } from "./types.ts";
import type { ObjectStore, FeedbackModel } from "./types.ts";
import { errorMessage } from "./errors.ts";
interface WorkerOptions {
  store: ObjectStore;
  model: FeedbackModel;
  requestSize?: number;
}
interface ProcessOptions extends WorkerOptions {
  key: string;
  signal?: AbortSignal;
}
import { batchSchema, batchIdFromKey } from "./domain.ts";
import { aggregate } from "./metrics.ts";
import { CLASSIFICATION_VERSION, validateClassifications } from "./model.ts";
import { conflict } from "./store.ts";

// Conditional status updates prevent a late failed invocation from downgrading completion.
export async function updateStatus(
  store: ObjectStore,
  batchId: string,
  fields: Partial<BatchStatus> & Pick<BatchStatus, "state">,
) {
  const key = `status/${batchId}.json`;
  for (let attempt = 0; attempt < 8; attempt++) {
    const current = await readObject(store, key, statusSchema);
    if (current?.value.state === "completed") return current.value;
    const value = {
      ...current?.value,
      batchId,
      ...fields,
      updatedAt: new Date().toISOString(),
    };
    try {
      await store.put(
        key,
        value,
        current ? { ifMatch: current.etag } : { ifNoneMatch: true },
      );
      return value;
    } catch (e) {
      if (!conflict(e)) throw e;
    }
  }
  throw new Error("Status update contention; retry the event.");
}
export async function processBatch({
  store,
  model,
  key,
  requestSize = 10,
  signal,
}: ProcessOptions) {
  if (!Number.isInteger(requestSize) || requestSize < 1 || requestSize > 20)
    throw new Error("Model request size must be an integer from 1 to 20.");
  const parsedBatchId = batchIdFromKey(key);
  if (!parsedBatchId) throw new Error("Invalid batch object key.");
  const batchId: string = parsedBatchId;
  const resultKey = `processed/${batchId}.json`;
  const source = { bucket: store.bucket, key };
  const started = Date.now();
  const checkDeadline = () => signal?.throwIfAborted();
  async function completed(result: ProcessedBatch) {
    await updateStatus(store, batchId, {
      state: "completed",
      stage: "transformation",
      source,
      resultKey,
      completedAt: result.processedAt,
      processingMs: result.processingMs,
      error: null,
    });
    return result;
  }
  // An already committed result is authoritative, even if its status write previously failed.
  const saved = await readObject(store, resultKey, processedSchema);
  if (saved) {
    if (
      saved.value.batchId !== batchId ||
      saved.value.source.key !== key ||
      saved.value.source.bucket !== store.bucket
    )
      throw new Error("Batch ID reused for a different source object.");
    await completed(saved.value);
    return { duplicate: true, result: saved.value };
  }
  try {
    checkDeadline();
    await updateStatus(store, batchId, {
      state: "processing",
      stage: "classification",
      source,
      startedAt: new Date(started).toISOString(),
      error: null,
    });
    const object = await store.get(key); // Exactly one original-batch download per processing attempt.
    if (!object) throw new Error("Source batch does not exist.");
    const batch = batchSchema.parse(object.value);
    if (
      batch.batchId !== batchId ||
      new Set(batch.records.map((r) => r.id)).size !== batch.records.length
    )
      throw new Error("Invalid batch identity or duplicate feedback IDs.");
    const classifications: Classification[] = [];
    for (let offset = 0; offset < batch.records.length; offset += requestSize) {
      checkDeadline();
      const group = batch.records.slice(offset, offset + requestSize);
      classifications.push(
        ...validateClassifications(await model.classify(group, signal), group),
      );
    }
    checkDeadline();
    await updateStatus(store, batchId, {
      state: "processing",
      stage: "aggregation",
      source,
    });
    const byId = new Map(classifications.map((r) => [r.id, r]));
    const records: ClassifiedFeedback[] = batch.records.map((record) => ({
      ...record,
      ...byId.get(record.id)!,
      batchId,
      source,
      evidenceRef: `/api/evidence/${batchId}/${record.id}`,
    }));
    const metrics = aggregate(records);
    await updateStatus(store, batchId, {
      state: "processing",
      stage: "transformation",
      source,
    });
    checkDeadline();
    const result: ProcessedBatch = {
      schemaVersion: 1,
      batchId,
      source,
      createdAt: batch.createdAt,
      processedAt: new Date().toISOString(),
      processingMs: Date.now() - started,
      modelId: model.id,
      promptVersion: CLASSIFICATION_VERSION,
      records,
      metrics,
    };
    try {
      await store.put(resultKey, result, { ifNoneMatch: true });
    } catch (e) {
      if (!conflict(e)) throw e;
      const winner = await readObject(store, resultKey, processedSchema);
      if (
        !winner ||
        winner.value.batchId !== batchId ||
        winner.value.source.key !== key ||
        winner.value.source.bucket !== store.bucket
      )
        throw new Error("Conflicting processed batch identity.");
      await completed(winner.value);
      return { duplicate: true, result: winner.value };
    }
    await completed(result);
    return { duplicate: false, result };
  } catch (error) {
    // An ambiguous successful write must never be reported as failed.
    const committed = await readObject(store, resultKey, processedSchema);
    if (
      committed?.value.batchId === batchId &&
      committed.value.source.key === key &&
      committed.value.source.bucket === store.bucket
    ) {
      await completed(committed.value);
      return { duplicate: true, result: committed.value };
    }
    await updateStatus(store, batchId, {
      state: "failed",
      stage: "failed",
      source,
      error: errorMessage(error).slice(0, 500),
      failedAt: new Date().toISOString(),
    });
    throw error; // Propagate so Lambda retries the S3 event.
  }
}
export function makeHandler({ store, model, requestSize }: WorkerOptions) {
  return async (
    event: S3Event | { Event: "s3:TestEvent" },
    context?: Pick<Context, "getRemainingTimeInMillis">,
  ) => {
    if ("Event" in event) return { testEvent: true };
    const signal = AbortSignal.timeout(
      Math.max(1, (context?.getRemainingTimeInMillis?.() ?? 900000) - 10000),
    );
    const results: Awaited<ReturnType<typeof processBatch>>[] = [];
    for (const record of event.Records || []) {
      if (
        record.eventSource !== "aws:s3" ||
        !record.eventName?.startsWith("ObjectCreated:")
      )
        continue;
      if (record.s3.bucket.name !== store.bucket)
        throw new Error("Unexpected source bucket.");
      const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, " "));
      if (!key.startsWith("batches/")) continue;
      results.push(
        await processBatch({ store, model, key, requestSize, signal }),
      );
    }
    return {
      processed: results.length,
      duplicates: results.filter((r) => r.duplicate).length,
    };
  };
}
