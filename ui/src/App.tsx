import { FeedbackForm } from "./components/FeedbackForm.tsx";
import { EvidenceDialog } from "./components/EvidenceDialog.tsx";
import {
  Pill,
  Empty,
  Stat,
  Evidence,
  Comparison,
} from "./components/FeedbackDisplay.tsx";
import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import type {
  AppConfig,
  Report,
  EvidenceResponse,
  FeedbackInput,
  ClassifiedFeedback,
  BranchId,
  Sentiment,
} from "@feedback/contracts";
import { api, errorMessage } from "./api.ts";
import { dateLabel, number, average, objectLink } from "./format.ts";
import { useDashboard } from "./hooks/useDashboard.ts";
import {
  Activity,
  ArrowDownToLine,
  ArrowRight,
  BarChart3,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Database,
  FileJson,
  Layers3,
  Leaf,
  LoaderCircle,
  MessageSquare,
  Plus,
  RefreshCw,
  Sparkles,
  Star,
  X,
} from "lucide-react";
import "./styles.css";

type UISelection = { from: string; to: string; branchId: BranchId | "" };
function currentWeek(): UISelection {
  const now = new Date(),
    monday = new Date(now);
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
  return {
    from: monday.toISOString().slice(0, 10),
    to: now.toISOString().slice(0, 10),
    branchId: "",
  };
}
export default function App() {
  const [view, setView] = useState("dashboard"),
    [config, setConfig] = useState<AppConfig | null>(null);
  const [filters, setFilters] = useState(currentWeek),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState("");
  const [question, setQuestion] = useState(
      "Which region had the worst reviews this week?",
    ),
    [report, setReport] = useState<Report | null>(null),
    [asking, setAsking] = useState(false),
    [evidence, setEvidence] = useState<EvidenceResponse | null>(null);
  const [sampleCount, setSampleCount] = useState(24);
  const [form, setForm] = useState<FeedbackInput>({
    branchId: "ikeja",
    item: "",
    rating: 0,
    comment: "",
  });
  const questionController = useRef<AbortController | null>(null);
  const query = new URLSearchParams(
    Object.entries(filters).filter(([, v]) => v),
  ).toString();
  useEffect(() => {
    api
      .config()
      .then(setConfig)
      .catch((e) => setError(errorMessage(e)));
  }, []);
  const { buffer, data, pollError, refresh } = useDashboard(query);
  useEffect(() => {
    setReport(null);
    setAsking(false);
    questionController.current?.abort();
    return () => questionController.current?.abort();
  }, [query]);
  async function action(name: string, work: () => Promise<void>) {
    setBusy(name);
    setError("");
    setNotice("");
    try {
      await work();
      await refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy("");
    }
  }
  async function showEvidence(record: ClassifiedFeedback) {
    try {
      setEvidence(await api.evidence(record.batchId, record.id));
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  async function ask(event: FormEvent) {
    event.preventDefault();
    questionController.current?.abort();
    const controller = new AbortController();
    questionController.current = controller;
    setAsking(true);
    setError("");
    setReport(null);
    try {
      const answer = await api.question(
        question,
        {
          from: filters.from,
          to: filters.to,
          ...(filters.branchId ? { branchId: filters.branchId } : {}),
        },
        controller.signal,
      );
      if (!controller.signal.aborted) setReport(answer);
    } catch (error) {
      if (!controller.signal.aborted) setError(errorMessage(error));
    } finally {
      if (questionController.current === controller) setAsking(false);
    }
  }
  function submitFeedback(event: FormEvent) {
    event.preventDefault();
    void action("submit", async () => {
      if (!form.rating) throw new Error("Please choose a rating.");
      const result = await api.submit(form);
      setNotice(
        `Thank you! Feedback ${result.id.slice(0, 8)} was received and is waiting for batch export.`,
      );
      setForm((previous) => ({
        ...previous,
        item: "",
        comment: "",
        rating: 0,
      }));
    });
  }
  const total = data?.metrics.total;
  const sentiments = total?.sentiments || {
    positive: 0,
    negative: 0,
    mixed: 0,
    neutral: 0,
  };
  const colors = {
    positive: "#2e8166",
    negative: "#ca6c56",
    mixed: "#d4aa55",
    neutral: "#a1aba5",
  };
  let position = 0;
  const slices = Object.entries(sentiments).map(([name, count]) => {
    const start = position;
    position += total?.responseCount ? (count / total.responseCount) * 100 : 0;
    return `${colors[name as Sentiment]} ${start}% ${position}%`;
  });
  const changeFilter = <K extends keyof UISelection>(
    key: K,
    value: UISelection[K],
  ) => setFilters((previous) => ({ ...previous, [key]: value }));
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setView("dashboard");
          }}
        >
          <span className="brand-mark">
            <Leaf size={24} />
          </span>
          <span>
            branchlight<span className="brand-sub">FEEDBACK INTELLIGENCE</span>
          </span>
        </a>
        <div className="workspace">
          <span className="workspace-icon">B</span>
          <div>
            Branchlight Retail<small>Demo workspace</small>
          </div>
          <ChevronRight size={15} />
        </div>
        <p className="nav-label">WORKSPACE</p>
        <nav aria-label="Main navigation">
          <button
            className={view === "dashboard" ? "active" : ""}
            onClick={() => setView("dashboard")}
          >
            <BarChart3 size={18} />
            Overview
            <span className="nav-dot" />
          </button>
          <button
            className={view === "feedback" ? "active" : ""}
            onClick={() => setView("feedback")}
          >
            <MessageSquare size={18} />
            Collect feedback
          </button>
        </nav>
        <div className="sidebar-bottom">
          <div className="demo-note">
            <Layers3 size={19} />
            <strong>A small batch. A bigger picture.</strong>
            <p>
              Collect feedback, process a batch, then explore the story behind
              the numbers.
            </p>
            <span>LEARNING LAB · 01</span>
          </div>
          <div className="profile">
            <span className="avatar">S</span>
            <div>
              Shalom<small>Workspace admin</small>
            </div>
            <span className="online-dot" />
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            Workspace <ChevronRight size={14} />{" "}
            <strong>
              {view === "dashboard" ? "Overview" : "Collect feedback"}
            </strong>
          </div>
          <div className="topbar-right">
            <span className="environment">
              <span className="online-dot" />
              {config?.mode === "aws" ? "AWS mode" : "Local simulation"}
            </span>
            <span className="top-avatar">S</span>
          </div>
        </header>
        <main>
          <div className="page-heading">
            <div>
              <p className="eyebrow">LISTEN CLOSELY. ACT CONFIDENTLY.</p>
              <h1>
                {view === "dashboard"
                  ? "Every branch has a story."
                  : "Good listening starts here."}
              </h1>
              <p className="subtitle">
                {view === "dashboard"
                  ? "Turn everyday customer feedback into a clearer view of your business."
                  : "Tell us about your purchase. Your experience helps every branch get better."}
              </p>
            </div>
            <div className="sample-controls">
              <select
                aria-label="Sample feedback count"
                value={sampleCount}
                onChange={(e) => setSampleCount(Number(e.target.value))}
              >
                <option value={24}>24 responses</option>
                <option value={200}>200 · full batch</option>
              </select>
              <button
                className="button secondary"
                disabled={!!busy}
                onClick={() =>
                  action("sample", async () => {
                    await api.samples(sampleCount);
                    setNotice(
                      `${sampleCount} sample responses added across all six branches.`,
                    );
                  })
                }
              >
                <Sparkles size={16} />
                {busy === "sample" ? "Generating…" : "Generate sample feedback"}
              </button>
            </div>
          </div>
          {error && (
            <div className="alert error" role="alert">
              {error}
              <button aria-label="Dismiss error" onClick={() => setError("")}>
                <X size={16} />
              </button>
            </div>
          )}
          {pollError && (
            <div className="alert error" role="alert">
              {pollError}
            </div>
          )}
          {notice && (
            <div className="alert success" role="status">
              <CheckCircle2 size={17} />
              {notice}
            </div>
          )}
          <section className="buffer-strip" aria-label="Collection buffer">
            <div className="buffer-icon">
              <Database size={22} />
            </div>
            <div className="buffer-copy">
              <strong>
                {buffer?.count ?? "—"} <span>responses in memory</span>
              </strong>
              <p>
                Exports at 200 responses or 30 minutes.{" "}
                {buffer?.nextExportAt
                  ? `Next due ${dateLabel(buffer.nextExportAt)}.`
                  : "Ready for your next batch."}
              </p>
            </div>
            <div className="buffer-progress">
              <div>
                <span
                  style={{
                    width: `${Math.min(100, ((buffer?.count || 0) / 200) * 100)}%`,
                  }}
                />
              </div>
              <small>{buffer?.count || 0} / 200 responses</small>
            </div>
            <button
              className="button primary"
              disabled={!!busy || !buffer?.count || buffer.exporting}
              onClick={() =>
                action("flush", async () => {
                  const value = await api.flush();
                  setNotice(
                    value.export
                      ? `Batch uploaded: ${value.export.count} responses. The worker will pick it up next.`
                      : "The buffer is already empty.",
                  );
                })
              }
            >
              {busy === "flush" || buffer?.exporting ? (
                <LoaderCircle size={16} className="spin" />
              ) : (
                <ArrowDownToLine size={16} />
              )}
              Flush batch now
            </button>
          </section>
          <p className="teaching-note">
            <Clock3 size={13} />
            Temporary memory: restarting Express loses unexported feedback.
            Production needs durable storage.
            {config?.mode === "local" &&
              " Local mode uses files and a rule-based model; no AWS calls."}
          </p>
          {buffer?.lastError && (
            <div className="alert error" role="alert">
              Upload failed: {buffer.lastError}. The batch remains in memory and
              will retry with ID {buffer.retryBatchId}.
            </div>
          )}
          {view === "feedback" ? (
            <FeedbackForm
              config={config}
              form={form}
              setForm={setForm}
              busy={busy}
              onSubmit={submitFeedback}
              onDashboard={() => setView("dashboard")}
            />
          ) : (
            <>
              <section className="filter-row" aria-label="Dashboard filters">
                <div>
                  <label htmlFor="branch-filter">Branch</label>
                  <select
                    id="branch-filter"
                    value={filters.branchId}
                    onChange={(e) =>
                      changeFilter(
                        "branchId",
                        e.target.value as UISelection["branchId"],
                      )
                    }
                  >
                    <option value="">All branches</option>
                    {config?.branches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="from-filter">From (UTC)</label>
                  <input
                    id="from-filter"
                    type="date"
                    value={filters.from}
                    onChange={(e) => changeFilter("from", e.target.value)}
                  />
                </div>
                <span className="date-dash">—</span>
                <div>
                  <label htmlFor="to-filter">Through (UTC)</label>
                  <input
                    id="to-filter"
                    type="date"
                    value={filters.to}
                    onChange={(e) => changeFilter("to", e.target.value)}
                  />
                </div>
                <button
                  className="text-button"
                  onClick={() => setFilters(currentWeek())}
                >
                  This week
                </button>
                <button
                  className="refresh-button"
                  aria-label="Refresh dashboard"
                  onClick={() => refresh()}
                >
                  <RefreshCw size={17} />
                </button>
              </section>
              <div className="coverage">
                <span>
                  <span
                    className={`status-dot ${data?.coverage.incomplete ? "amber" : "green"}`}
                  />
                  Data processed through{" "}
                  <strong>
                    {dateLabel(data?.coverage.dataProcessedThrough)}
                  </strong>
                </span>
                <span>
                  {data?.coverage.incomplete
                    ? `${data.coverage.pendingBatches} pending · ${data.coverage.failedBatches} failed · ${data.coverage.bufferedCount} buffered — partial results`
                    : !data
                      ? "Loading processing coverage…"
                      : !data.batches.length
                        ? "No exported batches in this selection"
                        : "All currently listed batches processed"}
                  <span
                    title="The latest processed submission is not a completeness watermark. Older batches may still be pending."
                    className="info-dot"
                  >
                    i
                  </span>
                </span>
              </div>
              <section className="stat-grid" aria-label="Key metrics">
                <Stat
                  label="Processed responses"
                  value={number(total?.responseCount)}
                  detail="Across your selected branches"
                  icon={<MessageSquare size={18} />}
                />
                <Stat
                  label="Average rating"
                  value={average(total?.averageRating)}
                  suffix="/ 5"
                  detail={`${number(total?.ratingTotal)} total rating points`}
                  icon={<Star size={18} />}
                />
                <Stat
                  label="Positive sentiment"
                  value={
                    total?.responseCount
                      ? `${Math.round((sentiments.positive / total.responseCount) * 100)}%`
                      : "—"
                  }
                  detail={`${number(sentiments.positive)} positive experiences`}
                  icon={<Leaf size={18} />}
                />
                <Stat
                  label="Regions represented"
                  value={data?.metrics.regions.length || 0}
                  detail={`${data?.metrics.branches.length || 0} branches with processed feedback`}
                  icon={<BarChart3 size={18} />}
                />
              </section>
              <div className="chart-grid">
                <section className="panel region-panel">
                  <div className="panel-heading">
                    <div>
                      <h2>A closer look at your regions</h2>
                      <p>
                        Average rating · lowest first · weighted by response
                        count
                      </p>
                    </div>
                    <span className="quiet-label">OUT OF 5</span>
                  </div>
                  {data?.metrics.regions.length ? (
                    <div className="region-chart">
                      {data.metrics.regions.map((region, index) => (
                        <div className="region-line" key={region.id}>
                          <div>
                            <strong>{region.name}</strong>
                            <small>{region.responseCount} responses</small>
                          </div>
                          <div className="bar-track">
                            <div
                              className={
                                index === 0 ? "rating-bar lowest" : "rating-bar"
                              }
                              style={{
                                width: `${((region.averageRating ?? 0) / 5) * 100}%`,
                              }}
                            />
                          </div>
                          <strong>{average(region.averageRating)}</strong>
                        </div>
                      ))}
                      <div className="chart-axis">
                        <span>0</span>
                        <span>1</span>
                        <span>2</span>
                        <span>3</span>
                        <span>4</span>
                        <span>5</span>
                      </div>
                    </div>
                  ) : (
                    <Empty>
                      Processed feedback will bring your regional comparison to
                      life.
                    </Empty>
                  )}
                  <div className="panel-foot">
                    <span className="legend-square coral" />
                    Lowest average rating signals where to look first. Small
                    samples need care.
                  </div>
                </section>
                <section className="panel sentiment-panel">
                  <div className="panel-heading">
                    <div>
                      <h2>The overall mood</h2>
                      <p>Sentiment across processed feedback</p>
                    </div>
                  </div>
                  <div className="sentiment-body">
                    <div
                      className="donut"
                      style={{
                        background: total?.responseCount
                          ? `conic-gradient(${slices.join(",")})`
                          : "#e9ede9",
                      }}
                      role="img"
                      aria-label={Object.entries(sentiments)
                        .map(([s, n]) => `${s}: ${n}`)
                        .join(", ")}
                    >
                      <div>
                        <strong>{number(total?.responseCount)}</strong>
                        <small>responses</small>
                      </div>
                    </div>
                    <div className="sentiment-legend">
                      {Object.entries(sentiments).map(([name, count]) => (
                        <div key={name}>
                          <span
                            className="legend-dot"
                            style={{ background: colors[name as Sentiment] }}
                          />
                          <span>{name}</span>
                          <strong>{count}</strong>
                        </div>
                      ))}
                    </div>
                  </div>
                </section>
              </div>
              <section className="panel questions-panel">
                <div className="question-intro">
                  <div className="sparkle-box">
                    <Sparkles size={22} />
                  </div>
                  <div>
                    <h2>Ask a better question. Find a clearer answer.</h2>
                    <p>
                      Explore calculated results, with customer comments to back
                      them up.
                    </p>
                  </div>
                  <span className="quiet-label">
                    {config?.mode === "aws"
                      ? "POWERED BY BEDROCK"
                      : "LOCAL MODEL PREVIEW"}
                  </span>
                </div>
                <form onSubmit={ask} className="question-form">
                  <label className="sr-only" htmlFor="question">
                    Ask about feedback
                  </label>
                  <input
                    id="question"
                    required
                    minLength={5}
                    maxLength={1000}
                    value={question}
                    onChange={(e) => setQuestion(e.target.value)}
                    placeholder="Which region had the worst reviews this week?"
                  />
                  <button
                    className="button primary"
                    disabled={asking || !data || !!pollError}
                  >
                    {asking ? (
                      <LoaderCircle size={16} className="spin" />
                    ) : (
                      <ArrowRight size={17} />
                    )}{" "}
                    {asking ? "Finding an answer…" : "Ask question"}
                  </button>
                </form>
                <div className="suggestions">
                  <span>TRY ASKING</span>
                  {[
                    "Why did the lowest-rated region perform poorly?",
                    "What are customers saying about service?",
                  ].map((q) => (
                    <button key={q} onClick={() => setQuestion(q)}>
                      {q}
                    </button>
                  ))}
                </div>
                <p className="question-scope">
                  Uses the selected dates and branch above. Each request
                  includes its own data; the model has no memory of previous
                  batches.
                </p>
                {report && (
                  <div className="answer" aria-live="polite">
                    <div className="answer-heading">
                      <span>
                        <Sparkles size={16} />
                        Your feedback brief
                      </span>
                      <a
                        href={objectLink(report.key)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <FileJson size={15} />
                        Saved report
                      </a>
                    </div>
                    <p>{report.answer}</p>
                    <p className="report-scope">
                      Snapshot: {report.filters.from}–{report.filters.to} UTC ·{" "}
                      {report.filters.branchId || "All branches"} ·{" "}
                      {report.coverage.incomplete
                        ? "Partial results"
                        : "All listed batches processed"}
                    </p>
                    <Comparison regions={report.comparison} />
                    {report.evidence.length > 0 && (
                      <>
                        <h3>Supporting comments</h3>
                        <div className="evidence-grid">
                          {report.evidence.map((record) => (
                            <Evidence
                              key={record.id}
                              record={record}
                              onOpen={showEvidence}
                            />
                          ))}
                        </div>
                      </>
                    )}
                    <small>
                      {report.measure} {report.evidenceSelection}
                    </small>
                  </div>
                )}
              </section>
              <div className="lower-grid">
                <section className="panel">
                  <div className="panel-heading">
                    <div>
                      <h2>What customers talk about</h2>
                      <p>
                        Topic mentions · one response can include several topics
                      </p>
                    </div>
                  </div>
                  <div className="topic-list">
                    {Object.entries(total?.topics || {})
                      .sort((a, b) => b[1].count - a[1].count)
                      .map(([name, metric]) => (
                        <div key={name}>
                          <span>{name}</span>
                          <div className="topic-track">
                            <span
                              style={{
                                width: `${total?.responseCount ? (metric.count / total.responseCount) * 100 : 0}%`,
                              }}
                            />
                          </div>
                          <strong>{metric.count}</strong>
                        </div>
                      ))}
                  </div>
                </section>
                <section className="panel pipeline-panel">
                  <div className="panel-heading">
                    <div>
                      <h2>From feedback to insight</h2>
                      <p>
                        {config?.mode === "aws"
                          ? "S3 → Lambda Managed Instances → Bedrock"
                          : "Filesystem → local worker → model simulation"}
                      </p>
                    </div>
                    <Activity size={19} />
                  </div>
                  <div className="pipeline">
                    {[
                      ["01", "Classification", "Sentiment & topics"],
                      ["02", "Aggregation", "Counts & rating totals"],
                      ["03", "Transformation", "Charts & evidence"],
                    ].map(([n, title, description]) => (
                      <div key={n}>
                        <span>{n}</span>
                        <strong>{title}</strong>
                        <small>{description}</small>
                      </div>
                    ))}
                  </div>
                  <div className="panel-foot">
                    Only objects under <code>batches/</code> start the
                    processing flow.
                  </div>
                </section>
              </div>
              <section className="panel batch-panel">
                <div className="panel-heading">
                  <div>
                    <h2>Batch activity</h2>
                    <p>
                      Original objects, processing progress, and saved results
                    </p>
                  </div>
                  <Pill state="neutral">
                    {data?.batches.length || 0} batches
                  </Pill>
                </div>
                {data?.batches.length ? (
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Batch / source object</th>
                          <th>Responses</th>
                          <th>Processing status</th>
                          <th>Uploaded</th>
                          <th>Result</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.batches.map((batch) => (
                          <tr key={batch.batchId}>
                            <td>
                              <a
                                className="batch-link"
                                href={objectLink(batch.sourceKey)}
                                target="_blank"
                                rel="noreferrer"
                              >
                                <FileJson size={16} />
                                {batch.batchId.slice(0, 8)}
                                <ArrowRight size={13} />
                              </a>
                              <small className="source-key">
                                {batch.sourceKey}
                              </small>
                            </td>
                            <td>
                              {batch.count}
                              {batch.count !== batch.totalCount && (
                                <small> / {batch.totalCount} total</small>
                              )}
                            </td>
                            <td>
                              <Pill state={batch.state}>
                                {batch.state === "processing"
                                  ? batch.stage
                                  : batch.state}
                              </Pill>
                              {batch.error && (
                                <small className="batch-error">
                                  {batch.error}
                                </small>
                              )}
                            </td>
                            <td>{dateLabel(batch.createdAt)}</td>
                            <td>
                              {batch.state === "completed" ? (
                                <a
                                  className="result-link"
                                  href={objectLink(
                                    `processed/${batch.batchId}.json`,
                                  )}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  View JSON <ArrowRight size={13} />
                                </a>
                              ) : (
                                <span className="muted">Waiting</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <Empty>
                    Your first batch starts with a little feedback. Add samples,
                    then flush the buffer.
                  </Empty>
                )}
              </section>
              <section className="recent-section">
                <div className="panel-heading">
                  <div>
                    <h2>The voices behind the numbers</h2>
                    <p>
                      Most recent processed responses · up to 100 in this
                      selection
                    </p>
                  </div>
                  <button
                    className="text-button"
                    onClick={() => setView("feedback")}
                  >
                    <Plus size={16} />
                    Add feedback
                  </button>
                </div>
                {data?.records.length ? (
                  <div className="evidence-grid">
                    {data.records.slice(0, 6).map((record) => (
                      <Evidence
                        key={record.id}
                        record={record}
                        onOpen={showEvidence}
                      />
                    ))}
                  </div>
                ) : (
                  <Empty>
                    Supporting comments will appear once a batch is processed.
                  </Empty>
                )}
              </section>
            </>
          )}
          <footer>
            <span>
              <Leaf size={15} />
              Branchlight · Feedback intelligence demo
            </span>
            <span>
              Batch processing + Managed Instances integration. No cost
              advantage is assumed.
            </span>
          </footer>
        </main>
      </div>
      <EvidenceDialog evidence={evidence} onClose={() => setEvidence(null)} />
    </div>
  );
}
