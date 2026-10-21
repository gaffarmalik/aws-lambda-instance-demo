import type {
  Batch,
  Feedback,
  BatchExport,
  BufferStatus,
} from "@feedback/contracts";
import type { ObjectStore } from "./types.ts";
import { errorMessage } from "./errors.ts";
import { randomUUID } from "node:crypto";
import { batchKey, createFeedback } from "./domain.ts";
import { conflict } from "./store.ts";

interface CollectorOptions {
  threshold?: number;
  intervalMs?: number;
  retryMs?: number;
  maxBuffer?: number;
  now?: () => Date;
  automatic?: boolean;
}
export class Collector {
  readonly store: ObjectStore;
  readonly threshold: number;
  readonly intervalMs: number;
  readonly retryMs: number;
  readonly maxBuffer: number;
  now: () => Date;
  automatic: boolean;
  records: Feedback[] = [];
  pending: Batch | null = null;
  inFlight: Promise<BatchExport | null> | null = null;
  timer: ReturnType<typeof setTimeout> | undefined;
  lastExport: BatchExport | null = null;
  lastError: string | null = null;
  retryAt: number | null = null;

  constructor(
    store: ObjectStore,
    {
      threshold = 200,
      intervalMs = 30 * 60 * 1000,
      retryMs = 5000,
      maxBuffer = 10000,
      now = () => new Date(),
      automatic = true,
    }: CollectorOptions = {},
  ) {
    this.store = store;
    this.threshold = threshold;
    this.intervalMs = intervalMs;
    this.retryMs = retryMs;
    this.maxBuffer = maxBuffer;
    this.now = now;
    this.automatic = automatic;
  }

  submit(input: unknown) {
    if (this.records.length >= this.maxBuffer)
      throw Object.assign(
        new Error(
          "Memory buffer is full. Restore uploads before collecting more feedback.",
        ),
        { status: 503 },
      );
    const record = createFeedback(input, this.now());
    this.records.push(record);
    if (
      this.automatic &&
      this.records.length >= this.threshold &&
      !this.lastError
    )
      queueMicrotask(() => this.flush().catch(() => {}));
    this.schedule();
    return record;
  }
  schedule() {
    clearTimeout(this.timer);
    if (!this.automatic || !this.records.length || this.inFlight) return;
    const due = this.lastError
      ? Math.max(
          0,
          (this.retryAt ?? this.now().getTime()) - this.now().getTime(),
        )
      : Math.max(
          0,
          new Date(this.records[0].submittedAt).getTime() +
            this.intervalMs -
            this.now().getTime(),
        );
    this.timer = setTimeout(() => this.flush().catch(() => {}), due);
    this.timer.unref();
  }
  flush(): Promise<BatchExport | null> {
    if (this.inFlight) return this.inFlight;
    if (!this.records.length) return Promise.resolve(null);
    clearTimeout(this.timer);
    this.inFlight = this.exportBatch().finally(() => {
      this.inFlight = null;
      this.schedule();
      if (
        this.automatic &&
        !this.lastError &&
        this.records.length >= this.threshold
      )
        queueMicrotask(() => this.flush().catch(() => {}));
    });
    return this.inFlight;
  }
  async exportBatch() {
    if (!this.pending)
      this.pending = {
        schemaVersion: 1,
        batchId: randomUUID(),
        createdAt: this.now().toISOString(),
        records: this.records.slice(0, this.threshold),
      };
    const batch = this.pending,
      key = batchKey(batch);
    try {
      try {
        await this.store.put(key, batch, { ifNoneMatch: true });
      } catch (e) {
        if (!conflict(e)) throw e;
        const existing = await this.store.get(key);
        if (
          !existing ||
          JSON.stringify(existing.value) !== JSON.stringify(batch)
        )
          throw new Error(
            "Batch key collision: retained records for inspection.",
          );
      }
      // Remove only the successfully uploaded snapshot. New submissions remain buffered.
      const exported = new Set(batch.records.map((r) => r.id));
      this.records = this.records.filter((r) => !exported.has(r.id));
      this.lastExport = {
        batchId: batch.batchId,
        key,
        count: batch.records.length,
        exportedAt: this.now().toISOString(),
      };
      this.pending = null;
      this.lastError = null;
      this.retryAt = null;
      return this.lastExport;
    } catch (e) {
      this.lastError = errorMessage(e);
      this.retryAt = this.now().getTime() + this.retryMs;
      throw e;
    }
  }
  status(): BufferStatus {
    return {
      count: this.records.length,
      threshold: this.threshold,
      intervalMinutes: this.intervalMs / 60000,
      exporting: !!this.inFlight,
      retryBatchId: this.pending?.batchId || null,
      lastExport: this.lastExport,
      lastError: this.lastError,
      nextExportAt: this.records.length
        ? new Date(
            this.retryAt ??
              new Date(this.records[0].submittedAt).getTime() + this.intervalMs,
          ).toISOString()
        : null,
    };
  }
  close() {
    this.automatic = false;
    clearTimeout(this.timer);
  }
}
