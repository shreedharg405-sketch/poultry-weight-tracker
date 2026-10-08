import React from 'react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
  Cell,
  CartesianGrid
} from 'recharts';
import { UniformityStats } from '../types';

interface BellCurveHistogramProps {
  stats: UniformityStats;
}

export const BellCurveHistogram: React.FC<BellCurveHistogramProps> = ({ stats }) => {
  if (!stats || stats.totalBirds === 0) {
    return (
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 text-center text-slate-400">
        <p className="text-sm">No bird tally data available to plot bell curve distribution.</p>
        <p className="text-xs text-slate-500 mt-1">Start entering weights in the tally matrix to view live distribution.</p>
      </div>
    );
  }

  const data = stats.histogram;

  return (
    <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-xl">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-slate-800 gap-2">
        <div>
          <h3 className="text-base font-bold text-white flex items-center gap-2">
            <span>Weight Distribution Histogram</span>
            <span className="text-xs font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
              N = {stats.totalBirds} Birds
            </span>
          </h3>
          <p className="text-xs text-slate-400">
            Bell curve distribution with ±10% acceptable uniformity cutoff bands
          </p>
        </div>

        {/* Legend */}
        <div className="flex items-center gap-3 text-xs">
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-sm bg-rose-500 inline-block"></span>
            <span className="text-slate-300">Under (&lt;90%): {stats.underweightBirds} ({stats.underweightPercent}%)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-sm bg-emerald-500 inline-block"></span>
            <span className="text-emerald-300 font-semibold">Uniform (±10%): {stats.birdsInUniformRange} ({stats.uniformityPercent}%)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-sm bg-amber-500 inline-block"></span>
            <span className="text-slate-300">Over (&gt;110%): {stats.overweightBirds} ({stats.overweightPercent}%)</span>
          </div>
        </div>
      </div>

      {/* Chart Canvas */}
      <div className="h-64 sm:h-72 w-full mt-4">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 10, right: 10, left: -20, bottom: 20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
            <XAxis
              dataKey="weight"
              stroke="#64748b"
              fontSize={11}
              tickLine={false}
              label={{ value: 'Body Weight (grams)', position: 'insideBottom', offset: -10, fill: '#94a3b8', fontSize: 11 }}
            />
            <YAxis
              stroke="#64748b"
              fontSize={11}
              tickLine={false}
              allowDecimals={false}
              label={{ value: 'Birds Count', angle: -90, position: 'insideLeft', offset: 25, fill: '#94a3b8', fontSize: 11 }}
            />
            <Tooltip
              content={({ active, payload }) => {
                if (active && payload && payload.length) {
                  const d = payload[0].payload;
                  return (
                    <div className="bg-slate-900 border border-slate-700 p-2.5 rounded-lg shadow-2xl text-xs space-y-1">
                      <p className="font-bold text-white text-sm">{d.weight} g</p>
                      <p className="text-slate-300">Count: <span className="font-semibold text-emerald-400">{d.count} birds</span> ({d.percent}%)</p>
                      <p className={`font-semibold ${d.isUnder ? 'text-rose-400' : d.isOver ? 'text-amber-400' : 'text-emerald-400'}`}>
                        {d.isUnder ? 'Underweight (< 90%)' : d.isOver ? 'Overweight (> 110%)' : 'Uniform (±10% Range)'}
                      </p>
                    </div>
                  );
                }
                return null;
              }}
            />
            {/* Reference line for average weight */}
            <ReferenceLine
              x={stats.averageWeight}
              stroke="#38bdf8"
              strokeWidth={2}
              strokeDasharray="4 4"
              label={{ value: `Avg ${stats.averageWeight}g`, position: 'top', fill: '#38bdf8', fontSize: 11, fontWeight: 'bold' }}
            />
            <Bar dataKey="count" radius={[4, 4, 0, 0]}>
              {data.map((entry, index) => {
                let fill = '#10b981'; // emerald for uniform
                if (entry.isUnder) fill = '#f43f5e'; // rose for under
                if (entry.isOver) fill = '#f59e0b'; // amber for over
                return <Cell key={`cell-${index}`} fill={fill} />;
              })}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Numerical Cutoff Bounds Summary */}
      <div className="mt-2 grid grid-cols-3 gap-2 bg-slate-950/60 p-3 rounded-xl border border-slate-800 text-center text-xs">
        <div>
          <span className="text-slate-400 block">Lower Limit (-10%)</span>
          <span className="font-mono font-bold text-rose-400 text-sm">{stats.lowerLimit10Pct} g</span>
        </div>
        <div>
          <span className="text-slate-400 block">Average Weight (x̄)</span>
          <span className="font-mono font-bold text-sky-400 text-sm">{stats.averageWeight} g</span>
        </div>
        <div>
          <span className="text-slate-400 block">Upper Limit (+10%)</span>
          <span className="font-mono font-bold text-amber-400 text-sm">{stats.upperLimit10Pct} g</span>
        </div>
      </div>
    </div>
  );
};
