import type { TestContext } from "node:test";
import type { FeedbackInput, Filters, Batch } from "@feedback/contracts";
import {
  batchSchema,
  statusSchema,
  processedSchema,
  reportSchema,
} from "@feedback/contracts";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { LocalStore, S3Store } from "../src/store.ts";
import { Collector } from "../src/collector.ts";
import { createFeedback, parseFilters, sampleInputs } from "../src/domain.ts";
import {
  LocalModel,
  validateClassifications,
  validateAnswer,
} from "../src/model.ts";
import { makeHandler, processBatch, updateStatus } from "../src/worker.ts";
import { dashboard, answerQuestion } from "../src/dashboard.ts";
import { createApp } from "../src/app.ts";

const input: FeedbackInput = {
  branchId: "ikeja",
  rating: 5,
  item: "Trainers",
  comment: "Excellent quality and friendly staff.",
};
const now = () => new Date("2026-10-21T13:00:00.000Z");
const filters: Filters = {
  timezone: "UTC",
  from: "2026-10-19",
  to: "2026-10-25",
  branchId: null,
};
function fixture(
  t: TestContext,
  options: ConstructorParameters<typeof Collector>[1] = {},
) {
  const dir = mkdtempSync(join(tmpdir(), "branchlight-test-"));
  const store = new LocalStore(dir),
    model = new LocalModel(),
    collector = new Collector(store, { now, automatic: false, ...options });
  t.after(() => {
    collector.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return { store, model, collector };
}
async function exported(
  f: ReturnType<typeof fixture>,
  inputs: FeedbackInput[] = [input],
) {
  inputs.forEach((value) => f.collector.submit(value));
  const batch = await f.collector.flush();
  assert.ok(batch);
  return batch;
}
async function until(predicate: () => boolean | Promise<boolean>) {
  for (let i = 0; i < 100; i++) {
    if (await predicate()) return;
    await delay(5);
  }
  throw new Error("Condition did not become true.");
}

test("validates input, assigns unique IDs, and derives authoritative branch metadata", () => {
  const first = createFeedback(input, now()),
    second = createFeedback(input, now());
  assert.notEqual(first.id, second.id);
  assert.equal(first.region, "South West");
  assert.equal(first.country, "Nigeria");
  for (const invalid of [
    { ...input, rating: 6 },
    { ...input, rating: "5" },
    { ...input, comment: "  " },
    { ...input, branchId: "unknown" },
    { ...input, region: "Injected" },
  ])
    assert.throws(() => createFeedback(invalid));
});
test("failed upload retains the exact snapshot and reuses batch ID and object key", async (t) => {
  const f = fixture(t);
  f.collector.submit(input);
  const original = f.store.put.bind(f.store),
    attempts: { key: string; value: Batch }[] = [];
  f.store.put = async (key, value, options) => {
    attempts.push({ key, value: batchSchema.parse(value) });
    if (attempts.length === 1) throw new Error("S3 unavailable");
    return original(key, value, options);
  };
  await assert.rejects(f.collector.flush(), /unavailable/);
  assert.equal(f.collector.records.length, 1);
  assert.equal(f.collector.status().retryBatchId, attempts[0].value.batchId);
  f.collector.submit({ ...input, rating: 1 });
  await f.collector.flush();
  assert.equal(attempts[0].key, attempts[1].key);
  assert.deepEqual(attempts[0].value, attempts[1].value);
  assert.equal(f.collector.records.length, 1);
  assert.equal(f.collector.records[0].rating, 1);
});
test("ambiguous successful upload retries safely without duplicating the source", async (t) => {
  const f = fixture(t);
  const put = f.store.put.bind(f.store);
  let first = true;
  f.store.put = async (...args) => {
    const value = await put(...args);
    if (first) {
      first = false;
      throw new Error("Connection closed after upload");
    }
    return value;
  };
  f.collector.submit(input);
  await assert.rejects(f.collector.flush());
  await f.collector.flush();
  assert.equal((await f.store.list("batches/")).length, 1);
  assert.equal(f.collector.records.length, 0);
});
test("overlapping flushes share one upload and preserve arrivals during upload", async (t) => {
  const f = fixture(t);
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const put = f.store.put.bind(f.store);
  let calls = 0;
  f.store.put = async (...args) => {
    calls++;
    await gate;
    return put(...args);
  };
  f.collector.submit(input);
  const one = f.collector.flush(),
    two = f.collector.flush();
  assert.equal(one, two);
  f.collector.submit(input);
  release();
  await one;
  assert.equal(calls, 1);
  assert.equal(f.collector.records.length, 1);
});
test("200 responses trigger one export without calling the model", async (t) => {
  const f = fixture(t, { automatic: true });
  sampleInputs(200).forEach((value) => f.collector.submit(value));
  await until(() => f.collector.records.length === 0);
  assert.equal((await f.store.list("batches/")).length, 1);
  const object = await f.store.get((await f.store.list("batches/"))[0]);
  assert.equal(batchSchema.parse(object?.value).records.length, 200);
});
test("oldest response deadline triggers a timed partial batch; new submissions do not reset it", async (t) => {
  let clock = Date.now();
  const f = fixture(t, {
    automatic: true,
    intervalMs: 30 * 60 * 1000,
    now: () => new Date(clock),
  });
  f.collector.submit(input);
  const firstDeadline = f.collector.status().nextExportAt;
  clock += 30 * 60 * 1000;
  f.collector.submit(input);
  assert.equal(f.collector.status().nextExportAt, firstDeadline);
  await until(() => f.collector.records.length === 0);
  assert.equal((await f.store.list("batches/")).length, 1);
});
test("failed exports retry automatically with the same ID", async (t) => {
  const f = fixture(t, { automatic: true, threshold: 1, retryMs: 10 });
  const put = f.store.put.bind(f.store);
  const keys: string[] = [];
  f.store.put = async (...args) => {
    keys.push(args[0]);
    if (keys.length === 1) throw new Error("temporary");
    return put(...args);
  };
  f.collector.submit(input);
  await until(() => keys.length > 1 && f.collector.records.length === 0);
  assert.equal(keys[0], keys[1]);
});
test("buffer limit rejects new feedback without removing existing records", (t) => {
  const f = fixture(t, { maxBuffer: 1 });
  f.collector.submit(input);
  assert.throws(() => f.collector.submit(input), /full/);
  assert.equal(f.collector.records.length, 1);
});
test("one source download, chunked model calls, and traceable transformed output", async (t) => {
  const f = fixture(t),
    batch = await exported(f, sampleInputs(24));
  const get = f.store.get.bind(f.store),
    classify = f.model.classify.bind(f.model);
  let sourceReads = 0;
  const sizes: number[] = [];
  f.store.get = async (key) => {
    if (key === batch.key) sourceReads++;
    return get(key);
  };
  f.model.classify = async (records) => {
    sizes.push(records.length);
    return (await classify(records)).reverse();
  };
  const { result } = await processBatch({
    ...f,
    key: batch.key,
    requestSize: 10,
  });
  assert.equal(sourceReads, 1);
  assert.deepEqual(sizes, [10, 10, 4]);
  assert.equal(result.metrics.total.responseCount, 24);
  assert.equal(result.records.length, 24);
  assert.equal(result.promptVersion, "feedback-classification-v1");
  assert.equal(result.source.key, batch.key);
  for (const record of result.records) {
    assert.ok(record.comment.includes(record.excerpt));
    assert.ok(record.evidenceRef.includes(record.id));
    assert.equal(record.batchId, batch.batchId);
  }
});
test("sequential duplicate events skip model calls and repair missing completion status", async (t) => {
  const f = fixture(t),
    batch = await exported(f);
  await processBatch({ ...f, key: batch.key });
  const previous = statusSchema.parse(
    (await f.store.get(`status/${batch.batchId}.json`))?.value,
  );
  await f.store.put(`status/${batch.batchId}.json`, {
    ...previous,
    state: "processing",
  });
  f.model.classify = () => {
    throw new Error("Should not classify twice");
  };
  assert.equal((await processBatch({ ...f, key: batch.key })).duplicate, true);
  assert.equal(
    statusSchema.parse(
      (await f.store.get(`status/${batch.batchId}.json`))?.value,
    ).state,
    "completed",
  );
  assert.equal(
    (await dashboard(f.store, f.collector, filters)).metrics.total
      .responseCount,
    1,
  );
});
test("concurrent duplicates commit one canonical result and cannot downgrade completion", async (t) => {
  const f = fixture(t),
    batch = await exported(f, sampleInputs(6));
  const results = await Promise.all([
    processBatch({ ...f, key: batch.key }),
    processBatch({ ...f, key: batch.key }),
  ]);
  assert.equal(results.filter((r) => r.duplicate).length, 1);
  assert.equal((await f.store.list("processed/")).length, 1);
  await updateStatus(f.store, batch.batchId, { state: "failed" });
  assert.equal(
    statusSchema.parse(
      (await f.store.get(`status/${batch.batchId}.json`))?.value,
    ).state,
    "completed",
  );
  assert.equal(
    (await dashboard(f.store, f.collector, filters)).metrics.total
      .responseCount,
    6,
  );
});
test("classification failure is visible, retryable, and never produces partial metrics", async (t) => {
  const f = fixture(t),
    batch = await exported(f);
  const model = {
    ...f.model,
    explain: f.model.explain.bind(f.model),
    classify: async () => {
      throw new Error("Bedrock throttled");
    },
  };
  await assert.rejects(
    processBatch({ ...f, model, key: batch.key }),
    /throttled/,
  );
  const data = await dashboard(f.store, f.collector, filters);
  assert.equal(data.coverage.failedBatches, 1);
  assert.equal(data.metrics.total.responseCount, 0);
  await processBatch({ ...f, key: batch.key });
  assert.equal(
    (await dashboard(f.store, f.collector, filters)).coverage.failedBatches,
    0,
  );
});
test("model IDs, exact excerpts, and topic uniqueness are checked", async () => {
  const record = createFeedback(input, now()),
    model = new LocalModel(),
    valid = await model.classify([record]);
  assert.doesNotThrow(() => validateClassifications(valid, [record]));
  assert.throws(
    () =>
      validateClassifications([{ ...valid[0], id: randomUUID() }], [record]),
    /unknown/,
  );
  assert.throws(
    () =>
      validateClassifications(
        [{ ...valid[0], excerpt: "invented evidence" }],
        [record],
      ),
    /exact excerpt/,
  );
  assert.throws(
    () => validateClassifications([valid[0], valid[0]], [record]),
    /exactly once/,
  );
  assert.throws(
    () =>
      validateClassifications(
        [{ ...valid[0], topics: [valid[0].topics[0], valid[0].topics[0]] }],
        [record],
      ),
    /duplicate topics/,
  );
  assert.throws(
    () =>
      validateAnswer(
        { answer: "Unsupported citation", evidenceIds: [randomUUID()] },
        [record],
      ),
    /unknown feedback/,
  );
});
test("weighted regional metrics use rating totals and counts, never average batch averages", async (t) => {
  const f = fixture(t);
  for (const inputs of [
    [{ ...input, rating: 1 }],
    Array.from({ length: 9 }, () => input),
  ]) {
    const batch = await exported(f, inputs);
    await processBatch({ ...f, key: batch.key });
  }
  const data = await dashboard(f.store, f.collector, filters);
  assert.equal(data.metrics.total.responseCount, 10);
  assert.equal(data.metrics.total.ratingTotal, 46);
  assert.equal(data.metrics.total.averageRating, 4.6);
  assert.equal(data.metrics.regions[0].averageRating, 4.6);
  assert.equal(data.metrics.branches[0].ratingTotal, 46);
});
test("branch and submission-date filtering works inside batches spanning midnight", async (t) => {
  const f = fixture(t);
  f.collector.now = () => new Date("2026-10-20T23:59:59Z");
  f.collector.submit(input);
  f.collector.now = () => new Date("2026-10-21T00:00:01Z");
  f.collector.submit({ ...input, branchId: "enugu", rating: 1 });
  const batch = await f.collector.flush();
  assert.ok(batch);
  await processBatch({ ...f, key: batch.key });
  const data = await dashboard(f.store, f.collector, {
    timezone: "UTC",
    from: "2026-10-21",
    to: "2026-10-21",
    branchId: "enugu",
  });
  assert.equal(data.metrics.total.responseCount, 1);
  assert.equal(data.metrics.total.ratingTotal, 1);
  assert.equal(data.metrics.regions[0].name, "South East");
  assert.equal(
    (
      await dashboard(f.store, f.collector, {
        timezone: "UTC",
        from: "2026-10-21",
        to: "2026-10-21",
        branchId: "ikeja",
      })
    ).metrics.total.responseCount,
    0,
  );
});
test("coverage reports older pending work and buffered records despite newer completed data", async (t) => {
  const f = fixture(t);
  const first = await exported(f);
  f.collector.now = () => new Date("2026-10-21T14:00:00Z");
  const second = await exported(f);
  await processBatch({ ...f, key: second.key });
  f.collector.submit(input);
  const data = await dashboard(f.store, f.collector, filters);
  assert.equal(data.coverage.pendingBatches, 1);
  assert.equal(data.coverage.bufferedCount, 1);
  assert.equal(data.coverage.incomplete, true);
  assert.equal(data.coverage.dataProcessedThrough, "2026-10-21T14:00:00.000Z");
  assert.equal(
    data.batches.find((b) => b.batchId === first.batchId)?.state,
    "pending",
  );
});
test("reports persist calculated comparisons and resolvable supporting evidence", async (t) => {
  const f = fixture(t),
    batch = await exported(f, sampleInputs(24));
  await processBatch({ ...f, key: batch.key });
  const report = await answerQuestion({
    ...f,
    filters,
    question: "Which region had the worst reviews this week?",
  });
  assert.equal(report.comparison[0].name, "South East");
  assert.ok(report.evidence.length > 0);
  assert.equal(
    reportSchema
      .omit({ key: true })
      .parse((await f.store.get(report.key))?.value).reportId,
    report.reportId,
  );
  for (const evidence of report.evidence) {
    const result = await f.store.get(`processed/${evidence.batchId}.json`);
    assert.ok(
      processedSchema
        .parse(result?.value)
        .records.some((r) => r.id === evidence.id),
    );
  }
  const empty = await answerQuestion({
    ...f,
    filters: {
      from: "2025-01-01",
      to: "2025-01-02",
      branchId: null,
      timezone: "UTC",
    },
    question: "What happened?",
  });
  assert.equal(empty.evidence.length, 0);
  assert.match(empty.answer, /No processed feedback/);
});
test("S3 handler filters events, validates bucket, decodes keys, and supports duplicate delivery", async (t) => {
  const f = fixture(t),
    batch = await exported(f);
  const handler = makeHandler(f);
  assert.deepEqual(await handler({ Event: "s3:TestEvent" }), {
    testEvent: true,
  });
  const event = {
    Records: [
      {
        eventVersion: "2.1",
        awsRegion: "us-east-1",
        eventTime: now().toISOString(),
        userIdentity: { principalId: "test" },
        requestParameters: { sourceIPAddress: "127.0.0.1" },
        responseElements: { "x-amz-request-id": "test", "x-amz-id-2": "test" },
        eventSource: "aws:s3",
        eventName: "ObjectCreated:Put",
        s3: {
          s3SchemaVersion: "1.0",
          configurationId: "test",
          bucket: {
            name: f.store.bucket,
            ownerIdentity: { principalId: "test" },
            arn: "arn:aws:s3:::test",
          },
          object: {
            key: encodeURIComponent(batch.key),
            size: 100,
            eTag: "test",
            sequencer: "1",
          },
        },
      },
    ],
  };
  assert.deepEqual(await handler(event), { processed: 1, duplicates: 0 });
  assert.deepEqual(await handler(event), { processed: 1, duplicates: 1 });
  event.Records[0].s3.object.key = "processed/anything.json";
  assert.equal((await handler(event)).processed, 0);
  event.Records[0].s3.bucket.name = "foreign";
  await assert.rejects(handler(event), /Unexpected source bucket/);
});
test("abort before classification records failure without committing a result", async (t) => {
  const f = fixture(t),
    batch = await exported(f);
  const controller = new AbortController();
  controller.abort(new Error("Deadline exceeded"));
  await assert.rejects(
    processBatch({ ...f, key: batch.key, signal: controller.signal }),
    /Deadline/,
  );
  assert.equal((await f.store.list("processed/")).length, 0);
});
test("S3 adapter paginates listings and uses conditional write headers", async () => {
  const store = new S3Store("test", "us-east-1");
  const calls: Record<string, unknown>[] = [];
  store.client.send = async (command) => {
    calls.push({ ...command.input });
    return calls.length === 1
      ? {
          Contents: [{ Key: "processed/a.json" }],
          IsTruncated: true,
          NextContinuationToken: "next",
        }
      : calls.length === 2
        ? { Contents: [{ Key: "processed/b.json" }] }
        : { ETag: "etag" };
  };
  assert.deepEqual(await store.list("processed/"), [
    "processed/a.json",
    "processed/b.json",
  ]);
  assert.equal(calls[1].ContinuationToken, "next");
  await store.put("processed/c.json", {}, { ifNoneMatch: true });
  assert.equal(calls[2].IfNoneMatch, "*");
  await store.put("status/a.json", {}, { ifMatch: "previous" });
  assert.equal(calls[3].IfMatch, "previous");
});
test("UTC week/date parsing rejects impossible dates and inverted ranges", () => {
  assert.deepEqual(parseFilters({}, now()), {
    from: "2026-10-19",
    to: "2026-10-21",
    branchId: null,
    timezone: "UTC",
  });
  assert.throws(() => parseFilters({ from: "2026-02-30" }));
  assert.throws(() => parseFilters({ from: "2026-11-01", to: "2026-10-01" }));
});
test("HTTP submission, sample generation, flush, dashboard, questions, and evidence work end to end", async (t) => {
  const f = fixture(t);
  const app = createApp({ ...f, config: { mode: "local" } });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  t.after(() => server.close());
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}/api`;
  const post = (path: string, body: unknown) =>
    fetch(base + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  assert.equal((await post("/feedback", { ...input, rating: 0 })).status, 400);
  assert.equal((await post("/feedback", input)).status, 201);
  assert.equal((await post("/samples", { count: 24 })).status, 201);
  const batch = (await (await post("/batches/flush", {})).json()).export;
  await processBatch({ ...f, key: batch.key });
  const data = await (
    await fetch(base + "/dashboard?from=2026-10-19&to=2026-10-25")
  ).json();
  assert.equal(data.metrics.total.responseCount, 25);
  const answer = await (
    await post("/questions", {
      question: "Which region is worst?",
      filters: { from: "2026-10-19", to: "2026-10-25" },
    })
  ).json();
  assert.ok(answer.evidence.length > 0);
  const response = await fetch(
    `http://127.0.0.1:${address.port}${answer.evidence[0].evidenceRef}`,
  );
  assert.equal(response.status, 200);
  assert.equal((await response.json()).record.id, answer.evidence[0].id);
  assert.equal(
    (
      await fetch(base + "/buffer", {
        headers: { Origin: "https://example.com" },
      })
    ).status,
    403,
  );
  assert.equal(
    (await fetch(base + "/object?key=reports/../../.env")).status,
    400,
  );
});

test("new submissions cannot postpone an already scheduled upload retry", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let clock = Date.now();
  const f = fixture(t, {
    automatic: true,
    retryMs: 50,
    now: () => new Date(clock),
  });
  const put = f.store.put.bind(f.store);
  let attempts = 0;
  f.store.put = async (...args) => {
    attempts++;
    if (attempts === 1) throw new Error("Temporary outage");
    return put(...args);
  };
  f.collector.submit(input);
  await assert.rejects(f.collector.flush(), /outage/);
  clock += 49;
  t.mock.timers.tick(49);
  f.collector.submit(input);
  clock += 1;
  t.mock.timers.tick(1);
  await f.collector.inFlight;
  assert.equal(attempts, 2, "retry must occur at the original deadline");
  assert.equal(f.collector.records.length, 1);
});

test("local simulation does not mistake unhelpful for helpful", async () => {
  const model = new LocalModel();
  const [result] = await model.classify([
    createFeedback({ ...input, comment: "The staff were unhelpful." }, now()),
  ]);
  assert.equal(result.sentiment, "negative");
});

test("malformed persisted results and mismatched source references are rejected", async (t) => {
  const f = fixture(t),
    batch = await exported(f);
  const { result } = await processBatch({ ...f, key: batch.key });
  await f.store.put(`processed/${batch.batchId}.json`, {
    ...result,
    source: { ...result.source, bucket: "wrong-bucket" },
  });
  await assert.rejects(
    dashboard(f.store, f.collector, filters),
    /does not match/,
  );
  await f.store.put(`processed/${batch.batchId}.json`, {
    ...result,
    records: [{ ...result.records[0], sentiment: "invented" }],
  });
  await assert.rejects(
    dashboard(f.store, f.collector, filters),
    /Invalid option/,
  );
});

test("invalid model chunk size fails immediately instead of looping forever", async (t) => {
  const f = fixture(t),
    batch = await exported(f);
  await assert.rejects(
    processBatch({ ...f, key: batch.key, requestSize: 0 }),
    /request size/,
  );
});
