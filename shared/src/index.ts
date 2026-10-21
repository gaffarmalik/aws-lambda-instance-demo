import { z } from "zod";
export const BRANCHES = [
  { id: "ikeja", name: "Ikeja", country: "Nigeria", region: "South West" },
  { id: "lekki", name: "Lekki", country: "Nigeria", region: "South West" },
  {
    id: "abuja",
    name: "Abuja Central",
    country: "Nigeria",
    region: "North Central",
  },
  { id: "ilorin", name: "Ilorin", country: "Nigeria", region: "North Central" },
  { id: "enugu", name: "Enugu", country: "Nigeria", region: "South East" },
  { id: "owerri", name: "Owerri", country: "Nigeria", region: "South East" },
] as const;
export const SENTIMENTS = ["positive", "negative", "mixed", "neutral"] as const;
export const TOPICS = [
  "service",
  "quality",
  "value",
  "availability",
  "delivery",
  "other",
] as const;
export const inputSchema = z
  .object({
    branchId: z.enum(BRANCHES.map((b) => b.id)),
    item: z.string().trim().min(1).max(120),
    rating: z.number().int().min(1).max(5),
    comment: z.string().trim().min(3).max(2000),
  })
  .strict();
export const recordSchema = inputSchema.extend({
  id: z.uuid(),
  branch: z.string(),
  country: z.string(),
  region: z.string(),
  submittedAt: z.iso.datetime(),
});
export const batchSchema = z.object({
  schemaVersion: z.literal(1),
  batchId: z.uuid(),
  createdAt: z.iso.datetime(),
  records: z.array(recordSchema).min(1).max(200),
});

export type BranchId = (typeof BRANCHES)[number]["id"];
export type FeedbackInput = z.infer<typeof inputSchema>;
export type Feedback = z.infer<typeof recordSchema>;
export type Batch = z.infer<typeof batchSchema>;
export type Sentiment = (typeof SENTIMENTS)[number];
export type Topic = (typeof TOPICS)[number];
export const sourceSchema = z.object({ bucket: z.string(), key: z.string() });
export const classificationSchema = z
  .object({
    id: z.uuid(),
    sentiment: z.enum(SENTIMENTS),
    excerpt: z.string().min(1).max(2000),
    topics: z
      .array(
        z
          .object({
            name: z.enum(TOPICS),
            sentiment: z.enum(SENTIMENTS),
            excerpt: z.string().min(1).max(2000),
          })
          .strict(),
      )
      .min(1)
      .max(TOPICS.length),
  })
  .strict();
export const classifiedFeedbackSchema = recordSchema.extend({
  ...classificationSchema.shape,
  batchId: z.uuid(),
  source: sourceSchema,
  evidenceRef: z.string(),
});
export type Classification = z.infer<typeof classificationSchema>;
export type ClassifiedFeedback = z.infer<typeof classifiedFeedbackSchema>;
const count = z.number().int().nonnegative();
const sentimentCountsSchema = z.object({
  positive: count,
  negative: count,
  mixed: count,
  neutral: count,
});
const topicMetricSchema = z.object({
  count,
  sentiments: sentimentCountsSchema,
});
export const metricSchema = z.object({
  id: z.string(),
  name: z.string(),
  responseCount: count,
  ratingTotal: count,
  sentiments: sentimentCountsSchema,
  topics: z.object({
    service: topicMetricSchema,
    quality: topicMetricSchema,
    value: topicMetricSchema,
    availability: topicMetricSchema,
    delivery: topicMetricSchema,
    other: topicMetricSchema,
  }),
  averageRating: z.number().min(1).max(5).nullable(),
  negativeShare: z.number().min(0).max(1),
});
export const metricsSchema = z.object({
  total: metricSchema,
  branches: z.array(metricSchema),
  regions: z.array(metricSchema),
  days: z.array(metricSchema),
});
export type Metric = z.infer<typeof metricSchema>;
export type Metrics = z.infer<typeof metricsSchema>;
export const processedSchema = z.object({
  schemaVersion: z.literal(1),
  batchId: z.uuid(),
  source: sourceSchema,
  createdAt: z.iso.datetime(),
  processedAt: z.iso.datetime(),
  processingMs: count,
  modelId: z.string(),
  promptVersion: z.string(),
  records: z.array(classifiedFeedbackSchema),
  metrics: metricsSchema,
});
export type ProcessedBatch = z.infer<typeof processedSchema>;
export const statusSchema = z.object({
  batchId: z.uuid(),
  state: z.enum(["processing", "completed", "failed"]),
  stage: z.enum(["classification", "aggregation", "transformation", "failed"]),
  source: sourceSchema,
  updatedAt: z.iso.datetime(),
  startedAt: z.iso.datetime().optional(),
  completedAt: z.iso.datetime().optional(),
  failedAt: z.iso.datetime().optional(),
  resultKey: z.string().optional(),
  processingMs: count.optional(),
  error: z.string().nullable().optional(),
});
export type BatchStatus = z.infer<typeof statusSchema>;
export const filtersSchema = z.object({
  from: z.string(),
  to: z.string(),
  branchId: z.enum(BRANCHES.map((b) => b.id)).nullable(),
  timezone: z.literal("UTC"),
});
export type Filters = z.infer<typeof filtersSchema>;
export interface FilterInput {
  from?: string;
  to?: string;
  branchId?: BranchId;
}
export const coverageSchema = z.object({
  dataProcessedThrough: z.iso.datetime().nullable(),
  pendingBatches: count,
  failedBatches: count,
  bufferedCount: count,
  incomplete: z.boolean(),
  asOf: z.iso.datetime(),
  note: z.string(),
});
export type Coverage = z.infer<typeof coverageSchema>;
export const batchActivitySchema = z.object({
  batchId: z.uuid(),
  sourceKey: z.string(),
  state: z.enum(["pending", "processing", "completed", "failed"]),
  stage: z.enum([
    "waiting",
    "classification",
    "aggregation",
    "transformation",
    "failed",
  ]),
  count,
  totalCount: count,
  createdAt: z.iso.datetime(),
  processedAt: z.iso.datetime().nullable(),
  processingMs: count.nullable(),
  error: z.string().nullable().optional(),
  updatedAt: z.iso.datetime(),
});
export type BatchActivity = z.infer<typeof batchActivitySchema>;
export const dashboardSchema = z.object({
  filters: filtersSchema,
  measure: z.string(),
  metrics: metricsSchema,
  coverage: coverageSchema,
  batches: z.array(batchActivitySchema),
  records: z.array(classifiedFeedbackSchema),
  evidenceLimit: count.optional(),
});
export type DashboardData = z.infer<typeof dashboardSchema>;
export const answerSchema = z
  .object({
    answer: z.string().min(1).max(12000),
    evidenceIds: z.array(z.uuid()).max(30),
  })
  .strict();
export type Answer = z.infer<typeof answerSchema>;
export interface ExplanationContext {
  question: string;
  filters: Filters;
  measure: string;
  metrics: Metrics;
  coverage: Coverage;
  evidence: ClassifiedFeedback[];
}
export const reportSchema = z.object({
  schemaVersion: z.literal(1),
  reportId: z.uuid(),
  createdAt: z.iso.datetime(),
  question: z.string(),
  filters: filtersSchema,
  measure: z.string(),
  coverage: coverageSchema,
  comparison: z.array(metricSchema),
  ...answerSchema.shape,
  evidence: z.array(classifiedFeedbackSchema),
  evidenceSelection: z.string(),
  sourceBatches: z.array(
    z.object({ batchId: z.uuid(), sourceKey: z.string() }),
  ),
  modelId: z.string(),
  promptVersion: z.string(),
  key: z.string(),
});
export type Report = z.infer<typeof reportSchema>;
export const exportSchema = z.object({
  batchId: z.uuid(),
  key: z.string(),
  count,
  exportedAt: z.iso.datetime(),
});
export type BatchExport = z.infer<typeof exportSchema>;
export const bufferSchema = z.object({
  count,
  threshold: count,
  intervalMinutes: z.number(),
  exporting: z.boolean(),
  retryBatchId: z.uuid().nullable(),
  lastExport: exportSchema.nullable(),
  lastError: z.string().nullable(),
  nextExportAt: z.iso.datetime().nullable(),
});
export type BufferStatus = z.infer<typeof bufferSchema>;
export const configSchema = z.object({
  branches: z.array(
    z.object({
      id: z.enum(BRANCHES.map((b) => b.id)),
      name: z.string(),
      country: z.string(),
      region: z.string(),
    }),
  ),
  mode: z.enum(["local", "aws"]),
  modelId: z.string(),
  bucket: z.string(),
  threshold: count,
  intervalMinutes: z.number(),
});
export type AppConfig = z.infer<typeof configSchema>;
export const evidenceSchema = z.object({
  record: classifiedFeedbackSchema,
  modelId: z.string(),
  promptVersion: z.string(),
  processedAt: z.iso.datetime(),
});
export type EvidenceResponse = z.infer<typeof evidenceSchema>;
export const submissionSchema = z.object({
  id: z.uuid(),
  submittedAt: z.iso.datetime(),
  message: z.string(),
  buffer: bufferSchema,
});
export const samplesSchema = z.object({ count, buffer: bufferSchema });
export const flushSchema = z.object({
  export: exportSchema.nullable(),
  buffer: bufferSchema,
});
