"use client";

import { useEffect, useRef } from "react";

// Small ink splash wherever the user clicks — purely decorative.
export default function InkEffects() {
  const layerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return;
    const onDown = (e: PointerEvent) => {
      const layer = layerRef.current;
      if (!layer || e.button !== 0) return;
      const interactive = (e.target as HTMLElement | null)?.closest("button, a, [role=button], [role=tab], [role=radio], label, input, select, textarea");
      const color = interactive ? "var(--ui-terra)" : "var(--ui-ink)";
      const frag = document.createDocumentFragment();
      const ring = document.createElement("span");
      ring.className = "ui-ink-ring";
      ring.style.left = `${e.clientX}px`;
      ring.style.top = `${e.clientY}px`;
      ring.style.borderColor = color;
      frag.appendChild(ring);
      const n = 7;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + Math.random() * 0.6;
        const r = 14 + Math.random() * 16;
        const dot = document.createElement("span");
        dot.className = "ui-ink-dot";
        dot.style.left = `${e.clientX}px`;
        dot.style.top = `${e.clientY}px`;
        dot.style.background = color;
        const size = 2 + Math.random() * 3.5;
        dot.style.width = dot.style.height = `${size}px`;
        dot.style.setProperty("--dx", `${Math.cos(a) * r}px`);
        dot.style.setProperty("--dy", `${Math.sin(a) * r}px`);
        frag.appendChild(dot);
      }
      const nodes = Array.from(frag.childNodes);
      layer.appendChild(frag);
      window.setTimeout(() => nodes.forEach((nd) => nd.parentNode?.removeChild(nd)), 700);
    };
    window.addEventListener("pointerdown", onDown, { passive: true });
    return () => window.removeEventListener("pointerdown", onDown);
  }, []);

  return <div ref={layerRef} className="ui-ink-layer" aria-hidden="true" />;
}
