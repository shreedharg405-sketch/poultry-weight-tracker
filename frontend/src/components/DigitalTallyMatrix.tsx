import React, { useState, useEffect, useMemo } from 'react';
import {
  Scale,
  Plus,
  Minus,
  RotateCcw,
  Save,
  Wand2,
  AlertCircle,
  CheckCircle2,
  ArrowUpDown,
  Calculator,
  ChevronDown,
  Layers
} from 'lucide-react';
import confetti from 'canvas-confetti';
import { Flock, TallyItem, UniformityStats } from '../types';
import { computeUniformityStats, computePerformanceAlerts } from '../services/calculations';
import { getClientBenchmarkForWeek } from '../services/benchmarks';
import { soundEffects } from '../services/audioFeedback';
import { api } from '../services/api';

interface DigitalTallyMatrixProps {
  flocks: Flock[];
  activeFlock: Flock | null;
  onFlockChange: (flock: Flock) => void;
  onSavedRecord: () => void;
}

export const DigitalTallyMatrix: React.FC<DigitalTallyMatrixProps> = ({
  flocks,
  activeFlock,
  onFlockChange,
  onSavedRecord,
}) => {
  // Session Header State
  const [selectedWeek, setSelectedWeek] = useState<number>(12);
  const [weighDate, setWeighDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [weighedBy, setWeighedBy] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [customTargetWeight, setCustomTargetWeight] = useState<number | ''>('');
  const [stepSize, setStepSize] = useState<number>(20); // 10g, 20g, or 50g

  // Stream scale input
  const [scaleInputText, setScaleInputText] = useState<string>('');

  // Tallies State: Map of weight -> birdCount
  const [tallyMap, setTallyMap] = useState<Map<number, number>>(new Map());

  // Saving state
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [saveSuccessMsg, setSaveSuccessMsg] = useState<string | null>(null);

  // Determine target weight from benchmarks
  const benchmark = useMemo(() => {
    if (!activeFlock) return { targetWeight: 1260, feedGramsPerBirdDay: 55 };
    return getClientBenchmarkForWeek(activeFlock.season, activeFlock.sex, selectedWeek);
  }, [activeFlock, selectedWeek]);

  const effectiveTargetWeight = customTargetWeight !== '' ? Number(customTargetWeight) : benchmark.targetWeight;

  // Initialize or re-center buckets around target weight
  const centerBuckets = (target: number, step: number) => {
    const bucketsCount = 19; // 9 below, center, 9 above
    const half = Math.floor(bucketsCount / 2);
    const start = Math.max(step, Math.round(target / step) * step - half * step);

    setTallyMap((prev) => {
      const next = new Map<number, number>();
      for (let i = 0; i < bucketsCount; i++) {
        const w = start + i * step;
        next.set(w, prev.get(w) || 0);
      }
      return next;
    });
  };

  // Re-center on initial mount or when step/target changes significantly
  useEffect(() => {
    centerBuckets(effectiveTargetWeight, stepSize);
  }, [stepSize, selectedWeek]);

  // Convert map to sorted TallyItem array
  const talliesArray: TallyItem[] = useMemo(() => {
    const items: TallyItem[] = [];
    tallyMap.forEach((count, weight) => {
      items.push({ weightGrams: weight, birdCount: count });
    });
    return items.sort((a, b) => a.weightGrams - b.weightGrams);
  }, [tallyMap]);

  // Live Calculated Stats
  const stats: UniformityStats = useMemo(() => {
    return computeUniformityStats(talliesArray);
  }, [talliesArray]);

  // Live Performance & Feed Alerts
  const alerts = useMemo(() => {
    return computePerformanceAlerts({
      actualAvgWeight: stats.averageWeight,
      targetWeight: effectiveTargetWeight,
      standardFeedGrams: benchmark.feedGramsPerBirdDay,
      uniformityPercent: stats.uniformityPercent,
    });
  }, [stats, effectiveTargetWeight, benchmark]);

  // Increment tally
  const incrementTally = (weight: number, delta: number = 1) => {
    soundEffects.playTallyBeep();
    setTallyMap((prev) => {
      const next = new Map(prev);
      const current = next.get(weight) || 0;
      const updated = Math.max(0, current + delta);
      next.set(weight, updated);
      return next;
    });
  };

  // Set explicit count
  const setCount = (weight: number, count: number) => {
    setTallyMap((prev) => {
      const next = new Map(prev);
      next.set(weight, Math.max(0, count));
      return next;
    });
  };

  // Add bucket above or below
  const addBucketLower = () => {
    const minWeight = Math.min(...Array.from(tallyMap.keys()));
    const newWeight = Math.max(10, minWeight - stepSize);
    setTallyMap((prev) => new Map([[newWeight, 0], ...prev]));
  };

  const addBucketUpper = () => {
    const maxWeight = Math.max(...Array.from(tallyMap.keys()));
    const newWeight = maxWeight + stepSize;
    setTallyMap((prev) => new Map([...prev, [newWeight, 0]]));
  };

  // Direct scale weight stream parser (e.g. '1240 1260 1220 1280')
  const handleScaleInputSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!scaleInputText.trim()) return;

    const values = scaleInputText
      .split(/[\s,;\n]+/)
      .map((s) => parseFloat(s.trim()))
      .filter((n) => !isNaN(n) && n > 0);

    if (values.length === 0) return;

    setTallyMap((prev) => {
      const next = new Map(prev);
      for (const val of values) {
        // Find nearest bucket or add bucket
        const rounded = Math.round(val / stepSize) * stepSize;
        const cur = next.get(rounded) || 0;
        next.set(rounded, cur + 1);
      }
      return next;
    });

    soundEffects.playTallyBeep();
    setScaleInputText('');
  };

  // Populate sample 100 birds for quick demonstration
  const handleFillDemoData = () => {
    soundEffects.playSuccessChime();
    const demoCounts: Record<number, number> = {};
    const center = Math.round(effectiveTargetWeight / stepSize) * stepSize;

    // Bell curve distribution
    const offsets = [-4, -3, -2, -1, 0, 1, 2, 3, 4];
    const distribution = [2, 5, 12, 22, 28, 18, 9, 3, 1]; // sums to 100 birds

    setTallyMap((prev) => {
      const next = new Map(prev);
      offsets.forEach((off, idx) => {
        const w = center + off * stepSize;
        next.set(w, distribution[idx]);
      });
      return next;
    });
  };

  // Reset tallies
  const handleResetTallies = () => {
    if (window.confirm('Are you sure you want to clear all tally marks on this sheet?')) {
      setTallyMap((prev) => {
        const next = new Map();
        prev.forEach((_, key) => next.set(key, 0));
        return next;
      });
    }
  };

  // Save weighing session to backend / offline store
  const handleSave = async () => {
    if (!activeFlock) {
      alert('Please select or create a flock first.');
      return;
    }
    if (stats.totalBirds < 5) {
      alert('Please tally at least 5 birds before saving (Standard sample is 50-100+ birds).');
      return;
    }

    setIsSaving(true);
    try {
      await api.saveWeighing({
        flockId: activeFlock.id,
        ageWeeks: selectedWeek,
        weighDate,
        tallies: talliesArray,
        weighedBy: weighedBy || 'Flock Technician',
        notes: notes || undefined,
      });

      if (stats.uniformityPercent >= 80) {
        confetti({
          particleCount: 80,
          spread: 70,
          origin: { y: 0.6 },
        });
      }
      soundEffects.playSuccessChime();
      setSaveSuccessMsg(`Session saved successfully for Week ${selectedWeek}!`);
      setTimeout(() => setSaveSuccessMsg(null), 4000);
      onSavedRecord();
    } catch (err: any) {
      alert('Error saving weighing: ' + (err.message || 'Unknown error'));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* 1. SESSION HEADER / FLOCK DETAILS */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-xl">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-slate-800">
          <div>
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <Scale className="w-5 h-5 text-emerald-400" />
              <span>Digital Weighing Sheet & Tally Matrix</span>
            </h2>
            <p className="text-xs text-slate-400">
              Replicating the traditional Suguna Foods bodyweight recording chart with live uniformity formulas
            </p>
          </div>

          {/* Quick Actions */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => centerBuckets(effectiveTargetWeight, stepSize)}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition flex items-center gap-1.5"
            >
              <RotateCcw className="w-3.5 h-3.5 text-slate-400" />
              <span>Center on Target</span>
            </button>
            <button
              onClick={handleFillDemoData}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-950 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-900/50 transition flex items-center gap-1.5"
            >
              <Wand2 className="w-3.5 h-3.5 text-emerald-400" />
              <span>Sample 100 Birds</span>
            </button>
            <button
              onClick={handleResetTallies}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 text-rose-300 hover:bg-rose-950/40 border border-slate-700 transition"
            >
              Clear Counts
            </button>
          </div>
        </div>

        {/* Input Parameters Matrix */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mt-4 text-xs">
          {/* Flock Selector */}
          <div className="col-span-2 sm:col-span-1">
            <label className="text-slate-400 block mb-1 font-medium">Select Flock</label>
            <div className="relative">
              <select
                value={activeFlock?.id || ''}
                onChange={(e) => {
                  const found = flocks.find((f) => f.id === e.target.value);
                  if (found) onFlockChange(found);
                }}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-100 focus:outline-none focus:border-emerald-500 pr-8"
              >
                {flocks.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.farmName} ({f.houseNo} / {f.penNo} - {f.sex})
                  </option>
                ))}
              </select>
              <ChevronDown className="w-4 h-4 text-slate-400 absolute right-2 top-2 pointer-events-none" />
            </div>
          </div>

          {/* Age Weeks */}
          <div>
            <label className="text-slate-400 block mb-1 font-medium">Age (Weeks)</label>
            <select
              value={selectedWeek}
              onChange={(e) => setSelectedWeek(Number(e.target.value))}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-100 focus:outline-none focus:border-emerald-500"
            >
              {Array.from({ length: 23 }, (_, i) => i + 1).map((w) => (
                <option key={w} value={w}>
                  Week {w}
                </option>
              ))}
            </select>
          </div>

          {/* Weigh Date */}
          <div>
            <label className="text-slate-400 block mb-1 font-medium">Weighing Date</label>
            <input
              type="date"
              value={weighDate}
              onChange={(e) => setWeighDate(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-100 focus:outline-none focus:border-emerald-500"
            />
          </div>

          {/* Target Weight (g) */}
          <div>
            <label className="text-slate-400 block mb-1 font-medium">
              Target Wt (g) <span className="text-emerald-400 font-mono">(Std: {benchmark.targetWeight}g)</span>
            </label>
            <input
              type="number"
              placeholder={`${benchmark.targetWeight}`}
              value={customTargetWeight}
              onChange={(e) => setCustomTargetWeight(e.target.value ? Number(e.target.value) : '')}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-100 focus:outline-none focus:border-emerald-500 font-mono"
            />
          </div>

          {/* Step Size (10g, 20g, 50g) */}
          <div>
            <label className="text-slate-400 block mb-1 font-medium">Bucket Step</label>
            <div className="grid grid-cols-3 gap-1">
              {[10, 20, 50].map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStepSize(s)}
                  className={`py-1.5 rounded text-center font-bold text-xs transition ${
                    stepSize === s
                      ? 'bg-emerald-600 text-white shadow'
                      : 'bg-slate-950 border border-slate-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {s}g
                </button>
              ))}
            </div>
          </div>

          {/* Weighed By */}
          <div>
            <label className="text-slate-400 block mb-1 font-medium">Weighed By</label>
            <input
              type="text"
              placeholder="e.g. K. Rajan"
              value={weighedBy}
              onChange={(e) => setWeighedBy(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-100 focus:outline-none focus:border-emerald-500"
            />
          </div>
        </div>

        {/* Digital Scale Quick Weights Input Bar */}
        <form onSubmit={handleScaleInputSubmit} className="mt-4 pt-3 border-t border-slate-800 flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <input
              type="text"
              value={scaleInputText}
              onChange={(e) => setScaleInputText(e.target.value)}
              placeholder="Direct Scale Entry: Type or paste weights (e.g. '1240 1260 1280 1220 1240') and press Enter..."
              className="w-full bg-slate-950/80 border border-slate-700 rounded-lg pl-3 pr-24 py-2 text-xs text-slate-100 font-mono focus:outline-none focus:border-emerald-500"
            />
            <span className="absolute right-2 top-2 text-[10px] text-slate-500 uppercase tracking-wider font-semibold">
              Fast Scale In
            </span>
          </div>
          <button
            type="submit"
            className="px-4 py-2 rounded-lg text-xs font-bold bg-slate-800 hover:bg-slate-700 text-emerald-400 border border-slate-700 transition flex items-center justify-center gap-1.5"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Weight(s)</span>
          </button>
        </form>
      </div>

      {/* 2. REAL-TIME STATISTICAL TELEMETRY BANNER */}
      <div className="bg-gradient-to-r from-slate-900 via-slate-900 to-slate-800 border border-slate-800 rounded-2xl p-4 shadow-xl">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 items-center">
          {/* Sample Size with progress ring */}
          <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-800 text-center">
            <span className="text-[11px] text-slate-400 block">Total Sample Birds</span>
            <div className="flex items-center justify-center gap-1.5 mt-0.5">
              <span className="text-xl font-black text-white font-mono">{stats.totalBirds}</span>
              <span className="text-xs text-slate-400">/ 100</span>
            </div>
            {/* Progress bar */}
            <div className="w-full bg-slate-800 h-1 rounded-full mt-1.5 overflow-hidden">
              <div
                className="bg-emerald-500 h-full transition-all duration-300"
                style={{ width: `${Math.min(100, (stats.totalBirds / 100) * 100)}%` }}
              ></div>
            </div>
          </div>

          {/* Average Weight */}
          <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-800 text-center">
            <span className="text-[11px] text-slate-400 block">Average Weight (x̄)</span>
            <span className="text-xl font-black text-sky-400 font-mono block mt-0.5">
              {stats.averageWeight} <span className="text-xs font-normal text-slate-400">g</span>
            </span>
            <span className="text-[10px] text-slate-400">
              Diff: <span className={alerts.diffGrams >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                {alerts.diffGrams >= 0 ? '+' : ''}{alerts.diffGrams}g ({alerts.diffPercent}%)
              </span>
            </span>
          </div>

          {/* Uniformity % */}
          <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-800 text-center">
            <span className="text-[11px] text-slate-400 block">Uniformity (±10%)</span>
            <span className={`text-xl font-black font-mono block mt-0.5 ${
              stats.uniformityPercent >= 80 ? 'text-emerald-400' : stats.uniformityPercent >= 70 ? 'text-amber-400' : 'text-rose-400'
            }`}>
              {stats.uniformityPercent}%
            </span>
            <span className={`text-[10px] font-bold uppercase tracking-wider ${
              stats.uniformityPercent >= 80 ? 'text-emerald-400' : stats.uniformityPercent >= 70 ? 'text-amber-400' : 'text-rose-400'
            }`}>
              {stats.status}
            </span>
          </div>

          {/* CV % (via F-factor) */}
          <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-800 text-center" title="CV% = Range / (x̄ * F) * 100 from paper chart formula">
            <span className="text-[11px] text-slate-400 block">CV % (F-Factor)</span>
            <span className="text-xl font-black text-purple-400 font-mono block mt-0.5">
              {stats.cvPercentF}%
            </span>
            <span className="text-[10px] text-slate-400 font-mono">
              F = {stats.fValue} | SD: {stats.stdDev}g
            </span>
          </div>

          {/* Weight Range */}
          <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-800 text-center">
            <span className="text-[11px] text-slate-400 block">Weight Range</span>
            <span className="text-xl font-black text-amber-400 font-mono block mt-0.5">
              {stats.weightRange} <span className="text-xs font-normal text-slate-400">g</span>
            </span>
            <span className="text-[10px] text-slate-400 font-mono">
              {stats.lightestWeight}g - {stats.heaviestWeight}g
            </span>
          </div>

          {/* Suggested Daily Feed */}
          <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-800 text-center">
            <span className="text-[11px] text-slate-400 block">Suggested Feed</span>
            <span className="text-xl font-black text-amber-300 font-mono block mt-0.5">
              {alerts.suggestedDailyFeed} <span className="text-xs font-normal text-slate-400">g/bird</span>
            </span>
            <span className="text-[10px] text-slate-400">
              Std: {benchmark.feedGramsPerBirdDay}g ({alerts.feedAdjustmentGrams >= 0 ? '+' : ''}{alerts.feedAdjustmentGrams}g)
            </span>
          </div>
        </div>

        {/* Save confirmation banner */}
        {saveSuccessMsg && (
          <div className="mt-3 p-2.5 rounded-lg bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 text-xs flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            <span>{saveSuccessMsg}</span>
          </div>
        )}
      </div>

      {/* 3. INTERACTIVE TALLY MATRIX GRID (SUGUNA PAPER CHART REPLICA) */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-xl">
        <div className="flex items-center justify-between pb-3 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-emerald-400" />
            <h3 className="text-sm font-bold text-white uppercase tracking-wider">
              Weight Tally Grid (Step: {stepSize}g)
            </h3>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={addBucketLower}
              className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs border border-slate-700"
            >
              + Add Lower ({stepSize}g)
            </button>
            <button
              onClick={addBucketUpper}
              className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs border border-slate-700"
            >
              + Add Higher ({stepSize}g)
            </button>
          </div>
        </div>

        {/* Matrix Rows */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 mt-4">
          {talliesArray.map((item) => {
            const isTarget = item.weightGrams === Math.round(effectiveTargetWeight / stepSize) * stepSize;
            const isUnder = stats.averageWeight > 0 && item.weightGrams < stats.lowerLimit10Pct;
            const isOver = stats.averageWeight > 0 && item.weightGrams > stats.upperLimit10Pct;
            const isUniform = stats.averageWeight > 0 && !isUnder && !isOver;

            // Generate tally sticks representation (e.g., |||| / ||||)
            const fullFives = Math.floor(item.birdCount / 5);
            const remainder = item.birdCount % 5;
            const tallyDisplay = '卌 '.repeat(fullFives) + '|'.repeat(remainder);

            return (
              <div
                key={item.weightGrams}
                className={`relative rounded-xl p-3 border transition-all ${
                  isTarget
                    ? 'bg-slate-800/90 border-emerald-500/50 ring-1 ring-emerald-500/30'
                    : 'bg-slate-950/60 border-slate-800 hover:border-slate-700'
                }`}
              >
                {/* Weight Header */}
                <div className="flex items-center justify-between">
                  <span className={`font-mono font-bold text-base ${
                    isTarget ? 'text-emerald-400' : 'text-slate-200'
                  }`}>
                    {item.weightGrams} <span className="text-xs text-slate-400 font-normal">g</span>
                  </span>

                  {/* Status Indicator Pill */}
                  {stats.totalBirds > 0 && (
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                      isUnder ? 'bg-rose-500/20 text-rose-300' :
                      isOver ? 'bg-amber-500/20 text-amber-300' :
                      'bg-emerald-500/20 text-emerald-300'
                    }`}>
                      {isUnder ? 'Under' : isOver ? 'Over' : 'Uniform'}
                    </span>
                  )}
                </div>

                {/* Tally Mark Simulation */}
                <div className="h-5 my-1 overflow-hidden text-[11px] font-mono text-emerald-400/80 tracking-widest truncate">
                  {item.birdCount > 0 ? tallyDisplay : <span className="text-slate-600">-</span>}
                </div>

                {/* Counter Control */}
                <div className="flex items-center justify-between gap-1 mt-1">
                  <button
                    onClick={() => incrementTally(item.weightGrams, -1)}
                    disabled={item.birdCount === 0}
                    className="w-8 h-8 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center justify-center font-bold text-sm transition active:scale-95 disabled:opacity-30 disabled:pointer-events-none"
                  >
                    <Minus className="w-3.5 h-3.5" />
                  </button>

                  <input
                    type="number"
                    min="0"
                    value={item.birdCount}
                    onChange={(e) => setCount(item.weightGrams, parseInt(e.target.value, 10) || 0)}
                    className="w-12 h-8 text-center bg-slate-900 border border-slate-700 rounded-lg font-mono font-bold text-white text-sm focus:outline-none focus:border-emerald-500"
                  />

                  <button
                    onClick={() => incrementTally(item.weightGrams, 1)}
                    className="w-10 h-8 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white flex items-center justify-center font-bold text-base transition active:scale-95 shadow-md shadow-emerald-700/20"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Save and Submit Bar */}
        <div className="mt-6 pt-4 border-t border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="text-xs text-slate-400">
            <span>Formula standard: </span>
            <span className="font-mono text-slate-300">CV% = Range / (x̄ × F) × 100</span>
            <span className="mx-2">•</span>
            <span>Uniform range: </span>
            <span className="font-mono text-emerald-400">[{stats.lowerLimit10Pct}g - {stats.upperLimit10Pct}g]</span>
          </div>

          <div className="flex items-center gap-3 w-full sm:w-auto">
            <button
              onClick={handleSave}
              disabled={isSaving || stats.totalBirds === 0}
              className="w-full sm:w-auto px-6 py-2.5 rounded-xl font-bold text-sm bg-gradient-to-r from-emerald-600 to-teal-500 hover:from-emerald-500 hover:to-teal-400 text-white shadow-lg shadow-emerald-600/30 transition flex items-center justify-center gap-2 active:scale-95 disabled:opacity-50"
            >
              <Save className="w-4 h-4" />
              <span>{isSaving ? 'Saving Sheet...' : 'Save Weighing Session'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
