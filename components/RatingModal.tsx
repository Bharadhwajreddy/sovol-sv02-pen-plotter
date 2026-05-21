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
    <div className="fixed bottom-6 right-6 z-50 pointer-events-none">
      <div
        className="pointer-events-auto w-80 rounded-2xl border border-white/[0.10] bg-[#161616] shadow-2xl shadow-black/60 animate-fade-in"
        role="dialog"
        aria-label="Rate your G-code output"
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-white/[0.06] flex items-center justify-between">
          <div>
            <p className="text-sm font-bold text-white">How did it plot?</p>
            <p className="text-xs text-white/40 mt-0.5">Rate the output quality</p>
          </div>
          <button
            onClick={handleSkip}
            className="p-1.5 rounded-lg text-white/30 hover:text-white/70 hover:bg-white/[0.06] transition-all"
            aria-label="Skip rating"
          >
            <X size={14} />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4">
          {submitted ? (
            // Confirmation message
            <div className="flex flex-col items-center gap-2 py-2">
              <div className="w-10 h-10 rounded-full bg-green-500/15 flex items-center justify-center">
                <Star size={18} className="text-green-400 fill-green-400" />
              </div>
              <p className="text-sm font-semibold text-white">Thanks for the feedback!</p>
              <p className="text-xs text-white/40">Your rating has been saved.</p>
            </div>
          ) : (
            <>
              {/* Star rating */}
              <div
                className="flex items-center justify-center gap-2 py-2"
                role="group"
                aria-label="Star rating"
              >
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
                      className="transition-transform hover:scale-110 focus:outline-none focus:scale-110"
                    >
                      <Star
                        size={28}
                        className={`transition-colors ${
                          isActive
                            ? "text-yellow-400 fill-yellow-400"
                            : "text-white/20"
                        }`}
                      />
                    </button>
                  );
                })}
              </div>

              {/* Error message */}
              {error && (
                <div className="mt-2 px-3 py-2 rounded-xl bg-red-500/10 border border-red-500/20 text-xs text-red-300 flex items-center gap-2">
                  <span className="flex-1">{error}</span>
                  <button
                    onClick={handleSubmit}
                    className="flex items-center gap-1 text-red-400 hover:text-red-300 transition-colors"
                    aria-label="Retry submission"
                  >
                    <RotateCcw size={11} />
                    Retry
                  </button>
                </div>
              )}

              {/* Actions */}
              <div className="flex items-center gap-2 mt-3">
                <button
                  onClick={handleSkip}
                  className="flex-1 py-2 rounded-xl text-xs font-semibold text-white/40 hover:text-white/70 border border-white/[0.08] hover:border-white/[0.16] bg-white/[0.02] hover:bg-white/[0.06] transition-all"
                >
                  Skip
                </button>
                <button
                  onClick={handleSubmit}
                  disabled={selected === 0 || submitting}
                  className="flex-1 py-2 rounded-xl text-xs font-black text-white bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-lg shadow-purple-500/20"
                >
                  {submitting ? "Saving…" : "Submit Rating"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
