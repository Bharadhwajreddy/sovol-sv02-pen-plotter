/**
 * sticker-data.ts
 * Catalogue of all sticker assets with metadata for the Sticker Library panel.
 * Requirements: 9.1, 9.8
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type StickerCategory =
  | "geometric"
  | "arrows"
  | "speech-bubbles"
  | "celebration"
  | "icons"
  | "text-decorations";

export interface StickerMeta {
  id: string;
  name: string;
  category: StickerCategory;
  path: string; // relative URL: /stickers/{category}/{filename}.svg
}

// ─── Sticker Inventory ────────────────────────────────────────────────────────

export const STICKERS: StickerMeta[] = [
  // ── Geometric ──────────────────────────────────────────────────────────────
  {
    id: "geometric-star",
    name: "Star",
    category: "geometric",
    path: "/stickers/geometric/star.svg",
  },
  {
    id: "geometric-heart",
    name: "Heart",
    category: "geometric",
    path: "/stickers/geometric/heart.svg",
  },
  {
    id: "geometric-circle",
    name: "Circle",
    category: "geometric",
    path: "/stickers/geometric/circle.svg",
  },
  {
    id: "geometric-triangle",
    name: "Triangle",
    category: "geometric",
    path: "/stickers/geometric/triangle.svg",
  },
  {
    id: "geometric-diamond",
    name: "Diamond",
    category: "geometric",
    path: "/stickers/geometric/diamond.svg",
  },

  // ── Arrows ─────────────────────────────────────────────────────────────────
  {
    id: "arrows-single-arrow",
    name: "Single Arrow",
    category: "arrows",
    path: "/stickers/arrows/single-arrow.svg",
  },
  {
    id: "arrows-double-arrow",
    name: "Double Arrow",
    category: "arrows",
    path: "/stickers/arrows/double-arrow.svg",
  },
  {
    id: "arrows-curved-arrow",
    name: "Curved Arrow",
    category: "arrows",
    path: "/stickers/arrows/curved-arrow.svg",
  },

  // ── Speech Bubbles ─────────────────────────────────────────────────────────
  {
    id: "speech-bubbles-round-bubble",
    name: "Round Bubble",
    category: "speech-bubbles",
    path: "/stickers/speech-bubbles/round-bubble.svg",
  },
  {
    id: "speech-bubbles-rectangular-bubble",
    name: "Rectangular Bubble",
    category: "speech-bubbles",
    path: "/stickers/speech-bubbles/rectangular-bubble.svg",
  },

  // ── Celebration ────────────────────────────────────────────────────────────
  {
    id: "celebration-confetti-burst",
    name: "Confetti Burst",
    category: "celebration",
    path: "/stickers/celebration/confetti-burst.svg",
  },
  {
    id: "celebration-balloon",
    name: "Balloon",
    category: "celebration",
    path: "/stickers/celebration/balloon.svg",
  },
  {
    id: "celebration-party-hat",
    name: "Party Hat",
    category: "celebration",
    path: "/stickers/celebration/party-hat.svg",
  },

  // ── Icons ──────────────────────────────────────────────────────────────────
  {
    id: "icons-sun",
    name: "Sun",
    category: "icons",
    path: "/stickers/icons/sun.svg",
  },
  {
    id: "icons-moon",
    name: "Moon",
    category: "icons",
    path: "/stickers/icons/moon.svg",
  },
  {
    id: "icons-flower",
    name: "Flower",
    category: "icons",
    path: "/stickers/icons/flower.svg",
  },
  {
    id: "icons-lightning-bolt",
    name: "Lightning Bolt",
    category: "icons",
    path: "/stickers/icons/lightning-bolt.svg",
  },

  // ── Text Decorations ───────────────────────────────────────────────────────
  {
    id: "text-decorations-happy-birthday-banner",
    name: "Happy Birthday Banner",
    category: "text-decorations",
    path: "/stickers/text-decorations/happy-birthday-banner.svg",
  },
  {
    id: "text-decorations-banner-ribbon",
    name: "Banner Ribbon",
    category: "text-decorations",
    path: "/stickers/text-decorations/banner-ribbon.svg",
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Get all stickers in a given category. */
export function getStickersByCategory(category: StickerCategory): StickerMeta[] {
  return STICKERS.filter((s) => s.category === category);
}

/** Get a sticker by its id. */
export function getStickerById(id: string): StickerMeta | undefined {
  return STICKERS.find((s) => s.id === id);
}

/** Get all unique categories that have at least one sticker. */
export function getStickerCategories(): StickerCategory[] {
  const seen = new Set<StickerCategory>();
  const result: StickerCategory[] = [];
  for (const s of STICKERS) {
    if (!seen.has(s.category)) {
      seen.add(s.category);
      result.push(s.category);
    }
  }
  return result;
}
