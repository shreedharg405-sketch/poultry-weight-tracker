import React, { useState, useMemo, useEffect } from 'react';
import { 
  Building2, 
  Calendar, 
  Download, 
  Plus, 
  Trash2, 
  Sparkles, 
  FileSpreadsheet, 
  RotateCcw,
  TrendingUp,
  TrendingDown,
  CheckCircle2,
  AlertTriangle,
  ArrowRight
} from 'lucide-react';
import * as XLSX from 'xlsx';

// F-Factor lookup table matching standard poultry bodyweight calculation
export const F_FACTOR_LOOKUP: Record<number, number> = {
  10: 3.08,
  15: 3.54,
  20: 3.73,
  25: 3.94,
  30: 4.09,
  35: 4.20,
  40: 4.30,
  45: 4.40,
  50: 4.50,
  55: 4.57,
  60: 4.64,
  65: 4.70,
  70: 4.76,
  75: 4.81,
  80: 4.87,
  85: 4.90,
  90: 4.94,
  95: 4.98,
  100: 5.02,
  150: 5.03,
};

export const getFFactor = (n: number): number => {
  if (n <= 10) return 3.08;
  if (n >= 150) return 5.03;
  if (F_FACTOR_LOOKUP[n]) return F_FACTOR_LOOKUP[n];

  const keys = Object.keys(F_FACTOR_LOOKUP).map(Number).sort((a, b) => a - b);
  for (let i = 0; i < keys.length - 1; i++) {
    const s1 = keys[i];
    const s2 = keys[i + 1];
    if (n >= s1 && n <= s2) {
      const f1 = F_FACTOR_LOOKUP[s1];
      const f2 = F_FACTOR_LOOKUP[s2];
      const ratio = (n - s1) / (s2 - s1);
      return Number((f1 + ratio * (f2 - f1)).toFixed(2));
    }
  }
  return 5.02;
};

// Suguna Seasonal Standard Benchmarks (Weeks 1 to 23)
export const SEASONAL_STANDARDS: Record<'Winter' | 'Summer', Record<number, { stdF: number; stdM: number }>> = {
  Winter: {
    1: { stdF: 140, stdM: 140 },
    2: { stdF: 260, stdM: 320 },
    3: { stdF: 400, stdM: 510 },
    4: { stdF: 520, stdM: 690 },
    5: { stdF: 630, stdM: 850 },
    6: { stdF: 730, stdM: 1000 },
    7: { stdF: 830, stdM: 1140 },
    8: { stdF: 920, stdM: 1270 },
    9: { stdF: 1010, stdM: 1400 },
    10: { stdF: 1100, stdM: 1530 },
    11: { stdF: 1180, stdM: 1650 },
    12: { stdF: 1260, stdM: 1770 },
    13: { stdF: 1340, stdM: 1880 },
    14: { stdF: 1430, stdM: 1990 },
    15: { stdF: 1530, stdM: 2110 },
    16: { stdF: 1640, stdM: 2240 },
    17: { stdF: 1765, stdM: 2390 },
    18: { stdF: 1905, stdM: 2550 },
    19: { stdF: 2065, stdM: 2720 },
    20: { stdF: 2235, stdM: 2890 },
    21: { stdF: 2415, stdM: 3050 },
    22: { stdF: 2585, stdM: 3200 },
    23: { stdF: 2745, stdM: 3340 }
  },
  Summer: {
    1: { stdF: 140, stdM: 140 },
    2: { stdF: 260, stdM: 320 },
    3: { stdF: 400, stdM: 510 },
    4: { stdF: 530, stdM: 690 },
    5: { stdF: 640, stdM: 850 },
    6: { stdF: 740, stdM: 1000 },
    7: { stdF: 840, stdM: 1140 },
    8: { stdF: 940, stdM: 1270 },
    9: { stdF: 1040, stdM: 1400 },
    10: { stdF: 1130, stdM: 1530 },
    11: { stdF: 1220, stdM: 1650 },
    12: { stdF: 1310, stdM: 1770 },
    13: { stdF: 1400, stdM: 1880 },
    14: { stdF: 1500, stdM: 1990 },
    15: { stdF: 1610, stdM: 2110 },
    16: { stdF: 1730, stdM: 2240 },
    17: { stdF: 1865, stdM: 2390 },
    18: { stdF: 2020, stdM: 2550 },
    19: { stdF: 2190, stdM: 2720 },
    20: { stdF: 2370, stdM: 2890 },
    21: { stdF: 2550, stdM: 3050 },
    22: { stdF: 2720, stdM: 3200 },
    23: { stdF: 2880, stdM: 3340 }
  }
};

export interface PenLine {
  id: number;
  name: string;
  weights: number[];
}

export interface ShedData {
  id: string;
  name: string;
  type: 'Female' | 'Male';
  lines: PenLine[];
}

// Initial sample data replicating exact sample from 'B.wt Excel format-1.xlsx'
const INITIAL_SHEDS_DATA: ShedData[] = [
  {
    id: '1',
    name: 'Shed 1',
    type: 'Female',
    lines: [
      { id: 1, name: 'Line 1', weights: [1270, 1290, 1300, 1300, 1330, 1370, 1380, 1390, 1400, 1450, 1850, 1950, 1985, 1990, 1890, 2000, 2040, 1650, 1690, 1720, 1750, 1780, 1810, 1840, 1880] },
      { id: 2, name: 'Line 2', weights: [1205, 1250, 1270, 1290, 1330, 1370, 1380, 1390, 1400, 1450, 1470, 1500, 1520, 1550, 1580, 1610, 1640, 1670, 1700, 1730, 1760, 1790] },
      { id: 3, name: 'Line 3', weights: [1270, 1290, 1300, 1300, 1330, 1370, 1380, 1390, 1400, 1450, 1470, 1500, 1500, 1510, 1540, 1580, 1620, 1660, 1700, 1740] }
    ]
  },
  {
    id: '2',
    name: 'Shed 2',
    type: 'Female',
    lines: [
      { id: 1, name: 'Line 1', weights: [1270, 1290, 1300, 1300, 1330, 1370, 1380, 1390, 1400, 1450, 1470, 1470, 1470, 1500, 1500, 1510, 1540, 1600, 1650, 1700, 1750, 1790] }
    ]
  },
  {
    id: '3',
    name: 'Shed 3',
    type: 'Female',
    lines: [
      { id: 1, name: 'Line 1', weights: [1270, 1290, 1300, 1300, 1330, 1370, 1380, 1390, 1400, 1450, 1470, 1470, 1470, 1500, 1500, 1510, 1540, 1600, 1650, 1700, 1750, 1790] }
    ]
  },
  {
    id: '4',
    name: 'Shed 4',
    type: 'Female',
    lines: [
      { id: 1, name: 'Line 1', weights: [1270, 1290, 1300, 1300, 1330, 1370, 1380, 1390, 1400, 1450, 1470, 1470, 1470, 1500, 1500, 1510, 1540, 1600, 1650, 1700, 1750, 1790] }
    ]
  },
  {
    id: '5',
    name: 'Shed 5',
    type: 'Female',
    lines: [
      { id: 1, name: 'Line 1', weights: [1270, 1290, 1300, 1300, 1330, 1370, 1380, 1390, 1400, 1450, 1470, 1470, 1470, 1500, 1500, 1510, 1540, 1600, 1650, 1700, 1750, 1790] }
    ]
  },
  {
    id: '6',
    name: 'Shed 6',
    type: 'Female',
    lines: [
      { id: 1, name: 'Line 1', weights: [1270, 1290, 1300, 1300, 1330, 1370, 1380, 1390, 1400, 1450, 1470, 1470, 1470, 1500, 1500, 1510, 1540, 1600, 1650, 1700, 1750, 1790] }
    ]
  },
  {
    id: '7',
    name: 'Shed 7',
    type: 'Female',
    lines: [
      { id: 1, name: 'Line 1', weights: [1270, 1290, 1300, 1300, 1330, 1370, 1380, 1390, 1400, 1450, 1470, 1470, 1470, 1500, 1500, 1510, 1540, 1600, 1650, 1700, 1750, 1790] }
    ]
  },
  {
    id: '8',
    name: 'Shed 8 Male',
    type: 'Male',
    lines: [
      { id: 1, name: 'Line 1', weights: [2800, 3000, 3800, 2650, 2950, 2456, 3566, 2800, 3000, 3800, 2650, 2950, 2456, 3566, 2800, 3000, 3800, 2900, 3100, 3200] }
    ]
  },
  {
    id: '9',
    name: 'Shed 9',
    type: 'Female',
    lines: [
      { id: 1, name: 'Line 1', weights: [1270, 1290, 1300, 1300, 1330, 1370, 1380, 1390, 1400, 1450, 1470, 1470, 1470, 1500, 1500, 1510, 1540, 1600, 1650, 1700, 1750, 1790] }
    ]
  },
  {
    id: '10',
    name: 'Shed 10',
    type: 'Female',
    lines: [
      { id: 1, name: 'Line 1', weights: [1270, 1290, 1300, 1300, 1330, 1370, 1380, 1390, 1400, 1450, 1470, 1470, 1470, 1500, 1500, 1510, 1540, 1600, 1650, 1700, 1750, 1790] }
    ]
  }
];

export const ExcelReplicaDashboard: React.FC = () => {
  // 1. FARM & FLOCK METADATA
  const [farmName, setFarmName] = useState<string>('SAI FARM - UNIT 1');
  const [date, setDate] = useState<string>(() => new Date().toISOString().split('T')[0]);
  const [season, setSeason] = useState<'Winter' | 'Summer'>('Winter');
  const [femaleAgeWeek, setFemaleAgeWeek] = useState<number>(18);
  const [maleAgeWeek, setMaleAgeWeek] = useState<number>(13);

  // Standard Target Weights based on Season and Week
  const stdWeightFemale = SEASONAL_STANDARDS[season][femaleAgeWeek]?.stdF || 1905;
  const stdWeightMale = SEASONAL_STANDARDS[season][maleAgeWeek]?.stdM || 1880;

  // Active View Tab: 'Cons' or Shed ID ('1' to '10')
  const [activeTab, setActiveTab] = useState<string>('Cons');
  const [selectedLineId, setSelectedLineId] = useState<number>(1);
  const [inputWeight, setInputWeight] = useState<string>('');

  // Sheds State
  const [sheds, setSheds] = useState<ShedData[]>(INITIAL_SHEDS_DATA);

  // Auto-Save / Load from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('poultry_bwt_excel_replica');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed.sheds && Array.isArray(parsed.sheds)) setSheds(parsed.sheds);
        if (parsed.farmName) setFarmName(parsed.farmName);
        if (parsed.date) setDate(parsed.date);
        if (parsed.season) setSeason(parsed.season);
        if (parsed.femaleAgeWeek) setFemaleAgeWeek(parsed.femaleAgeWeek);
        if (parsed.maleAgeWeek) setMaleAgeWeek(parsed.maleAgeWeek);
      } catch (err) {
        console.warn('Could not parse localStorage data:', err);
      }
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(
      'poultry_bwt_excel_replica',
      JSON.stringify({ farmName, sheds, date, season, femaleAgeWeek, maleAgeWeek })
    );
  }, [farmName, sheds, date, season, femaleAgeWeek, maleAgeWeek]);

  // Current Shed pointer
  const currentShed = sheds.find((s) => s.id === activeTab);
  const currentStd = currentShed?.type === 'Male' ? stdWeightMale : stdWeightFemale;

  // Add weight to selected line
  const handleAddWeight = (e: React.FormEvent) => {
    e.preventDefault();
    const val = parseFloat(inputWeight);
    if (!val || isNaN(val) || !currentShed) return;

    setSheds((prev) =>
      prev.map((s) => {
        if (s.id !== currentShed.id) return s;
        return {
          ...s,
          lines: s.lines.map((line) => {
            if (line.id !== selectedLineId) return line;
            return { ...line, weights: [...line.weights, val] };
          })
        };
      })
    );
    setInputWeight('');
  };

  // Delete weight
  const handleDeleteWeight = (shedId: string, lineId: number, index: number) => {
    setSheds((prev) =>
      prev.map((s) => {
        if (s.id !== shedId) return s;
        return {
          ...s,
          lines: s.lines.map((l) => {
            if (l.id !== lineId) return l;
            const updated = [...l.weights];
            updated.splice(index, 1);
            return { ...l, weights: updated };
          })
        };
      })
    );
  };

  // Add line to current shed
  const handleAddLine = () => {
    if (!currentShed) return;
    const nextId = currentShed.lines.length + 1;
    setSheds((prev) =>
      prev.map((s) => {
        if (s.id !== currentShed.id) return s;
        return {
          ...s,
          lines: [...s.lines, { id: nextId, name: `Line ${nextId}`, weights: [] }]
        };
      })
    );
    setSelectedLineId(nextId);
  };

  // Delete active line
  const handleDeleteLine = (lineId: number) => {
    if (!currentShed || currentShed.lines.length <= 1) return;
    setSheds((prev) =>
      prev.map((s) => {
        if (s.id !== currentShed.id) return s;
        const filtered = s.lines.filter((l) => l.id !== lineId);
        return { ...s, lines: filtered };
      })
    );
    const remaining = currentShed.lines.filter((l) => l.id !== lineId);
    if (remaining.length > 0) setSelectedLineId(remaining[0].id);
  };

  // Reset to initial demo dataset
  const handleResetData = () => {
    if (window.confirm('Reset all sheds and lines to original Excel template dataset?')) {
      setSheds(INITIAL_SHEDS_DATA);
      setFarmName('SAI FARM - UNIT 1');
      setSeason('Winter');
      setFemaleAgeWeek(18);
      setMaleAgeWeek(13);
    }
  };

  // Clear all weights for current shed
  const handleClearCurrentShed = () => {
    if (!currentShed) return;
    if (window.confirm(`Clear all weighed birds in ${currentShed.name}?`)) {
      setSheds((prev) =>
        prev.map((s) => {
          if (s.id !== currentShed.id) return s;
          return {
            ...s,
            lines: s.lines.map((l) => ({ ...l, weights: [] }))
          };
        })
      );
    }
  };

  // Statistical calculations matching Excel rows 56 to 69
  const computeLineStats = (weights: number[], stdTarget: number) => {
    const count = weights.length;
    if (count === 0) {
      return { count: 0, avg: 0, diff: 0, min: 0, max: 0, cv: 0, mb: 0, b: 0, s: 0, a: 0, ma: 0, unif: 0 };
    }

    const sum = weights.reduce((acc, w) => acc + w, 0);
    const avg = Number((sum / count).toFixed(1));
    const diff = Number((avg - stdTarget).toFixed(1));
    const min = Math.min(...weights);
    const max = Math.max(...weights);

    const fFactor = getFFactor(count);
    const cv = Number((((max - min) * 100) / (avg * fFactor)).toFixed(2));

    // Standard Grading Bands:
    // MB (< -15%), B (-15% to -10%), S (-10% to +10%), A (+10% to +15%), MA (> +15%)
    const sLow = stdTarget * 0.90;
    const sHigh = stdTarget * 1.10;
    const mbLimit = stdTarget * 0.85;
    const maLimit = stdTarget * 1.15;

    let mb = 0, b = 0, s = 0, a = 0, ma = 0;
    weights.forEach((w) => {
      if (w < mbLimit) mb++;
      else if (w < sLow) b++;
      else if (w <= sHigh) s++;
      else if (w <= maLimit) a++;
      else ma++;
    });

    return {
      count,
      avg,
      diff,
      min,
      max,
      cv,
      mb: Number(((mb / count) * 100).toFixed(1)),
      b: Number(((b / count) * 100).toFixed(1)),
      s: Number(((s / count) * 100).toFixed(1)),
      a: Number(((a / count) * 100).toFixed(1)),
      ma: Number(((ma / count) * 100).toFixed(1)),
      unif: Number(((s / count) * 100).toFixed(1))
    };
  };

  // Shed Aggregation
  const computeShedStats = (shed: ShedData) => {
    const allWeights = shed.lines.flatMap((l) => l.weights);
    const std = shed.type === 'Male' ? stdWeightMale : stdWeightFemale;
    return computeLineStats(allWeights, std);
  };

  // Master Consolidated Conclusion (Cons Sheet Replica)
  const consolidatedStats = useMemo(() => {
    const femaleSheds = sheds.filter((s) => s.type === 'Female');
    const maleSheds = sheds.filter((s) => s.type === 'Male');

    const femaleWeights = femaleSheds.flatMap((s) => s.lines.flatMap((l) => l.weights));
    const maleWeights = maleSheds.flatMap((s) => s.lines.flatMap((l) => l.weights));

    const fStats = computeLineStats(femaleWeights, stdWeightFemale);
    const mStats = computeLineStats(maleWeights, stdWeightMale);

    const shedRows = sheds.map((s) => {
      const stats = computeShedStats(s);
      return {
        id: s.id,
        name: s.name,
        type: s.type,
        avg: stats.avg,
        min: stats.min,
        max: stats.max,
        unif: stats.unif,
        cv: stats.cv,
        count: stats.count
      };
    });

    return { fStats, mStats, shedRows };
  }, [sheds, stdWeightFemale, stdWeightMale]);

  // Export exact Multi-Tab Excel Workbook (.xlsx)
  const handleExportExcel = () => {
    const wb = XLSX.utils.book_new();

    // 1. Build "Cons" Sheet
    const consData: (string | number)[][] = [
      ['Farm Name:', farmName, 'Date:', date, 'Season:', `${season} Brooding`],
      [],
      ['', '', 'Female (♀)', 'Male (♂)', '', 'Shed No', 'Shed Name', 'Sex', 'Act B.Wt (g)', 'Min (g)', 'Max (g)', 'CV %', 'Uniformity %', 'Sample Size'],
      ['', 'Age', `W${femaleAgeWeek}F`, `M${maleAgeWeek}`],
      ['', 'STD B.WT', stdWeightFemale, stdWeightMale],
      ['', 'Act B.WT', consolidatedStats.fStats.avg, consolidatedStats.mStats.avg],
      ['', 'Diff', consolidatedStats.fStats.diff, consolidatedStats.mStats.diff],
      ['', 'CV % (F-factor)', `${consolidatedStats.fStats.cv}%`, `${consolidatedStats.mStats.cv}%`],
      ['', 'Min', consolidatedStats.fStats.min, consolidatedStats.mStats.min],
      ['', 'Max', consolidatedStats.fStats.max, consolidatedStats.mStats.max],
      ['', 'MB % (< -15%)', `${consolidatedStats.fStats.mb}%`, `${consolidatedStats.mStats.mb}%`],
      ['', 'B % (-10% to -15%)', `${consolidatedStats.fStats.b}%`, `${consolidatedStats.mStats.b}%`],
      ['', 'S % (Ideal ±10%)', `${consolidatedStats.fStats.s}%`, `${consolidatedStats.mStats.s}%`],
      ['', 'A % (+10% to +15%)', `${consolidatedStats.fStats.a}%`, `${consolidatedStats.mStats.a}%`],
      ['', 'MA % (> +15%)', `${consolidatedStats.fStats.ma}%`, `${consolidatedStats.mStats.ma}%`],
      ['', 'Sample Birds Weighed', consolidatedStats.fStats.count, consolidatedStats.mStats.count]
    ];

    consolidatedStats.shedRows.forEach((s, idx) => {
      const rowIdx = 3 + idx;
      while (consData.length <= rowIdx) consData.push([]);
      consData[rowIdx][5] = s.id;
      consData[rowIdx][6] = s.name;
      consData[rowIdx][7] = s.type;
      consData[rowIdx][8] = s.avg;
      consData[rowIdx][9] = s.min;
      consData[rowIdx][10] = s.max;
      consData[rowIdx][11] = `${s.cv}%`;
      consData[rowIdx][12] = `${s.unif}%`;
      consData[rowIdx][13] = s.count;
    });

    const wsCons = XLSX.utils.aoa_to_sheet(consData);
    XLSX.utils.book_append_sheet(wb, wsCons, 'Cons');

    // 2. Build Individual Shed Sheets
    sheds.forEach((shed) => {
      const shedRows: (string | number)[][] = [
        ['Farm:', farmName, 'Shed:', shed.name, 'Sex:', shed.type, 'Date:', date],
        ['Season:', `${season} Brooding`, 'Target Std B.Wt:', shed.type === 'Male' ? stdWeightMale : stdWeightFemale],
        []
      ];

      const headerRow: (string | number)[] = ['Sample #'];
      shed.lines.forEach((l) => headerRow.push(l.name, 'Grade'));
      shedRows.push(headerRow);

      const maxSamples = Math.max(...shed.lines.map((l) => l.weights.length), 0);
      const std = shed.type === 'Male' ? stdWeightMale : stdWeightFemale;

      for (let i = 0; i < maxSamples; i++) {
        const row: (string | number)[] = [i + 1];
        shed.lines.forEach((l) => {
          const w = l.weights[i];
          if (w !== undefined) {
            let grade = 'S';
            if (w < std * 0.85) grade = 'MB';
            else if (w < std * 0.90) grade = 'B';
            else if (w > std * 1.15) grade = 'MA';
            else if (w > std * 1.10) grade = 'A';
            row.push(w, grade);
          } else {
            row.push('', '');
          }
        });
        shedRows.push(row);
      }

      shedRows.push([]);
      shedRows.push(['Count', ...shed.lines.flatMap((l) => [computeLineStats(l.weights, std).count, ''])]);
      shedRows.push(['Avg Wt', ...shed.lines.flatMap((l) => [computeLineStats(l.weights, std).avg, ''])]);
      shedRows.push(['Diff', ...shed.lines.flatMap((l) => [computeLineStats(l.weights, std).diff, ''])]);
      shedRows.push(['Min', ...shed.lines.flatMap((l) => [computeLineStats(l.weights, std).min, ''])]);
      shedRows.push(['Max', ...shed.lines.flatMap((l) => [computeLineStats(l.weights, std).max, ''])]);
      shedRows.push(['CV %', ...shed.lines.flatMap((l) => [`${computeLineStats(l.weights, std).cv}%`, ''])]);
      shedRows.push(['Uniformity %', ...shed.lines.flatMap((l) => [`${computeLineStats(l.weights, std).unif}%`, ''])]);

      const wsShed = XLSX.utils.aoa_to_sheet(shedRows);
      XLSX.utils.book_append_sheet(wb, wsShed, shed.name.substring(0, 31));
    });

    const fileName = `${farmName.replace(/\s+/g, '_')}_B_Weight_${date}.xlsx`;
    XLSX.writeFile(wb, fileName);
  };

  return (
    <div className="space-y-6">
      
      {/* 1. EDITABLE FARM HEADER */}
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-4 sm:p-6 shadow-xl relative overflow-hidden">
        <div className="absolute top-0 right-0 w-96 h-96 bg-emerald-500/5 rounded-full blur-3xl -z-10 pointer-events-none" />
        <div className="absolute bottom-0 left-0 w-96 h-96 bg-amber-500/5 rounded-full blur-3xl -z-10 pointer-events-none" />

        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-start sm:items-center gap-3.5">
            <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-2xl text-emerald-400 shrink-0 shadow-inner">
              <Building2 className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <input 
                  type="text" 
                  value={farmName} 
                  onChange={(e) => setFarmName(e.target.value)}
                  className="bg-transparent font-black text-xl sm:text-2xl text-white tracking-wide border-b border-dashed border-slate-700 hover:border-slate-500 focus:border-emerald-500 focus:outline-none transition py-0.5"
                  placeholder="Farm Name"
                  title="Click to edit Farm Name"
                />
              </div>
              <p className="text-xs text-slate-400 mt-1 flex items-center gap-2">
                <span>Excel Replica Standard Matrix (B.wt Format)</span>
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                <span className="text-emerald-400 font-medium">Real-Time Auto-Save</span>
              </p>
            </div>
          </div>

          {/* Controls: Date, Age (Female & Male), Season, Actions */}
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="flex items-center gap-2 bg-slate-950/80 px-3 py-2 rounded-xl border border-slate-800 text-xs">
              <Calendar className="w-3.5 h-3.5 text-slate-400" />
              <input 
                type="date" 
                value={date} 
                onChange={(e) => setDate(e.target.value)}
                className="bg-transparent text-slate-200 focus:outline-none text-xs font-mono"
              />
            </div>

            <div className="flex items-center gap-1.5 bg-slate-950/80 px-2.5 py-1.5 rounded-xl border border-slate-800 text-xs">
              <span className="text-slate-400 font-semibold">Season:</span>
              <select 
                value={season} 
                onChange={(e) => setSeason(e.target.value as any)}
                className="bg-transparent text-emerald-400 font-bold focus:outline-none cursor-pointer"
              >
                <option value="Winter" className="bg-slate-900 text-white">Winter Brood (Aug-Jan)</option>
                <option value="Summer" className="bg-slate-900 text-white">Summer Brood (Feb-Jul)</option>
              </select>
            </div>

            <div className="flex items-center gap-1.5 bg-slate-950/80 px-2.5 py-1.5 rounded-xl border border-slate-800 text-xs">
              <span className="text-pink-400 font-bold">♀ Age:</span>
              <select 
                value={femaleAgeWeek} 
                onChange={(e) => setFemaleAgeWeek(Number(e.target.value))}
                className="bg-transparent text-white font-bold focus:outline-none cursor-pointer"
              >
                {Array.from({ length: 23 }, (_, i) => i + 1).map((w) => (
                  <option key={w} value={w} className="bg-slate-900 text-white">
                    W{w}F ({SEASONAL_STANDARDS[season][w]?.stdF}g)
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-1.5 bg-slate-950/80 px-2.5 py-1.5 rounded-xl border border-slate-800 text-xs">
              <span className="text-blue-400 font-bold">♂ Age:</span>
              <select 
                value={maleAgeWeek} 
                onChange={(e) => setMaleAgeWeek(Number(e.target.value))}
                className="bg-transparent text-white font-bold focus:outline-none cursor-pointer"
              >
                {Array.from({ length: 23 }, (_, i) => i + 1).map((w) => (
                  <option key={w} value={w} className="bg-slate-900 text-white">
                    M{w} ({SEASONAL_STANDARDS[season][w]?.stdM}g)
                  </option>
                ))}
              </select>
            </div>

            <button
              onClick={handleExportExcel}
              className="bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-black px-4 py-2 rounded-xl text-xs flex items-center gap-1.5 transition active:scale-95 shadow-md shadow-emerald-950 ml-auto sm:ml-0"
              title="Download exact multi-sheet .xlsx workbook matching B.wt format"
            >
              <Download className="w-4 h-4" />
              <span>Export .xlsx</span>
            </button>

            <button
              onClick={handleResetData}
              className="bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold px-3 py-2 rounded-xl text-xs flex items-center gap-1.5 transition"
              title="Reset data back to template demo"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reset</span>
            </button>
          </div>
        </div>
      </div>

      {/* 2. SHED TABS NAVIGATION */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-2 shadow-lg backdrop-blur-md">
        <div className="flex items-center gap-2 overflow-x-auto no-scrollbar">
          <button
            onClick={() => setActiveTab('Cons')}
            className={`px-4 py-2.5 rounded-xl text-xs font-black tracking-wider transition whitespace-nowrap flex items-center gap-2 shrink-0 ${
              activeTab === 'Cons' 
                ? 'bg-amber-500 text-slate-950 shadow-md shadow-amber-950 ring-2 ring-amber-400/50' 
                : 'bg-slate-950/60 text-slate-400 hover:text-white hover:bg-slate-800'
            }`}
          >
            <Sparkles className="w-4 h-4 text-amber-950" />
            <span>CONSOLIDATED CONCLUSION (Cons)</span>
          </button>

          <div className="h-6 w-[1px] bg-slate-800 mx-1 shrink-0" />

          {sheds.map((shed) => {
            const count = shed.lines.reduce((acc, l) => acc + l.weights.length, 0);
            return (
              <button
                key={shed.id}
                onClick={() => {
                  setActiveTab(shed.id);
                  setSelectedLineId(shed.lines[0]?.id || 1);
                }}
                className={`px-3.5 py-2.5 rounded-xl text-xs font-bold transition whitespace-nowrap flex items-center gap-2 shrink-0 ${
                  activeTab === shed.id 
                    ? 'bg-emerald-500 text-slate-950 shadow-md shadow-emerald-950 ring-2 ring-emerald-400/50' 
                    : 'bg-slate-950/60 text-slate-400 hover:text-white hover:bg-slate-800'
                }`}
              >
                <span>{shed.name}</span>
                <span
                  className={`text-[10px] px-1.5 py-0.5 rounded font-black ${
                    shed.type === 'Male'
                      ? 'bg-blue-950 text-blue-300 border border-blue-800/60'
                      : 'bg-pink-950 text-pink-300 border border-pink-800/60'
                  }`}
                >
                  {shed.type === 'Male' ? '♂ M' : '♀ F'}
                </span>
                <span className="bg-slate-900/80 text-slate-300 px-1.5 py-0.5 rounded-full text-[10px] font-mono">
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 3. ACTIVE TAB CONTENT */}

      {/* ================================================================= */}
      {/* VIEW 1: CONSOLIDATED CONCLUSION ("Cons" Sheet Replica)            */}
      {/* ================================================================= */}
      {activeTab === 'Cons' && (
        <div className="space-y-6">
          
          {/* Top Cards: Female vs Male Overall Breakdown */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            
            {/* Female Overall Card */}
            <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 sm:p-6 shadow-xl relative overflow-hidden">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3 mb-5">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-xl bg-pink-500/10 border border-pink-500/30 flex items-center justify-center text-pink-400 font-bold text-lg">
                    ♀
                  </div>
                  <div>
                    <h3 className="font-black text-base sm:text-lg text-white">Female Overall (W{femaleAgeWeek}F)</h3>
                    <p className="text-[11px] text-slate-400">Target Standard Weight: <span className="text-white font-mono font-bold">{stdWeightFemale}g</span></p>
                  </div>
                </div>
                <span className="text-xs bg-pink-950/70 text-pink-300 font-bold px-3 py-1 rounded-full border border-pink-800/40">
                  {consolidatedStats.fStats.count} birds weighed
                </span>
              </div>

              <div className="grid grid-cols-3 gap-3 text-center mb-5">
                <div className="bg-slate-950/80 p-3.5 rounded-2xl border border-slate-800">
                  <span className="text-[10px] text-slate-400 uppercase font-semibold tracking-wider">Act B.Wt</span>
                  <div className="text-xl sm:text-2xl font-black text-emerald-400 mt-0.5">
                    {consolidatedStats.fStats.avg}g
                  </div>
                  <span className={`text-[10px] font-mono font-bold ${consolidatedStats.fStats.diff >= 0 ? 'text-emerald-400' : 'text-amber-400'}`}>
                    Diff: {consolidatedStats.fStats.diff > 0 ? `+${consolidatedStats.fStats.diff}` : consolidatedStats.fStats.diff}g
                  </span>
                </div>

                <div className="bg-slate-950/80 p-3.5 rounded-2xl border border-slate-800">
                  <span className="text-[10px] text-slate-400 uppercase font-semibold tracking-wider">Uniformity (S%)</span>
                  <div className="text-xl sm:text-2xl font-black text-amber-400 mt-0.5">
                    {consolidatedStats.fStats.unif}%
                  </div>
                  <span className="text-[10px] text-slate-400 font-medium">Standard Target ±10%</span>
                </div>

                <div className="bg-slate-950/80 p-3.5 rounded-2xl border border-slate-800">
                  <span className="text-[10px] text-slate-400 uppercase font-semibold tracking-wider">CV % (F-Factor)</span>
                  <div className="text-xl sm:text-2xl font-black text-sky-400 mt-0.5">
                    {consolidatedStats.fStats.cv}%
                  </div>
                  <span className="text-[10px] text-slate-400 font-mono">
                    Min {consolidatedStats.fStats.min} / Max {consolidatedStats.fStats.max}
                  </span>
                </div>
              </div>

              {/* Grade Spread Progress Bar */}
              <div className="bg-slate-950/90 p-4 rounded-2xl border border-slate-800 text-xs">
                <div className="flex flex-wrap justify-between text-[11px] text-slate-400 font-semibold mb-2 gap-2">
                  <span className="text-white font-bold">Standard Grade Spread:</span>
                  <div className="flex gap-2 text-[10px] font-mono">
                    <span className="text-rose-400">MB: {consolidatedStats.fStats.mb}%</span>
                    <span className="text-amber-400">B: {consolidatedStats.fStats.b}%</span>
                    <span className="text-emerald-400 font-bold">S: {consolidatedStats.fStats.s}%</span>
                    <span className="text-sky-400">A: {consolidatedStats.fStats.a}%</span>
                    <span className="text-purple-400">MA: {consolidatedStats.fStats.ma}%</span>
                  </div>
                </div>
                <div className="w-full bg-slate-800 h-3 rounded-full overflow-hidden flex shadow-inner">
                  <div style={{ width: `${consolidatedStats.fStats.mb}%` }} className="bg-rose-500" title={`MB: ${consolidatedStats.fStats.mb}%`} />
                  <div style={{ width: `${consolidatedStats.fStats.b}%` }} className="bg-amber-500" title={`B: ${consolidatedStats.fStats.b}%`} />
                  <div style={{ width: `${consolidatedStats.fStats.s}%` }} className="bg-emerald-500" title={`S: ${consolidatedStats.fStats.s}%`} />
                  <div style={{ width: `${consolidatedStats.fStats.a}%` }} className="bg-sky-500" title={`A: ${consolidatedStats.fStats.a}%`} />
                  <div style={{ width: `${consolidatedStats.fStats.ma}%` }} className="bg-purple-500" title={`MA: ${consolidatedStats.fStats.ma}%`} />
                </div>
              </div>
            </div>

            {/* Male Overall Card */}
            <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 sm:p-6 shadow-xl relative overflow-hidden">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3 mb-5">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-xl bg-blue-500/10 border border-blue-500/30 flex items-center justify-center text-blue-400 font-bold text-lg">
                    ♂
                  </div>
                  <div>
                    <h3 className="font-black text-base sm:text-lg text-white">Male Overall (M{maleAgeWeek})</h3>
                    <p className="text-[11px] text-slate-400">Target Standard Weight: <span className="text-white font-mono font-bold">{stdWeightMale}g</span></p>
                  </div>
                </div>
                <span className="text-xs bg-blue-950/70 text-blue-300 font-bold px-3 py-1 rounded-full border border-blue-800/40">
                  {consolidatedStats.mStats.count} birds weighed
                </span>
              </div>

              <div className="grid grid-cols-3 gap-3 text-center mb-5">
                <div className="bg-slate-950/80 p-3.5 rounded-2xl border border-slate-800">
                  <span className="text-[10px] text-slate-400 uppercase font-semibold tracking-wider">Act B.Wt</span>
                  <div className="text-xl sm:text-2xl font-black text-emerald-400 mt-0.5">
                    {consolidatedStats.mStats.avg}g
                  </div>
                  <span className={`text-[10px] font-mono font-bold ${consolidatedStats.mStats.diff >= 0 ? 'text-emerald-400' : 'text-amber-400'}`}>
                    Diff: {consolidatedStats.mStats.diff > 0 ? `+${consolidatedStats.mStats.diff}` : consolidatedStats.mStats.diff}g
                  </span>
                </div>

                <div className="bg-slate-950/80 p-3.5 rounded-2xl border border-slate-800">
                  <span className="text-[10px] text-slate-400 uppercase font-semibold tracking-wider">Uniformity (S%)</span>
                  <div className="text-xl sm:text-2xl font-black text-amber-400 mt-0.5">
                    {consolidatedStats.mStats.unif}%
                  </div>
                  <span className="text-[10px] text-slate-400 font-medium">Standard Target ±10%</span>
                </div>

                <div className="bg-slate-950/80 p-3.5 rounded-2xl border border-slate-800">
                  <span className="text-[10px] text-slate-400 uppercase font-semibold tracking-wider">CV % (F-Factor)</span>
                  <div className="text-xl sm:text-2xl font-black text-sky-400 mt-0.5">
                    {consolidatedStats.mStats.cv}%
                  </div>
                  <span className="text-[10px] text-slate-400 font-mono">
                    Min {consolidatedStats.mStats.min} / Max {consolidatedStats.mStats.max}
                  </span>
                </div>
              </div>

              {/* Grade Spread Progress Bar */}
              <div className="bg-slate-950/90 p-4 rounded-2xl border border-slate-800 text-xs">
                <div className="flex flex-wrap justify-between text-[11px] text-slate-400 font-semibold mb-2 gap-2">
                  <span className="text-white font-bold">Standard Grade Spread:</span>
                  <div className="flex gap-2 text-[10px] font-mono">
                    <span className="text-rose-400">MB: {consolidatedStats.mStats.mb}%</span>
                    <span className="text-amber-400">B: {consolidatedStats.mStats.b}%</span>
                    <span className="text-emerald-400 font-bold">S: {consolidatedStats.mStats.s}%</span>
                    <span className="text-sky-400">A: {consolidatedStats.mStats.a}%</span>
                    <span className="text-purple-400">MA: {consolidatedStats.mStats.ma}%</span>
                  </div>
                </div>
                <div className="w-full bg-slate-800 h-3 rounded-full overflow-hidden flex shadow-inner">
                  <div style={{ width: `${consolidatedStats.mStats.mb}%` }} className="bg-rose-500" title={`MB: ${consolidatedStats.mStats.mb}%`} />
                  <div style={{ width: `${consolidatedStats.mStats.b}%` }} className="bg-amber-500" title={`B: ${consolidatedStats.mStats.b}%`} />
                  <div style={{ width: `${consolidatedStats.mStats.s}%` }} className="bg-emerald-500" title={`S: ${consolidatedStats.mStats.s}%`} />
                  <div style={{ width: `${consolidatedStats.mStats.a}%` }} className="bg-sky-500" title={`A: ${consolidatedStats.mStats.a}%`} />
                  <div style={{ width: `${consolidatedStats.mStats.ma}%` }} className="bg-purple-500" title={`MA: ${consolidatedStats.mStats.ma}%`} />
                </div>
              </div>
            </div>

          </div>

          {/* Shed-Wise Comparison Table (Excel Cons Sheet Columns I to L) */}
          <div className="bg-slate-900 border border-slate-800 rounded-3xl overflow-hidden shadow-xl">
            <div className="px-6 py-4 border-b border-slate-800 flex flex-wrap justify-between items-center bg-slate-900/90 gap-2">
              <div>
                <h3 className="font-black text-base text-white flex items-center gap-2">
                  <FileSpreadsheet className="w-4 h-4 text-emerald-400" />
                  <span>Shed-Wise Conclusion Table</span>
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">Shed 1 to 10 Consolidated Uniformity & Body Weight Analysis</p>
              </div>
              <span className="text-xs bg-slate-800 text-slate-300 px-3 py-1 rounded-full font-mono">
                {sheds.length} Sheds Total
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-950 text-slate-400 uppercase text-[10px] tracking-wider border-b border-slate-800">
                  <tr>
                    <th className="py-3.5 px-4 font-bold">Shed #</th>
                    <th className="py-3.5 px-4 font-bold">Shed Name</th>
                    <th className="py-3.5 px-4 font-bold">Sex</th>
                    <th className="py-3.5 px-4 font-bold">Sample Birds</th>
                    <th className="py-3.5 px-4 font-bold text-emerald-400">Act B.Wt</th>
                    <th className="py-3.5 px-4 font-bold">Min</th>
                    <th className="py-3.5 px-4 font-bold">Max</th>
                    <th className="py-3.5 px-4 font-bold">CV %</th>
                    <th className="py-3.5 px-4 font-bold text-amber-400">Uniformity (S%)</th>
                    <th className="py-3.5 px-4 font-bold text-center">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70 font-medium">
                  {consolidatedStats.shedRows.map((s) => (
                    <tr key={s.id} className="hover:bg-slate-800/40 transition">
                      <td className="py-3 px-4 font-mono font-bold text-white">{s.id}</td>
                      <td className="py-3 px-4 text-slate-200 font-semibold">{s.name}</td>
                      <td className="py-3 px-4">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          s.type === 'Male' 
                            ? 'bg-blue-950 text-blue-300 border border-blue-800/40' 
                            : 'bg-pink-950 text-pink-300 border border-pink-800/40'
                        }`}>
                          {s.type === 'Male' ? '♂ Male' : '♀ Female'}
                        </span>
                      </td>
                      <td className="py-3 px-4 font-mono text-slate-300">
                        {s.count > 0 ? `${s.count} birds` : <span className="text-slate-600">0 birds</span>}
                      </td>
                      <td className="py-3 px-4 font-bold text-emerald-400 font-mono text-sm">
                        {s.count > 0 ? `${s.avg}g` : '-'}
                      </td>
                      <td className="py-3 px-4 font-mono text-slate-400">
                        {s.count > 0 ? `${s.min}g` : '-'}
                      </td>
                      <td className="py-3 px-4 font-mono text-slate-400">
                        {s.count > 0 ? `${s.max}g` : '-'}
                      </td>
                      <td className="py-3 px-4 font-mono">
                        {s.count > 0 ? `${s.cv}%` : '-'}
                      </td>
                      <td className="py-3 px-4 font-bold font-mono text-amber-400 text-sm">
                        {s.count > 0 ? `${s.unif}%` : '-'}
                      </td>
                      <td className="py-3 px-4 text-center">
                        <button
                          onClick={() => {
                            setActiveTab(s.id);
                            setSelectedLineId(1);
                          }}
                          className="text-xs bg-slate-800 hover:bg-emerald-600 hover:text-slate-950 text-slate-200 font-semibold px-3 py-1.5 rounded-xl transition flex items-center gap-1 mx-auto"
                        >
                          <span>Enter Data</span>
                          <ArrowRight className="w-3 h-3" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

        </div>
      )}

      {/* ================================================================= */}
      {/* VIEW 2: SHED MANUAL ENTRY SHEET (Shed 1 to 10 Tabs)               */}
      {/* ================================================================= */}
      {activeTab !== 'Cons' && currentShed && (
        <div className="space-y-4">
          
          {/* Shed Live Banner */}
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 flex flex-wrap justify-between items-center gap-4 shadow-xl">
            <div>
              <div className="flex items-center gap-3">
                <h2 className="text-xl sm:text-2xl font-black text-white">{currentShed.name}</h2>
                <button
                  onClick={() => {
                    setSheds((prev) =>
                      prev.map((s) => {
                        if (s.id !== currentShed.id) return s;
                        return { ...s, type: s.type === 'Male' ? 'Female' : 'Male' };
                      })
                    );
                  }}
                  className={`text-xs px-2.5 py-1 rounded-xl font-black border transition ${
                    currentShed.type === 'Male'
                      ? 'bg-blue-950 text-blue-300 border-blue-800/60 hover:bg-blue-900'
                      : 'bg-pink-950 text-pink-300 border-pink-800/60 hover:bg-pink-900'
                  }`}
                  title="Click to toggle Gender for this Shed"
                >
                  {currentShed.type === 'Male' ? '♂ Male' : '♀ Female'} (Std: {currentStd}g)
                </button>
              </div>
              <p className="text-xs text-slate-400 mt-1">
                Manual Sample Weighing • Line-by-Line Auto-Grading & Real-Time Conclusion
              </p>
            </div>

            {(() => {
              const sStats = computeShedStats(currentShed);
              return (
                <div className="flex items-center gap-4 sm:gap-6 text-right bg-slate-950/80 px-4 py-2.5 rounded-2xl border border-slate-800">
                  <div>
                    <div className="text-[10px] text-slate-400 uppercase font-semibold">Shed Mean</div>
                    <div className="text-lg font-black text-emerald-400">{sStats.avg}g</div>
                  </div>
                  <div className="h-7 w-[1px] bg-slate-800" />
                  <div>
                    <div className="text-[10px] text-slate-400 uppercase font-semibold">Shed Uniformity</div>
                    <div className="text-lg font-black text-amber-400">{sStats.unif}%</div>
                  </div>
                  <div className="h-7 w-[1px] bg-slate-800" />
                  <div>
                    <div className="text-[10px] text-slate-400 uppercase font-semibold">Shed CV %</div>
                    <div className="text-lg font-black text-sky-400">{sStats.cv}%</div>
                  </div>
                  <div className="h-7 w-[1px] bg-slate-800" />
                  <button
                    onClick={handleClearCurrentShed}
                    className="text-slate-400 hover:text-rose-400 transition p-1"
                    title="Clear all weights in this shed"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              );
            })()}
          </div>

          {/* Line Selection Ribbon */}
          <div className="flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar">
            {currentShed.lines.map((line) => (
              <div key={line.id} className="relative group shrink-0">
                <button
                  onClick={() => setSelectedLineId(line.id)}
                  className={`px-3.5 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 whitespace-nowrap ${
                    selectedLineId === line.id 
                      ? 'bg-emerald-600 text-white shadow-md shadow-emerald-950 ring-2 ring-emerald-500/50' 
                      : 'bg-slate-900 border border-slate-800 text-slate-400 hover:text-white hover:bg-slate-800'
                  }`}
                >
                  <span>{line.name}</span>
                  <span className="bg-slate-950 px-1.5 py-0.5 rounded-full text-[10px] text-emerald-400 font-mono">
                    {line.weights.length}
                  </span>
                </button>
                {currentShed.lines.length > 1 && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteLine(line.id);
                    }}
                    className="absolute -top-1.5 -right-1.5 bg-rose-900 text-rose-300 w-4 h-4 rounded-full text-[10px] hidden group-hover:flex items-center justify-center hover:bg-rose-700"
                    title={`Delete ${line.name}`}
                  >
                    ×
                  </button>
                )}
              </div>
            ))}

            <button
              onClick={handleAddLine}
              className="bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition shrink-0"
              title="Add a new pen/line in this shed"
            >
              <Plus className="w-3.5 h-3.5 text-emerald-400" />
              <span>Add Line</span>
            </button>
          </div>

          {/* Input Form & Quick Keypad */}
          <div className="bg-slate-900 border border-slate-800 p-3 rounded-2xl flex flex-col sm:flex-row items-stretch sm:items-center gap-3 shadow-lg">
            <form onSubmit={handleAddWeight} className="flex-1 flex items-center gap-2">
              <input
                type="number"
                step="1"
                placeholder={`Enter bird weight (g) for ${currentShed.lines.find((l) => l.id === selectedLineId)?.name || 'selected line'}...`}
                value={inputWeight}
                onChange={(e) => setInputWeight(e.target.value)}
                autoFocus
                className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-base font-bold text-white focus:outline-none focus:border-emerald-500 font-mono"
              />
              <button
                type="submit"
                className="bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-black px-5 py-2.5 rounded-xl text-xs flex items-center gap-1.5 transition active:scale-95 shadow-md shadow-emerald-950 shrink-0"
              >
                <Plus className="w-4 h-4" />
                <span>Save Bird</span>
              </button>
            </form>

            {/* Quick Increment Shortcuts */}
            <div className="flex items-center gap-1.5 overflow-x-auto text-xs font-mono font-bold no-scrollbar">
              {[currentStd - 100, currentStd, currentStd + 100].map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setInputWeight(preset.toString())}
                  className="bg-slate-800 hover:bg-slate-700 text-slate-300 px-2.5 py-1.5 rounded-lg border border-slate-700 text-xs shrink-0"
                >
                  {preset}g
                </button>
              ))}
            </div>
          </div>

          {/* Line Matrix Table (Side-by-side lines like in Shed 1 Excel sheet) */}
          <div className="bg-slate-900 border border-slate-800 rounded-3xl overflow-hidden shadow-xl">
            <div className="overflow-x-auto max-h-[550px]">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="bg-slate-950 text-slate-400 text-[10px] uppercase tracking-wider sticky top-0 z-20 border-b border-slate-800">
                  <tr>
                    <th className="py-3 px-3 border-r border-slate-800 w-12 text-center font-bold">#</th>
                    {currentShed.lines.map((line) => (
                      <th
                        key={line.id}
                        colSpan={2}
                        className={`py-3 px-3 border-r border-slate-800 text-center font-bold ${
                          selectedLineId === line.id ? 'text-emerald-400 bg-emerald-950/20' : 'text-slate-200'
                        }`}
                      >
                        {line.name} ({line.weights.length} birds)
                      </th>
                    ))}
                  </tr>
                  <tr className="bg-slate-950/90 text-slate-500 text-[9px]">
                    <th className="border-r border-slate-800"></th>
                    {currentShed.lines.map((line) => (
                      <React.Fragment key={`sub-${line.id}`}>
                        <th className="px-2.5 py-1.5 text-slate-400">Weight (g)</th>
                        <th className="px-2.5 py-1.5 border-r border-slate-800 text-slate-400 text-center">Grade</th>
                      </React.Fragment>
                    ))}
                  </tr>
                </thead>

                <tbody className="divide-y divide-slate-800/60 font-mono text-xs">
                  {Array.from({ length: Math.max(...currentShed.lines.map((l) => l.weights.length), 10) }).map((_, rIdx) => (
                    <tr key={rIdx} className="hover:bg-slate-800/30 transition">
                      <td className="py-1 px-3 border-r border-slate-800 text-center text-slate-500 font-sans text-[10px]">
                        {rIdx + 1}
                      </td>
                      {currentShed.lines.map((line) => {
                        const w = line.weights[rIdx];
                        if (w === undefined) {
                          return (
                            <React.Fragment key={`empty-${line.id}-${rIdx}`}>
                              <td className="px-2.5 py-1 text-slate-800">-</td>
                              <td className="px-2.5 py-1 border-r border-slate-800 text-slate-800 text-center">-</td>
                            </React.Fragment>
                          );
                        }

                        let grade = 'S';
                        let gradeColor = 'text-emerald-400 bg-emerald-950/40 border-emerald-800/50';
                        if (w < currentStd * 0.85) { 
                          grade = 'MB'; 
                          gradeColor = 'text-rose-400 bg-rose-950/40 border-rose-800/50'; 
                        } else if (w < currentStd * 0.90) { 
                          grade = 'B'; 
                          gradeColor = 'text-amber-400 bg-amber-950/40 border-amber-800/50'; 
                        } else if (w > currentStd * 1.15) { 
                          grade = 'MA'; 
                          gradeColor = 'text-purple-400 bg-purple-950/40 border-purple-800/50'; 
                        } else if (w > currentStd * 1.10) { 
                          grade = 'A'; 
                          gradeColor = 'text-sky-400 bg-sky-950/40 border-sky-800/50'; 
                        }

                        return (
                          <React.Fragment key={`val-${line.id}-${rIdx}`}>
                            <td className="px-2.5 py-1 font-bold text-white group relative">
                              <span>{w}</span>
                              <button 
                                onClick={() => handleDeleteWeight(currentShed.id, line.id, rIdx)}
                                className="absolute right-1 top-1 opacity-0 group-hover:opacity-100 text-rose-400 hover:text-rose-200 transition text-xs bg-rose-950 px-1 rounded"
                                title="Delete bird weight"
                              >
                                ×
                              </button>
                            </td>
                            <td className="px-2.5 py-1 border-r border-slate-800 text-center">
                              <span className={`px-1.5 py-0.2 rounded text-[10px] font-bold border ${gradeColor}`}>
                                {grade}
                              </span>
                            </td>
                          </React.Fragment>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>

                {/* Summary Rows (Matching rows 56-69 in Excel) */}
                <tfoot className="bg-slate-950 font-bold border-t-2 border-slate-700 sticky bottom-0 text-[11px] shadow-2xl">
                  <tr className="border-b border-slate-800">
                    <td className="py-2 px-3 border-r border-slate-800 text-slate-400 font-sans">Sample N</td>
                    {currentShed.lines.map((l) => (
                      <td key={`cnt-${l.id}`} colSpan={2} className="px-2 py-1.5 border-r border-slate-800 text-center text-slate-300 font-mono">
                        {computeLineStats(l.weights, currentStd).count}
                      </td>
                    ))}
                  </tr>
                  <tr className="border-b border-slate-800">
                    <td className="py-2 px-3 border-r border-slate-800 text-slate-400 font-sans">Avg Wt</td>
                    {currentShed.lines.map((l) => (
                      <td key={`avg-${l.id}`} colSpan={2} className="px-2 py-1.5 border-r border-slate-800 text-center text-emerald-400 font-mono">
                        {computeLineStats(l.weights, currentStd).avg}g
                      </td>
                    ))}
                  </tr>
                  <tr className="border-b border-slate-800">
                    <td className="py-2 px-3 border-r border-slate-800 text-slate-400 font-sans">Diff</td>
                    {currentShed.lines.map((l) => {
                      const diff = computeLineStats(l.weights, currentStd).diff;
                      return (
                        <td key={`diff-${l.id}`} colSpan={2} className={`px-2 py-1.5 border-r border-slate-800 text-center font-mono ${diff >= 0 ? 'text-emerald-400' : 'text-amber-400'}`}>
                          {diff > 0 ? `+${diff}` : diff}g
                        </td>
                      );
                    })}
                  </tr>
                  <tr className="border-b border-slate-800">
                    <td className="py-2 px-3 border-r border-slate-800 text-slate-400 font-sans">Min / Max</td>
                    {currentShed.lines.map((l) => {
                      const stats = computeLineStats(l.weights, currentStd);
                      return (
                        <td key={`range-${l.id}`} colSpan={2} className="px-2 py-1.5 border-r border-slate-800 text-center text-slate-400 font-mono text-[10px]">
                          {stats.count > 0 ? `${stats.min} - ${stats.max}` : '-'}
                        </td>
                      );
                    })}
                  </tr>
                  <tr className="border-b border-slate-800">
                    <td className="py-2 px-3 border-r border-slate-800 text-slate-400 font-sans">Uniformity %</td>
                    {currentShed.lines.map((l) => (
                      <td key={`unif-${l.id}`} colSpan={2} className="px-2 py-1.5 border-r border-slate-800 text-center text-amber-400 font-mono">
                        {computeLineStats(l.weights, currentStd).unif}%
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <td className="py-2 px-3 border-r border-slate-800 text-slate-400 font-sans">CV % (F-Factor)</td>
                    {currentShed.lines.map((l) => (
                      <td key={`cv-${l.id}`} colSpan={2} className="px-2 py-1.5 border-r border-slate-800 text-center text-sky-400 font-mono">
                        {computeLineStats(l.weights, currentStd).cv}%
                      </td>
                    ))}
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

        </div>
      )}

    </div>
  );
};
