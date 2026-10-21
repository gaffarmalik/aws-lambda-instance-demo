import { z } from "zod";
import {
  configSchema,
  bufferSchema,
  dashboardSchema,
  submissionSchema,
  samplesSchema,
  flushSchema,
  evidenceSchema,
  reportSchema,
} from "@feedback/contracts";
import type { FeedbackInput, FilterInput } from "@feedback/contracts";

export const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
async function request<T>(
  path: string,
  schema: z.ZodType<T>,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(`/api${path}`, {
    signal,
    ...(body === undefined
      ? {}
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
  });
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    throw new Error(
      `The API returned a non-JSON response (${response.status}). Check that the Express server is running.`,
    );
  }
  if (!response.ok) {
    const error = z
      .object({ error: z.string(), details: z.array(z.string()).optional() })
      .safeParse(value);
    throw new Error(
      error.success
        ? [error.data.error, ...(error.data.details || [])].join(" ")
        : `API request failed (${response.status}).`,
    );
  }
  const result = schema.safeParse(value);
  if (!result.success)
    throw new Error(
      "The API returned data that does not match the expected contract. Refresh or check the server version.",
    );
  return result.data;
}
export const api = {
  config: () => request("/config", configSchema),
  buffer: () => request("/buffer", bufferSchema),
  dashboard: (query: string, signal?: AbortSignal) =>
    request(`/dashboard?${query}`, dashboardSchema, undefined, signal),
  submit: (input: FeedbackInput) =>
    request("/feedback", submissionSchema, input),
  samples: (count: number) => request("/samples", samplesSchema, { count }),
  flush: () => request("/batches/flush", flushSchema, {}),
  evidence: (batchId: string, feedbackId: string) =>
    request(`/evidence/${batchId}/${feedbackId}`, evidenceSchema),
  question: (question: string, filters: FilterInput, signal?: AbortSignal) =>
    request("/questions", reportSchema, { question, filters }, signal),
};
