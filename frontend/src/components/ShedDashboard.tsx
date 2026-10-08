import React, { useState, useEffect } from 'react';
import {
  Home,
  Layers,
  Scale,
  Award,
  TrendingUp,
  Utensils,
  AlertTriangle,
  CheckCircle2,
  Download,
  Printer,
  ChevronDown,
  Plus,
  RefreshCw,
  GitCompare,
  ArrowRight,
  Target
} from 'lucide-react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
  CartesianGrid,
  Legend,
  Cell
} from 'recharts';
import { Shed, ShedSummaryData, ShedComparisonItem, Flock } from '../types';
import { api } from '../services/api';
import { GrowthChart } from './GrowthChart';
import { getClientBenchmarkForWeek } from '../services/benchmarks';

export interface ShedDashboardProps {
  sheds: Shed[];
  activeShed: Shed | null;
  onSelectShed: (shed: Shed) => void;
  onOpenWeighPen: (penId: string) => void;
  onOpenShedSetup: () => void;
  onPrintShedReport: (shed: Shed, summary: ShedSummaryData, week: number) => void;
}

export const ShedDashboard: React.FC<ShedDashboardProps> = ({
  sheds,
  activeShed,
  onSelectShed,
  onOpenWeighPen,
  onOpenShedSetup,
  onPrintShedReport,
}) => {
  const [selectedWeek, setSelectedWeek] = useState<number>(12);
  const [summaryData, setSummaryData] = useState<ShedSummaryData | null>(null);
  const [comparisons, setComparisons] = useState<ShedComparisonItem[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [showComparisonView, setShowComparisonView] = useState<boolean>(false);

  // Load summary for active shed & week
  const loadSummary = async () => {
    if (!activeShed) return;
    setIsLoading(true);
    try {
      const res = await api.getShedSummary(activeShed.id, selectedWeek);
      setSummaryData(res.summary);

      const comp = await api.compareAllSheds(selectedWeek);
      setComparisons(comp);
    } catch (err) {
      console.warn('Error loading shed summary:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadSummary();
  }, [activeShed?.id, selectedWeek]);

  if (!activeShed) {
    return (
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 text-center text-slate-400">
        <Home className="w-10 h-10 text-emerald-400 mx-auto mb-3" />
        <p className="text-base font-semibold text-slate-200">No Shed Selected</p>
        <p className="text-xs text-slate-500 mt-1">Configure your farm houses and pens to view shed-wise analytics.</p>
        <button
          onClick={onOpenShedSetup}
          className="mt-4 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition"
        >
          Setup Farm Sheds
        </button>
      </div>
    );
  }

  const s = summaryData;

  // Compute benchmark target for the active shed at this audit week
  const benchmarkTarget = getClientBenchmarkForWeek(activeShed.season, 'FEMALE', selectedWeek);
  const targetDiffGrams = s && s.shedAverageWeight > 0 ? (s.shedAverageWeight - benchmarkTarget.targetWeight).toFixed(1) : null;
  const targetDiffPercent = s && s.shedAverageWeight > 0 && benchmarkTarget.targetWeight > 0
    ? (((s.shedAverageWeight - benchmarkTarget.targetWeight) / benchmarkTarget.targetWeight) * 100).toFixed(1)
    : null;

  const handleDownloadCsv = () => {
    if (!s) return;
    const url = api.getExportShedCsvUrl(activeShed.id, selectedWeek);
    window.open(url, '_blank');
  };

  return (
    <div className="space-y-6">
      {/* 1. SHED SELECTOR & AUDIT HEADER */}
      <div className="bg-gradient-to-br from-slate-900 via-slate-900 to-slate-800/90 border border-slate-800 rounded-2xl p-6 shadow-xl relative overflow-hidden">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs uppercase tracking-wider px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 font-bold border border-emerald-500/30">
                Shed-Wise Architecture
              </span>
              <span className="text-xs text-slate-400">
                {activeShed.season === 'WINTER_BROOD_SUMMER_LAY' ? 'Winter Brood Curve (Aug - Jan)' : 'Summer Brood Curve (Feb - Jul)'}
              </span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight flex items-center gap-3">
              <span>{activeShed.shedName}</span>
              <span className="text-xs font-mono font-normal px-2.5 py-1 rounded-full bg-slate-800 border border-slate-700 text-slate-300">
                {activeShed.farmName || 'Suguna Breeder Complex Unit 4'}
              </span>
            </h1>
            <p className="text-xs text-slate-400 mt-1">
              Multi-Pen Aggregated Body Weight, Uniformity Distribution & Feed Authorizations
            </p>
          </div>

          {/* Quick Selectors & Actions */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Shed Selector */}
            <div className="relative">
              <select
                value={activeShed.id}
                onChange={(e) => {
                  const found = sheds.find((sh) => sh.id === e.target.value);
                  if (found) onSelectShed(found);
                }}
                className="bg-slate-950 border border-slate-700 text-slate-200 text-xs rounded-xl px-3 py-2 font-medium focus:outline-none focus:border-emerald-500 pr-8"
              >
                {sheds.map((sh) => (
                  <option key={sh.id} value={sh.id}>
                    {sh.shedName}
                  </option>
                ))}
              </select>
              <ChevronDown className="w-3.5 h-3.5 text-slate-400 absolute right-2.5 top-2.5 pointer-events-none" />
            </div>

            {/* Audit Week Selector */}
            <div className="flex items-center gap-1.5 bg-slate-950 border border-slate-700 rounded-xl px-2.5 py-1.5 text-xs text-slate-300">
              <span className="text-slate-400 font-medium">Audit Age:</span>
              <select
                value={selectedWeek}
                onChange={(e) => setSelectedWeek(Number(e.target.value))}
                className="bg-transparent font-bold text-emerald-400 focus:outline-none"
              >
                {Array.from({ length: 23 }, (_, i) => i + 1).map((w) => (
                  <option key={w} value={w} className="bg-slate-900 text-white">
                    Week {w}
                  </option>
                ))}
              </select>
            </div>

            <button
              onClick={() => setShowComparisonView(!showComparisonView)}
              className={`px-3 py-2 rounded-xl text-xs font-semibold transition border flex items-center gap-1.5 ${
                showComparisonView
                  ? 'bg-purple-600 text-white border-purple-500 shadow'
                  : 'bg-slate-800 text-slate-300 border-slate-700 hover:text-white'
              }`}
            >
              <GitCompare className="w-3.5 h-3.5" />
              <span>Multi-Shed Compare</span>
            </button>

            <button
              onClick={onOpenShedSetup}
              className="px-3 py-2 rounded-xl text-xs font-bold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition flex items-center gap-1.5"
            >
              <Plus className="w-3.5 h-3.5 text-emerald-400" />
              <span>Setup / Add Pen</span>
            </button>
          </div>
        </div>
      </div>

      {/* MULTI-SHED COMPARISON DRAWER (if toggled) */}
      {showComparisonView && (
        <div className="bg-slate-900 border border-purple-500/30 rounded-2xl p-5 shadow-2xl animate-fade-in">
          <div className="flex items-center justify-between pb-3 border-b border-slate-800">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <GitCompare className="w-4 h-4 text-purple-400" />
              <span>Cross-Shed Performance Benchmark (Week {selectedWeek})</span>
            </h3>
            <span className="text-xs text-slate-400">Comparing all active grower houses</span>
          </div>

          <div className="overflow-x-auto mt-3">
            <table className="w-full text-xs text-left">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400 uppercase font-semibold">
                  <th className="py-2.5 px-3">Shed / House</th>
                  <th className="py-2.5 px-3 text-center">Pens</th>
                  <th className="py-2.5 px-3 text-right">Live Population</th>
                  <th className="py-2.5 px-3 text-right">Sampled (N)</th>
                  <th className="py-2.5 px-3 text-right">Shed Mean (x̄)</th>
                  <th className="py-2.5 px-3 text-center">Uniformity (±10%)</th>
                  <th className="py-2.5 px-3 text-center">Status</th>
                  <th className="py-2.5 px-3 text-right">Daily Feed (kg)</th>
                  <th className="py-2.5 px-3 text-right">50kg Bags</th>
                  <th className="py-2.5 px-3 text-center">Deviating Pens</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-mono">
                {comparisons.map((c) => (
                  <tr
                    key={c.shedId}
                    className={`transition ${c.shedId === activeShed.id ? 'bg-purple-950/30 font-bold' : 'hover:bg-slate-800/40'}`}
                  >
                    <td className="py-2.5 px-3 text-white flex items-center gap-2 font-sans">
                      <span>{c.shedName}</span>
                      {c.shedId === activeShed.id && (
                        <span className="text-[10px] px-1.5 py-0.2 rounded bg-purple-500/20 text-purple-300">Active</span>
                      )}
                    </td>
                    <td className="py-2.5 px-3 text-center">{c.totalPens}</td>
                    <td className="py-2.5 px-3 text-right text-slate-300">{c.totalLiveBirds.toLocaleString()}</td>
                    <td className="py-2.5 px-3 text-right text-slate-400">{c.totalSampleBirdsWeighed}</td>
                    <td className="py-2.5 px-3 text-right font-bold text-sky-400">{c.shedAverageWeight}g</td>
                    <td className="py-2.5 px-3 text-center font-bold text-emerald-400">{c.shedUniformityPercent}%</td>
                    <td className="py-2.5 px-3 text-center font-sans">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                        c.shedStatus === 'EXCELLENT' ? 'bg-emerald-500/20 text-emerald-300' :
                        c.shedStatus === 'ACCEPTABLE' ? 'bg-amber-500/20 text-amber-300' : 'bg-rose-500/20 text-rose-300'
                      }`}>
                        {c.shedStatus}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-right text-amber-300">{c.totalDailyFeedKg} kg</td>
                    <td className="py-2.5 px-3 text-right text-slate-300">{c.totalFeedBags50kg}</td>
                    <td className="py-2.5 px-3 text-center">
                      {c.deviatingPensCount > 0 ? (
                        <span className="text-rose-400 font-bold">{c.deviatingPensCount} pens (&gt;5%)</span>
                      ) : (
                        <span className="text-emerald-400 font-semibold">0 (Uniform)</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 2. 5 SHED-WISE AGGREGATED KPI STAT CARDS */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        {/* KPI 1: Shed Overall Weighted Average Weight */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-xl relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400">Shed Overall Avg Weight</span>
            <div className="w-8 h-8 rounded-lg bg-sky-500/10 text-sky-400 flex items-center justify-center">
              <Scale className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-black text-white font-mono">
                {s ? s.shedAverageWeight : '--'}
              </span>
              <span className="text-sm font-semibold text-slate-400">g</span>
            </div>
            <div className="flex items-center justify-between text-xs mt-2 pt-2 border-t border-slate-800/80">
              <span className="text-slate-400">Sample: {s ? s.totalSampleBirdsWeighed : 0} birds</span>
              <span className="text-sky-400 font-mono text-[10px]">
                ±10%: [{s?.shedLowerLimit10Pct || 0}g - {s?.shedUpperLimit10Pct || 0}g]
              </span>
            </div>
          </div>
        </div>

        {/* KPI 2: Target Avg Weight */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-xl relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400">Target Avg Weight</span>
            <div className="w-8 h-8 rounded-lg bg-emerald-500/10 text-emerald-400 flex items-center justify-center">
              <Target className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-black text-emerald-400 font-mono">
                {benchmarkTarget.targetWeight}
              </span>
              <span className="text-sm font-semibold text-slate-400">g</span>
            </div>
            <div className="flex items-center justify-between text-xs mt-2 pt-2 border-t border-slate-800/80">
              <span className="text-slate-400">Week {selectedWeek} Benchmark:</span>
              <span className={`font-mono font-bold text-[11px] ${
                targetDiffGrams && Number(targetDiffGrams) >= 0 ? 'text-emerald-400' : 'text-rose-400'
              }`}>
                {targetDiffGrams ? `${Number(targetDiffGrams) >= 0 ? '+' : ''}${targetDiffGrams}g (${Number(targetDiffPercent) >= 0 ? '+' : ''}${targetDiffPercent}%)` : '--'}
              </span>
            </div>
          </div>
        </div>

        {/* KPI 3: Shed-Wise Overall Uniformity % */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-xl relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400">Shed Uniformity %</span>
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
              s && s.shedUniformityPercent >= 80 ? 'bg-emerald-500/10 text-emerald-400' :
              s && s.shedUniformityPercent >= 70 ? 'bg-amber-500/10 text-amber-400' : 'bg-rose-500/10 text-rose-400'
            }`}>
              <Award className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            <div className="flex items-baseline gap-2">
              <span className={`text-3xl font-black font-mono ${
                s && s.shedUniformityPercent >= 80 ? 'text-emerald-400' :
                s && s.shedUniformityPercent >= 70 ? 'text-amber-400' : 'text-rose-400'
              }`}>
                {s ? `${s.shedUniformityPercent}%` : '--'}
              </span>
              <span className={`text-[10px] uppercase font-extrabold tracking-wider px-2 py-0.5 rounded ${
                s && s.shedUniformityPercent >= 80 ? 'bg-emerald-500/20 text-emerald-300' :
                s && s.shedUniformityPercent >= 70 ? 'bg-amber-500/20 text-amber-300' : 'bg-rose-500/20 text-rose-300'
              }`}>
                {s ? s.shedStatus : 'NO DATA'}
              </span>
            </div>
            <div className="flex items-center justify-between text-xs mt-2 pt-2 border-t border-slate-800/80">
              <span className="text-slate-400">In Band: {s ? s.shedBirdsInUniformRange : 0}</span>
              <span className="text-slate-400">{s?.totalPens || 0} Pens Total</span>
            </div>
          </div>
        </div>

        {/* KPI 4: Live Bird Population */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-xl relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400">Total Live Birds</span>
            <div className="w-8 h-8 rounded-lg bg-teal-500/10 text-teal-400 flex items-center justify-center">
              <Home className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-black text-white font-mono">
                {s ? s.totalLiveBirds.toLocaleString() : '--'}
              </span>
              <span className="text-sm font-semibold text-slate-400">birds</span>
            </div>
            <div className="flex items-center justify-between text-xs mt-2 pt-2 border-t border-slate-800/80">
              <span className="text-slate-400">Sampling Rate:</span>
              <span className="text-emerald-400 font-mono font-semibold">
                {s && s.totalLiveBirds > 0 ? ((s.totalSampleBirdsWeighed / s.totalLiveBirds) * 100).toFixed(1) : 0}%
              </span>
            </div>
          </div>
        </div>

        {/* KPI 5: Total Daily Feed for Shed (kg & Bags) */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-xl relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400">Total Daily Feed</span>
            <div className="w-8 h-8 rounded-lg bg-amber-500/10 text-amber-400 flex items-center justify-center">
              <Utensils className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-black text-amber-300 font-mono">
                {s ? s.totalDailyFeedKg : '--'}
              </span>
              <span className="text-sm font-semibold text-slate-400">kg</span>
            </div>
            <div className="flex items-center justify-between text-xs mt-2 pt-2 border-t border-slate-800/80">
              <span className="text-slate-400">50kg Feed Bags:</span>
              <span className="font-bold text-amber-400 font-mono">
                {s ? `${s.totalFeedBags50kg} bags` : '--'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* 3. PEN DEVIATION ALERTS (HIGHLIGHTS PENS DEVIATING >5% FROM SHED MEAN) */}
      {s && s.alerts.length > 0 && (
        <div className="p-4 rounded-2xl border bg-amber-950/40 border-amber-500/30 text-amber-200">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-400 mt-0.5 flex-shrink-0" />
            <div className="space-y-1 text-xs flex-1">
              <div className="flex items-center justify-between">
                <h4 className="font-bold text-sm text-white">
                  Pen Deviation Warning ({s.alerts.length} Pen{s.alerts.length > 1 ? 's' : ''} Exceeding ±5% Threshold)
                </h4>
                <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-black/40 text-amber-300">
                  Shed Mean: {s.shedAverageWeight}g
                </span>
              </div>
              {s.alerts.map((msg, i) => (
                <p key={i} className="text-slate-300 leading-relaxed font-sans">
                  • {msg}
                </p>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 4. PEN BREAKDOWN TABLE (SIDE-BY-SIDE COMPARISON) */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-xl">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-slate-800 gap-2">
          <div>
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <Layers className="w-4 h-4 text-emerald-400" />
              <span>Pen-by-Pen Comparative Breakdown</span>
            </h3>
            <p className="text-xs text-slate-400">
              Comparing pen-level averages, deviation vs shed mean, target differences, and feed authorizations
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleDownloadCsv}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition flex items-center gap-1.5 shadow"
            >
              <Download className="w-3.5 h-3.5 text-emerald-400" />
              <span>Download Shed CSV</span>
            </button>
            <button
              onClick={() => s && onPrintShedReport(activeShed, s, selectedWeek)}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white transition flex items-center gap-1.5 shadow-md shadow-emerald-700/20"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Print Shed Report</span>
            </button>
          </div>
        </div>

        <div className="overflow-x-auto mt-4">
          <table className="w-full text-xs text-left">
            <thead>
              <tr className="border-b border-slate-800 text-slate-400 uppercase font-semibold">
                <th className="py-3 px-3">Pen</th>
                <th className="py-3 px-3">Gender & Breed</th>
                <th className="py-3 px-3 text-right">Population</th>
                <th className="py-3 px-3 text-right">Sample (N)</th>
                <th className="py-3 px-3 text-right">Pen Avg (x̄pen)</th>
                <th className="py-3 px-3 text-right">Deviation vs Shed Mean</th>
                <th className="py-3 px-3 text-center">Uniformity %</th>
                <th className="py-3 px-3 text-center">CV % (F)</th>
                <th className="py-3 px-3 text-right">Daily Feed / Bird</th>
                <th className="py-3 px-3 text-right">Total Feed (kg)</th>
                <th className="py-3 px-3 text-right">50kg Bags</th>
                <th className="py-3 px-3 text-center">Status</th>
                <th className="py-3 px-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-mono">
              {s && s.pens.map((pen) => {
                const isHeavyDev = Math.abs(pen.deviationFromShedMeanPercent) > 5.0;
                return (
                  <tr
                    key={pen.penId}
                    className={`transition ${isHeavyDev ? 'bg-amber-950/20' : 'hover:bg-slate-800/40'}`}
                  >
                    <td className="py-3 px-3 font-bold text-white text-sm font-sans">{pen.penNumber}</td>
                    <td className="py-3 px-3 text-slate-300 font-sans">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold mr-1 ${
                        pen.sex === 'FEMALE' ? 'bg-pink-500/20 text-pink-300' : 'bg-blue-500/20 text-blue-300'
                      }`}>
                        {pen.sex}
                      </span>
                      <span className="text-slate-400">{pen.breed}</span>
                    </td>
                    <td className="py-3 px-3 text-right text-slate-300">{pen.liveBirdCount.toLocaleString()}</td>
                    <td className="py-3 px-3 text-right text-slate-400">{pen.sampleSize} birds</td>
                    <td className="py-3 px-3 text-right font-black text-sky-400 text-sm">
                      {pen.averageWeight > 0 ? `${pen.averageWeight}g` : '--'}
                    </td>
                    <td className={`py-3 px-3 text-right font-bold ${
                      pen.deviationFromShedMeanGrams > 0 ? 'text-amber-400' : 'text-rose-400'
                    }`}>
                      {pen.averageWeight > 0 ? (
                        <>
                          {pen.deviationFromShedMeanGrams > 0 ? '+' : ''}{pen.deviationFromShedMeanGrams}g
                          <span className="text-[10px] ml-1">
                            ({pen.deviationFromShedMeanPercent > 0 ? '+' : ''}{pen.deviationFromShedMeanPercent}%)
                          </span>
                        </>
                      ) : '--'}
                    </td>
                    <td className="py-3 px-3 text-center font-bold text-emerald-400">
                      {pen.sampleSize > 0 ? `${pen.uniformityPercent}%` : '--'}
                    </td>
                    <td className="py-3 px-3 text-center text-purple-400">
                      {pen.sampleSize > 0 ? `${pen.cvPercent}%` : '--'}
                    </td>
                    <td className="py-3 px-3 text-right text-amber-300 font-bold">
                      {pen.suggestedFeedGrams} g
                    </td>
                    <td className="py-3 px-3 text-right font-bold text-white">
                      {pen.dailyFeedKg} kg
                    </td>
                    <td className="py-3 px-3 text-right text-amber-400 font-bold">
                      {pen.feedBags50kg}
                    </td>
                    <td className="py-3 px-3 text-center font-sans">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                        pen.status === 'EXCELLENT' ? 'bg-emerald-500/20 text-emerald-300' :
                        pen.status === 'ACCEPTABLE' ? 'bg-amber-500/20 text-amber-300' : 'bg-rose-500/20 text-rose-300'
                      }`}>
                        {pen.status}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-right font-sans">
                      <button
                        onClick={() => onOpenWeighPen(pen.penId)}
                        className="px-2.5 py-1 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/30 font-semibold text-xs transition"
                      >
                        Weigh Pen
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            {s && (
              <tfoot>
                <tr className="bg-slate-950 font-bold font-mono text-white text-xs border-t-2 border-slate-700">
                  <td className="py-3 px-3 font-sans">SHED TOTAL</td>
                  <td className="py-3 px-3 font-sans text-slate-400">{s.totalPens} Pens Combined</td>
                  <td className="py-3 px-3 text-right text-emerald-400">{s.totalLiveBirds.toLocaleString()}</td>
                  <td className="py-3 px-3 text-right">{s.totalSampleBirdsWeighed}</td>
                  <td className="py-3 px-3 text-right text-sky-400 text-sm">{s.shedAverageWeight}g (Mean)</td>
                  <td className="py-3 px-3 text-right text-slate-400">Baseline (0%)</td>
                  <td className="py-3 px-3 text-center text-emerald-400 text-sm">{s.shedUniformityPercent}%</td>
                  <td className="py-3 px-3 text-center text-purple-400">--</td>
                  <td className="py-3 px-3 text-right text-amber-300">--</td>
                  <td className="py-3 px-3 text-right text-amber-400 text-sm">{s.totalDailyFeedKg} kg</td>
                  <td className="py-3 px-3 text-right text-amber-400 text-sm">{s.totalFeedBags50kg} bags</td>
                  <td className="py-3 px-3 text-center font-sans">
                    <span className="text-emerald-400">{s.shedStatus}</span>
                  </td>
                  <td></td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* 5. COMPOSITE MULTI-PEN DISTRIBUTION HISTOGRAM */}
      {s && s.compositeHistogram.length > 0 && (
        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-xl">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-slate-800 gap-2">
            <div>
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <span>Multi-Pen Composite Weight Distribution</span>
                <span className="text-xs font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-300">
                  N = {s.totalSampleBirdsWeighed} Birds
                </span>
              </h3>
              <p className="text-xs text-slate-400">
                Overlay of bird counts across all pens with shed-level ±10% cutoffs ([{s.shedLowerLimit10Pct}g - {s.shedUpperLimit10Pct}g])
              </p>
            </div>
            <div className="text-xs text-slate-400 flex items-center gap-3">
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-sm bg-emerald-500 inline-block"></span>
                <span>Within Shed ±10% Range</span>
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-sm bg-rose-500 inline-block"></span>
                <span>Outside Range</span>
              </span>
            </div>
          </div>

          <div className="h-64 sm:h-72 w-full mt-4">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={s.compositeHistogram} margin={{ top: 10, right: 10, left: -20, bottom: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                <XAxis
                  dataKey="weight"
                  stroke="#64748b"
                  fontSize={11}
                  tickLine={false}
                  label={{ value: 'Body Weight (g)', position: 'insideBottom', offset: -10, fill: '#94a3b8', fontSize: 11 }}
                />
                <YAxis
                  stroke="#64748b"
                  fontSize={11}
                  tickLine={false}
                  label={{ value: 'Total Birds', angle: -90, position: 'insideLeft', offset: 25, fill: '#94a3b8', fontSize: 11 }}
                />
                <Tooltip
                  content={({ active, payload }) => {
                    if (active && payload && payload.length) {
                      const d = payload[0].payload;
                      return (
                        <div className="bg-slate-900 border border-slate-700 p-2.5 rounded-lg shadow-2xl text-xs space-y-1">
                          <p className="font-bold text-white text-sm">{d.weight} g</p>
                          <p className="text-slate-300">Total Count: <span className="font-bold text-emerald-400">{d.totalCount} birds</span></p>
                          <div className="pt-1 border-t border-slate-800 space-y-0.5">
                            {Object.entries(d.penBreakdown).map(([penName, count]) => (
                              <p key={penName} className="text-slate-400 flex justify-between gap-3">
                                <span>{penName}:</span>
                                <span className="text-white font-mono">{count as number}</span>
                              </p>
                            ))}
                          </div>
                          <p className={`font-semibold text-[10px] ${d.isWithinShedRange ? 'text-emerald-400' : 'text-rose-400'}`}>
                            {d.isWithinShedRange ? 'Within Shed Range' : 'Outside Shed Range'}
                          </p>
                        </div>
                      );
                    }
                    return null;
                  }}
                />
                <ReferenceLine
                  x={s.shedAverageWeight}
                  stroke="#38bdf8"
                  strokeWidth={2}
                  strokeDasharray="4 4"
                  label={{ value: `Shed Mean ${s.shedAverageWeight}g`, position: 'top', fill: '#38bdf8', fontSize: 11, fontWeight: 'bold' }}
                />
                <Bar dataKey="totalCount" radius={[4, 4, 0, 0]}>
                  {s.compositeHistogram.map((entry, index) => (
                    <Cell
                      key={`comp-cell-${index}`}
                      fill={entry.isWithinShedRange ? '#10b981' : '#f43f5e'}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* 6. GROWTH CHART (WEEKS 1 - 23): ACTUAL SHED WEIGHT VS TARGET CURVE */}
      <GrowthChart
        season={activeShed.season}
        shedAverageWeight={s?.shedAverageWeight}
        currentWeek={selectedWeek}
      />
    </div>
  );
};
