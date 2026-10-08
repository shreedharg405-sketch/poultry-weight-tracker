import React, { useState } from 'react';
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from 'recharts';
import { getClientBenchmarkCurve } from '../services/benchmarks';
import { SeasonType, SexType, WeighingRecord } from '../types';

export interface GrowthChartProps {
  season: SeasonType;
  sex?: SexType;
  weighings?: WeighingRecord[];
  shedAverageWeight?: number;
  currentWeek?: number;
}

export const GrowthChart: React.FC<GrowthChartProps> = ({
  season,
  sex = 'FEMALE',
  weighings = [],
  shedAverageWeight,
  currentWeek = 12,
}) => {
  const [showFeed, setShowFeed] = useState<boolean>(true);
  const [selectedGender, setSelectedGender] = useState<SexType>(sex);

  const benchmarks = getClientBenchmarkCurve(season, selectedGender);

  // Map actual weighings or shed average into the benchmark series
  const chartData = benchmarks.map((bm) => {
    const penRecord = weighings.find((w) => w.ageWeeks === bm.week);
    const isCurrent = bm.week === currentWeek;
    const actual = penRecord
      ? penRecord.actualAvgWeight
      : isCurrent && shedAverageWeight && shedAverageWeight > 0
      ? shedAverageWeight
      : null;

    return {
      week: `Wk ${bm.week}`,
      weekNum: bm.week,
      targetWeight: bm.targetWeight,
      minTarget: bm.minTargetWeight,
      maxTarget: bm.maxTargetWeight,
      actualWeight: actual,
      feedGrams: bm.feedGramsPerBirdDay,
      gain: bm.weightGain,
    };
  });

  return (
    <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-xl">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-slate-800 gap-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs uppercase tracking-wider px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 font-bold border border-emerald-500/30">
              Growth Trajectory
            </span>
            <span className="text-xs text-slate-400">
              {season === 'WINTER_BROOD_SUMMER_LAY'
                ? 'Winter Brood (Aug-Jan) / Summer Lay (Feb-Jul)'
                : 'Summer Brood (Feb-Jul) / Winter Lay (Aug-Jan)'}
            </span>
          </div>
          <h3 className="text-base font-bold text-white flex items-center gap-2">
            <span>Flock & Shed Growth Curve (Weeks 1 – 23)</span>
          </h3>
          <p className="text-xs text-slate-400 mt-0.5">
            Suguna Foods benchmark target curve with ±10% growth envelop vs Actual Weighed Weights
          </p>
        </div>

        {/* View toggles */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Gender toggle */}
          <div className="bg-slate-950 border border-slate-700 rounded-xl p-0.5 flex text-xs">
            <button
              onClick={() => setSelectedGender('FEMALE')}
              className={`px-2.5 py-1 rounded-lg font-bold transition ${
                selectedGender === 'FEMALE'
                  ? 'bg-pink-600 text-white'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Female Curve (F)
            </button>
            <button
              onClick={() => setSelectedGender('MALE')}
              className={`px-2.5 py-1 rounded-lg font-bold transition ${
                selectedGender === 'MALE'
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Male Curve (M)
            </button>
          </div>

          <button
            onClick={() => setShowFeed(!showFeed)}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition border ${
              showFeed
                ? 'bg-amber-500/20 text-amber-300 border-amber-500/30 shadow'
                : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-slate-200'
            }`}
          >
            {showFeed ? '✓ Feed Curve Active' : '+ Daily Feed'}
          </button>
        </div>
      </div>

      <div className="h-72 sm:h-80 w-full mt-4">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} margin={{ top: 10, right: 20, left: -10, bottom: 20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
            <XAxis
              dataKey="week"
              stroke="#64748b"
              fontSize={11}
              tickLine={false}
              interval={0}
              tick={{ fontSize: 10 }}
            />
            <YAxis
              yAxisId="weight"
              stroke="#64748b"
              fontSize={11}
              tickLine={false}
              domain={[0, selectedGender === 'MALE' ? 3600 : 3100]}
              label={{ value: 'Body Weight (g)', angle: -90, position: 'insideLeft', offset: 20, fill: '#94a3b8', fontSize: 11 }}
            />
            {showFeed && (
              <YAxis
                yAxisId="feed"
                orientation="right"
                stroke="#f59e0b"
                fontSize={11}
                tickLine={false}
                domain={[0, 140]}
                label={{ value: 'Feed (g/bird/d)', angle: 90, position: 'insideRight', offset: 10, fill: '#f59e0b', fontSize: 11 }}
              />
            )}
            <Tooltip
              content={({ active, payload }) => {
                if (active && payload && payload.length) {
                  const d = payload[0].payload;
                  return (
                    <div className="bg-slate-900 border border-slate-700 p-3 rounded-xl shadow-2xl text-xs space-y-1.5 font-mono">
                      <p className="font-bold text-white text-sm border-b border-slate-800 pb-1 font-sans">
                        Week {d.weekNum} Benchmark Data
                      </p>
                      <p className="text-slate-300 flex justify-between gap-4">
                        <span className="font-sans">Target Weight:</span>
                        <span className="font-bold text-emerald-400">{d.targetWeight} g</span>
                      </p>
                      <p className="text-slate-400 flex justify-between gap-4">
                        <span className="font-sans">±10% Target Band:</span>
                        <span className="text-slate-300">{d.minTarget}g – {d.maxTarget}g</span>
                      </p>
                      {d.actualWeight && (
                        <p className="text-sky-300 font-bold flex justify-between gap-4">
                          <span className="font-sans">Actual Weighed:</span>
                          <span className="text-sky-400">
                            {d.actualWeight} g ({d.actualWeight >= d.targetWeight ? '+' : ''}
                            {(d.actualWeight - d.targetWeight).toFixed(1)}g)
                          </span>
                        </p>
                      )}
                      <p className="text-slate-300 flex justify-between gap-4">
                        <span className="font-sans">Weekly Gain:</span>
                        <span className="text-slate-200">+{d.gain} g/wk</span>
                      </p>
                      <p className="text-amber-300 flex justify-between gap-4">
                        <span className="font-sans">Standard Feed:</span>
                        <span className="font-semibold">{d.feedGrams} g/bird/day</span>
                      </p>
                    </div>
                  );
                }
                return null;
              }}
            />
            <Legend verticalAlign="top" height={36} wrapperStyle={{ fontSize: '11px', color: '#94a3b8' }} />

            {/* Target 10% Band Area */}
            <Area
              yAxisId="weight"
              type="monotone"
              dataKey="maxTarget"
              stroke="transparent"
              fill="#10b981"
              fillOpacity={0.08}
              name="±10% Standard Target Band"
            />

            {/* Benchmark Target Curve Line */}
            <Line
              yAxisId="weight"
              type="monotone"
              dataKey="targetWeight"
              stroke="#10b981"
              strokeWidth={2.5}
              dot={false}
              name="Target Benchmark Weight (g)"
            />

            {/* Actual Recorded Weights as connected points */}
            <Line
              yAxisId="weight"
              type="monotone"
              dataKey="actualWeight"
              stroke="#38bdf8"
              strokeWidth={3}
              dot={{ r: 5, fill: '#0284c7', stroke: '#bae6fd', strokeWidth: 2 }}
              connectNulls={true}
              name="Actual Weighed Weight (g)"
            />

            {/* Daily Feed Curve */}
            {showFeed && (
              <Line
                yAxisId="feed"
                type="monotone"
                dataKey="feedGrams"
                stroke="#f59e0b"
                strokeWidth={2}
                strokeDasharray="4 4"
                dot={false}
                name="Daily Feed (g/bird/day)"
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};
