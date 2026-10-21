import type { ReactNode } from "react";
import type { ClassifiedFeedback, Metric } from "@feedback/contracts";
import { MessageSquare, Star, ArrowRight } from "lucide-react";
import { average } from "../format.ts";
export function Pill({
  state,
  children,
}: {
  state?: string;
  children?: ReactNode;
}) {
  return (
    <span className={`pill ${state || ""}`}>
      <span className="status-dot" />
      {children || state}
    </span>
  );
}
export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="empty">
      <MessageSquare size={25} />
      <p>{children}</p>
    </div>
  );
}
export function Stat({
  label,
  value,
  suffix,
  detail,
  icon,
}: {
  label: string;
  value: ReactNode;
  suffix?: string;
  detail: string;
  icon: ReactNode;
}) {
  return (
    <article className="stat-card">
      <div>
        <span>{label}</span>
        {icon}
      </div>
      <p>
        {value}
        <small>{suffix}</small>
      </p>
      <span className="stat-detail">{detail}</span>
    </article>
  );
}
export function Evidence({
  record,
  onOpen,
}: {
  record: ClassifiedFeedback;
  onOpen: (record: ClassifiedFeedback) => void;
}) {
  return (
    <button className="evidence-card" onClick={() => onOpen(record)}>
      <div>
        <Pill state={record.sentiment} />
        <span className="comment-rating">
          <Star size={13} fill="currentColor" />
          {record.rating}/5
        </span>
      </div>
      <p>“{record.excerpt}”</p>
      <div className="evidence-meta">
        <span>
          <strong>{record.branch}</strong>
          <small>
            {record.region} · {record.item}
          </small>
        </span>
        <ArrowRight size={17} />
      </div>
    </button>
  );
}
export function Comparison({ regions }: { regions: Metric[] }) {
  return (
    regions.length > 0 && (
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Region</th>
              <th>Responses</th>
              <th>Rating total</th>
              <th>Average / 5</th>
              <th>Negative</th>
            </tr>
          </thead>
          <tbody>
            {regions.map((region) => (
              <tr key={region.id}>
                <td>{region.name}</td>
                <td>{region.responseCount}</td>
                <td>{region.ratingTotal}</td>
                <td>{average(region.averageRating)}</td>
                <td>{Math.round(region.negativeShare * 100)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  );
}
