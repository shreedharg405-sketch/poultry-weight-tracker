import React from 'react';
import {
  TrendingUp,
  Award,
  Zap,
  Scale,
  Calendar,
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Info,
  Layers,
  Utensils
} from 'lucide-react';
import { Flock, WeighingRecord, UniformityStats } from '../types';
import { BellCurveHistogram } from './BellCurveHistogram';
import { GrowthCurveChart } from './GrowthCurveChart';
import { computeUniformityStats, computePerformanceAlerts } from '../services/calculations';
import { getClientBenchmarkForWeek } from '../services/benchmarks';

interface DashboardProps {
  flocks: Flock[];
  activeFlock: Flock | null;
  onSelectFlock: (flock: Flock) => void;
  weighings: WeighingRecord[];
  onOpenTallySheet: () => void;
  onOpenPaperSheet: (record: WeighingRecord) => void;
}

export const Dashboard: React.FC<DashboardProps> = ({
  flocks,
  activeFlock,
  onSelectFlock,
  weighings,
  onOpenTallySheet,
  onOpenPaperSheet,
}) => {
  if (!activeFlock) {
    return (
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 text-center text-slate-400">
        <p>No flock selected. Please create or choose a flock.</p>
      </div>
    );
  }

  // Latest weighing record
  const latestWeighing = weighings.length > 0 ? weighings[weighings.length - 1] : null;
  const currentWeek = latestWeighing ? latestWeighing.ageWeeks : 12;

  const currentBenchmark = getClientBenchmarkForWeek(activeFlock.season, activeFlock.sex, currentWeek);

  // Derive stats from latest weighing or empty
  const stats: UniformityStats = latestWeighing
    ? computeUniformityStats(latestWeighing.tallies)
    : {
        totalBirds: 0,
        averageWeight: 0,
        lightestWeight: 0,
        heaviestWeight: 0,
        weightRange: 0,
        fValue: 3.08,
        cvPercentF: 0,
        stdDev: 0,
        cvPercentStd: 0,
        lowerLimit10Pct: 0,
        upperLimit10Pct: 0,
        birdsInUniformRange: 0,
        uniformityPercent: 0,
        underweightBirds: 0,
        underweightPercent: 0,
        overweightBirds: 0,
        overweightPercent: 0,
        status: 'POOR',
        histogram: [],
      };

  const alerts = computePerformanceAlerts({
    actualAvgWeight: stats.averageWeight,
    targetWeight: latestWeighing ? latestWeighing.targetWeight : currentBenchmark.targetWeight,
    standardFeedGrams: currentBenchmark.feedGramsPerBirdDay,
    uniformityPercent: stats.uniformityPercent,
  });

  return (
    <div className="space-y-6">
      {/* 1. FLOCK OVERVIEW HEADER CARD */}
      <div className="bg-gradient-to-br from-slate-900 via-slate-900 to-slate-800/90 border border-slate-800 rounded-2xl p-6 shadow-xl relative overflow-hidden">
        <div className="absolute top-0 right-0 -mr-16 -mt-16 w-64 h-64 bg-emerald-500/5 rounded-full blur-3xl pointer-events-none"></div>

        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs uppercase tracking-wider px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 font-bold border border-emerald-500/30">
                Active Flock Monitor
              </span>
              <span className="text-xs text-slate-400">
                {activeFlock.season === 'WINTER_BROOD_SUMMER_LAY' ? 'Winter Brood Curve' : 'Summer Brood Curve'}
              </span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
              {activeFlock.farmName}
            </h1>
            <p className="text-sm text-slate-400 mt-0.5">
              House: <span className="text-slate-200 font-semibold">{activeFlock.houseNo}</span> | Pen:{' '}
              <span className="text-slate-200 font-semibold">{activeFlock.penNo}</span> | Breed:{' '}
              <span className="text-slate-200 font-semibold">{activeFlock.breed}</span> ({activeFlock.sex}) |
              Bird Population: <span className="text-slate-200 font-semibold">{activeFlock.initialBirdCount.toLocaleString()}</span>
            </p>
          </div>

          {/* Quick Flock Switcher & Action */}
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={activeFlock.id}
              onChange={(e) => {
                const found = flocks.find((f) => f.id === e.target.value);
                if (found) onSelectFlock(found);
              }}
              className="bg-slate-950 border border-slate-700 text-slate-200 text-xs rounded-xl px-3 py-2 font-medium focus:outline-none focus:border-emerald-500"
            >
              {flocks.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.farmName} ({f.houseNo} - {f.sex})
                </option>
              ))}
            </select>

            <button
              onClick={onOpenTallySheet}
              className="px-4 py-2 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white transition flex items-center gap-2 shadow-lg shadow-emerald-700/20 active:scale-95"
            >
              <Scale className="w-4 h-4" />
              <span>Weigh Flock (Week {currentWeek})</span>
            </button>
          </div>
        </div>
      </div>

      {/* 2. CORE KPI STAT CARDS */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* KPI 1: Latest Average Weight vs Target */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-xl relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400">Actual Average Body Weight</span>
            <div className="w-8 h-8 rounded-lg bg-sky-500/10 text-sky-400 flex items-center justify-center">
              <Scale className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-black text-white font-mono">
                {stats.averageWeight > 0 ? stats.averageWeight : '--'}
              </span>
              <span className="text-sm font-semibold text-slate-400">grams</span>
            </div>
            <div className="flex items-center justify-between text-xs mt-2 pt-2 border-t border-slate-800/80">
              <span className="text-slate-400">Target Wk {currentWeek}: {currentBenchmark.targetWeight}g</span>
              <span className={`font-bold font-mono ${alerts.diffGrams >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                {alerts.diffGrams >= 0 ? '+' : ''}{alerts.diffGrams}g ({alerts.diffPercent}%)
              </span>
            </div>
          </div>
        </div>

        {/* KPI 2: Standard Uniformity % (±10% Rule) */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-xl relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400">Standard Uniformity (±10%)</span>
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
              stats.uniformityPercent >= 80 ? 'bg-emerald-500/10 text-emerald-400' :
              stats.uniformityPercent >= 70 ? 'bg-amber-500/10 text-amber-400' : 'bg-rose-500/10 text-rose-400'
            }`}>
              <Award className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            <div className="flex items-baseline gap-2">
              <span className={`text-3xl font-black font-mono ${
                stats.uniformityPercent >= 80 ? 'text-emerald-400' :
                stats.uniformityPercent >= 70 ? 'text-amber-400' : 'text-rose-400'
              }`}>
                {stats.totalBirds > 0 ? `${stats.uniformityPercent}%` : '--'}
              </span>
              <span className={`text-xs uppercase font-extrabold tracking-wider px-2 py-0.5 rounded ${
                stats.uniformityPercent >= 80 ? 'bg-emerald-500/20 text-emerald-300' :
                stats.uniformityPercent >= 70 ? 'bg-amber-500/20 text-amber-300' : 'bg-rose-500/20 text-rose-300'
              }`}>
                {stats.totalBirds > 0 ? stats.status : 'NO DATA'}
              </span>
            </div>
            <div className="flex items-center justify-between text-xs mt-2 pt-2 border-t border-slate-800/80">
              <span className="text-slate-400">Sample: {stats.totalBirds} birds</span>
              <span className="text-emerald-400 font-semibold">{stats.birdsInUniformRange} in range</span>
            </div>
          </div>
        </div>

        {/* KPI 3: CV % via F-factor Table */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-xl relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400">CV % (F-Factor Formula)</span>
            <div className="w-8 h-8 rounded-lg bg-purple-500/10 text-purple-400 flex items-center justify-center">
              <TrendingUp className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-black text-purple-300 font-mono">
                {stats.totalBirds > 0 ? `${stats.cvPercentF}%` : '--'}
              </span>
              <span className="text-xs text-slate-400 font-mono">F = {stats.fValue}</span>
            </div>
            <div className="flex items-center justify-between text-xs mt-2 pt-2 border-t border-slate-800/80">
              <span className="text-slate-400">Range: {stats.weightRange}g</span>
              <span className="text-slate-300 font-mono">SD: {stats.stdDev}g</span>
            </div>
          </div>
        </div>

        {/* KPI 4: Daily Feed Allocation per Bird */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-xl relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400">Authorized Daily Feed</span>
            <div className="w-8 h-8 rounded-lg bg-amber-500/10 text-amber-400 flex items-center justify-center">
              <Utensils className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-black text-amber-300 font-mono">
                {alerts.suggestedDailyFeed}
              </span>
              <span className="text-sm font-semibold text-slate-400">g / bird / day</span>
            </div>
            <div className="flex items-center justify-between text-xs mt-2 pt-2 border-t border-slate-800/80">
              <span className="text-slate-400">Standard: {currentBenchmark.feedGramsPerBirdDay}g</span>
              <span className={`font-semibold ${alerts.feedAdjustmentGrams > 0 ? 'text-amber-400' : 'text-slate-300'}`}>
                {alerts.feedAdjustmentGrams > 0 ? `+${alerts.feedAdjustmentGrams}g boost` : 'Standard'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* 3. PERFORMANCE ALERTS & ACTIONABLE FEEDING GUIDANCE */}
      <div className={`p-4 rounded-2xl border transition-all ${
        alerts.severity === 'green'
          ? 'bg-emerald-950/40 border-emerald-500/30 text-emerald-200'
          : alerts.severity === 'yellow'
          ? 'bg-amber-950/40 border-amber-500/30 text-amber-200'
          : 'bg-rose-950/40 border-rose-500/30 text-rose-200'
      }`}>
        <div className="flex items-start gap-3">
          <div className="mt-0.5">
            {alerts.severity === 'green' ? (
              <CheckCircle2 className="w-5 h-5 text-emerald-400" />
            ) : (
              <AlertTriangle className="w-5 h-5 text-amber-400" />
            )}
          </div>
          <div className="flex-1 text-xs space-y-1">
            <div className="flex items-center justify-between">
              <h4 className="font-bold text-sm text-white">
                Nutritional & Pen Grading Recommendation (Week {currentWeek})
              </h4>
              <span className="font-mono text-xs px-2 py-0.5 rounded bg-black/30">
                {alerts.feedRecommendation.includes('underweight') ? 'Weight Deficit' : 'Trajectory Status'}
              </span>
            </div>
            <p className="text-slate-300 leading-relaxed">{alerts.feedRecommendation}</p>
            <p className="text-slate-400 italic mt-0.5">{alerts.gradingAdvice}</p>
          </div>
        </div>
      </div>

      {/* 4. CHARTS GRID (BELL CURVE + GROWTH CURVE) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Bell Curve Distribution Histogram */}
        <BellCurveHistogram stats={stats} />

        {/* Growth Curve Benchmark vs Actual Trajectory */}
        <GrowthCurveChart
          season={activeFlock.season}
          sex={activeFlock.sex}
          weighings={weighings}
        />
      </div>

      {/* 5. RECENT WEIGHING RECORDS LIST ON DASHBOARD */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-xl">
        <div className="flex items-center justify-between pb-3 border-b border-slate-800">
          <div>
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <span>Historical Weighing Sessions for this Flock</span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 font-mono">
                {weighings.length} recorded
              </span>
            </h3>
          </div>
        </div>

        {weighings.length === 0 ? (
          <div className="py-8 text-center text-slate-500 text-xs">
            No weighing sheets recorded yet. Click "Weigh Flock" above to record Week {currentWeek}.
          </div>
        ) : (
          <div className="overflow-x-auto mt-3">
            <table className="w-full text-xs text-left">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400 uppercase font-semibold">
                  <th className="py-2.5 px-3">Age</th>
                  <th className="py-2.5 px-3">Date</th>
                  <th className="py-2.5 px-3 text-right">Target Wt</th>
                  <th className="py-2.5 px-3 text-right">Actual Avg</th>
                  <th className="py-2.5 px-3 text-right">Gain / Diff</th>
                  <th className="py-2.5 px-3 text-center">Uniformity %</th>
                  <th className="py-2.5 px-3 text-center">CV %</th>
                  <th className="py-2.5 px-3 text-center">Sample (N)</th>
                  <th className="py-2.5 px-3 text-center">Status</th>
                  <th className="py-2.5 px-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-mono">
                {weighings.map((rec) => {
                  const diff = Math.round((rec.actualAvgWeight - rec.targetWeight) * 10) / 10;
                  return (
                    <tr key={rec.id} className="hover:bg-slate-800/40 transition">
                      <td className="py-2.5 px-3 font-bold text-white">Wk {rec.ageWeeks}</td>
                      <td className="py-2.5 px-3 text-slate-400">{rec.weighDate}</td>
                      <td className="py-2.5 px-3 text-right text-slate-300">{rec.targetWeight}g</td>
                      <td className="py-2.5 px-3 text-right font-bold text-sky-400">{rec.actualAvgWeight}g</td>
                      <td className={`py-2.5 px-3 text-right font-bold ${diff >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {diff >= 0 ? `+${diff}` : diff}g
                      </td>
                      <td className="py-2.5 px-3 text-center font-bold text-emerald-400">
                        {rec.uniformityPercent}%
                      </td>
                      <td className="py-2.5 px-3 text-center text-purple-400">{rec.cvPercent}%</td>
                      <td className="py-2.5 px-3 text-center text-slate-300">{rec.sampleSize} birds</td>
                      <td className="py-2.5 px-3 text-center font-sans">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                          rec.status === 'EXCELLENT' ? 'bg-emerald-500/20 text-emerald-300' :
                          rec.status === 'ACCEPTABLE' ? 'bg-amber-500/20 text-amber-300' : 'bg-rose-500/20 text-rose-300'
                        }`}>
                          {rec.status}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-right font-sans">
                        <button
                          onClick={() => onOpenPaperSheet(rec)}
                          className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition"
                        >
                          View Paper Sheet
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
