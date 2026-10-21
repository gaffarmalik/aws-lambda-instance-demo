import type { Metric, ClassifiedFeedback, Metrics } from "@feedback/contracts";
type Counts = Omit<Metric, "averageRating" | "negativeShare">;
import { SENTIMENTS, TOPICS } from "./domain.ts";
export const RANKING_MEASURE =
  "Lowest average star rating (rating total ÷ response count); ties use higher negative share, then region name.";
const empty = (id: string, name = id): Counts => ({
  id,
  name,
  responseCount: 0,
  ratingTotal: 0,
  sentiments: Object.fromEntries(
    SENTIMENTS.map((s) => [s, 0]),
  ) as Metric["sentiments"],
  topics: Object.fromEntries(
    TOPICS.map((t) => [
      t,
      {
        count: 0,
        sentiments: Object.fromEntries(
          SENTIMENTS.map((s) => [s, 0]),
        ) as Metric["sentiments"],
      },
    ]),
  ) as Metric["topics"],
});
function add(metric: Counts, record: ClassifiedFeedback) {
  metric.responseCount++;
  metric.ratingTotal += record.rating;
  metric.sentiments[record.sentiment]++;
  for (const topic of record.topics) {
    metric.topics[topic.name].count++;
    metric.topics[topic.name].sentiments[topic.sentiment]++;
  }
}
const finish = (metric: Counts): Metric => ({
  ...metric,
  averageRating: metric.responseCount
    ? metric.ratingTotal / metric.responseCount
    : null,
  negativeShare: metric.responseCount
    ? metric.sentiments.negative / metric.responseCount
    : 0,
});
export function aggregate(records: ClassifiedFeedback[]): Metrics {
  const total = empty("all", "All feedback");
  const branches = new Map<string, Counts>(),
    regions = new Map<string, Counts>(),
    days = new Map<string, Counts>();
  for (const record of records) {
    add(total, record);
    for (const [map, id, name] of [
      [branches, record.branchId, record.branch],
      [regions, record.region, record.region],
      [days, record.submittedAt.slice(0, 10), record.submittedAt.slice(0, 10)],
    ] as [Map<string, Counts>, string, string][]) {
      if (!map.has(id)) map.set(id, empty(id, name));
      add(map.get(id)!, record);
    }
  }
  return {
    total: finish(total),
    branches: [...branches.values()].map(finish),
    regions: [...regions.values()]
      .map(finish)
      .sort(
        (a, b) =>
          (a.averageRating ?? 0) - (b.averageRating ?? 0) ||
          b.negativeShare - a.negativeShare ||
          a.name.localeCompare(b.name),
      ),
    days: [...days.values()]
      .map(finish)
      .sort((a, b) => a.id.localeCompare(b.id)),
  };
}
