"use client";

import { useState, useEffect } from "react";
import { Save, RotateCcw, ChevronDown, ChevronUp, CheckCircle2 } from "lucide-react";

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
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <label className="text-sm text-gray-300">{label}</label>
        <span className="text-xs text-[#6b7280]">{unit}</span>
      </div>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
        className="w-full bg-[#0f0f0f] border border-[#2a2a2a] rounded-lg px-3 py-2 text-sm font-mono text-white focus:outline-none focus:border-[#3b82f6] transition-colors"
      />
      {hint && <p className="text-xs text-[#6b7280]">{hint}</p>}
    </div>
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
      {/* Settings form */}
      <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-[#2a2a2a]">
          <h2 className="font-semibold text-white">Printer Settings</h2>
          <p className="text-xs text-[#6b7280] mt-0.5">
            These values are used when generating G-code. Saved to your browser.
          </p>
        </div>

        <div className="p-5 space-y-6">
          {/* Z heights */}
          <div>
            <h3 className="text-xs font-medium text-[#6b7280] uppercase tracking-wider mb-3">
              Z Heights
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field
                label="Z_DRAW — Pen down height"
                value={settings.zDraw}
                onChange={update("zDraw")}
                unit="mm"
                min={-5}
                max={10}
                step={0.1}
                hint="Height where pen touches paper. Start at 0.0 and adjust."
              />
              <Field
                label="Z_HOP — Pen up height"
                value={settings.zHop}
                onChange={update("zHop")}
                unit="mm"
                min={0.5}
                max={20}
                step={0.5}
                hint="Height pen lifts between strokes. Increase if pen drags."
              />
            </div>
          </div>

          {/* Feed rates */}
          <div>
            <h3 className="text-xs font-medium text-[#6b7280] uppercase tracking-wider mb-3">
              Feed Rates
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field
                label="Draw Feed Rate"
                value={settings.feedDraw}
                onChange={update("feedDraw")}
                unit="mm/min"
                min={100}
                max={5000}
                step={100}
                hint="Speed while drawing. Lower = smoother arcs."
              />
              <Field
                label="Travel Feed Rate"
                value={settings.feedTravel}
                onChange={update("feedTravel")}
                unit="mm/min"
                min={100}
                max={10000}
                step={100}
                hint="Speed while moving between strokes."
              />
            </div>
          </div>

          {/* Canvas */}
          <div>
            <h3 className="text-xs font-medium text-[#6b7280] uppercase tracking-wider mb-3">
              Drawing Area
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field
                label="Canvas Width"
                value={settings.canvasX}
                onChange={update("canvasX")}
                unit="mm"
                min={10}
                max={270}
                step={1}
                hint="Usable drawing width. Default 200mm."
              />
              <Field
                label="Canvas Height"
                value={settings.canvasY}
                onChange={update("canvasY")}
                unit="mm"
                min={10}
                max={230}
                step={1}
                hint="Usable drawing height. Default 160mm."
              />
              <Field
                label="X Offset from home"
                value={settings.offsetX}
                onChange={update("offsetX")}
                unit="mm"
                min={0}
                max={80}
                step={1}
                hint="Distance from X home to drawing start. Default 40mm."
              />
              <Field
                label="Y Offset from home"
                value={settings.offsetY}
                onChange={update("offsetY")}
                unit="mm"
                min={0}
                max={80}
                step={1}
                hint="Distance from Y home to drawing start. Default 40mm."
              />
            </div>
          </div>

          {/* Machine info */}
          <div className="bg-[#0f0f0f] rounded-lg p-4 font-mono text-xs text-[#6b7280] space-y-1">
            <p className="text-gray-400 font-medium mb-2">Current G-code header preview</p>
            <p>G21 ; mm units</p>
            <p>G90 ; absolute positioning</p>
            <p>G28 X Y ; home X and Y ONLY</p>
            <p>G0 Z{settings.zHop.toFixed(2)} F{settings.feedTravel} ; pen up</p>
          </div>

          {/* Buttons */}
          <div className="flex gap-3">
            <button
              onClick={save}
              className="flex items-center gap-2 px-4 py-2.5 bg-[#3b82f6] hover:bg-[#2563eb] text-white text-sm font-medium rounded-lg transition-colors"
            >
              {saved ? (
                <>
                  <CheckCircle2 size={14} />
                  Saved
                </>
              ) : (
                <>
                  <Save size={14} />
                  Save Settings
                </>
              )}
            </button>
            <button
              onClick={reset}
              className="flex items-center gap-2 px-4 py-2.5 bg-[#1a1a1a] hover:bg-[#2a2a2a] border border-[#2a2a2a] text-gray-300 text-sm font-medium rounded-lg transition-colors"
            >
              <RotateCcw size={14} />
              Reset to Defaults
            </button>
          </div>
        </div>
      </div>

      {/* Calibration wizard */}
      <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-[#2a2a2a]">
          <h2 className="font-semibold text-white">Calibration Wizard</h2>
          <p className="text-xs text-[#6b7280] mt-0.5">
            Follow these steps to set up your Sovol SV02 as a pen plotter.
          </p>
        </div>

        <div className="divide-y divide-[#2a2a2a]">
          {calibrationSteps.map((step, i) => (
            <div key={i}>
              <button
                onClick={() => setOpenStep(openStep === i ? null : i)}
                className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-[#0f0f0f] transition-colors"
              >
                <div className="flex items-center gap-3">
                  <div className="w-6 h-6 rounded-full bg-[#3b82f6]/20 border border-[#3b82f6]/40 flex items-center justify-center text-xs font-mono text-[#3b82f6] shrink-0">
                    {i + 1}
                  </div>
                  <span className="text-sm font-medium text-gray-200">{step.title}</span>
                </div>
                {openStep === i ? (
                  <ChevronUp size={14} className="text-[#6b7280] shrink-0" />
                ) : (
                  <ChevronDown size={14} className="text-[#6b7280] shrink-0" />
                )}
              </button>
              {openStep === i && (
                <div className="px-5 pb-4 pl-14">
                  <p className="text-sm text-[#9ca3af] leading-relaxed">{step.content}</p>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Machine reference */}
      <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl p-5">
        <h3 className="font-semibold text-white mb-3">Machine Reference</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs font-mono">
          {[
            ["Printer", "Sovol SV02"],
            ["Firmware", "Marlin"],
            ["Board", "ATmega2560"],
            ["Bed size", "280 × 240mm"],
            ["Units", "G21 (mm)"],
            ["Positioning", "G90 (absolute)"],
            ["Home command", "G28 X Y"],
            ["Never home", "Z axis"],
            ["No commands", "M104/M109/M140"],
          ].map(([k, v]) => (
            <div key={k} className="bg-[#0f0f0f] rounded-lg p-2.5">
              <p className="text-[#6b7280] text-xs mb-0.5">{k}</p>
              <p className="text-gray-300">{v}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
