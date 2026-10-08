import React, { useRef } from 'react';
import { Printer, Download, Home, Layers, Calendar, Award, Utensils } from 'lucide-react';
import { Flock, WeighingRecord, Shed, ShedSummaryData } from '../types';
import { F_FACTOR_LOOKUP } from '../services/calculations';

interface PaperSheetReplicaProps {
  flock: Flock | null;
  record: WeighingRecord | null;
  shed?: Shed | null;
  shedSummary?: ShedSummaryData | null;
  onSelectAnotherRecord?: () => void;
}

export const PaperSheetReplica: React.FC<PaperSheetReplicaProps> = ({
  flock,
  record,
  shed,
  shedSummary,
}) => {
  const printRef = useRef<HTMLDivElement>(null);

  const handlePrint = () => {
    window.print();
  };

  const handleDownloadCsv = () => {
    if (!record) return;
    let csv = `POULTRY FLOCK BODY WEIGHT & UNIFORMITY RECORDING SHEET\n`;
    csv += `Farm Name,${flock?.farmName || ''},House / Shed,${shed?.shedName || flock?.houseNo || ''},Pen No,${flock?.penNo || ''}\n`;
    csv += `Breed,${flock?.breed || ''},Sex,${flock?.sex || ''},Age (Weeks),${record.ageWeeks}\n`;
    csv += `Date of Weighing,${record.weighDate},Weighed By,${record.weighedBy || ''}\n`;
    csv += `Target Weight (g),${record.targetWeight},Actual Avg Weight (g),${record.actualAvgWeight}\n\n`;

    if (shedSummary) {
      csv += `SHED AGGREGATED SUMMARY (HOUSE LEVEL)\n`;
      csv += `Shed Mean Weight (g),${shedSummary.shedAverageWeight}\n`;
      csv += `Shed Overall Uniformity (±10%),${shedSummary.shedUniformityPercent}%\n`;
      csv += `Total Live Birds in Shed,${shedSummary.totalLiveBirds}\n`;
      csv += `Total Sample Birds Weighed,${shedSummary.totalSampleBirdsWeighed}\n`;
      csv += `Shed Daily Feed Requirement,${shedSummary.totalDailyFeedKg} kg (${shedSummary.totalFeedBags50kg} bags)\n\n`;
    }

    csv += `PEN TALLY MATRIX\n`;
    csv += `Weight (g),Count (Birds),Weight x Count,Category\n`;
    for (const t of record.tallies) {
      const isUnder = t.weightGrams < record.actualAvgWeight * 0.9;
      const isOver = t.weightGrams > record.actualAvgWeight * 1.1;
      const cat = isUnder ? 'Underweight (<90%)' : isOver ? 'Overweight (>110%)' : 'Uniform (±10%)';
      csv += `${t.weightGrams},${t.birdCount},${t.weightGrams * t.birdCount},${cat}\n`;
    }

    csv += `\nSUMMARY STATISTICS\n`;
    csv += `Total Sample Birds (N),${record.sampleSize}\n`;
    csv += `Average Weight (g),${record.actualAvgWeight}\n`;
    csv += `Lightest Bird (g),${record.lightestWeight}\n`;
    csv += `Heaviest Bird (g),${record.heaviestWeight}\n`;
    csv += `Weight Range (g),${record.weightRange}\n`;
    csv += `F-Factor Value,${record.fValue}\n`;
    csv += `CV % (F-Formula),${record.cvPercent}%\n`;
    csv += `Standard Deviation,${record.stdDev} g\n`;
    csv += `Acceptable ±10% Range,${(record.actualAvgWeight * 0.9).toFixed(1)}g - ${(record.actualAvgWeight * 1.1).toFixed(1)}g\n`;
    csv += `Uniform Birds Count,${record.uniformCount}\n`;
    csv += `Uniformity %,${record.uniformityPercent}%\n`;
    csv += `Underweight Birds Count,${record.underCount}\n`;
    csv += `Overweight Birds Count,${record.overCount}\n`;
    csv += `Uniformity Grade,${record.status}\n`;
    csv += `Suggested Feed (g/bird/day),${record.suggestedFeedGrams} g\n`;

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `suguna_sheet_${shed?.shedName || 'shed'}_wk${record.ageWeeks}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  if (!record) {
    return (
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 text-center text-slate-400">
        <p className="text-base font-semibold text-slate-300">No weighing session selected for paper view.</p>
        <p className="text-xs text-slate-500 mt-1">
          Complete a weighing in the Tally Matrix or select a past session from History.
        </p>
      </div>
    );
  }

  const sortedTallies = [...record.tallies].sort((a, b) => a.weightGrams - b.weightGrams);

  return (
    <div className="space-y-4">
      {/* Action Toolbar (no-print) */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-900/90 border border-slate-800 rounded-2xl p-4 no-print">
        <div>
          <h2 className="text-base font-bold text-white flex items-center gap-2">
            <span>Official Suguna Bodyweight Recording Sheet</span>
            <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 font-semibold border border-emerald-500/20">
              Week {record.ageWeeks} Record
            </span>
          </h2>
          <p className="text-xs text-slate-400">
            Print-ready format with integrated Shed Summary & Pen Tally Matrix
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleDownloadCsv}
            className="px-3.5 py-2 rounded-xl text-xs font-bold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition flex items-center gap-2 shadow"
          >
            <Download className="w-4 h-4 text-emerald-400" />
            <span>Export CSV</span>
          </button>
          <button
            onClick={handlePrint}
            className="px-4 py-2 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white transition flex items-center gap-2 shadow-lg shadow-emerald-700/20"
          >
            <Printer className="w-4 h-4" />
            <span>Print Official Paper Sheet (A4)</span>
          </button>
        </div>
      </div>

      {/* PAPER SHEET DOCUMENT CONTAINER */}
      <div
        ref={printRef}
        className="print-sheet bg-white text-slate-900 rounded-2xl p-6 sm:p-8 shadow-2xl border border-slate-200 font-sans"
      >
        {/* Document Header */}
        <div className="border-b-2 border-slate-900 pb-4 text-center">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold tracking-widest text-slate-600 uppercase">
              SUGUNA FOODS STANDARD SPECIFICATION
            </span>
            <span className="text-xs font-mono font-bold bg-slate-100 px-2 py-0.5 rounded border border-slate-300">
              FORM: BWT-SHED-UNIFORMITY-02
            </span>
          </div>
          <h1 className="text-xl sm:text-2xl font-black tracking-tight text-slate-950 mt-1 uppercase">
            FLOCK BODY WEIGHT & UNIFORMITY RECORDING CHART
          </h1>
          <p className="text-xs text-slate-600 font-medium">
            Shed-Wise Aggregation & Pen-Level Sample Weighing Matrix
          </p>
        </div>

        {/* Metadata Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 py-3 border-b border-slate-300 text-xs">
          <div>
            <span className="text-slate-500 font-medium block">Farm Name:</span>
            <span className="font-bold text-slate-900">{flock?.farmName || 'Suguna Breeder Farm Complex'}</span>
          </div>
          <div>
            <span className="text-slate-500 font-medium block">Shed & Pen Identification:</span>
            <span className="font-bold text-slate-900">{shed?.shedName || flock?.houseNo} / {flock?.penNo}</span>
          </div>
          <div>
            <span className="text-slate-500 font-medium block">Breed & Sex:</span>
            <span className="font-bold text-slate-900">{flock?.breed} ({flock?.sex})</span>
          </div>
          <div>
            <span className="text-slate-500 font-medium block">Flock Season:</span>
            <span className="font-bold text-slate-900">
              {flock?.season === 'WINTER_BROOD_SUMMER_LAY' ? 'Winter Brood / Summer Lay' : 'Summer Brood / Winter Lay'}
            </span>
          </div>
          <div>
            <span className="text-slate-500 font-medium block">Flock Age:</span>
            <span className="font-bold text-slate-900 font-mono text-sm">Week {record.ageWeeks}</span>
          </div>
          <div>
            <span className="text-slate-500 font-medium block">Weighing Date:</span>
            <span className="font-bold text-slate-900 font-mono">{record.weighDate}</span>
          </div>
          <div>
            <span className="text-slate-500 font-medium block">Benchmark Target Weight:</span>
            <span className="font-bold text-emerald-700 font-mono text-sm">{record.targetWeight} g</span>
          </div>
          <div>
            <span className="text-slate-500 font-medium block">Recorded By:</span>
            <span className="font-bold text-slate-900">{record.weighedBy || 'Flock Technician'}</span>
          </div>
        </div>

        {/* DEDICATED SHED SUMMARY SECTION */}
        {shedSummary && (
          <div className="my-4 p-3.5 bg-slate-50 border-2 border-slate-700 rounded-lg">
            <div className="flex items-center justify-between border-b border-slate-300 pb-2 mb-2">
              <span className="font-black text-xs uppercase tracking-wider text-slate-900 flex items-center gap-1.5">
                <span>🏡 SHED-WISE AGGREGATED SUMMARY (ALL PENS IN {shed?.shedName || flock?.houseNo})</span>
              </span>
              <span className="font-mono text-xs font-bold text-slate-700">
                Week {record.ageWeeks} Summary
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-xs text-center">
              <div className="border border-slate-300 bg-white p-2 rounded">
                <span className="text-[10px] text-slate-500 block uppercase">Shed Mean (X̄shed)</span>
                <span className="font-mono font-black text-sm text-slate-950">{shedSummary.shedAverageWeight} g</span>
              </div>
              <div className="border border-slate-300 bg-white p-2 rounded">
                <span className="text-[10px] text-slate-500 block uppercase">Shed Uniformity (±10%)</span>
                <span className="font-mono font-black text-sm text-emerald-800">{shedSummary.shedUniformityPercent}%</span>
              </div>
              <div className="border border-slate-300 bg-white p-2 rounded">
                <span className="text-[10px] text-slate-500 block uppercase">Total Live Birds</span>
                <span className="font-mono font-bold text-sm text-slate-900">{shedSummary.totalLiveBirds.toLocaleString()}</span>
              </div>
              <div className="border border-slate-300 bg-white p-2 rounded">
                <span className="text-[10px] text-slate-500 block uppercase">Sample Weighed</span>
                <span className="font-mono font-bold text-sm text-slate-900">{shedSummary.totalSampleBirdsWeighed} birds</span>
              </div>
              <div className="border border-slate-300 bg-white p-2 rounded">
                <span className="text-[10px] text-slate-500 block uppercase">Total Daily Feed</span>
                <span className="font-mono font-black text-sm text-amber-800">
                  {shedSummary.totalDailyFeedKg} kg ({shedSummary.totalFeedBags50kg} bags)
                </span>
              </div>
            </div>

            {/* Pen breakdown table inside Shed Summary */}
            {shedSummary.pens.length > 0 && (
              <div className="mt-3">
                <table className="w-full text-[11px] border-collapse border border-slate-300 text-left">
                  <thead>
                    <tr className="bg-slate-200 text-slate-800 font-bold uppercase text-[10px]">
                      <th className="border border-slate-300 p-1 text-center">Pen</th>
                      <th className="border border-slate-300 p-1">Sex</th>
                      <th className="border border-slate-300 p-1 text-right">Population</th>
                      <th className="border border-slate-300 p-1 text-right">Pen Avg (g)</th>
                      <th className="border border-slate-300 p-1 text-right">Dev vs Shed Mean</th>
                      <th className="border border-slate-300 p-1 text-center">Uniformity %</th>
                      <th className="border border-slate-300 p-1 text-right">Feed/Bird</th>
                      <th className="border border-slate-300 p-1 text-right">Daily Feed (kg)</th>
                      <th className="border border-slate-300 p-1 text-right">50kg Bags</th>
                    </tr>
                  </thead>
                  <tbody className="font-mono">
                    {shedSummary.pens.map(p => (
                      <tr key={p.penId} className="hover:bg-slate-100">
                        <td className="border border-slate-300 p-1 text-center font-bold font-sans">{p.penNumber}</td>
                        <td className="border border-slate-300 p-1 font-sans">{p.sex}</td>
                        <td className="border border-slate-300 p-1 text-right">{p.liveBirdCount}</td>
                        <td className="border border-slate-300 p-1 text-right font-bold">{p.averageWeight}g</td>
                        <td className={`border border-slate-300 p-1 text-right font-bold ${p.deviationFromShedMeanGrams > 0 ? 'text-amber-700' : 'text-red-700'}`}>
                          {p.deviationFromShedMeanGrams > 0 ? '+' : ''}{p.deviationFromShedMeanGrams}g ({p.deviationFromShedMeanPercent > 0 ? '+' : ''}{p.deviationFromShedMeanPercent}%)
                        </td>
                        <td className="border border-slate-300 p-1 text-center text-emerald-800 font-bold">{p.uniformityPercent}%</td>
                        <td className="border border-slate-300 p-1 text-right">{p.suggestedFeedGrams}g</td>
                        <td className="border border-slate-300 p-1 text-right font-bold">{p.dailyFeedKg} kg</td>
                        <td className="border border-slate-300 p-1 text-right">{p.feedBags50kg}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Pen-Level Tally Matrix Table */}
        <div className="mt-4">
          <div className="font-bold text-xs uppercase tracking-wider text-slate-800 mb-1">
            PEN-LEVEL WEIGHING TALLY MATRIX ({flock?.penNo} - {flock?.sex})
          </div>
          <table className="print-table w-full text-xs border-collapse border border-slate-400">
            <thead>
              <tr className="bg-slate-100 text-slate-800 uppercase font-bold text-[11px]">
                <th className="border border-slate-400 p-2 text-center w-24">Weight (g)</th>
                <th className="border border-slate-400 p-2 text-left">Tally Marks (卌 ||||)</th>
                <th className="border border-slate-400 p-2 text-center w-20">Bird Count (n)</th>
                <th className="border border-slate-400 p-2 text-center w-28">Weight × Count</th>
                <th className="border border-slate-400 p-2 text-center w-28">Uniformity Category</th>
              </tr>
            </thead>
            <tbody>
              {sortedTallies.map((t) => {
                const fullFives = Math.floor(t.birdCount / 5);
                const remainder = t.birdCount % 5;
                const tallyStr = '卌 '.repeat(fullFives) + '|'.repeat(remainder);

                const lowerCut = record.actualAvgWeight * 0.9;
                const upperCut = record.actualAvgWeight * 1.1;
                const isUnder = t.weightGrams < lowerCut;
                const isOver = t.weightGrams > upperCut;

                return (
                  <tr key={t.weightGrams} className="hover:bg-slate-50 font-mono">
                    <td className="border border-slate-400 p-1.5 text-center font-bold text-slate-900">
                      {t.weightGrams}
                    </td>
                    <td className="border border-slate-400 p-1.5 font-bold tracking-widest text-slate-800 text-[11px]">
                      {t.birdCount > 0 ? tallyStr : ''}
                    </td>
                    <td className="border border-slate-400 p-1.5 text-center font-bold text-slate-900">
                      {t.birdCount}
                    </td>
                    <td className="border border-slate-400 p-1.5 text-center text-slate-700">
                      {(t.weightGrams * t.birdCount).toLocaleString()}
                    </td>
                    <td className="border border-slate-400 p-1.5 text-center font-sans font-semibold text-[10px]">
                      {isUnder ? (
                        <span className="text-red-600">Under (&lt;90%)</span>
                      ) : isOver ? (
                        <span className="text-amber-700">Over (&gt;110%)</span>
                      ) : (
                        <span className="text-emerald-700 font-bold">Uniform (±10%)</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="bg-slate-100 font-bold font-mono text-slate-950 text-xs">
                <td className="border border-slate-400 p-2 text-center font-sans">TOTAL</td>
                <td className="border border-slate-400 p-2 text-slate-600 font-sans italic">Sum of all sample birds</td>
                <td className="border border-slate-400 p-2 text-center text-sm">{record.sampleSize} birds</td>
                <td className="border border-slate-400 p-2 text-center text-sm">
                  {sortedTallies.reduce((acc, c) => acc + c.weightGrams * c.birdCount, 0).toLocaleString()} g
                </td>
                <td className="border border-slate-400 p-2 text-center text-emerald-800 font-bold">
                  {record.uniformCount} ({record.uniformityPercent}%)
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* Statistical Formulas & Calculations Breakdown */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4 pt-3 border-t border-slate-300 text-xs">
          <div className="border border-slate-400 rounded-lg p-3 bg-slate-50 space-y-1.5">
            <h4 className="font-bold text-slate-900 uppercase text-[11px] border-b border-slate-300 pb-1">
              Statistical Uniformity Metrics
            </h4>
            <div className="flex justify-between">
              <span className="text-slate-600">Average Weight (x̄ = Σ(w·n) / N):</span>
              <span className="font-mono font-bold text-slate-950 text-sm">{record.actualAvgWeight} g</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-600">Sample Range (Heaviest - Lightest):</span>
              <span className="font-mono font-bold text-slate-900">
                {record.weightRange} g ({record.lightestWeight}g to {record.heaviestWeight}g)
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-600">F-Factor Lookup (for N={record.sampleSize}):</span>
              <span className="font-mono font-bold text-slate-900">{record.fValue}</span>
            </div>
            <div className="flex justify-between bg-purple-50 p-1 rounded border border-purple-200">
              <span className="text-purple-900 font-bold">Coefficient of Variation (CV %):</span>
              <span className="font-mono font-black text-purple-900 text-sm">{record.cvPercent}%</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-600">Sample Standard Deviation (SD):</span>
              <span className="font-mono text-slate-800">{record.stdDev} g</span>
            </div>
          </div>

          <div className="border border-slate-400 rounded-lg p-3 bg-slate-50 space-y-1.5">
            <h4 className="font-bold text-slate-900 uppercase text-[11px] border-b border-slate-300 pb-1">
              ±10% Uniformity Classification & Feed Guidance
            </h4>
            <div className="flex justify-between">
              <span className="text-slate-600">Acceptable Range [0.90x̄ - 1.10x̄]:</span>
              <span className="font-mono font-bold text-slate-900">
                {(record.actualAvgWeight * 0.9).toFixed(1)}g - {(record.actualAvgWeight * 1.1).toFixed(1)}g
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-600">Birds in Uniform Range:</span>
              <span className="font-mono font-bold text-emerald-800">
                {record.uniformCount} birds ({record.uniformityPercent}%)
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-600">Underweight (&lt;90%) / Overweight (&gt;110%):</span>
              <span className="font-mono text-slate-800">
                {record.underCount} birds / {record.overCount} birds
              </span>
            </div>
            <div className="flex justify-between bg-emerald-50 p-1 rounded border border-emerald-200">
              <span className="text-emerald-900 font-bold">Flock Status Grade:</span>
              <span className="font-bold text-emerald-900 uppercase tracking-wider">{record.status}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-600">Authorized Daily Feed Allocation:</span>
              <span className="font-mono font-black text-amber-800 text-sm">
                {record.suggestedFeedGrams} g / bird / day (Std: {record.targetFeedGrams}g)
              </span>
            </div>
          </div>
        </div>

        {/* Reference: F-Value Lookup Table from Sheet */}
        <div className="mt-4 p-2 border border-slate-300 rounded bg-white text-[10px]">
          <span className="font-bold text-slate-700 block mb-1">
            STANDARD F-FACTOR TABLE (CV% = Range ÷ (x̄ × F) × 100):
          </span>
          <div className="grid grid-cols-5 sm:grid-cols-10 gap-1 font-mono text-center text-slate-600">
            {Object.entries(F_FACTOR_LOOKUP).map(([n, f]) => (
              <div key={n} className="border border-slate-200 p-0.5 rounded">
                <span className="block text-slate-400">N={n}</span>
                <span className="font-bold text-slate-900">{f}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Supervisor Signatures */}
        <div className="grid grid-cols-2 gap-8 mt-6 pt-4 border-t-2 border-slate-800 text-xs">
          <div>
            <p className="text-slate-500 font-medium">Weighed & Recorded By:</p>
            <div className="h-10 border-b border-slate-400 mt-2"></div>
            <p className="font-bold text-slate-900 mt-1">{record.weighedBy || 'Flock Technician'}</p>
            <p className="text-[10px] text-slate-500">Date: {record.weighDate}</p>
          </div>
          <div>
            <p className="text-slate-500 font-medium">Authorized By (Farm Manager / Vet):</p>
            <div className="h-10 border-b border-slate-400 mt-2"></div>
            <p className="font-bold text-slate-900 mt-1">Farm Production Manager</p>
            <p className="text-[10px] text-slate-500">Approved Feed Allocation: {record.suggestedFeedGrams} g/bird</p>
          </div>
        </div>
      </div>
    </div>
  );
};
