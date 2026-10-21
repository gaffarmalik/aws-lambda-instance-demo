import type { ErrorRequestHandler } from "express";
import { processedSchema } from "@feedback/contracts";
import { readObject } from "./types.ts";
import type { ObjectStore, FeedbackModel } from "./types.ts";
import type { Collector } from "./collector.ts";
import { errorMessage, errorProperty } from "./errors.ts";
import express from "express";
import { z, ZodError } from "zod";
import { BRANCHES, parseFilters, sampleInputs } from "./domain.ts";
import { dashboard, answerQuestion } from "./dashboard.ts";

export function createApp({
  store,
  model,
  collector,
  config,
}: {
  store: ObjectStore;
  model: FeedbackModel;
  collector: Collector;
  config: { mode: "local" | "aws" };
}) {
  const app = express();
  app.disable("x-powered-by");
  // Intended for a local workshop. Same-origin API requests only, no public CORS.
  app.use("/api", (req, res, next) => {
    const origin = req.get("origin");
    if (origin) {
      let hostname;
      try {
        hostname = new URL(origin).hostname;
      } catch {
        return res.status(403).json({ error: "Invalid origin." });
      }
      if (!["localhost", "127.0.0.1", "[::1]"].includes(hostname))
        return res
          .status(403)
          .json({ error: "This demo accepts local browser requests only." });
    }
    res.set("Cache-Control", "no-store");
    next();
  });
  app.use(express.json({ limit: "32kb" }));
  app.get("/api/config", (_req, res) =>
    res.json({
      branches: BRANCHES,
      mode: config.mode,
      modelId: model.id,
      bucket: store.bucket,
      threshold: 200,
      intervalMinutes: 30,
    }),
  );
  app.get("/api/buffer", (_req, res) => res.json(collector.status()));
  app.post("/api/feedback", (req, res) => {
    const record = collector.submit(req.body);
    res.status(201).json({
      id: record.id,
      submittedAt: record.submittedAt,
      message: "Feedback received. It is buffered for the next batch.",
      buffer: collector.status(),
    });
  });
  app.post("/api/samples", (req, res) => {
    const { count } = z
      .object({ count: z.number().int().min(1).max(200).default(24) })
      .strict()
      .parse(req.body || {});
    if (collector.records.length + count > collector.maxBuffer)
      return res
        .status(503)
        .json({ error: "Not enough buffer capacity for this sample." });
    for (const input of sampleInputs(count)) collector.submit(input);
    res.status(201).json({ count, buffer: collector.status() });
  });
  app.post("/api/batches/flush", async (_req, res) =>
    res.json({ export: await collector.flush(), buffer: collector.status() }),
  );
  app.get("/api/dashboard", async (req, res) => {
    const data = await dashboard(store, collector, parseFilters(req.query));
    res.json({
      ...data,
      records: data.records.slice(0, 100),
      evidenceLimit: 100,
    });
  });
  app.get("/api/evidence/:batchId/:feedbackId", async (req, res) => {
    const batchId = z.uuid().parse(req.params.batchId),
      id = z.uuid().parse(req.params.feedbackId);
    const result = (
      await readObject(store, `processed/${batchId}.json`, processedSchema)
    )?.value;
    const record = result?.records.find((r) => r.id === id);
    if (!record || !result)
      return res.status(404).json({ error: "Feedback evidence not found." });
    res.json({
      record,
      modelId: result.modelId,
      promptVersion: result.promptVersion,
      processedAt: result.processedAt,
    });
  });
  app.get("/api/object", async (req, res) => {
    const key = z
      .string()
      .regex(/^(batches|status|processed|reports)\/[\w/.-]+\.json$/)
      .refine((s) => !s.includes(".."))
      .parse(req.query.key);
    const object = await store.get(key);
    if (!object) return res.status(404).json({ error: "Object not found." });
    res.json(object.value);
  });
  let questionsInFlight = 0;
  app.post("/api/questions", async (req, res) => {
    const { question, filters } = z
      .object({
        question: z.string().trim().min(5).max(1000),
        filters: z
          .object({
            from: z.string().optional(),
            to: z.string().optional(),
            branchId: z.string().optional(),
          })
          .optional(),
      })
      .strict()
      .parse(req.body);
    if (questionsInFlight >= 2)
      return res.status(429).json({
        error:
          "Two questions are already being answered. Please try again shortly.",
      });
    questionsInFlight++;
    try {
      res.json(
        await answerQuestion({
          store,
          model,
          collector,
          question,
          filters: parseFilters(filters),
        }),
      );
    } finally {
      questionsInFlight--;
    }
  });
  app.use("/api", (_req, res) =>
    res.status(404).json({ error: "API route not found." }),
  );
  const handleError: ErrorRequestHandler = (
    error: unknown,
    req,
    res,
    _next,
  ) => {
    if (error instanceof ZodError)
      return res.status(400).json({
        error: "Invalid input.",
        details: error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
      });
    const status =
      Number(errorProperty(error, "status")) ||
      (errorProperty(error, "type") === "entity.parse.failed" ? 400 : 500);
    console.error(`${req.method} ${req.path}: ${errorMessage(error)}`);
    res
      .status(status)
      .json({ error: errorMessage(error) || "Request failed." });
  };
  app.use(handleError);
  return app;
}
