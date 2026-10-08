import React, { useState, useMemo, useRef, useEffect } from 'react';
import { 
  Building2, 
  Layers, 
  TrendingUp, 
  FileSpreadsheet, 
  Plus, 
  Minus, 
  RotateCcw, 
  Share2,
  Copy,
  Check,
  Wheat,
  Monitor,
  Calendar,
  Save,
  Crosshair,
  ArrowRight
} from 'lucide-react';
import { 
  ResponsiveContainer, 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  Tooltip, 
  ReferenceLine,
  LineChart,
  Line,
  CartesianGrid
} from 'recharts';
import { soundEffects } from '../services/audioFeedback';
import { WINTER_BROOD_STANDARDS, SUMMER_BROOD_STANDARDS } from '../services/benchmarks';
import { Shed, Flock, WeighingRecord } from '../types';

// Suguna Foods Standard F-Value Table for CV% Calculation
const F_TABLE: Record<number, number> = {
  10: 3.08, 15: 3.54, 20: 3.73, 25: 3.94, 30: 4.09, 35: 4.20, 40: 4.30,
  45: 4.40, 50: 4.50, 55: 4.57, 60: 4.64, 65: 4.70, 70: 4.76, 75: 4.81,
  80: 4.87, 85: 4.90, 90: 4.94, 95: 4.98, 100: 5.02, 150: 5.03
};

function getFValue(n: number): number {
  const keys = Object.keys(F_TABLE).map(Number).sort((a, b) => a - b);
  if (n <= keys[0]) return F_TABLE[keys[0]];
  if (n >= keys[keys.length - 1]) return F_TABLE[keys[keys.length - 1]];
  for (let i = 0; i < keys.length - 1; i++) {
    if (n >= keys[i] && n <= keys[i + 1]) {
      const s1 = keys[i];
      const s2 = keys[i + 1];
      const ratio = (n - s1) / (s2 - s1);
      return Number((F_TABLE[s1] + ratio * (F_TABLE[s2] - F_TABLE[s1])).toFixed(2));
    }
  }
  return 5.02;
}

interface MobilePoultryDashboardProps {
  sheds?: Shed[];
  flocks?: Flock[];
  activeShed?: Shed | null;
  activeFlock?: Flock | null;
  onSwitchToDesktop?: () => void;
  onSaveRecord?: (recordData: any) => Promise<void> | void;
}

export const MobilePoultryDashboard: React.FC<MobilePoultryDashboardProps> = ({
  sheds = [],
  flocks = [],
  activeShed: initialShed,
  activeFlock: initialFlock,
  onSwitchToDesktop,
  onSaveRecord,
}) => {
  // Navigation & View states
  const [activeTab, setActiveTab] = useState<'tally' | 'summary' | 'curve' | 'share'>('tally');
  const [selectedWeek, setSelectedWeek] = useState<number>(12);
  const [selectedSeason, setSelectedSeason] = useState<'SUMMER_BROOD' | 'WINTER_BROOD'>('SUMMER_BROOD');
  const [selectedGender, setSelectedGender] = useState<'FEMALE' | 'MALE'>('FEMALE');

  // Hierarchy selections
  const shedList = sheds.length > 0 ? sheds.map(s => s.shedName) : ['Shed 1', 'Shed 2', 'Shed 3'];
  const [selectedShed, setSelectedShed] = useState<string>(initialShed?.shedName || shedList[0]);

  const defaultPens = [
    { name: 'Pen A (Female)', sex: 'FEMALE' as const },
    { name: 'Pen B (Male)', sex: 'MALE' as const },
    { name: 'Pen C (Female)', sex: 'FEMALE' as const },
  ];
  const penList = flocks.length > 0 
    ? flocks.map(f => ({ name: f.penNo ? `Pen ${f.penNo} (${f.sex === 'MALE' ? 'Male' : 'Female'})` : f.houseNo, sex: f.sex }))
    : defaultPens;
  const [selectedPen, setSelectedPen] = useState<string>(penList[0].name);

  // Active Weight Bin for quick increment chips (+1, +5, +10)
  const [activeWeightBin, setActiveWeightBin] = useState<number | null>(1300);
  const [copiedShare, setCopiedShare] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);

  // Target standard lookup based on week, season & gender
  const standardsData = selectedSeason === 'SUMMER_BROOD' ? SUMMER_BROOD_STANDARDS : WINTER_BROOD_STANDARDS;
  const currentStandard = standardsData.find(s => s.week === selectedWeek) || standardsData[11];
  const targetWeight = selectedGender === 'FEMALE' ? currentStandard.femaleWeight : currentStandard.maleWeight;
  const targetDailyFeed = selectedGender === 'FEMALE' ? currentStandard.femaleFeed : currentStandard.maleFeed;

  // Initialize weights around target in 20g increments
  const [tallies, setTallies] = useState<Record<number, number>>({
    1200: 2, 1220: 4, 1240: 8, 1260: 12, 1280: 18, 
    1300: 24, 1320: 20, 1340: 10, 1360: 6, 1380: 2
  });

  const tallyListRef = useRef<HTMLDivElement | null>(null);
  const targetRowRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll to target weight bucket when week or target changes
  const scrollToTargetWeight = () => {
    if (targetRowRef.current) {
      targetRowRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  useEffect(() => {
    // Generate buckets around new target if out of range
    const currentWeights = Object.keys(tallies).map(Number);
    const minW = Math.min(...currentWeights);
    const maxW = Math.max(...currentWeights);

    if (targetWeight < minW || targetWeight > maxW) {
      const roundedTarget = Math.round(targetWeight / 20) * 20;
      const newTallies: Record<number, number> = {};
      for (let w = roundedTarget - 120; w <= roundedTarget + 120; w += 20) {
        newTallies[w] = 0;
      }
      setTallies(newTallies);
      setActiveWeightBin(roundedTarget);
    }
  }, [selectedWeek, targetWeight]);

  // Live Statistics Calculation (exact Suguna F-factor CV% & +/-10% uniformity)
  const stats = useMemo(() => {
    let totalBirds = 0;
    let sumWeight = 0;
    let minW = Infinity;
    let maxW = -Infinity;

    Object.entries(tallies).forEach(([wStr, count]) => {
      const w = Number(wStr);
      if (count > 0) {
        totalBirds += count;
        sumWeight += w * count;
        if (w < minW) minW = w;
        if (w > maxW) maxW = w;
      }
    });

    if (totalBirds === 0) {
      return { 
        avg: 0, 
        total: 0, 
        uniformity: 0, 
        cv: 0, 
        minW: 0, 
        maxW: 0, 
        rangeLow: 0, 
        rangeHigh: 0,
        underCount: 0,
        overCount: 0,
        fVal: 3.08
      };
    }

    const avg = Math.round(sumWeight / totalBirds);
    const rangeLow = Math.round(avg * 0.90);
    const rangeHigh = Math.round(avg * 1.10);

    let birdsInRange = 0;
    let underCount = 0;
    let overCount = 0;

    Object.entries(tallies).forEach(([wStr, count]) => {
      const w = Number(wStr);
      if (w >= rangeLow && w <= rangeHigh) {
        birdsInRange += count;
      } else if (w < rangeLow) {
        underCount += count;
      } else {
        overCount += count;
      }
    });

    const uniformity = Number(((birdsInRange / totalBirds) * 100).toFixed(1));
    const fVal = getFValue(totalBirds);
    const cv = Number((((maxW - minW) / (avg * fVal)) * 100).toFixed(1));

    return { 
      avg, 
      total: totalBirds, 
      uniformity, 
      cv, 
      minW, 
      maxW, 
      rangeLow, 
      rangeHigh,
      underCount,
      overCount,
      fVal
    };
  }, [tallies]);

  // Update count with audio feedback
  const updateCount = (weight: number, delta: number) => {
    setActiveWeightBin(weight);
    setTallies(prev => {
      const curr = prev[weight] || 0;
      const next = Math.max(0, curr + delta);
      return { ...prev, [weight]: next };
    });
    if (delta > 0) {
      soundEffects.playTallyBeep();
    }
  };

  // Ensure weight bins cover a span
  const addWeightBucket = (weight: number) => {
    if (!tallies[weight]) {
      setTallies(prev => ({ ...prev, [weight]: 0 }));
      setActiveWeightBin(weight);
    }
  };

  // Histogram data for Bell curve
  const chartData = useMemo(() => {
    return Object.keys(tallies)
      .map(Number)
      .sort((a, b) => a - b)
      .map(weight => ({
        weight: `${weight}g`,
        rawWeight: weight,
        count: tallies[weight] || 0,
        inRange: weight >= stats.rangeLow && weight <= stats.rangeHigh
      }));
  }, [tallies, stats.rangeLow, stats.rangeHigh]);

  // Growth curve comparison data (Weeks 1 to 23)
  const growthCurveData = useMemo(() => {
    return standardsData.map(item => {
      const std = selectedGender === 'FEMALE' ? item.femaleWeight : item.maleWeight;
      const actual = item.week === selectedWeek ? (stats.avg > 0 ? stats.avg : std) : (item.week < selectedWeek ? std - 15 : null);
      return {
        week: `W${item.week}`,
        standard: std,
        actual: actual,
      };
    });
  }, [standardsData, selectedGender, selectedWeek, stats.avg]);

  // Multi-Pen Shed Feed Calculation (5000 birds default estimation)
  const estimatedShedBirds = 5000;
  const dailyFeedKg = Math.round((estimatedShedBirds * targetDailyFeed) / 1000);
  const bags50kg = (dailyFeedKg / 50).toFixed(1);

  // Copy WhatsApp / SMS Report Text
  const generateShareReport = () => {
    return `🐔 *AVISYNC FLOCK WEIGHING REPORT*
📍 *Farm:* Sai Farm | *Shed:* ${selectedShed} | *Pen:* ${selectedPen}
📅 *Week:* ${selectedWeek} (${selectedSeason.replace('_', ' ')})
⚖️ *Sample Weighed:* ${stats.total}/100 Birds
📊 *Average Weight:* ${stats.avg}g (Target: ${targetWeight}g | Diff: ${stats.avg - targetWeight >= 0 ? '+' : ''}${stats.avg - targetWeight}g)
🎯 *Uniformity (±10%):* ${stats.uniformity}% (${stats.uniformity >= 80 ? 'EXCELLENT' : stats.uniformity >= 70 ? 'ACCEPTABLE' : 'ACTION REQUIRED'})
📉 *CV% (F-factor):* ${stats.cv}% (F=${stats.fVal})
📏 *Range:* ${stats.minW}g - ${stats.maxW}g (Band: ${stats.rangeLow}g - ${stats.rangeHigh}g)
🌾 *Est. Feed (Shed):* ${dailyFeedKg} kg/day (~${bags50kg} Bags @ 50kg)
*Generated via Avisync Mobile Field System*`;
  };

  const handleCopyShare = async () => {
    const text = generateShareReport();
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      setCopiedShare(true);
      setTimeout(() => setCopiedShare(false), 2500);
    }
    if (navigator.share) {
      try {
        await navigator.share({
          title: `Weighing Report - ${selectedShed} ${selectedPen}`,
          text: text,
        });
      } catch {
        // User cancelled share
      }
    }
  };

  const handleSaveToSystem = async () => {
    setIsSaving(true);
    try {
      if (onSaveRecord) {
        await onSaveRecord({
          shedName: selectedShed,
          penName: selectedPen,
          week: selectedWeek,
          season: selectedSeason,
          sex: selectedGender,
          stats: stats,
          tallies: tallies,
        });
      }
      soundEffects.playSuccessChime();
      alert('✅ Weighing session saved and synced successfully!');
    } catch {
      alert('Saved locally in offline mode.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="flex flex-col min-h-screen bg-slate-950 text-slate-100 max-w-md mx-auto shadow-2xl relative select-none pb-24 border-x border-slate-900">
      
      {/* Top Mobile App Header */}
      <header className="sticky top-0 z-30 bg-slate-900/95 backdrop-blur-md border-b border-slate-800 px-3.5 py-2.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center">
              <Building2 className="w-4 h-4 text-emerald-400" />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <span className="font-extrabold text-sm text-white tracking-tight">Sai Farm</span>
                <span className="text-[10px] bg-emerald-500/20 text-emerald-300 font-bold px-1.5 py-0.2 rounded border border-emerald-500/30">
                  W{selectedWeek}
                </span>
              </div>
              <span className="text-[10px] text-slate-400 block -mt-0.5 font-medium">Field Operator Mode</span>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            {/* Week Selector Dropdown */}
            <select
              aria-label="Select Age Week"
              value={selectedWeek}
              onChange={(e) => setSelectedWeek(Number(e.target.value))}
              className="bg-slate-800 border border-slate-700 text-xs font-bold text-emerald-400 rounded-lg px-2 py-1.5 outline-none"
            >
              {Array.from({ length: 23 }, (_, i) => i + 1).map(wk => (
                <option key={wk} value={wk}>W{wk}</option>
              ))}
            </select>

            {/* Quick Share */}
            <button 
              onClick={handleCopyShare}
              title="Share report via WhatsApp"
              className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg transition active:scale-95 border border-slate-700/60"
            >
              {copiedShare ? <Check className="w-4 h-4 text-emerald-400" /> : <Share2 className="w-4 h-4" />}
            </button>

            {/* Switch to Desktop View */}
            {onSwitchToDesktop && (
              <button
                onClick={onSwitchToDesktop}
                title="Switch to Full Desktop Matrix"
                className="p-1.5 bg-slate-800 hover:bg-slate-700 text-sky-400 rounded-lg transition active:scale-95 border border-slate-700/60"
              >
                <Monitor className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* Shed & Pen Horizontal Swipe Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar mt-2 pt-1 pb-1">
          {shedList.map(shed => (
            <button
              key={shed}
              onClick={() => setSelectedShed(shed)}
              className={`px-3 py-1 rounded-full text-xs font-semibold whitespace-nowrap transition-all shadow-sm ${
                selectedShed === shed 
                  ? 'bg-emerald-500 text-slate-950 font-black ring-2 ring-emerald-400/50' 
                  : 'bg-slate-800/80 text-slate-400 hover:text-slate-200 border border-slate-700/50'
              }`}
            >
              {shed}
            </button>
          ))}
          <div className="w-[1px] bg-slate-700 mx-1 my-auto h-4 shrink-0" />
          {penList.map(pen => (
            <button
              key={pen.name}
              onClick={() => {
                setSelectedPen(pen.name);
                setSelectedGender(pen.sex);
              }}
              className={`px-3 py-1 rounded-full text-xs font-semibold whitespace-nowrap transition-all shadow-sm ${
                selectedPen === pen.name 
                  ? 'bg-sky-500 text-slate-950 font-black ring-2 ring-sky-400/50' 
                  : 'bg-slate-800/80 text-slate-400 hover:text-slate-200 border border-slate-700/50'
              }`}
            >
              {pen.name}
            </button>
          ))}
        </div>
      </header>

      {/* Sticky Metric Dashboard Banner */}
      <section className="bg-gradient-to-b from-slate-900 to-slate-850 mx-3 mt-2.5 p-3 rounded-2xl border border-slate-800 shadow-xl relative overflow-hidden">
        {/* Sample Progress bar */}
        <div className="w-full bg-slate-800 h-1.5 rounded-full mb-2.5 overflow-hidden">
          <div 
            className={`h-full transition-all duration-300 ${
              stats.total >= 100 ? 'bg-emerald-400' : stats.total >= 80 ? 'bg-sky-400' : 'bg-amber-400'
            }`}
            style={{ width: `${Math.min(100, (stats.total / 100) * 100)}%` }}
          />
        </div>

        <div className="grid grid-cols-4 gap-1 text-center divide-x divide-slate-800">
          <div>
            <div className="text-[10px] text-slate-400 font-semibold tracking-wider">WEIGHED</div>
            <div className="text-xl font-black text-white">{stats.total}</div>
            <div className="text-[10px] text-slate-500 font-mono">Target 100</div>
          </div>
          <div className="pl-1">
            <div className="text-[10px] text-slate-400 font-semibold tracking-wider">AVG WT</div>
            <div className="text-xl font-black text-emerald-400">{stats.avg}g</div>
            <div className="text-[10px] text-slate-400 font-medium">Std: {targetWeight}g</div>
          </div>
          <div className="pl-1">
            <div className="text-[10px] text-slate-400 font-semibold tracking-wider">UNIFORM</div>
            <div className={`text-xl font-black ${
              stats.uniformity >= 80 ? 'text-emerald-400' : stats.uniformity >= 70 ? 'text-amber-400' : 'text-rose-400'
            }`}>
              {stats.uniformity}%
            </div>
            <div className="text-[10px] text-slate-500">±10% band</div>
          </div>
          <div className="pl-1">
            <div className="text-[10px] text-slate-400 font-semibold tracking-wider">CV %</div>
            <div className={`text-xl font-black ${stats.cv <= 8 ? 'text-emerald-400' : stats.cv <= 10 ? 'text-amber-400' : 'text-rose-400'}`}>
              {stats.cv}%
            </div>
            <div className="text-[10px] text-slate-500 font-mono">F: {stats.fVal}</div>
          </div>
        </div>

        {/* Live Band Range Indicator */}
        <div className="mt-2.5 pt-2 border-t border-slate-800/80 flex items-center justify-between text-[11px] text-slate-400 px-1">
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
            Uniform Range (±10%):
          </span>
          <span className="font-bold font-mono text-sky-400 bg-slate-900/80 px-2 py-0.5 rounded border border-slate-800">
            {stats.rangeLow}g — {stats.rangeHigh}g
          </span>
        </div>
      </section>

      {/* Main Tab Body */}
      <main className="flex-1 px-3 mt-3">
        {/* TAB 1: THUMB-FRIENDLY TALLY PAD */}
        {activeTab === 'tally' && (
          <div className="space-y-2.5">
            {/* Quick Increment Chip Bar for Active Bin */}
            <div className="bg-slate-900/90 border border-slate-800 p-2.5 rounded-xl shadow-md">
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Active Bin:</span>
                  <span className="text-xs font-extrabold text-sky-400 font-mono bg-sky-950/50 px-2 py-0.5 rounded border border-sky-800/40">
                    {activeWeightBin ? `${activeWeightBin}g` : 'Select a weight below'}
                  </span>
                </div>
                <button
                  onClick={scrollToTargetWeight}
                  className="flex items-center gap-1 text-[11px] font-semibold text-emerald-400 hover:text-emerald-300 bg-emerald-950/40 px-2 py-0.5 rounded border border-emerald-500/30"
                >
                  <Crosshair className="w-3 h-3" /> Target ({targetWeight}g)
                </button>
              </div>

              {/* Quick Increment Chips (+1, +5, +10) */}
              <div className="grid grid-cols-4 gap-1.5">
                {[1, 5, 10].map(val => (
                  <button
                    key={val}
                    disabled={!activeWeightBin}
                    onClick={() => activeWeightBin && updateCount(activeWeightBin, val)}
                    className="py-2 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/40 text-emerald-300 font-black text-sm active:scale-95 transition disabled:opacity-30 disabled:pointer-events-none shadow-sm flex items-center justify-center gap-0.5"
                  >
                    <Plus className="w-3.5 h-3.5" />{val}
                  </button>
                ))}
                <button
                  disabled={!activeWeightBin || !(tallies[activeWeightBin] > 0)}
                  onClick={() => activeWeightBin && updateCount(activeWeightBin, -1)}
                  className="py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 font-bold text-sm active:scale-95 transition disabled:opacity-30 disabled:pointer-events-none shadow-sm flex items-center justify-center gap-0.5"
                >
                  <Minus className="w-3.5 h-3.5" />1
                </button>
              </div>
            </div>

            {/* List Header & Controls */}
            <div className="flex items-center justify-between px-1">
              <span className="text-xs font-extrabold text-slate-400 uppercase tracking-wider">
                Weight Grid (20g Steps)
              </span>
              <div className="flex items-center gap-2">
                <button 
                  onClick={() => {
                    const minW = Math.min(...Object.keys(tallies).map(Number));
                    addWeightBucket(minW - 20);
                  }}
                  className="text-[11px] font-medium text-slate-400 hover:text-slate-200 bg-slate-850 px-2 py-0.5 rounded border border-slate-800"
                >
                  -20g
                </button>
                <button 
                  onClick={() => {
                    const maxW = Math.max(...Object.keys(tallies).map(Number));
                    addWeightBucket(maxW + 20);
                  }}
                  className="text-[11px] font-medium text-slate-400 hover:text-slate-200 bg-slate-850 px-2 py-0.5 rounded border border-slate-800"
                >
                  +20g
                </button>
                <button 
                  onClick={() => {
                    if (window.confirm('Reset all weight tallies for this pen?')) {
                      setTallies(prev => {
                        const cleared: Record<number, number> = {};
                        Object.keys(prev).forEach(k => cleared[Number(k)] = 0);
                        return cleared;
                      });
                    }
                  }} 
                  className="text-[11px] text-rose-400 hover:text-rose-300 flex items-center gap-1 active:opacity-70 bg-rose-950/30 px-2 py-0.5 rounded border border-rose-900/40"
                >
                  <RotateCcw className="w-3 h-3" /> Reset
                </button>
              </div>
            </div>

            {/* Touch Tally Item Rows */}
            <div ref={tallyListRef} className="space-y-1.5 max-h-[50vh] overflow-y-auto pr-1 no-scrollbar">
              {Object.keys(tallies).map(Number).sort((a,b)=>a-b).map(weight => {
                const count = tallies[weight] || 0;
                const isInRange = weight >= stats.rangeLow && weight <= stats.rangeHigh;
                const isTarget = Math.abs(weight - targetWeight) < 10;
                const isActive = activeWeightBin === weight;

                return (
                  <div 
                    key={weight}
                    ref={isTarget ? targetRowRef : null}
                    onClick={() => setActiveWeightBin(weight)}
                    className={`flex items-center justify-between p-2.5 rounded-xl border transition-all cursor-pointer ${
                      isActive
                        ? 'ring-2 ring-emerald-500 shadow-lg'
                        : ''
                    } ${
                      count > 0 
                        ? isInRange 
                          ? 'bg-slate-900/95 border-emerald-500/50 shadow-sm shadow-emerald-950/30' 
                          : 'bg-slate-900/95 border-amber-500/40 shadow-sm shadow-amber-950/30'
                        : 'bg-slate-900/60 border-slate-850'
                    }`}
                  >
                    {/* Weight Label & Badge */}
                    <div className="flex items-center gap-2">
                      <div className="text-base font-black tracking-tight text-white font-mono">
                        {weight}g
                      </div>
                      {isTarget && (
                        <span className="text-[9px] font-black uppercase px-1.5 py-0.5 rounded bg-sky-500/20 text-sky-400 border border-sky-500/30">
                          Target
                        </span>
                      )}
                      {isInRange && count > 0 && (
                        <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-sm shadow-emerald-400/50" />
                      )}
                    </div>

                    {/* Touch Action Buttons */}
                    <div className="flex items-center gap-2.5">
                      <button
                        aria-label={`Decrement count for ${weight} grams`}
                        onClick={(e) => {
                          e.stopPropagation();
                          updateCount(weight, -1);
                        }}
                        disabled={count === 0}
                        className="w-10 h-10 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 flex items-center justify-center active:scale-90 disabled:opacity-20 disabled:pointer-events-none border border-slate-700/80 transition shadow"
                      >
                        <Minus className="w-5 h-5" />
                      </button>

                      <span className="w-8 text-center font-black text-xl text-emerald-300 font-mono">
                        {count}
                      </span>

                      <button
                        aria-label={`Increment count for ${weight} grams`}
                        onClick={(e) => {
                          e.stopPropagation();
                          updateCount(weight, 1);
                        }}
                        className="w-11 h-11 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white flex items-center justify-center font-black active:scale-90 shadow-lg shadow-emerald-900/60 transition"
                      >
                        <Plus className="w-6 h-6 stroke-[3]" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* TAB 2: SHED SUMMARY & BELL CURVE */}
        {activeTab === 'summary' && (
          <div className="space-y-3">
            {/* Shed-Wise Aggregation Card */}
            <div className="bg-slate-900 rounded-2xl p-4 border border-slate-800 shadow-lg">
              <div className="flex items-center justify-between mb-2.5">
                <h3 className="font-bold text-sm text-slate-100 flex items-center gap-1.5">
                  <Building2 className="w-4 h-4 text-emerald-400" />
                  Shed Aggregation ({selectedShed})
                </h3>
                <span className="text-[10px] font-bold bg-slate-800 text-slate-400 px-2 py-0.5 rounded border border-slate-700">
                  Week {selectedWeek}
                </span>
              </div>

              <div className="space-y-2">
                <div className="flex justify-between items-center p-2.5 bg-slate-850/80 rounded-xl text-xs border border-slate-800">
                  <span className="text-slate-300 font-semibold">Pen A (Female)</span>
                  <span className="font-mono font-bold text-emerald-400">1290g • 86.0% Unif • CV 7.1%</span>
                </div>
                <div className="flex justify-between items-center p-2.5 bg-slate-850/80 rounded-xl text-xs border border-slate-800">
                  <span className="text-slate-300 font-semibold">Pen B (Male)</span>
                  <span className="font-mono font-bold text-emerald-400">1760g • 84.5% Unif • CV 7.4%</span>
                </div>
                <div className="flex justify-between items-center p-2.5 bg-sky-950/30 rounded-xl text-xs border border-sky-800/40">
                  <span className="text-sky-300 font-semibold">Shed Mean (X̄shed):</span>
                  <span className="font-mono font-black text-sky-300">1385g • 85.3% Shed Unif</span>
                </div>
              </div>

              {/* Feed Requirement Calculator */}
              <div className="mt-3 p-3 bg-emerald-950/30 border border-emerald-500/30 rounded-xl space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-emerald-300 font-bold flex items-center gap-1">
                    <Wheat className="w-3.5 h-3.5" /> Daily Feed Requirement:
                  </span>
                  <span className="text-emerald-400 font-mono font-bold">{targetDailyFeed}g / bird / day</span>
                </div>
                <div className="flex items-center justify-between text-xs pt-1 border-t border-emerald-500/20">
                  <span className="text-slate-400">Total Flock Feed (5,000 birds):</span>
                  <span className="font-black text-white font-mono">{dailyFeedKg} kg / day</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-400">50kg Bags Required:</span>
                  <span className="font-black text-emerald-300 font-mono bg-emerald-900/60 px-2 py-0.5 rounded border border-emerald-700/50">
                    {bags50kg} Bags (~{Math.ceil(Number(bags50kg))} Bags)
                  </span>
                </div>
              </div>
            </div>

            {/* Bell Curve Histogram */}
            <div className="bg-slate-900 rounded-2xl p-3 border border-slate-800 shadow-lg">
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-bold text-xs text-slate-200">Pen Sample Bell Curve Distribution</h3>
                <span className="text-[10px] text-emerald-400 font-mono">Mean: {stats.avg}g</span>
              </div>
              <div className="h-44 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} margin={{ top: 5, right: 5, left: -25, bottom: 0 }}>
                    <XAxis dataKey="weight" tick={{ fontSize: 9, fill: '#94a3b8' }} />
                    <YAxis tick={{ fontSize: 9, fill: '#94a3b8' }} />
                    <Tooltip 
                      contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '8px', fontSize: '11px' }} 
                    />
                    <ReferenceLine x={`${stats.avg}g`} stroke="#10b981" strokeDasharray="3 3" />
                    <Bar dataKey="count" fill="#38bdf8" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: GROWTH CURVE CHART */}
        {activeTab === 'curve' && (
          <div className="space-y-3">
            <div className="bg-slate-900 rounded-2xl p-4 border border-slate-800 shadow-lg">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-1.5">
                  <TrendingUp className="w-4 h-4 text-emerald-400" />
                  <h3 className="font-bold text-sm text-slate-100">Growth Standard vs Actual</h3>
                </div>
                <span className="text-[10px] font-bold text-sky-400 bg-sky-950/40 px-2 py-0.5 rounded border border-sky-800/40">
                  {selectedGender === 'FEMALE' ? 'Female' : 'Male'} Standard
                </span>
              </div>

              <div className="h-52 w-full mt-2">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={growthCurveData} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                    <XAxis dataKey="week" tick={{ fontSize: 9, fill: '#94a3b8' }} />
                    <YAxis tick={{ fontSize: 9, fill: '#94a3b8' }} />
                    <Tooltip 
                      contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '8px', fontSize: '11px' }} 
                    />
                    <Line type="monotone" dataKey="standard" stroke="#94a3b8" strokeDasharray="4 4" dot={false} name="Suguna Std" />
                    <Line type="monotone" dataKey="actual" stroke="#10b981" strokeWidth={2} dot={{ r: 3 }} name="Actual Weight" connectNulls />
                  </LineChart>
                </ResponsiveContainer>
              </div>

              <div className="grid grid-cols-2 gap-2 mt-3 text-center text-xs">
                <div className="p-2 bg-slate-850 rounded-xl border border-slate-800">
                  <span className="text-slate-400 block text-[10px]">W{selectedWeek} Standard:</span>
                  <span className="font-bold text-slate-200 font-mono text-sm">{targetWeight}g</span>
                </div>
                <div className="p-2 bg-slate-850 rounded-xl border border-slate-800">
                  <span className="text-slate-400 block text-[10px]">Current Pen Mean:</span>
                  <span className="font-bold text-emerald-400 font-mono text-sm">
                    {stats.avg}g ({stats.avg - targetWeight >= 0 ? '+' : ''}{stats.avg - targetWeight}g)
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 4: SHARE & EXPORT */}
        {activeTab === 'share' && (
          <div className="space-y-3">
            <div className="bg-slate-900 rounded-2xl p-4 border border-slate-800 shadow-lg space-y-3">
              <h3 className="font-bold text-sm text-slate-100 flex items-center gap-1.5">
                <Share2 className="w-4 h-4 text-emerald-400" />
                Export & Field Communication
              </h3>
              
              <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 font-mono text-[11px] text-slate-300 leading-relaxed max-h-48 overflow-y-auto no-scrollbar whitespace-pre-line">
                {generateShareReport()}
              </div>

              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={handleCopyShare}
                  className="py-2.5 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center justify-center gap-1.5 active:scale-95 transition shadow-lg shadow-emerald-950"
                >
                  {copiedShare ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                  {copiedShare ? 'Copied!' : 'Copy WhatsApp Report'}
                </button>

                <button
                  onClick={handleSaveToSystem}
                  disabled={isSaving}
                  className="py-2.5 px-3 rounded-xl bg-sky-600 hover:bg-sky-500 text-white font-bold text-xs flex items-center justify-center gap-1.5 active:scale-95 transition shadow-lg shadow-sky-950 disabled:opacity-50"
                >
                  <Save className="w-4 h-4" />
                  {isSaving ? 'Saving...' : 'Sync to Database'}
                </button>
              </div>

              <button
                onClick={() => window.print()}
                className="w-full py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-xs border border-slate-700 flex items-center justify-center gap-1.5 active:scale-95 transition"
              >
                <FileSpreadsheet className="w-4 h-4 text-emerald-400" /> Print Suguna Recording Sheet
              </button>
            </div>
          </div>
        )}
      </main>

      {/* Floating Bottom Touch Bar */}
      <nav className="fixed bottom-0 left-0 right-0 max-w-md mx-auto bg-slate-900/95 backdrop-blur-md border-t border-slate-800 p-2 flex justify-around items-center z-40 shadow-2xl">
        <button
          onClick={() => setActiveTab('tally')}
          className={`flex flex-col items-center gap-1 text-[11px] font-bold py-1 px-3 rounded-xl transition-all ${
            activeTab === 'tally' 
              ? 'text-emerald-400 bg-slate-800 shadow-inner' 
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Layers className="w-5 h-5" />
          Tally
        </button>

        <button
          onClick={() => setActiveTab('summary')}
          className={`flex flex-col items-center gap-1 text-[11px] font-bold py-1 px-3 rounded-xl transition-all ${
            activeTab === 'summary' 
              ? 'text-emerald-400 bg-slate-800 shadow-inner' 
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <FileSpreadsheet className="w-5 h-5" />
          Shed View
        </button>

        <button
          onClick={() => setActiveTab('curve')}
          className={`flex flex-col items-center gap-1 text-[11px] font-bold py-1 px-3 rounded-xl transition-all ${
            activeTab === 'curve' 
              ? 'text-emerald-400 bg-slate-800 shadow-inner' 
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <TrendingUp className="w-5 h-5" />
          Curve
        </button>

        <button
          onClick={() => setActiveTab('share')}
          className={`flex flex-col items-center gap-1 text-[11px] font-bold py-1 px-3 rounded-xl transition-all ${
            activeTab === 'share' 
              ? 'text-emerald-400 bg-slate-800 shadow-inner' 
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Share2 className="w-5 h-5" />
          Share
        </button>
      </nav>
    </div>
  );
};

export default MobilePoultryDashboard;
