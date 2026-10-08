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
  Scatter
} from 'recharts';
import { getClientBenchmarkCurve } from '../services/benchmarks';
import { SeasonType, SexType, WeighingRecord } from '../types';

interface GrowthCurveChartProps {
  season: SeasonType;
  sex: SexType;
  weighings: WeighingRecord[];
}

export const GrowthCurveChart: React.FC<GrowthCurveChartProps> = ({ season, sex, weighings }) => {
  const [showFeed, setShowFeed] = useState<boolean>(false);

  const benchmarks = getClientBenchmarkCurve(season, sex);

  // Map actual weighings into the benchmark series
  const chartData = benchmarks.map((bm) => {
    const actualRec = weighings.find((w) => w.ageWeeks === bm.week);
    return {
      week: `Wk ${bm.week}`,
      weekNum: bm.week,
      targetWeight: bm.targetWeight,
      minTarget: bm.minTargetWeight,
      maxTarget: bm.maxTargetWeight,
      actualWeight: actualRec ? actualRec.actualAvgWeight : null,
      feedGrams: bm.feedGramsPerBirdDay,
      gain: bm.weightGain,
    };
  });

  return (
    <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-xl">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-slate-800 gap-2">
        <div>
          <h3 className="text-base font-bold text-white flex items-center gap-2">
            <span>Standard Growth Trajectory vs Actual (Weeks 1 - 23)</span>
            <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 font-semibold border border-emerald-500/20">
              {sex === 'FEMALE' ? 'Female (F)' : 'Male (M)'} Standard
            </span>
          </h3>
          <p className="text-xs text-slate-400">
            {season === 'WINTER_BROOD_SUMMER_LAY'
              ? 'Winter Brood (Aug - Jan) / Summer Laying (Feb - Jul)'
              : 'Summer Brood (Feb - Jul) / Winter Laying (Aug - Jan)'}
          </p>
        </div>

        {/* View toggle */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowFeed(!showFeed)}
            className={`px-3 py-1 rounded-lg text-xs font-semibold transition border ${
              showFeed
                ? 'bg-amber-500/20 text-amber-300 border-amber-500/30'
                : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-slate-200'
            }`}
          >
            {showFeed ? '✓ Showing Feed Curve' : '+ Overlay Daily Feed'}
          </button>
        </div>
      </div>

      <div className="h-64 sm:h-80 w-full mt-4">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} margin={{ top: 10, right: 20, left: -10, bottom: 20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
            <XAxis
              dataKey="week"
              stroke="#64748b"
              fontSize={11}
              tickLine={false}
              interval={1}
            />
            <YAxis
              yAxisId="weight"
              stroke="#64748b"
              fontSize={11}
              tickLine={false}
              domain={[0, sex === 'MALE' ? 3600 : 3100]}
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
                    <div className="bg-slate-900 border border-slate-700 p-3 rounded-xl shadow-2xl text-xs space-y-1.5">
                      <p className="font-bold text-white text-sm border-b border-slate-800 pb-1">
                        Week {d.weekNum} Performance
                      </p>
                      <p className="text-slate-300 flex justify-between gap-4">
                        <span>Target Weight:</span>
                        <span className="font-bold text-emerald-400">{d.targetWeight} g</span>
                      </p>
                      <p className="text-slate-400 flex justify-between gap-4">
                        <span>±10% Target Band:</span>
                        <span className="font-mono text-slate-300">{d.minTarget}g - {d.maxTarget}g</span>
                      </p>
                      {d.actualWeight && (
                        <p className="text-sky-300 font-bold flex justify-between gap-4">
                          <span>Actual Recorded:</span>
                          <span className="text-sky-400">{d.actualWeight} g ({d.actualWeight > d.targetWeight ? '+' : ''}{(d.actualWeight - d.targetWeight).toFixed(1)}g)</span>
                        </p>
                      )}
                      <p className="text-slate-300 flex justify-between gap-4">
                        <span>Weekly Gain:</span>
                        <span className="text-slate-200">+{d.gain} g/wk</span>
                      </p>
                      <p className="text-amber-300 flex justify-between gap-4">
                        <span>Standard Feed:</span>
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
              name="Benchmark Target Weight (g)"
            />

            {/* Actual Recorded Weights as connected dots */}
            <Line
              yAxisId="weight"
              type="monotone"
              dataKey="actualWeight"
              stroke="#38bdf8"
              strokeWidth={3}
              dot={{ r: 5, fill: '#0284c7', stroke: '#bae6fd', strokeWidth: 2 }}
              connectNulls={true}
              name="Actual Flock Weight (g)"
            />

            {/* Optional Daily Feed Curve */}
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
