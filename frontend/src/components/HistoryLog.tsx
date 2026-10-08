import React from 'react';
import { FileText, Download, Calendar, Scale, Award, Trash2 } from 'lucide-react';
import { Flock, WeighingRecord } from '../types';

interface HistoryLogProps {
  flock: Flock | null;
  weighings: WeighingRecord[];
  onSelectRecordForPaper: (record: WeighingRecord) => void;
}

export const HistoryLog: React.FC<HistoryLogProps> = ({
  flock,
  weighings,
  onSelectRecordForPaper,
}) => {
  if (!flock) {
    return (
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 text-center text-slate-400">
        <p>Please select a flock to inspect historical records.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-xl">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-800">
          <div>
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <Calendar className="w-5 h-5 text-emerald-400" />
              <span>Weighing Audit History & Weekly Progress</span>
            </h2>
            <p className="text-xs text-slate-400">
              {flock.farmName} — House: {flock.houseNo} | Pen: {flock.penNo} ({flock.sex})
            </p>
          </div>
          <span className="text-xs font-mono font-bold px-3 py-1 bg-slate-800 text-slate-300 rounded-lg border border-slate-700">
            {weighings.length} Recorded Sessions
          </span>
        </div>

        {weighings.length === 0 ? (
          <div className="py-12 text-center text-slate-500 text-xs">
            No weighing sheets recorded for this flock yet. Go to "Weighing Tally" to add records.
          </div>
        ) : (
          <div className="overflow-x-auto mt-4">
            <table className="w-full text-xs text-left">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400 uppercase font-semibold">
                  <th className="py-3 px-3">Age (Week)</th>
                  <th className="py-3 px-3">Weigh Date</th>
                  <th className="py-3 px-3 text-right">Target Weight</th>
                  <th className="py-3 px-3 text-right">Actual Average</th>
                  <th className="py-3 px-3 text-right">Variance (g / %)</th>
                  <th className="py-3 px-3 text-center">Uniformity (±10%)</th>
                  <th className="py-3 px-3 text-center">CV % (F)</th>
                  <th className="py-3 px-3 text-center">Sample Birds</th>
                  <th className="py-3 px-3 text-center">Status</th>
                  <th className="py-3 px-3 text-center">Recorded By</th>
                  <th className="py-3 px-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-mono">
                {weighings.map((rec) => {
                  const diff = Math.round((rec.actualAvgWeight - rec.targetWeight) * 10) / 10;
                  const diffPct = rec.targetWeight > 0 ? ((diff / rec.targetWeight) * 100).toFixed(1) : '0';

                  return (
                    <tr key={rec.id} className="hover:bg-slate-800/40 transition">
                      <td className="py-3 px-3 font-bold text-white text-sm">
                        Week {rec.ageWeeks}
                      </td>
                      <td className="py-3 px-3 text-slate-400">{rec.weighDate}</td>
                      <td className="py-3 px-3 text-right text-slate-300 font-semibold">{rec.targetWeight}g</td>
                      <td className="py-3 px-3 text-right font-black text-sky-400 text-sm">
                        {rec.actualAvgWeight}g
                      </td>
                      <td className={`py-3 px-3 text-right font-bold ${diff >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {diff >= 0 ? `+${diff}` : diff}g ({diffPct}%)
                      </td>
                      <td className="py-3 px-3 text-center font-bold text-emerald-400 text-sm">
                        {rec.uniformityPercent}%
                      </td>
                      <td className="py-3 px-3 text-center text-purple-400 font-bold">{rec.cvPercent}%</td>
                      <td className="py-3 px-3 text-center text-slate-300">{rec.sampleSize}</td>
                      <td className="py-3 px-3 text-center font-sans">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                          rec.status === 'EXCELLENT' ? 'bg-emerald-500/20 text-emerald-300' :
                          rec.status === 'ACCEPTABLE' ? 'bg-amber-500/20 text-amber-300' : 'bg-rose-500/20 text-rose-300'
                        }`}>
                          {rec.status}
                        </span>
                      </td>
                      <td className="py-3 px-3 text-center font-sans text-slate-400">
                        {rec.weighedBy || '--'}
                      </td>
                      <td className="py-3 px-3 text-right font-sans">
                        <button
                          onClick={() => onSelectRecordForPaper(rec)}
                          className="px-3 py-1.5 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/30 font-semibold text-xs transition flex items-center gap-1.5 ml-auto"
                        >
                          <FileText className="w-3.5 h-3.5" />
                          <span>Paper Chart</span>
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
