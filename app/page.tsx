"use client";

import { useCallback, useEffect, useState } from "react";
import { Grid3X3, Settings, PenLine, FileCode2 } from "lucide-react";
import UploadConvert from "@/components/UploadConvert";
import TestPatterns from "@/components/TestPatterns";
import SettingsPanel from "@/components/SettingsPanel";
import SvgToGcode from "@/components/SvgToGcode";
import InkEffects from "@/components/InkEffects";

type Tab = "upload" | "svg" | "test" | "settings";

const TABS: { id: Tab; label: string; hash: string; icon: React.ReactNode }[] = [
  { id: "upload",   label: "Create",        hash: "#/convert",  icon: <PenLine size={14} /> },
  { id: "svg",      label: "SVG → G-code",  hash: "#/svg",      icon: <FileCode2 size={14} /> },
  { id: "test",     label: "Test Patterns", hash: "#/patterns", icon: <Grid3X3 size={14} /> },
  { id: "settings", label: "Printer",       hash: "#/printer",  icon: <Settings size={14} /> },
];

// Hash routes keep the browser's back / forward buttons inside the app.
function tabFromHash(hash: string): Tab {
  if (hash.startsWith("#/svg")) return "svg";
  if (hash.startsWith("#/patterns")) return "test";
  if (hash.startsWith("#/printer")) return "settings";
  return "upload";
}

export default function Home() {
  const [activeTab, setActiveTab] = useState<Tab>("upload");

  useEffect(() => {
    setActiveTab(tabFromHash(window.location.hash));
    const onPop = () => setActiveTab(tabFromHash(window.location.hash));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const openTab = useCallback((tab: Tab) => {
    const t = TABS.find((x) => x.id === tab)!;
    if (tab !== activeTab) window.history.pushState(null, "", t.hash);
    setActiveTab(tab);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [activeTab]);

  return (
    <div className="relative min-h-screen flex flex-col">
      <InkEffects />

      {/* ── Ambient warmth ──────────────────────────────────────────────── */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden" aria-hidden="true">
        <div className="absolute -top-64 left-1/2 -translate-x-1/2 w-[1200px] h-[620px] rounded-full opacity-60 blur-3xl"
          style={{ background: "radial-gradient(closest-side, rgba(255,251,240,0.95), transparent)" }} />
        <div className="absolute top-1/3 -left-48 w-[520px] h-[520px] rounded-full opacity-40 blur-3xl"
          style={{ background: "radial-gradient(closest-side, rgba(214,180,130,0.35), transparent)" }} />
        <div className="absolute bottom-0 -right-40 w-[560px] h-[560px] rounded-full opacity-30 blur-3xl"
          style={{ background: "radial-gradient(closest-side, rgba(47,58,140,0.18), transparent)" }} />
      </div>

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-50 border-b"
        style={{ borderColor: "var(--ui-line)", background: "rgba(246,241,232,0.82)", backdropFilter: "blur(16px) saturate(150%)", WebkitBackdropFilter: "blur(16px) saturate(150%)" }}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">

          {/* Brand */}
          <button type="button" onClick={() => openTab("upload")} className="flex items-center gap-3 flex-shrink-0 group" aria-label="PlotterAI home">
            <div className="relative w-10 h-10 rounded-[13px] grid place-items-center transition-transform group-hover:-rotate-6"
              style={{ background: "linear-gradient(160deg, #3a46a3, #27307a)", boxShadow: "0 1px 0 rgba(255,255,255,0.25) inset, 0 8px 18px -8px rgba(47,58,140,0.7)" }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M4 20l2.2-6.4L16.8 3a1.6 1.6 0 0 1 2.3 0l1.9 1.9a1.6 1.6 0 0 1 0 2.3L10.4 17.8z" fill="#fdfaf3" />
                <path d="M4 20l2.2-6.4 4.2 4.2z" fill="#ebc995" />
                <path d="M4 20l.9-2.6 1.7 1.7z" fill="#26231f" />
              </svg>
            </div>
            <div className="leading-tight text-left">
              <h1 className="font-serif-display text-[19px] font-semibold text-tx">Plotter<span className="italic text-ink">AI</span></h1>
              <p className="text-[11px] font-medium text-tx3">Sketch to pen plot · Sovol SV02</p>
            </div>
          </button>

          {/* Desktop nav */}
          <nav className="hidden md:flex ui-seg" role="tablist" aria-label="Sections">
            {TABS.map((tab) => (
              <button key={tab.id} role="tab" aria-selected={activeTab === tab.id}
                onClick={() => openTab(tab.id)} className="ui-seg-btn !px-4">
                {tab.icon}{tab.label}
              </button>
            ))}
          </nav>

          <span className="hidden sm:inline-flex ui-badge">
            <span className="relative flex w-2 h-2">
              <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-60 animate-ping" />
              <span className="relative inline-flex w-2 h-2 rounded-full bg-emerald-600" />
            </span>
            SV02 · Marlin
          </span>
        </div>

        {/* Mobile nav */}
        <nav className="md:hidden ui-scroll-x border-t px-3 py-2" style={{ borderColor: "var(--ui-line)" }} role="tablist" aria-label="Sections">
          <div className="ui-seg w-max">
            {TABS.map((tab) => (
              <button key={tab.id} role="tab" aria-selected={activeTab === tab.id}
                onClick={() => openTab(tab.id)} className="ui-seg-btn !h-8 !text-[12.5px]">
                {tab.icon}{tab.label}
              </button>
            ))}
          </div>
        </nav>
      </header>

      {/* ── Main ────────────────────────────────────────────────────────── */}
      <main className="relative z-[1] flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 py-7 sm:py-10">
        {/* The creator stays mounted so switching tabs never loses your work */}
        <div className={activeTab === "upload" ? "" : "hidden"}>
          <UploadConvert active={activeTab === "upload"} />
        </div>
        {activeTab === "svg"      && <div className="ui-rise"><SvgToGcode /></div>}
        {activeTab === "test"     && <div className="ui-rise"><TestPatterns /></div>}
        {activeTab === "settings" && <div className="ui-rise"><SettingsPanel /></div>}
      </main>

      {/* ── Footer ──────────────────────────────────────────────────────── */}
      <footer className="relative z-[1] border-t" style={{ borderColor: "var(--ui-line)" }}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 flex flex-col sm:flex-row items-center justify-between gap-2">
          <span className="font-serif-display italic text-[13px] text-tx2">
            Made for slow, beautiful lines.
          </span>
          <span className="text-[11px] font-mono text-tx3">
            G21 · G90 · G28 X Y · never homes Z
          </span>
        </div>
      </footer>
    </div>
  );
}
