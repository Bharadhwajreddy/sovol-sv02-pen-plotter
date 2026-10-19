"use client";

import { useState } from "react";
import { Grid3X3, Settings, Zap, Pen, FileCode2 } from "lucide-react";
import UploadConvert from "@/components/UploadConvert";
import TestPatterns from "@/components/TestPatterns";
import SettingsPanel from "@/components/SettingsPanel";
import SvgToGcode from "@/components/SvgToGcode";

type Tab = "upload" | "svg" | "test" | "settings";

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: "upload",   label: "Convert",       icon: <Zap size={14} /> },
  { id: "svg",      label: "SVG → G-code",  icon: <FileCode2 size={14} /> },
  { id: "test",     label: "Test Patterns", icon: <Grid3X3 size={14} /> },
  { id: "settings", label: "Settings",      icon: <Settings size={14} /> },
];

export default function Home() {
  const [activeTab, setActiveTab] = useState<Tab>("upload");

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "var(--ui-bg)" }}>

      {/* ── Ambient background ──────────────────────────────────────────── */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden" aria-hidden="true">
        <div className="absolute -top-56 left-1/2 -translate-x-1/2 w-[1100px] h-[560px] rounded-full opacity-[0.16] blur-3xl"
          style={{ background: "radial-gradient(closest-side, #7c3aed, transparent)" }} />
        <div className="absolute top-1/3 -right-40 w-[520px] h-[520px] rounded-full opacity-[0.07] blur-3xl"
          style={{ background: "radial-gradient(closest-side, #3b82f6, transparent)" }} />
      </div>

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-50 border-b"
        style={{ borderColor: "var(--ui-line)", background: "rgba(7,7,11,0.78)", backdropFilter: "blur(18px) saturate(140%)", WebkitBackdropFilter: "blur(18px) saturate(140%)" }}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">

          {/* Brand */}
          <div className="flex items-center gap-3 flex-shrink-0">
            <div className="relative w-9 h-9 rounded-xl grid place-items-center shadow-lg shadow-purple-900/40"
              style={{ background: "linear-gradient(135deg, #8b5cf6, #4f46e5)" }}>
              <Pen size={16} className="text-white" />
              <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-400 ring-2 ring-[#07070b]" />
            </div>
            <div className="leading-tight">
              <h1 className="text-white font-extrabold text-[15px] tracking-tight">PlotterAI</h1>
              <p className="text-[11px] font-medium" style={{ color: "var(--ui-text-3)" }}>Sketch → G-code · Sovol SV02</p>
            </div>
          </div>

          {/* Desktop nav */}
          <nav className="hidden md:flex ui-seg" role="tablist" aria-label="Sections">
            {TABS.map((tab) => (
              <button key={tab.id} role="tab" aria-selected={activeTab === tab.id}
                onClick={() => setActiveTab(tab.id)} className="ui-seg-btn !px-4">
                {tab.icon}{tab.label}
              </button>
            ))}
          </nav>

          <span className="hidden sm:inline-flex ui-badge">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            SV02 · Marlin
          </span>
        </div>

        {/* Mobile nav */}
        <nav className="md:hidden ui-scroll-x border-t px-3 py-2" style={{ borderColor: "var(--ui-line)" }} role="tablist" aria-label="Sections">
          <div className="flex gap-1.5 w-max">
            {TABS.map((tab) => (
              <button key={tab.id} role="tab" aria-selected={activeTab === tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`ui-btn ui-btn-sm ${activeTab === tab.id ? "!text-white !bg-white/10 !border-white/15" : ""}`}>
                {tab.icon}{tab.label}
              </button>
            ))}
          </div>
        </nav>
      </header>

      {/* ── Main ────────────────────────────────────────────────────────── */}
      <main className="relative flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
        {activeTab === "upload"   && <UploadConvert />}
        {activeTab === "svg"      && <SvgToGcode />}
        {activeTab === "test"     && <TestPatterns />}
        {activeTab === "settings" && <SettingsPanel />}
      </main>

      {/* ── Footer ──────────────────────────────────────────────────────── */}
      <footer className="relative border-t" style={{ borderColor: "var(--ui-line)" }}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-5 flex flex-col sm:flex-row items-center justify-between gap-2">
          <span className="text-xs" style={{ color: "var(--ui-text-3)" }}>
            PlotterAI — pen plotting for the Sovol SV02
          </span>
          <span className="text-[11px] font-mono" style={{ color: "var(--ui-text-3)" }}>
            G21 · G90 · G28 X Y · never homes Z
          </span>
        </div>
      </footer>
    </div>
  );
}
