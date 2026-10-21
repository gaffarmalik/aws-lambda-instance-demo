import type { Dispatch, SetStateAction, FormEvent } from "react";
import type { AppConfig, FeedbackInput, BranchId } from "@feedback/contracts";
import { MessageSquare, Star, Send, ArrowRight } from "lucide-react";
interface Props {
  config: AppConfig | null;
  form: FeedbackInput;
  setForm: Dispatch<SetStateAction<FeedbackInput>>;
  busy: string;
  onSubmit: (event: FormEvent) => void;
  onDashboard: () => void;
}
export function FeedbackForm({
  config,
  form,
  setForm,
  busy,
  onSubmit,
  onDashboard,
}: Props) {
  return (
    <section className="collection-layout">
      <form className="panel feedback-form" onSubmit={onSubmit}>
        <div className="panel-heading">
          <div>
            <p className="eyebrow">YOUR VOICE MATTERS</p>
            <h2>How was your visit?</h2>
          </div>
          <MessageSquare size={22} />
        </div>
        <div className="form-grid">
          <label>
            Branch
            <select
              value={form.branchId}
              onChange={(e) =>
                setForm({ ...form, branchId: e.target.value as BranchId })
              }
            >
              {config?.branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name} · {b.region}
                </option>
              ))}
            </select>
          </label>
          <label>
            Purchased item
            <input
              required
              maxLength={120}
              placeholder="e.g. Everyday trainers"
              value={form.item}
              onChange={(e) => setForm({ ...form, item: e.target.value })}
            />
          </label>
        </div>
        <fieldset className="rating-field">
          <legend>Your overall experience</legend>
          <div className="stars">
            {[1, 2, 3, 4, 5].map((rating) => (
              <button
                type="button"
                key={rating}
                aria-label={`${rating} star${rating > 1 ? "s" : ""}`}
                aria-pressed={rating === form.rating}
                className={rating <= form.rating ? "selected" : ""}
                onClick={() => setForm({ ...form, rating })}
              >
                <Star
                  size={32}
                  fill={rating <= form.rating ? "currentColor" : "none"}
                />
              </button>
            ))}
            <span>
              {
                [
                  "Choose a rating",
                  "Very disappointing",
                  "Could be better",
                  "It was okay",
                  "A good experience",
                  "Loved it",
                ][form.rating]
              }
            </span>
          </div>
        </fieldset>
        <label>
          Tell us a little more
          <textarea
            required
            minLength={3}
            maxLength={2000}
            rows={5}
            placeholder="What went well? What could we do better?"
            value={form.comment}
            onChange={(e) => setForm({ ...form, comment: e.target.value })}
          />
        </label>
        <div className="form-bottom">
          <small>{form.comment.length}/2,000 characters</small>
          <button className="button primary" disabled={!!busy}>
            <Send size={16} />
            {busy === "submit" ? "Sending…" : "Send feedback"}
          </button>
        </div>
      </form>
      <aside className="collection-aside">
        <div className="illustration">
          <MessageSquare size={52} />
          <span>
            <Star size={20} fill="currentColor" />
          </span>
        </div>
        <h2>
          One response.
          <br />
          Part of a bigger picture.
        </h2>
        <p>
          Your feedback joins the next batch. Once processed, it helps the team
          understand what is working and where to improve.
        </p>
        <ol>
          <li>
            <span>1</span>Share your experience
          </li>
          <li>
            <span>2</span>Feedback joins a batch
          </li>
          <li>
            <span>3</span>The team explores the insights
          </li>
        </ol>
        <button className="text-button" onClick={() => onDashboard()}>
          Explore the dashboard <ArrowRight size={16} />
        </button>
      </aside>
    </section>
  );
}
