import { randomUUID } from "node:crypto";
import { z } from "zod";

import { BRANCHES, inputSchema } from "@feedback/contracts";
import type {
  Feedback,
  FeedbackInput,
  Batch,
  Filters,
} from "@feedback/contracts";
export {
  BRANCHES,
  SENTIMENTS,
  TOPICS,
  inputSchema,
  batchSchema,
} from "@feedback/contracts";
export function createFeedback(input: unknown, now = new Date()) {
  const data = inputSchema.parse(input);
  const branch = BRANCHES.find((b) => b.id === data.branchId)!;
  return {
    ...data,
    id: randomUUID(),
    branch: branch.name,
    country: branch.country,
    region: branch.region,
    submittedAt: now.toISOString(),
  };
}
export function batchKey(batch: Pick<Batch, "createdAt" | "batchId">) {
  return `batches/${batch.createdAt.slice(0, 10)}/${batch.createdAt.slice(11, 16).replace(":", "-")}/batch-${batch.batchId}.json`;
}
export function batchIdFromKey(key: string) {
  const match =
    /^batches\/\d{4}-\d{2}-\d{2}\/\d{2}-\d{2}\/batch-([\da-f-]{36})\.json$/.exec(
      key,
    );
  return match && z.uuid().safeParse(match[1]).success ? match[1] : null;
}
export function parseFilters(query: unknown = {}, now = new Date()): Filters {
  const date = z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine(
      (s) =>
        !Number.isNaN(Date.parse(s)) &&
        new Date(s).toISOString().slice(0, 10) === s,
    );
  const input = z
    .object({
      from: date.optional(),
      to: date.optional(),
      branchId: z.enum(BRANCHES.map((b) => b.id)).optional(),
    })
    .parse(query);
  const monday = new Date(now);
  monday.setUTCHours(0, 0, 0, 0);
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
  const from = input.from || monday.toISOString().slice(0, 10);
  const to = input.to || now.toISOString().slice(0, 10);
  if (from > to)
    throw Object.assign(
      new Error("Start date must be on or before end date."),
      { status: 400 },
    );
  return { from, to, branchId: input.branchId || null, timezone: "UTC" };
}
export function matches(record: Feedback, filters: Filters) {
  const date = record.submittedAt.slice(0, 10);
  return (
    date >= filters.from &&
    date <= filters.to &&
    (!filters.branchId || record.branchId === filters.branchId)
  );
}

const examples: [number, string, string][] = [
  [
    5,
    "The staff were friendly and helped me find exactly what I needed. Excellent service.",
    "Everyday trainers",
  ],
  [
    1,
    "The delivery was late and the packaging arrived damaged. Very disappointed.",
    "Wireless headphones",
  ],
  [
    3,
    "The quality is great, but the queue was slow and the staff were unhelpful.",
    "Cotton shirt",
  ],
  [
    4,
    "Good quality and a fair price. I will shop here again.",
    "Travel backpack",
  ],
  [
    2,
    "My size was out of stock, and the replacement feels cheap. Poor selection.",
    "Everyday trainers",
  ],
  [
    5,
    "Fast delivery, helpful staff, and excellent quality. Thank you!",
    "Coffee maker",
  ],
  [
    2,
    "Too expensive for the quality. The stitching broke after one day.",
    "Travel backpack",
  ],
  [
    3,
    "The item was available. The purchase was ordinary and met my expectations.",
    "Desk lamp",
  ],
];
export function sampleInputs(count = 24): FeedbackInput[] {
  return Array.from({ length: count }, (_, i) => {
    const branch = BRANCHES[i % BRANCHES.length];
    // A deterministic, varied sample with more delivery complaints in South East.
    const index =
      branch.region === "South East" && i % 3 !== 0
        ? i % 2
          ? 1
          : 4
        : Math.floor(i / 6 + i) % examples.length;
    const [rating, comment, item] = examples[index];
    return { branchId: branch.id, rating, comment, item };
  });
}
