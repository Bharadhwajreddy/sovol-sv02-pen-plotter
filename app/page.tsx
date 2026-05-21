"use client";

import { useState } from "react";
import { Grid3X3, Settings, Zap, Pen, FileCode2 } from "lucide-react";
import UploadConvert from "@/components/UploadConvert";
import TestPatterns from "@/components/TestPatterns";
import SettingsPanel from "@/components/SettingsPanel";
import SvgToGcode from "@/components/SvgToGcode";

type Tab = "upload" | "svg" | "test" | "settings";

export default function Home() {
  const [activeTab, setActiveTab] = useState<Tab>("upload");

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "upload",   label: "Convert",       icon: <Zap size={13} /> },
    { id: "svg",      label: "SVG → G-code",  icon: <FileCode2 size={13} /> },
    { id: "test",     label: "Test Patterns", icon: <Grid3X3 size={13} /> },
    { id: "settings", label: "Settings",      icon: <Settings size={13} /> },
  ];

  return (
    <div className="min-h-screen" style={{ background: "var(--bg)" }}>

      {/* ── Ambient background orbs ─────────────────────────────────────── */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden" aria-hidden="true">
        <div className="absolute -top-40 -left-40 w-[600px] h-[600px] rounded-full opacity-[0.07]"
          style={{ background: "radial-gradient(circle, #8b5cf6 0%, transparent 70%)" }} />
        <div className="absolute -top-20 right-0 w-[500px] h-[500px] rounded-full opacity-[0.05]"
          style={{ background: "radial-gradient(circle, #3b82f6 0%, transparent 70%)" }} />
        <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] rounded-full opacity-[0.04]"
          style={{ background: "radial-gradient(circle, #8b5cf6 0%, transparent 70%)" }} />
      </div>

      {/* ── Sticky Header ─────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-50 border-b"
        style={{ borderColor: "var(--border)", background: "rgba(3,3,5,0.85)", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)" }}>
        <div className="max-w-6xl mx-auto px-5 h-14 flex items-center justify-between gap-4">

          {/* Logo */}
          <div className="flex items-center gap-3 flex-shrink-0">
            <div className="relative w-8 h-8 flex-shrink-0">
              <div className="absolute inset-0 rounded-xl opacity-60 blur-md"
                style={{ background: "linear-gradient(135deg, #8b5cf6, #3b82f6)" }} />
              <div className="relative w-8 h-8 rounded-xl flex items-center justify-center shadow-lg"
                style={{ background: "linear-gradient(135deg, #7c3aed, #2563eb)" }}>
                <Pen size={14} className="text-white" />
              </div>
            </div>
            <div className="hidden sm:block">
              <h1 className="text-white font-bold text-sm leading-none tracking-tight">PlotterAI</h1>
              <p className="text-[10px] mt-0.5 font-mono" style={{ color: "var(--text-muted)" }}>
                Sketch → G-code · Sovol SV02
              </p>
            </div>
          </div>

          {/* Nav Tabs */}
          <nav className="flex items-center gap-0.5 rounded-xl p-1 border"
            style={{ background: "rgba(255,255,255,0.03)", borderColor: "var(--border)" }}>
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all duration-200 ${
                  activeTab === tab.id
                    ? "text-white shadow-sm"
                    : "hover:text-white/70"
                }`}
                style={activeTab === tab.id ? {
                  background: "linear-gradient(135deg, rgba(124,58,237,0.7), rgba(37,99,235,0.7))",
                  boxShadow: "0 1px 8px rgba(139,92,246,0.25)",
                  color: "white",
                } : { color: "rgba(255,255,255,0.35)" }}
              >
                {tab.icon}
                <span className="hidden sm:inline">{tab.label}</span>
              </button>
            ))}
          </nav>

          {/* Version badge */}
          <div className="hidden sm:flex items-center">
            <span className="text-[10px] font-mono px-2.5 py-1 rounded-full border"
              style={{ color: "var(--text-muted)", background: "rgba(255,255,255,0.03)", borderColor: "var(--border)" }}>
              v3.0
            </span>
          </div>
        </div>
      </header>

      {/* ── Hero Banner (Convert tab only) ────────────────────────────────── */}
      {activeTab === "upload" && (
        <div className="relative overflow-hidden border-b" style={{ borderColor: "var(--border)" }}>
          {/* Grid */}
          <div className="absolute inset-0 hero-grid opacity-100" />

          {/* Gradient fade at bottom */}
          <div className="absolute bottom-0 left-0 right-0 h-24 pointer-events-none"
            style={{ background: "linear-gradient(to bottom, transparent, var(--bg))" }} />

          <div className="relative max-w-6xl mx-auto px-5 py-14">
            <div className="flex flex-col items-center text-center gap-6">

              {/* Icon cluster */}
              <div className="flex items-center gap-5 mb-1">
                {[
                  { src: "/icons/pen-nib.svg", delay: "0s", color: "rgba(139,92,246,0.15)" },
                  { src: "/icons/upload-3d.svg", delay: "0.4s", color: "rgba(59,130,246,0.15)" },
                  { src: "/icons/gcode-chip.svg", delay: "0.8s", color: "rgba(139,92,246,0.15)" },
                  { src: "/icons/robot-arm.svg", delay: "1.2s", color: "rgba(59,130,246,0.15)" },
                  { src: "/icons/download-arrow.svg", delay: "1.6s", color: "rgba(139,92,246,0.15)" },
                ].map(({ src, delay, color }) => (
                  <div key={src} className="animate-float w-11 h-11 rounded-2xl flex items-center justify-center border"
                    style={{ animationDelay: delay, background: color, borderColor: "rgba(255,255,255,0.08)" }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={src} alt="" className="w-6 h-6 opacity-80" />
                  </div>
                ))}
              </div>

              {/* Headline */}
              <div className="space-y-3">
                <h2 className="text-4xl sm:text-5xl font-black tracking-tight text-white leading-[1.1]">
                  Turn Sketches Into{" "}
                  <span className="gradient-text-purple">Plotter Art</span>
                </h2>
                <p className="text-base max-w-lg mx-auto leading-relaxed" style={{ color: "var(--text-secondary)" }}>
                  Upload any sketch and get perfect G-code for your Sovol SV02 in seconds
                </p>
              </div>

              {/* Feature pills */}
              <div className="flex items-center gap-2 flex-wrap justify-center">
                {[
                  { label: "2 Pen Types", color: "text-purple-400", bg: "rgba(139,92,246,0.1)", border: "rgba(139,92,246,0.2)" },
                  { label: "3 Drawing Modes", color: "text-blue-400", bg: "rgba(59,130,246,0.1)", border: "rgba(59,130,246,0.2)" },
                  { label: "100% Faithful", color: "text-emerald-400", bg: "rgba(16,185,129,0.1)", border: "rgba(16,185,129,0.2)" },
                  { label: "Sovol SV02 Ready", color: "text-amber-400", bg: "rgba(245,158,11,0.1)", border: "rgba(245,158,11,0.2)" },
                ].map(({ label, color, bg, border }) => (
                  <span key={label}
                    className={`text-xs font-semibold px-3.5 py-1.5 rounded-full border ${color}`}
                    style={{ background: bg, borderColor: border }}>
                    {label}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Main Content ──────────────────────────────────────────────────── */}
      <main className="max-w-6xl mx-auto px-5 py-10">
        {activeTab === "upload"   && <UploadConvert />}
        {activeTab === "svg"      && <SvgToGcode />}
        {activeTab === "test"     && <TestPatterns />}
        {activeTab === "settings" && <SettingsPanel />}
      </main>

      {/* ── Footer ────────────────────────────────────────────────────────── */}
      <footer className="border-t mt-20" style={{ borderColor: "var(--border)" }}>
        <div className="max-w-6xl mx-auto px-5 py-5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Pen size={13} style={{ color: "var(--text-muted)" }} />
            <span className="text-xs" style={{ color: "var(--text-muted)" }}>
              PlotterAI — Sovol SV02 Pen Plotter Tool
            </span>
          </div>
          <span className="text-xs font-mono" style={{ color: "var(--text-muted)" }}>
            G21 · G90 · G28 X Y
          </span>
        </div>
      </footer>
    </div>
  );
}
