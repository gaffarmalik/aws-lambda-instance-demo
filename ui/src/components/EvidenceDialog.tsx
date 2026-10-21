import { useEffect, useRef } from "react";
import type { EvidenceResponse } from "@feedback/contracts";
import { X } from "lucide-react";
import { Pill } from "./FeedbackDisplay.tsx";
import { dateLabel, objectLink } from "../format.ts";
export function EvidenceDialog({
  evidence,
  onClose,
}: {
  evidence: EvidenceResponse | null;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (evidence && !dialog.current?.open) dialog.current?.showModal();
  }, [evidence]);
  return (
    <dialog
      ref={dialog}
      onClose={onClose}
      className="evidence-dialog"
      aria-labelledby="evidence-title"
    >
      {evidence && (
        <>
          <div className="dialog-top">
            <p className="eyebrow">FEEDBACK EVIDENCE</p>
            <button
              aria-label="Close evidence"
              onClick={() => dialog.current?.close()}
            >
              <X size={20} />
            </button>
          </div>
          <h2 id="evidence-title">
            {evidence.record.branch} · {evidence.record.region}
          </h2>
          <p className="muted">
            {evidence.record.item} · {dateLabel(evidence.record.submittedAt)}
          </p>
          <Pill state={evidence.record.sentiment} />
          <blockquote>{evidence.record.comment}</blockquote>
          <p>
            <strong>{evidence.record.rating}/5</strong> customer rating
          </p>
          <h3>Classified topics</h3>
          {evidence.record.topics.map((topic) => (
            <div className="topic-evidence" key={topic.name}>
              <strong>
                {topic.name} <Pill state={topic.sentiment} />
              </strong>
              <p>“{topic.excerpt}”</p>
            </div>
          ))}
          <dl>
            <dt>Feedback ID</dt>
            <dd>{evidence.record.id}</dd>
            <dt>Batch ID</dt>
            <dd>{evidence.record.batchId}</dd>
            <dt>Source object</dt>
            <dd>
              <a
                href={objectLink(evidence.record.source.key)}
                target="_blank"
                rel="noreferrer"
              >
                {evidence.record.source.key}
              </a>
            </dd>
            <dt>Model / prompt</dt>
            <dd>
              {evidence.modelId} / {evidence.promptVersion}
            </dd>
          </dl>
        </>
      )}
    </dialog>
  );
}
