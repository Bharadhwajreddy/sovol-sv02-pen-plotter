"use client";

import { useState, useEffect } from "react";
import { Save, RotateCcw, ChevronDown, CheckCircle2 } from "lucide-react";

interface PlotterSettings {
  zDraw: number;
  zHop: number;
  feedDraw: number;
  feedTravel: number;
  canvasX: number;
  canvasY: number;
  offsetX: number;
  offsetY: number;
}

const DEFAULTS: PlotterSettings = {
  zDraw: 0.0,
  zHop: 3.0,
  feedDraw: 1500,
  feedTravel: 3000,
  canvasX: 200,
  canvasY: 160,
  offsetX: 20,
  offsetY: 40,
};

interface FieldProps {
  label: string;
  value: number;
  onChange: (v: number) => void;
  unit: string;
  min?: number;
  max?: number;
  step?: number;
  hint?: string;
}

function Field({ label, value, onChange, unit, min, max, step = 0.1, hint }: FieldProps) {
  return (
    <label className="ui-field">
      <span>{label}</span>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
        className={`ui-input font-mono ${unit.length > 3 ? "!pr-16" : ""}`}
      />
      <span className="ui-unit" style={{ bottom: hint ? "auto" : 12, top: hint ? 33 : "auto" }}>{unit}</span>
      {hint && <span className="ui-hint !text-[12px]">{hint}</span>}
    </label>
  );
}

const calibrationSteps = [
  {
    title: "Mount the pen",
    content: `Remove the extruder assembly from the X-carriage. Attach a pen holder (or use tape/zip ties) to mount a Sharpie or similar marker. The pen tip should point straight down and be roughly centered on the carriage.`,
  },
  {
    title: "Set Z_DRAW height",
    content: `Place your paper on the bed. Manually jog Z down until the pen tip just barely touches the paper surface. Note this Z value — set it as Z_DRAW in settings. Start with 0.0mm and adjust if needed. The pen should draw with light, consistent pressure.`,
  },
  {
    title: "Set Z_HOP height",
    content: `Z_HOP is how high the pen lifts between strokes. Default is 3.0mm. Run the Z-Hop Test pattern to verify the pen lifts fully. If you see drag marks between lines, increase Z_HOP to 4mm or 5mm.`,
  },
  {
    title: "Run the Calibration Cross",
    content: `Download and run the Calibration Cross test pattern. The cross should span exactly 200×160mm on your paper. If it's too small or large, adjust Canvas X/Y in settings. If it's offset, adjust the X/Y Offset values.`,
  },
  {
    title: "Run the Smiley Face",
    content: `Run the Smiley Face test. Circles should be round and smooth. If they're oval, check belt tension on both X and Y axes. If arcs are jagged, reduce the Draw Feed Rate.`,
  },
  {
    title: "You're ready to plot",
    content: `Upload your sketch image in the Upload & Convert tab. Set the detail level, generate G-code, and download. Copy the .gcode file to your SD card and run it on the printer.`,
  },
];

export default function SettingsPanel() {
  const [settings, setSettings] = useState<PlotterSettings>(DEFAULTS);
  const [saved, setSaved] = useState(false);
  const [openStep, setOpenStep] = useState<number | null>(0);

  useEffect(() => {
    try {
      const stored = localStorage.getItem("plotterSettings");
      if (stored) setSettings(JSON.parse(stored));
    } catch {}
  }, []);

  const update = (key: keyof PlotterSettings) => (value: number) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  };

  const save = () => {
    localStorage.setItem("plotterSettings", JSON.stringify(settings));
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const reset = () => {
    setSettings(DEFAULTS);
    localStorage.removeItem("plotterSettings");
    setSaved(false);
  };

  return (
    <div className="space-y-8">
      <div>
        <span className="ui-badge ui-badge-ink"><Save size={12} />Saved in this browser</span>
        <h2 className="mt-4 font-serif-display text-[34px] sm:text-[42px] leading-[1.05] font-semibold text-tx">Printer <em className="text-ink">settings</em></h2>
        <p className="mt-2 text-[15px] text-tx2 max-w-2xl">Pen heights, speeds and the drawing area of your Sovol SV02, plus a step-by-step calibration guide.</p>
      </div>

      <div className="grid lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] gap-6 items-start">
        {/* Settings form */}
        <section className="ui-panel overflow-hidden">
          {[
            { title: "Pen heights", fields: (
              <>
                <Field label="Pen down height (Z_DRAW)" value={settings.zDraw} onChange={update("zDraw")} unit="mm" min={-5} max={10} step={0.1} hint="Where the pen touches the paper. Start at 0.0 and adjust." />
                <Field label="Pen up height (Z_HOP)" value={settings.zHop} onChange={update("zHop")} unit="mm" min={0.5} max={20} step={0.5} hint="How high the pen lifts between strokes. Increase if it drags." />
              </>
            ) },
            { title: "Speeds", fields: (
              <>
                <Field label="Drawing speed" value={settings.feedDraw} onChange={update("feedDraw")} unit="mm/min" min={100} max={5000} step={100} hint="Lower is smoother on curves." />
                <Field label="Travel speed" value={settings.feedTravel} onChange={update("feedTravel")} unit="mm/min" min={100} max={10000} step={100} hint="Speed while the pen is lifted." />
              </>
            ) },
            { title: "Drawing area", fields: (
              <>
                <Field label="Canvas width" value={settings.canvasX} onChange={update("canvasX")} unit="mm" min={10} max={270} step={1} hint="Usable drawing width. Default 200 mm." />
                <Field label="Canvas height" value={settings.canvasY} onChange={update("canvasY")} unit="mm" min={10} max={230} step={1} hint="Usable drawing height. Default 160 mm." />
                <Field label="X offset from home" value={settings.offsetX} onChange={update("offsetX")} unit="mm" min={0} max={80} step={1} hint="Distance from X home to the drawing start." />
                <Field label="Y offset from home" value={settings.offsetY} onChange={update("offsetY")} unit="mm" min={0} max={80} step={1} hint="Distance from Y home to the drawing start." />
              </>
            ) },
          ].map((g) => (
            <div key={g.title} className="ui-section">
              <p className="ui-eyebrow mb-4">{g.title}</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-5">{g.fields}</div>
            </div>
          ))}

          <div className="ui-section">
            <div className="rounded-2xl p-4 font-mono text-[12px] space-y-1 text-tx2" style={{ background: "var(--ui-panel-2)", border: "1px solid var(--ui-line)" }}>
              <p className="ui-eyebrow !font-sans mb-2">G-code header preview</p>
              <p>G21 ; mm units</p>
              <p>G90 ; absolute positioning</p>
              <p>G28 X Y ; home X and Y ONLY</p>
              <p>G0 Z{settings.zHop.toFixed(2)} F{settings.feedTravel} ; pen up</p>
            </div>
          </div>

          <div className="ui-section ui-muted flex flex-wrap gap-3">
            <button onClick={save} className={`ui-btn ui-btn-primary ui-shine ${saved ? "!bg-[var(--ui-ok)] !bg-none" : ""}`}>
              {saved ? (<><CheckCircle2 size={15} />Saved</>) : (<><Save size={15} />Save settings</>)}
            </button>
            <button onClick={reset} className="ui-btn">
              <RotateCcw size={14} />
              Reset to defaults
            </button>
          </div>
        </section>

        <div className="flex flex-col gap-6">
          {/* Calibration wizard */}
          <section className="ui-panel overflow-hidden">
            <div className="ui-panel-head">
              <div>
                <p className="font-serif-display text-[19px] font-semibold text-tx">Calibration guide</p>
                <p className="ui-hint">Set up your Sovol SV02 as a pen plotter.</p>
              </div>
            </div>
            <div>
              {calibrationSteps.map((step, i) => (
                <div key={i} className={i > 0 ? "border-t" : ""} style={{ borderColor: "var(--ui-line)" }}>
                  <button
                    onClick={() => setOpenStep(openStep === i ? null : i)}
                    aria-expanded={openStep === i}
                    className="w-full flex items-center justify-between gap-3 px-5 py-4 text-left hover:bg-[var(--ui-panel-2)] transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <span className={`w-7 h-7 rounded-full grid place-items-center text-[12px] font-bold shrink-0 transition-colors ${openStep === i ? "text-[#fdfaf3]" : "text-ink"}`}
                        style={{ background: openStep === i ? "var(--ui-ink)" : "var(--ui-ink-soft)" }}>
                        {i + 1}
                      </span>
                      <span className="text-[14px] font-semibold text-tx">{step.title}</span>
                    </div>
                    <ChevronDown size={16} className={`text-tx3 shrink-0 transition-transform duration-300 ${openStep === i ? "rotate-180" : ""}`} />
                  </button>
                  {openStep === i && (
                    <div className="px-5 pb-5 pl-[60px] ui-pop">
                      <p className="text-[13.5px] text-tx2 leading-relaxed">{step.content}</p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>

          {/* Machine reference */}
          <section className="ui-panel p-5">
            <p className="font-serif-display text-[19px] font-semibold text-tx mb-4">Machine reference</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-2 xl:grid-cols-3 gap-2.5 text-[12px]">
              {[
                ["Printer", "Sovol SV02"],
                ["Firmware", "Marlin"],
                ["Board", "ATmega2560"],
                ["Bed size", "280 × 240 mm"],
                ["Units", "G21 (mm)"],
                ["Positioning", "G90 (absolute)"],
                ["Home command", "G28 X Y"],
                ["Never home", "Z axis"],
                ["No commands", "M104/M109/M140"],
              ].map(([k, v]) => (
                <div key={k} className="rounded-xl p-3" style={{ background: "var(--ui-panel-2)" }}>
                  <p className="text-tx3 mb-0.5">{k}</p>
                  <p className="font-mono font-medium text-tx">{v}</p>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
