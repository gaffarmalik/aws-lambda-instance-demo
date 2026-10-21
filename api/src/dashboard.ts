import {
  batchSchema,
  processedSchema,
  statusSchema,
} from "@feedback/contracts";
import type {
  Filters,
  ClassifiedFeedback,
  BatchActivity,
  DashboardData,
  Report,
} from "@feedback/contracts";
import { readObject } from "./types.ts";
import type { ObjectStore, FeedbackModel } from "./types.ts";
import type { Collector } from "./collector.ts";
import { randomUUID } from "node:crypto";
import { aggregate, RANKING_MEASURE } from "./metrics.ts";
import { batchIdFromKey, matches } from "./domain.ts";
import { EXPLANATION_VERSION, validateAnswer } from "./model.ts";

export async function dashboard(
  store: ObjectStore,
  collector: Collector,
  filters: Filters,
): Promise<DashboardData> {
  const asOf = new Date().toISOString();
  const bufferSnapshot = collector.records.slice();
  // The small teaching dataset is scanned; production should maintain a query index.
  const sources = await store.list("batches/");
  const records: ClassifiedFeedback[] = [];
  const batches: BatchActivity[] = [];
  const ids = new Set<string>();
  for (const key of sources) {
    const batchId = batchIdFromKey(key);
    if (!batchId) continue;
    const result = (
      await readObject(store, `processed/${batchId}.json`, processedSchema)
    )?.value;
    if (
      result &&
      (result.batchId !== batchId ||
        result.source.key !== key ||
        result.source.bucket !== store.bucket)
    )
      throw new Error("Processed result does not match its source batch.");
    const status = (
      await readObject(store, `status/${batchId}.json`, statusSchema)
    )?.value;
    const batch = result || (await readObject(store, key, batchSchema))?.value;
    if (!batch) continue;
    const relevant = batch.records.filter((record) => matches(record, filters));
    if (!relevant.length) continue;
    // Canonical processed output is authoritative when the final status write was interrupted.
    batches.push({
      batchId,
      sourceKey: key,
      state: result
        ? "completed"
        : status?.state === "completed"
          ? "pending"
          : status?.state || "pending",
      stage: result ? "transformation" : status?.stage || "waiting",
      count: relevant.length,
      totalCount: batch.records.length,
      createdAt: batch.createdAt,
      processedAt: result?.processedAt || null,
      processingMs: result?.processingMs ?? null,
      error: result ? null : status?.error,
      updatedAt: status?.updatedAt || batch.createdAt,
    });
    if (result)
      for (const record of result.records.filter((record) =>
        matches(record, filters),
      )) {
        if (!ids.has(record.id)) {
          ids.add(record.id);
          records.push(record);
        }
      }
  }
  records.sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
  const pending = batches.filter(
    (b) => b.state === "pending" || b.state === "processing",
  );
  const failed = batches.filter((b) => b.state === "failed");
  const bufferedCount = bufferSnapshot.filter(
    (record) => matches(record, filters) && !ids.has(record.id),
  ).length;
  const coverage = {
    dataProcessedThrough: records[0]?.submittedAt || null,
    pendingBatches: pending.length,
    failedBatches: failed.length,
    bufferedCount,
    incomplete: !!(pending.length || failed.length || bufferedCount),
    asOf,
    note: "Latest processed submission timestamp, not a guarantee that every earlier response is processed. Dates use UTC; unexported feedback is temporary. Snapshot starts at asOf; later submissions appear on the next refresh.",
  };
  return {
    filters,
    measure: RANKING_MEASURE,
    metrics: aggregate(records),
    coverage,
    batches: batches.sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    records,
  };
}
export async function answerQuestion({
  store,
  model,
  collector,
  filters,
  question,
}: {
  store: ObjectStore;
  model: FeedbackModel;
  collector: Collector;
  filters: Filters;
  question: string;
}): Promise<Report> {
  const data = await dashboard(store, collector, filters);
  // Balanced evidence from each ranked region, prioritizing low-rated/negative reviews.
  const evidence = data.metrics.regions
    .flatMap((region) =>
      data.records
        .filter((r) => r.region === region.name)
        .sort((a, b) => a.rating - b.rating || a.id.localeCompare(b.id))
        .slice(0, 10),
    )
    .slice(0, 30);
  const context = {
    question,
    filters,
    measure: data.measure,
    metrics: data.metrics,
    coverage: data.coverage,
    evidence,
  };
  const explanation = data.records.length
    ? validateAnswer(await model.explain(context), evidence)
    : {
        answer:
          "No processed feedback is available in this selection. Flush a batch and wait for processing, or change the date and branch filters.",
        evidenceIds: [],
      };
  const reportId = randomUUID(),
    createdAt = new Date().toISOString();
  const report: Omit<Report, "key"> = {
    schemaVersion: 1,
    reportId,
    createdAt,
    question,
    filters,
    measure: data.measure,
    coverage: data.coverage,
    comparison: data.metrics.regions,
    ...explanation,
    evidence: evidence.filter((r) => explanation.evidenceIds.includes(r.id)),
    evidenceSelection:
      "Up to 10 lowest-rated comments per region, up to 30 total. Illustrative evidence, not a causal analysis.",
    sourceBatches: data.batches
      .filter((b) => b.state === "completed")
      .map((b) => ({ batchId: b.batchId, sourceKey: b.sourceKey })),
    modelId: model.id,
    promptVersion: EXPLANATION_VERSION,
  };
  const key = `reports/${createdAt.slice(0, 10)}/${reportId}.json`;
  await store.put(key, report, { ifNoneMatch: true });
  return { ...report, key };
}
