"use client";

import { useState, useCallback } from "react";
import { Star, X, RotateCcw } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SessionMeta {
  upload_mode: "raw_photo" | "ai_sketch";
  orientation: "portrait" | "landscape";
  drawing_mode: string;
  detail_level: number;
  stroke_weight: number;
  border_style: string;
  stroke_count: number;
  path_length_mm: number;
  estimated_time_s: number;
}

export interface RatingModalProps {
  sessionMeta: SessionMeta;
  onSubmit: (rating: number) => void;
  onSkip: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function RatingModal({ sessionMeta, onSubmit, onSkip }: RatingModalProps) {
  const [hovered, setHovered] = useState<number>(0);
  const [selected, setSelected] = useState<number>(0);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [visible, setVisible] = useState(true);

  const handleSubmit = useCallback(async () => {
    if (selected === 0) return;
    setSubmitting(true);
    setError(null);

    try {
      const payload = {
        timestamp: new Date().toISOString(),
        rating: selected,
        ...sessionMeta,
      };

      const res = await fetch("/api/ratings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || `HTTP ${res.status}`);
      }

      setSubmitted(true);
      onSubmit(selected);

      // Hide after 2 seconds
      setTimeout(() => setVisible(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Submission failed");
    } finally {
      setSubmitting(false);
    }
  }, [selected, sessionMeta, onSubmit]);

  const handleSkip = useCallback(() => {
    setVisible(false);
    onSkip();
  }, [onSkip]);

  if (!visible) return null;

  return (
    // Non-blocking overlay — fixed position, pointer-events only on the card
    <div className="fixed bottom-6 right-6 left-6 sm:left-auto z-50 pointer-events-none">
      <div
        className="pointer-events-auto sm:w-[340px] ui-panel !shadow-[var(--ui-shadow-lg)] ui-pop"
        role="dialog"
        aria-label="Rate your G-code output"
      >
        {/* Header */}
        <div className="ui-panel-head !py-4">
          <div>
            <p className="font-serif-display text-[18px] font-semibold text-tx">How did it plot?</p>
            <p className="ui-hint">Your rating helps tune the drawing quality</p>
          </div>
          <button onClick={handleSkip} className="ui-btn ui-btn-sm ui-btn-ghost !px-2" aria-label="Skip rating">
            <X size={15} />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4">
          {submitted ? (
            <div className="flex flex-col items-center gap-2 py-2 ui-pop">
              <div className="w-11 h-11 rounded-full grid place-items-center" style={{ background: "var(--ui-gold-soft)" }}>
                <Star size={19} className="text-gold fill-[var(--ui-gold)]" />
              </div>
              <p className="text-[14px] font-semibold text-tx">Thank you!</p>
              <p className="ui-hint">Your rating has been saved.</p>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-center gap-1.5 py-1" role="group" aria-label="Star rating">
                {[1, 2, 3, 4, 5].map((star) => {
                  const isActive = star <= (hovered || selected);
                  return (
                    <button
                      key={star}
                      onMouseEnter={() => setHovered(star)}
                      onMouseLeave={() => setHovered(0)}
                      onClick={() => setSelected(star)}
                      aria-label={`${star} star${star !== 1 ? "s" : ""}`}
                      aria-pressed={selected === star}
                      className="p-1 transition-transform hover:scale-115 hover:-translate-y-0.5"
                    >
                      <Star size={30} strokeWidth={1.6}
                        className={`transition-colors ${isActive ? "text-gold fill-[var(--ui-gold)]" : "text-[color:var(--ui-line-strong)]"}`} />
                    </button>
                  );
                })}
              </div>

              {error && (
                <div className="mt-2 px-3 py-2 rounded-xl border text-[12.5px] text-errc flex items-center gap-2"
                  style={{ background: "var(--ui-err-soft)", borderColor: "rgba(176,58,46,0.25)" }}>
                  <span className="flex-1">{error}</span>
                  <button onClick={handleSubmit} className="inline-flex items-center gap-1 font-semibold hover:underline" aria-label="Retry submission">
                    <RotateCcw size={11} />
                    Retry
                  </button>
                </div>
              )}

              <div className="flex items-center gap-2 mt-3">
                <button onClick={handleSkip} className="ui-btn ui-btn-sm flex-1">Skip</button>
                <button onClick={handleSubmit} disabled={selected === 0 || submitting} className="ui-btn ui-btn-sm ui-btn-primary flex-1">
                  {submitting ? "Saving…" : "Submit rating"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
