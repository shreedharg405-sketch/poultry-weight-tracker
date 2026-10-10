import React, { useState, useEffect, useMemo } from 'react';
import { 
  Building2, 
  Calendar, 
  Scale, 
  Layers, 
  Settings, 
  ChevronRight, 
  ArrowLeft, 
  Plus, 
  Trash2, 
  Download, 
  Sparkles,
  Edit2,
  X,
  FileSpreadsheet,
  Share2,
  CheckCircle2,
  Clock
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { downloadExcelFile } from './utils/fileDownloader';

// F-Factor lookup table matching the manual sheet standards
const getFFactor = (n: number): number => {
  if (n <= 10) return 3.08;
  if (n <= 15) return 3.54;
  if (n <= 20) return 3.73;
  if (n <= 25) return 3.94;
  if (n <= 30) return 4.09;
  if (n <= 40) return 4.30;
  if (n <= 50) return 4.50;
  if (n <= 60) return 4.64;
  if (n <= 70) return 4.76;
  if (n <= 80) return 4.87;
  if (n <= 100) return 5.02;
  return 5.03;
};

// Seasonal Standard Benchmarks (Weeks 1 to 23)
const BENCHMARKS: Record<string, { stdF: number; stdM: number }> = {
  'W1': { stdF: 140, stdM: 140 },
  'W2': { stdF: 260, stdM: 320 },
  'W3': { stdF: 400, stdM: 510 },
  'W4': { stdF: 530, stdM: 690 },
  'W5': { stdF: 640, stdM: 850 },
  'W6': { stdF: 740, stdM: 1000 },
  'W7': { stdF: 840, stdM: 1140 },
  'W8': { stdF: 940, stdM: 1270 },
  'W9': { stdF: 1040, stdM: 1400 },
  'W10': { stdF: 1130, stdM: 1530 },
  'W11': { stdF: 1220, stdM: 1650 },
  'W12': { stdF: 1310, stdM: 1770 },
  'W13': { stdF: 1400, stdM: 1880 },
  'W14': { stdF: 1500, stdM: 1990 },
  'W15': { stdF: 1610, stdM: 2110 },
  'W16': { stdF: 1730, stdM: 2240 },
  'W17': { stdF: 1865, stdM: 2390 },
  'W18': { stdF: 1905, stdM: 2550 },
  'W19': { stdF: 2065, stdM: 2720 },
  'W20': { stdF: 2235, stdM: 2890 },
  'W21': { stdF: 2415, stdM: 3050 },
  'W22': { stdF: 2585, stdM: 3200 },
  'W23': { stdF: 2880, stdM: 3340 }
};

interface PenLine {
  id: number;
  name: string;
  weights: number[];
}

interface ShedData {
  id: string;
  name: string;
  type: 'Female' | 'Male';
  lines: PenLine[];
}

// Helper to format date string as date-month-year (DD-MM-YYYY)
const formatDateDMY = (dStr: string): string => {
  if (!dStr) return '';
  const parts = dStr.split('-');
  if (parts.length === 3) {
    if (parts[0].length === 4) {
      // YYYY-MM-DD -> DD-MM-YYYY
      return `${parts[2]}-${parts[1]}-${parts[0]}`;
    }
    return dStr;
  }
  return dStr;
};

// Helper to format time into 12-hour format with lowercase am/pm: '02:30 pm' or with seconds '02:30:15 pm'
const format12HourTime = (tStr: string, seconds?: string): string => {
  if (!tStr) return '02:30 pm';
  if (/am|pm/i.test(tStr)) return tStr.toLowerCase();
  const parts = tStr.split(':');
  if (parts.length < 2) return tStr;
  let hours = parseInt(parts[0], 10);
  const minutes = parts[1].padStart(2, '0');
  if (isNaN(hours)) return '02:30 pm';
  const ampm = hours >= 12 ? 'pm' : 'am';
  hours = hours % 12;
  if (hours === 0) hours = 12;
  const hoursStr = String(hours).padStart(2, '0');
  if (seconds !== undefined) {
    return `${hoursStr}:${minutes}:${seconds} ${ampm}`;
  }
  return `${hoursStr}:${minutes} ${ampm}`;
};

// Helper to get fresh system now values
const getSystemNow = () => {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  return { date: `${y}-${m}-${d}`, time: `${hh}:${mm}`, seconds: ss };
};

export default function App() {
  // Navigation Router: 'home' | 'weigh' | 'conclusion' | 'sheds' | 'setup'
  const [currentScreen, setCurrentScreen] = useState<'home' | 'weigh' | 'conclusion' | 'sheds' | 'setup'>('home');

  // Farm Profile State (Initialized to live current system date & time)
  const initialNow = getSystemNow();
  const [farmName, setFarmName] = useState('SAI FARM - UNIT 1');
  const [date, setDate] = useState(initialNow.date);
  const [recordTime, setRecordTime] = useState(initialNow.time);
  const [liveSeconds, setLiveSeconds] = useState(initialNow.seconds);
  const [isLiveClock, setIsLiveClock] = useState(true);
  const [showLiveSeconds, setShowLiveSeconds] = useState(true);
  const [ageWeek, setAgeWeek] = useState('W18');
  const [season, setSeason] = useState<'Summer' | 'Winter'>('Summer');

  // Background Live Clock: Automatically updates time and date in the background without reloading
  useEffect(() => {
    if (!isLiveClock) return;

    const syncLiveClock = () => {
      const { date: curDate, time: curTime, seconds: curSec } = getSystemNow();
      setDate(prev => (prev !== curDate ? curDate : prev));
      setRecordTime(prev => (prev !== curTime ? curTime : prev));
      setLiveSeconds(curSec);
    };

    syncLiveClock();
    const interval = setInterval(syncLiveClock, 1000);
    return () => clearInterval(interval);
  }, [isLiveClock]);

  // Formatted date-month-year | 12-hour time (e.g. 11-10-2026 | 02:30:45 pm)
  const formattedDateTime = useMemo(() => {
    const sec = (isLiveClock && showLiveSeconds) ? liveSeconds : undefined;
    return `${formatDateDMY(date)} | ${format12HourTime(recordTime, sec)}`;
  }, [date, recordTime, isLiveClock, showLiveSeconds, liveSeconds]);

  // Weighing & Line State
  const [selectedShedId, setSelectedShedId] = useState('1');
  const [selectedLineId, setSelectedLineId] = useState(1);
  const [inputWeight, setInputWeight] = useState('');

  // Shed Management Modals
  const [editingShedId, setEditingShedId] = useState<string | null>(null);
  const [editShedName, setEditShedName] = useState('');
  const [editShedType, setEditShedType] = useState<'Female' | 'Male'>('Female');
  const [showAddShedModal, setShowAddShedModal] = useState(false);
  const [newShedName, setNewShedName] = useState('');
  const [newShedType, setNewShedType] = useState<'Female' | 'Male'>('Female');

  // In-App Deletion Confirmation Modals (Bypasses browser popup blocking)
  const [linePendingDelete, setLinePendingDelete] = useState<{ id: number; name: string; weights: number[] } | null>(null);
  const [shedPendingDelete, setShedPendingDelete] = useState<{ id: string; name: string } | null>(null);

  // Mobile Toast Notification State
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3800);
  };

  // Target standard weights
  const stdWeightFemale = BENCHMARKS[ageWeek]?.stdF || 1905;
  const stdWeightMale = BENCHMARKS[ageWeek]?.stdM || 1880;

  // Initial Sheds Setup
  const [sheds, setSheds] = useState<ShedData[]>([
    { id: '1', name: 'Shed 1', type: 'Female', lines: [{ id: 1, name: 'Line 1', weights: [1270, 1290, 1300, 1300, 1330, 1370, 1380, 1390, 1400, 1450, 1850, 1950, 1985, 1990] }] },
    { id: '2', name: 'Shed 2', type: 'Female', lines: [{ id: 1, name: 'Line 1', weights: [1270, 1290, 1300, 1300, 1330, 1370, 1380, 1390, 1400, 1450, 1470, 1500, 1510] }] },
    { id: '3', name: 'Shed 3', type: 'Female', lines: [{ id: 1, name: 'Line 1', weights: [1270, 1290, 1300, 1300, 1330, 1370, 1380, 1390, 1400, 1450, 1470, 1500] }] },
    { id: '4', name: 'Shed 4', type: 'Female', lines: [{ id: 1, name: 'Line 1', weights: [1270, 1290, 1300, 1300, 1330, 1370, 1380, 1390, 1400, 1450, 1470] }] },
    { id: '5', name: 'Shed 5', type: 'Female', lines: [{ id: 1, name: 'Line 1', weights: [1270, 1290, 1300, 1300, 1330, 1370, 1380, 1390, 1400, 1450] }] },
    { id: '6', name: 'Shed 6', type: 'Female', lines: [{ id: 1, name: 'Line 1', weights: [1270, 1290, 1300, 1300, 1330, 1370, 1380, 1390, 1400] }] },
    { id: '7', name: 'Shed 7', type: 'Female', lines: [{ id: 1, name: 'Line 1', weights: [1270, 1290, 1300, 1300, 1330, 1370, 1380, 1390] }] },
    { id: '8', name: 'Shed 8 (Male)', type: 'Male', lines: [{ id: 1, name: 'Line 1', weights: [2800, 3000, 3800, 2650, 2950, 2456, 3566, 2800, 3000, 3800] }] },
    { id: '9', name: 'Shed 9', type: 'Female', lines: [{ id: 1, name: 'Line 1', weights: [1270, 1290, 1300, 1300, 1330, 1370, 1380, 1390, 1400, 1450] }] },
    { id: '10', name: 'Shed 10', type: 'Female', lines: [{ id: 1, name: 'Line 1', weights: [1270, 1290, 1300, 1300, 1330, 1370, 1380, 1390, 1400, 1450] }] },
  ]);

  // Load from local storage
  useEffect(() => {
    const saved = localStorage.getItem('poultry_dynamic_db');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed.sheds) setSheds(parsed.sheds);
        if (parsed.isLiveClock === false) {
          setIsLiveClock(false);
          if (parsed.date) setDate(parsed.date);
          if (parsed.recordTime) setRecordTime(parsed.recordTime);
        }
        if (parsed.showLiveSeconds !== undefined) {
          setShowLiveSeconds(parsed.showLiveSeconds);
        }
        if (parsed.ageWeek) setAgeWeek(parsed.ageWeek);
      } catch (err) {
        console.error(err);
      }
    }
  }, []);

  // Save to local storage
  useEffect(() => {
    localStorage.setItem('poultry_dynamic_db', JSON.stringify({ 
      farmName, 
      sheds, 
      date, 
      recordTime, 
      ageWeek, 
      isLiveClock, 
      showLiveSeconds 
    }));
  }, [farmName, sheds, date, recordTime, ageWeek, isLiveClock, showLiveSeconds]);

  // Active Shed & Line
  const activeShed = sheds.find(s => s.id === selectedShedId) || sheds[0];
  const activeLine = activeShed?.lines.find(l => l.id === selectedLineId) || activeShed?.lines[0] || { id: 1, name: 'Line 1', weights: [] };
  const activeStd = activeShed?.type === 'Male' ? stdWeightMale : stdWeightFemale;

  // --- SHED CREATION & MODIFICATION HANDLERS ---
  const handleCreateShed = () => {
    if (!newShedName.trim()) return;
    const newId = String(Date.now());
    const newShedObj: ShedData = {
      id: newId,
      name: newShedName.trim(),
      type: newShedType,
      lines: [{ id: 1, name: 'Line 1', weights: [] }]
    };
    setSheds(prev => [...prev, newShedObj]);
    setSelectedShedId(newId);
    setSelectedLineId(1);
    setNewShedName('');
    setShowAddShedModal(false);
  };

  const handleStartEditShed = (shed: ShedData) => {
    setEditingShedId(shed.id);
    setEditShedName(shed.name);
    setEditShedType(shed.type);
  };

  const handleSaveEditShed = () => {
    if (!editingShedId || !editShedName.trim()) return;
    setSheds(prev => prev.map(s => {
      if (s.id !== editingShedId) return s;
      return { ...s, name: editShedName.trim(), type: editShedType };
    }));
    setEditingShedId(null);
  };

  const handleDeleteShed = (shedId: string) => {
    if (sheds.length <= 1) {
      showToast('You must keep at least one shed.');
      return;
    }
    const targetShed = sheds.find(s => s.id === shedId);
    if (!targetShed) return;
    const totalWeights = targetShed.lines.reduce((sum, l) => sum + l.weights.length, 0);
    if (totalWeights === 0) {
      executeDeleteShed(shedId);
    } else {
      setShedPendingDelete({ id: targetShed.id, name: targetShed.name });
    }
  };

  const executeDeleteShed = (shedId: string) => {
    if (sheds.length <= 1) return;
    const targetShed = sheds.find(s => s.id === shedId);
    const shedName = targetShed?.name || 'Shed';
    const remaining = sheds.filter(s => s.id !== shedId);
    setSheds(remaining);
    if (selectedShedId === shedId) {
      setSelectedShedId(remaining[0].id);
      setSelectedLineId(remaining[0].lines[0]?.id || 1);
    }
    showToast(`${shedName} deleted.`);
    setShedPendingDelete(null);
  };

  // --- LINE / PEN CREATION & REMOVAL ---
  const handleAddLine = () => {
    if (!activeShed) return;
    const nextId = (activeShed.lines.length ? Math.max(...activeShed.lines.map(l => l.id)) : 0) + 1;
    setSheds(prev => prev.map(s => {
      if (s.id !== activeShed.id) return s;
      return {
        ...s,
        lines: [...s.lines, { id: nextId, name: `Line ${nextId}`, weights: [] }]
      };
    }));
    setSelectedLineId(nextId);
    showToast(`Line ${nextId} added.`);
  };

  const handleDeleteLine = (lineId: number, e?: React.MouseEvent) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    if (!activeShed) return;
    if (activeShed.lines.length <= 1) {
      showToast('A shed must have at least 1 pen line. Tap + Pen Line to add another first.');
      return;
    }
    const targetLine = activeShed.lines.find(l => l.id === lineId);
    if (!targetLine) return;

    // If line is empty with 0 weights, delete immediately!
    if (targetLine.weights.length === 0) {
      executeDeleteLine(lineId);
    } else {
      // If line contains weights, open custom in-app confirmation modal
      setLinePendingDelete({ id: targetLine.id, name: targetLine.name, weights: targetLine.weights });
    }
  };

  const executeDeleteLine = (lineId: number) => {
    if (!activeShed) return;
    const targetLine = activeShed.lines.find(l => l.id === lineId);
    const lineName = targetLine?.name || `Line ${lineId}`;
    const remainingLines = activeShed.lines.filter(l => l.id !== lineId);

    setSheds(prev => prev.map(s => {
      if (s.id !== activeShed.id) return s;
      return { ...s, lines: remainingLines };
    }));

    setSelectedLineId(prev => (prev === lineId ? remainingLines[0].id : prev));
    showToast(`${lineName} deleted.`);
    setLinePendingDelete(null);
  };

  const handleClearCurrentLineWeights = () => {
    if (!activeShed || !activeLine || activeLine.weights.length === 0) return;
    setSheds(prev => prev.map(s => {
      if (s.id !== activeShed.id) return s;
      return {
        ...s,
        lines: s.lines.map(l => {
          if (l.id !== activeLine.id) return l;
          return { ...l, weights: [] };
        })
      };
    }));
    showToast(`Weights in ${activeLine.name} cleared.`);
  };

  // --- WEIGHT INPUT & CALCULATION ---
  const handleAddWeight = (valToAdd?: number) => {
    const val = valToAdd !== undefined ? valToAdd : parseFloat(inputWeight);
    if (!val || isNaN(val) || !activeShed || !activeLine) return;

    setSheds(prev => prev.map(s => {
      if (s.id !== activeShed.id) return s;
      return {
        ...s,
        lines: s.lines.map(l => {
          if (l.id !== activeLine.id) return l;
          return { ...l, weights: [...l.weights, val] };
        })
      };
    }));
    setInputWeight('');
  };

  const handleDeleteWeight = (idx: number) => {
    setSheds(prev => prev.map(s => {
      if (s.id !== activeShed.id) return s;
      return {
        ...s,
        lines: s.lines.map(l => {
          if (l.id !== activeLine.id) return l;
          const copy = [...l.weights];
          copy.splice(idx, 1);
          return { ...l, weights: copy };
        })
      };
    }));
  };

  const computeStats = (weights: number[], stdTarget: number) => {
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

    const sLow = stdTarget * 0.90;
    const sHigh = stdTarget * 1.10;
    const mbLimit = stdTarget * 0.85;
    const maLimit = stdTarget * 1.15;

    let mb = 0, b = 0, s = 0, a = 0, ma = 0;
    weights.forEach(w => {
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

  // Grand Consolidated Calculation (Cons Sheet)
  const consolidated = useMemo(() => {
    const femaleWeights = sheds.filter(s => s.type === 'Female').flatMap(s => s.lines.flatMap(l => l.weights));
    const maleWeights = sheds.filter(s => s.type === 'Male').flatMap(s => s.lines.flatMap(l => l.weights));

    const fStats = computeStats(femaleWeights, stdWeightFemale);
    const mStats = computeStats(maleWeights, stdWeightMale);

    const shedSummaries = sheds.map((s, idx) => {
      const allW = s.lines.flatMap(l => l.weights);
      const std = s.type === 'Male' ? stdWeightMale : stdWeightFemale;
      return {
        ...s,
        indexNum: idx + 1,
        stats: computeStats(allW, std)
      };
    });

    return { fStats, mStats, shedSummaries };
  }, [sheds, stdWeightFemale, stdWeightMale]);

  // Export to Excel Matching Workbook with Mobile Native Sharing & Download
  const handleExportExcel = async () => {
    try {
      const wb = XLSX.utils.book_new();
    const consData: (string | number)[][] = [
      ['Farm Name:', farmName, 'Date | Time:', formattedDateTime, 'Age:', ageWeek, 'Season:', season],
      [],
      ['Metric', 'Female (♀)', 'Male (♂)'],
      ['STD B.WT', stdWeightFemale, stdWeightMale],
      ['Act B.WT', consolidated.fStats.avg, consolidated.mStats.avg],
      ['Diff', consolidated.fStats.diff, consolidated.mStats.diff],
      ['CV %', `${consolidated.fStats.cv}%`, `${consolidated.mStats.cv}%`],
      ['Uniformity (S%)', `${consolidated.fStats.unif}%`, `${consolidated.mStats.unif}%`],
      ['Min Wt', consolidated.fStats.min, consolidated.mStats.min],
      ['Max Wt', consolidated.fStats.max, consolidated.mStats.max],
      [],
      ['Shed No', 'Name', 'Sex', 'Birds', 'Act B.Wt', 'Min', 'Max', 'CV%', 'Uniformity %']
    ];

    consolidated.shedSummaries.forEach(s => {
      consData.push([s.indexNum, s.name, s.type, s.stats.count, s.stats.avg, s.stats.min, s.stats.max, `${s.stats.cv}%`, `${s.stats.unif}%`]);
    });

    const wsCons = XLSX.utils.aoa_to_sheet(consData);
    XLSX.utils.book_append_sheet(wb, wsCons, 'Cons');

    // Individual Shed sheets
    sheds.forEach(s => {
      const std = s.type === 'Male' ? stdWeightMale : stdWeightFemale;
      const sRows: (string | number)[][] = [
        ['Shed:', s.name, 'Gender:', s.type, 'Target:', std],
        ['Sample #', ...s.lines.flatMap(l => [l.name, 'Grade'])]
      ];
      const maxLen = Math.max(...s.lines.map(l => l.weights.length), 0);
      for (let i = 0; i < maxLen; i++) {
        const r: (string | number)[] = [i + 1];
        s.lines.forEach(l => {
          const w = l.weights[i];
          if (w !== undefined) {
            let grade = 'S';
            if (w < std * 0.85) grade = 'MB';
            else if (w < std * 0.90) grade = 'B';
            else if (w > std * 1.15) grade = 'MA';
            else if (w > std * 1.10) grade = 'A';
            r.push(w, grade);
          } else {
            r.push('', '');
          }
        });
        sRows.push(r);
      }
      const wsShed = XLSX.utils.aoa_to_sheet(sRows);
      XLSX.utils.book_append_sheet(wb, wsShed, s.name.substring(0, 31));
    });

      const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
      const fileName = `${farmName.replace(/\s+/g, '_')}_${ageWeek}_${date}.xlsx`;

      const result = await downloadExcelFile(wbout, fileName);
      if (result.success) {
        if (result.method === 'share') {
          showToast('Shared successfully!');
        } else {
          showToast("Saved to device! Open 'Files' or 'Downloads' app to view.");
        }
      } else if (result.method !== 'aborted') {
        showToast('Download could not complete. Please try again.');
      }
    } catch (err) {
      console.error('Export error:', err);
      showToast('Error generating workbook.');
    }
  };

  const lineStats = activeLine ? computeStats(activeLine.weights, activeStd) : computeStats([], activeStd);

  return (
    <div className="flex justify-center bg-slate-950 min-h-screen text-slate-100 font-sans antialiased selection:bg-emerald-500 selection:text-slate-950">
      <div className="w-full max-w-md min-h-screen bg-slate-900 border-x border-slate-800 flex flex-col shadow-2xl relative pb-8">
        
        {/* ========================================================= */}
        {/* 1. APP HOME DASHBOARD                                     */}
        {/* ========================================================= */}
        {currentScreen === 'home' && (
          <div className="flex-1 flex flex-col p-4 animate-in fade-in duration-150">
            
            {/* Top Quick Profile Card */}
            <div className="bg-gradient-to-br from-slate-850 to-slate-800 p-4 rounded-2xl border border-slate-700/80 shadow-md mb-5">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-widest bg-emerald-500/10 px-2.5 py-1 rounded-full border border-emerald-500/20">
                  Poultry Flock Live
                </span>
                <span className="text-xs text-slate-200 font-mono font-bold flex items-center gap-1.5 bg-slate-950/80 px-2.5 py-1 rounded-xl border border-slate-700/80 shadow-inner" title="Live Running Date & Time (Background real-time)">
                  {isLiveClock ? (
                    <span className="relative flex h-2 w-2 shrink-0">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                    </span>
                  ) : (
                    <Clock className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                  )}
                  <span>{formattedDateTime}</span>
                </span>
              </div>
              <h1 className="text-xl font-black text-white mt-2.5 tracking-tight flex items-center gap-2">
                <Building2 className="w-5 h-5 text-emerald-400 shrink-0" />
                <span className="truncate">{farmName}</span>
              </h1>
              <div className="flex items-center gap-2 mt-3 pt-3 border-t border-slate-700/50 text-xs">
                <span className="bg-slate-700/60 px-2.5 py-1 rounded-lg font-bold text-slate-200">Age: {ageWeek}</span>
                <span className="bg-slate-700/60 px-2.5 py-1 rounded-lg text-slate-300">{season}</span>
                <span className="bg-slate-700/60 px-2.5 py-1 rounded-lg text-slate-300 font-mono ml-auto">{sheds.length} Sheds</span>
              </div>
            </div>

            {/* Quick Stats Banner */}
            <div className="grid grid-cols-2 gap-2.5 mb-5">
              <div className="bg-slate-800/80 p-3 rounded-xl border border-slate-700 text-center">
                <span className="text-[10px] text-pink-400 uppercase font-semibold">Female Avg (♀)</span>
                <div className="text-lg font-black text-emerald-400 mt-0.5">{consolidated.fStats.avg}g</div>
                <span className="text-[10px] text-slate-500 font-mono">Target: {stdWeightFemale}g</span>
              </div>
              <div className="bg-slate-800/80 p-3 rounded-xl border border-slate-700 text-center">
                <span className="text-[10px] text-blue-400 uppercase font-semibold">Male Avg (♂)</span>
                <div className="text-lg font-black text-blue-400 mt-0.5">{consolidated.mStats.avg}g</div>
                <span className="text-[10px] text-slate-500 font-mono">Target: {stdWeightMale}g</span>
              </div>
            </div>

            {/* Main Action Buttons */}
            <div className="space-y-3 flex-1">
              <p className="text-[11px] font-black uppercase tracking-wider text-slate-400 px-1">Select Task</p>

              {/* 1. Enter Weights */}
              <button
                onClick={() => setCurrentScreen('weigh')}
                className="w-full bg-emerald-600 hover:bg-emerald-500 active:scale-[0.98] transition p-4 rounded-2xl flex items-center justify-between text-left shadow-lg shadow-emerald-950 border border-emerald-400/30 group"
              >
                <div className="flex items-center gap-3.5">
                  <div className="p-3 bg-emerald-950/40 rounded-xl text-emerald-300">
                    <Scale className="w-6 h-6" />
                  </div>
                  <div>
                    <h2 className="font-black text-base text-white">Enter Bird Weights</h2>
                    <p className="text-xs text-emerald-100/70">Weigh line-by-line & auto-grade</p>
                  </div>
                </div>
                <ChevronRight className="w-5 h-5 text-emerald-200 group-hover:translate-x-1 transition" />
              </button>

              {/* 2. Consolidated Report */}
              <button
                onClick={() => setCurrentScreen('conclusion')}
                className="w-full bg-slate-800 hover:bg-slate-750 active:scale-[0.98] transition p-4 rounded-2xl flex items-center justify-between text-left shadow-md border border-slate-700 group"
              >
                <div className="flex items-center gap-3.5">
                  <div className="p-3 bg-amber-500/10 rounded-xl text-amber-400">
                    <Sparkles className="w-6 h-6" />
                  </div>
                  <div>
                    <h2 className="font-black text-base text-white">Consolidated Conclusion</h2>
                    <p className="text-xs text-slate-400">Master report, Uniformity %, CV%</p>
                  </div>
                </div>
                <ChevronRight className="w-5 h-5 text-slate-400 group-hover:translate-x-1 transition" />
              </button>

              {/* 3. Manage Sheds & Comparison */}
              <button
                onClick={() => setCurrentScreen('sheds')}
                className="w-full bg-slate-800 hover:bg-slate-750 active:scale-[0.98] transition p-4 rounded-2xl flex items-center justify-between text-left shadow-md border border-slate-700 group"
              >
                <div className="flex items-center gap-3.5">
                  <div className="p-3 bg-sky-500/10 rounded-xl text-sky-400">
                    <Layers className="w-6 h-6" />
                  </div>
                  <div>
                    <h2 className="font-black text-base text-white">Manage & Compare Sheds</h2>
                    <p className="text-xs text-slate-400">Add, rename, delete sheds & view stats</p>
                  </div>
                </div>
                <ChevronRight className="w-5 h-5 text-slate-400 group-hover:translate-x-1 transition" />
              </button>

              {/* 4. Farm Details Settings */}
              <button
                onClick={() => setCurrentScreen('setup')}
                className="w-full bg-slate-800 hover:bg-slate-750 active:scale-[0.98] transition p-4 rounded-2xl flex items-center justify-between text-left shadow-md border border-slate-700 group"
              >
                <div className="flex items-center gap-3.5">
                  <div className="p-3 bg-purple-500/10 rounded-xl text-purple-400">
                    <Settings className="w-6 h-6" />
                  </div>
                  <div>
                    <h2 className="font-black text-base text-white">Edit Farm Details</h2>
                    <p className="text-xs text-slate-400">Change Name, Date, Age & Export Excel</p>
                  </div>
                </div>
                <ChevronRight className="w-5 h-5 text-slate-400 group-hover:translate-x-1 transition" />
              </button>
            </div>

            {/* Quick Export in Footer */}
            <div className="mt-4 pt-3 border-t border-slate-800">
              <button
                onClick={handleExportExcel}
                className="w-full bg-slate-800/90 hover:bg-slate-750 text-slate-200 py-3 rounded-2xl font-bold text-xs flex items-center justify-center gap-2 border border-slate-700 active:scale-95 transition"
              >
                <FileSpreadsheet className="w-4 h-4 text-emerald-400" />
                <span>Save / Share Complete .xlsx Workbook</span>
              </button>
            </div>

          </div>
        )}

        {/* ========================================================= */}
        {/* 2. WEIGHING SCREEN WITH IN-LINE MANAGEMENT                */}
        {/* ========================================================= */}
        {currentScreen === 'weigh' && activeShed && activeLine && (
          <div className="flex-1 flex flex-col p-4 animate-in slide-in-from-right duration-150">
            
            {/* Header with Back Button */}
            <div className="flex items-center justify-between mb-3">
              <button 
                onClick={() => setCurrentScreen('home')} 
                className="flex items-center gap-1.5 text-xs font-bold text-slate-300 bg-slate-800 px-3 py-1.5 rounded-xl border border-slate-700 active:scale-95"
              >
                <ArrowLeft className="w-4 h-4" /> Home
              </button>

              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => handleStartEditShed(activeShed)}
                  className="p-1.5 bg-slate-800 hover:bg-slate-700 rounded-lg text-slate-300 text-xs flex items-center gap-1 border border-slate-700"
                  title="Rename/Edit Shed"
                >
                  <Edit2 className="w-3.5 h-3.5" />
                </button>
                <span className={`text-[10px] px-2 py-1 rounded-full font-bold border ${
                  activeShed.type === 'Male' 
                    ? 'bg-blue-950/70 text-blue-300 border-blue-800' 
                    : 'bg-pink-950/70 text-pink-300 border-pink-800'
                }`}>
                  {activeShed.name} ({activeShed.type === 'Male' ? '♂' : '♀'})
                </span>
              </div>
            </div>

            {/* Shed Horizontal Selector Chips + Quick Add Shed Button */}
            <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-1 mb-2.5">
              {sheds.map(s => (
                <button
                  key={s.id}
                  onClick={() => {
                    setSelectedShedId(s.id);
                    setSelectedLineId(s.lines[0]?.id || 1);
                  }}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition ${
                    selectedShedId === s.id 
                      ? 'bg-emerald-500 text-slate-950 font-black shadow' 
                      : 'bg-slate-800 text-slate-400'
                  }`}
                >
                  {s.name}
                </button>
              ))}

              <button
                onClick={() => setShowAddShedModal(true)}
                className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-emerald-400 rounded-xl text-xs font-bold flex items-center gap-1 border border-dashed border-emerald-500/50 whitespace-nowrap"
              >
                <Plus className="w-3.5 h-3.5" /> Shed
              </button>
            </div>

            {/* Line Tabs + Line Add/Delete Controls */}
            <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-1 mb-3">
              {activeShed.lines.map(line => {
                const isSelected = selectedLineId === line.id;
                const isOnlyLine = activeShed.lines.length <= 1;
                return (
                  <div key={line.id} className="flex items-center shrink-0">
                    <button
                      type="button"
                      onClick={() => setSelectedLineId(line.id)}
                      className={`px-3 py-2 text-xs font-bold whitespace-nowrap transition rounded-l-xl ${
                        isSelected 
                          ? 'bg-sky-500 text-slate-950 font-black shadow-md' 
                          : 'bg-slate-800 text-slate-400 hover:text-white'
                      }`}
                    >
                      {line.name} ({line.weights.length})
                    </button>
                    <button
                      type="button"
                      onClick={(e) => handleDeleteLine(line.id, e)}
                      className={`px-2.5 py-2 rounded-r-xl border-l text-xs transition flex items-center justify-center active:scale-95 cursor-pointer ${
                        isOnlyLine 
                          ? 'bg-slate-800 text-slate-600 hover:text-slate-400 border-slate-700/60'
                          : isSelected 
                            ? 'bg-sky-600 text-slate-950 hover:bg-rose-600 hover:text-white border-sky-400' 
                            : 'bg-slate-800 text-slate-400 hover:bg-rose-950 hover:text-rose-400 border-slate-700'
                      }`}
                      title={isOnlyLine ? "Only pen line in shed (cannot delete)" : `Delete ${line.name}`}
                      aria-label={`Delete ${line.name}`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                );
              })}

              <button
                type="button"
                onClick={handleAddLine}
                className="px-3 py-2 bg-slate-800 hover:bg-slate-750 text-sky-400 rounded-xl text-xs font-bold flex items-center gap-1 border border-dashed border-sky-500/50 whitespace-nowrap shrink-0 active:scale-95 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" /> Pen Line
              </button>
            </div>

            {/* Real-Time Metric Strip for Current Line */}
            <div className="bg-slate-800/90 p-3 rounded-2xl border border-slate-700 grid grid-cols-4 gap-1 text-center mb-3.5 shadow-sm">
              <div>
                <span className="text-[10px] text-slate-400 font-bold uppercase">Weighed</span>
                <div className="text-base font-black text-white">{lineStats.count}</div>
              </div>
              <div>
                <span className="text-[10px] text-slate-400 font-bold uppercase">Avg Wt</span>
                <div className="text-base font-black text-emerald-400">{lineStats.avg}g</div>
              </div>
              <div>
                <span className="text-[10px] text-slate-400 font-bold uppercase">Unif (S%)</span>
                <div className="text-base font-black text-amber-400">{lineStats.unif}%</div>
              </div>
              <div>
                <span className="text-[10px] text-slate-400 font-bold uppercase">CV %</span>
                <div className="text-base font-black text-sky-400">{lineStats.cv}%</div>
              </div>
            </div>

            {/* Manual Entry Form */}
            <form onSubmit={e => { e.preventDefault(); handleAddWeight(); }} className="flex gap-2 mb-3">
              <input
                type="number"
                placeholder={`Type weight for ${activeLine.name}...`}
                value={inputWeight}
                onChange={e => setInputWeight(e.target.value)}
                autoFocus
                className="flex-1 bg-slate-950 border border-slate-700 rounded-xl px-4 py-3 text-lg font-black text-white focus:outline-none focus:border-emerald-500 font-mono"
              />
              <button
                type="submit"
                className="bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-slate-950 font-black px-5 rounded-xl text-sm"
              >
                Add
              </button>
            </form>

            {/* Quick Weight Pad Chips */}
            <div className="grid grid-cols-4 gap-1.5 mb-3.5">
              {[1250, 1300, 1350, 1400, 1450, 1500, 1550, 1600].map(w => (
                <button
                  key={w}
                  type="button"
                  onClick={() => handleAddWeight(w)}
                  className="bg-slate-800 hover:bg-slate-750 active:bg-slate-700 py-2 rounded-lg text-xs font-mono font-bold text-slate-200 border border-slate-700"
                >
                  +{w}
                </button>
              ))}
            </div>

            {/* Weighed Birds List with Live Grading */}
            <div className="flex-1 bg-slate-950 rounded-2xl border border-slate-800 p-3 overflow-y-auto max-h-[290px]">
              <div className="flex justify-between items-center text-xs text-slate-400 pb-2 mb-2 border-b border-slate-800">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-slate-300">Birds in {activeLine.name} ({activeLine.weights.length})</span>
                  {activeShed.lines.length > 1 && (
                    <button
                      type="button"
                      onClick={(e) => handleDeleteLine(activeLine.id, e)}
                      className="text-rose-400 hover:text-white hover:bg-rose-600 bg-rose-500/15 border border-rose-500/30 px-2 py-0.5 rounded-lg text-[10px] font-bold flex items-center gap-1 active:scale-95 transition cursor-pointer"
                      title={`Delete ${activeLine.name}`}
                    >
                      <Trash2 className="w-3 h-3" />
                      Delete Pen
                    </button>
                  )}
                  {activeLine.weights.length > 0 && (
                    <button
                      type="button"
                      onClick={handleClearCurrentLineWeights}
                      className="text-amber-400 hover:text-white hover:bg-amber-600 bg-amber-500/15 border border-amber-500/30 px-2 py-0.5 rounded-lg text-[10px] font-bold flex items-center gap-1 active:scale-95 transition cursor-pointer"
                      title={`Clear all weights recorded in ${activeLine.name}`}
                    >
                      Clear All
                    </button>
                  )}
                </div>
                <span className="text-[10px] font-mono">Target: {activeStd}g</span>
              </div>

              {activeLine.weights.length === 0 ? (
                <div className="text-center py-8 text-xs text-slate-600">No birds recorded yet for {activeLine.name}</div>
              ) : (
                <div className="space-y-1.5">
                  {activeLine.weights.map((w, idx) => {
                    let grade = 'S (Ideal)';
                    let color = 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20';
                    if (w < activeStd * 0.85) { grade = 'MB'; color = 'text-rose-400 bg-rose-500/10 border-rose-500/20'; }
                    else if (w < activeStd * 0.90) { grade = 'B'; color = 'text-amber-400 bg-amber-500/10 border-amber-500/20'; }
                    else if (w > activeStd * 1.15) { grade = 'MA'; color = 'text-purple-400 bg-purple-500/10 border-purple-500/20'; }
                    else if (w > activeStd * 1.10) { grade = 'A'; color = 'text-sky-400 bg-sky-500/10 border-sky-500/20'; }

                    return (
                      <div key={idx} className="flex items-center justify-between bg-slate-900 px-3 py-2 rounded-xl border border-slate-800 text-xs">
                        <span className="text-slate-500 font-mono w-6">#{idx + 1}</span>
                        <span className="font-bold text-sm text-white font-mono">{w}g</span>
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${color}`}>{grade}</span>
                        <button onClick={() => handleDeleteWeight(idx)} className="text-slate-500 hover:text-rose-400 p-1">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

          </div>
        )}

        {/* ========================================================= */}
        {/* 3. CONSOLIDATED CONCLUSION REPORT (Cons Sheet)            */}
        {/* ========================================================= */}
        {currentScreen === 'conclusion' && (
          <div className="flex-1 flex flex-col p-4 animate-in slide-in-from-right duration-150">
            
            <div className="flex items-center justify-between mb-4">
              <button 
                onClick={() => setCurrentScreen('home')} 
                className="flex items-center gap-1.5 text-xs font-bold text-slate-300 bg-slate-800 px-3 py-1.5 rounded-xl border border-slate-700 active:scale-95"
              >
                <ArrowLeft className="w-4 h-4" /> Home
              </button>
              <div className="text-right">
                <h2 className="text-sm font-black text-amber-400 uppercase tracking-wide">Cons Conclusion</h2>
                <div className="flex items-center justify-end gap-1 text-[10px] text-slate-400 font-mono">
                  {isLiveClock && <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>}
                  <span>{formattedDateTime}</span>
                </div>
              </div>
            </div>

            {/* Female vs Male Overall Cards */}
            <div className="space-y-3.5 mb-5">
              
              {/* Female Card */}
              <div className="bg-slate-800/90 border border-slate-700 p-3.5 rounded-2xl">
                <div className="flex justify-between items-center mb-2.5">
                  <span className="font-bold text-sm text-pink-400 flex items-center gap-1">♀ Female Overall ({ageWeek}F)</span>
                  <span className="text-xs text-slate-400 font-mono">Target: {stdWeightFemale}g</span>
                </div>
                <div className="grid grid-cols-3 gap-2 text-center text-xs mb-2.5">
                  <div className="bg-slate-900/60 p-2 rounded-xl">
                    <span className="text-[10px] text-slate-400">ACT WT</span>
                    <div className="font-bold text-emerald-400 text-sm">{consolidated.fStats.avg}g</div>
                  </div>
                  <div className="bg-slate-900/60 p-2 rounded-xl">
                    <span className="text-[10px] text-slate-400">DIFF</span>
                    <div className="font-bold text-slate-300 text-sm">{consolidated.fStats.diff}g</div>
                  </div>
                  <div className="bg-slate-900/60 p-2 rounded-xl">
                    <span className="text-[10px] text-slate-400">UNIF (S%)</span>
                    <div className="font-bold text-amber-400 text-sm">{consolidated.fStats.unif}%</div>
                  </div>
                </div>
                <div className="flex justify-between text-[11px] text-slate-400 bg-slate-900/60 px-2.5 py-1.5 rounded-lg">
                  <span>CV%: <strong className="text-sky-400">{consolidated.fStats.cv}%</strong></span>
                  <span>Range: <strong className="text-slate-300">{consolidated.fStats.min}g - {consolidated.fStats.max}g</strong></span>
                </div>
              </div>

              {/* Male Card */}
              <div className="bg-slate-800/90 border border-slate-700 p-3.5 rounded-2xl">
                <div className="flex justify-between items-center mb-2.5">
                  <span className="font-bold text-sm text-blue-400 flex items-center gap-1">♂ Male Overall ({ageWeek}M)</span>
                  <span className="text-xs text-slate-400 font-mono">Target: {stdWeightMale}g</span>
                </div>
                <div className="grid grid-cols-3 gap-2 text-center text-xs mb-2.5">
                  <div className="bg-slate-900/60 p-2 rounded-xl">
                    <span className="text-[10px] text-slate-400">ACT WT</span>
                    <div className="font-bold text-emerald-400 text-sm">{consolidated.mStats.avg}g</div>
                  </div>
                  <div className="bg-slate-900/60 p-2 rounded-xl">
                    <span className="text-[10px] text-slate-400">DIFF</span>
                    <div className="font-bold text-slate-300 text-sm">{consolidated.mStats.diff}g</div>
                  </div>
                  <div className="bg-slate-900/60 p-2 rounded-xl">
                    <span className="text-[10px] text-slate-400">UNIF (S%)</span>
                    <div className="font-bold text-amber-400 text-sm">{consolidated.mStats.unif}%</div>
                  </div>
                </div>
                <div className="flex justify-between text-[11px] text-slate-400 bg-slate-900/60 px-2.5 py-1.5 rounded-lg">
                  <span>CV%: <strong className="text-sky-400">{consolidated.mStats.cv}%</strong></span>
                  <span>Range: <strong className="text-slate-300">{consolidated.mStats.min}g - {consolidated.mStats.max}g</strong></span>
                </div>
              </div>

            </div>

            {/* Quick Export Button */}
            <button
              onClick={handleExportExcel}
              className="w-full bg-emerald-600 hover:bg-emerald-500 py-3.5 rounded-2xl font-black text-sm text-slate-950 flex items-center justify-center gap-2 active:scale-95 shadow-md shadow-emerald-950 transition"
            >
              <Download className="w-4 h-4" /> Save / Share Excel Sheet (.xlsx)
            </button>
          </div>
        )}

        {/* ========================================================= */}
        {/* 4. SHED COMPARISON & MANAGEMENT SCREEN                    */}
        {/* ========================================================= */}
        {currentScreen === 'sheds' && (
          <div className="flex-1 flex flex-col p-4 animate-in slide-in-from-right duration-150">
            
            <div className="flex items-center justify-between mb-4">
              <button 
                onClick={() => setCurrentScreen('home')} 
                className="flex items-center gap-1.5 text-xs font-bold text-slate-300 bg-slate-800 px-3 py-1.5 rounded-xl border border-slate-700 active:scale-95"
              >
                <ArrowLeft className="w-4 h-4" /> Home
              </button>
              <button
                onClick={() => setShowAddShedModal(true)}
                className="bg-emerald-600 hover:bg-emerald-500 text-slate-950 px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1 active:scale-95"
              >
                <Plus className="w-3.5 h-3.5" /> Add Shed
              </button>
            </div>

            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 px-1 mb-2">All Active Sheds ({sheds.length})</p>

            <div className="space-y-2.5 overflow-y-auto flex-1">
              {consolidated.shedSummaries.map(s => (
                <div key={s.id} className="bg-slate-800/90 p-3 rounded-2xl border border-slate-700 flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="font-black text-sm text-white">{s.name}</span>
                      <span className={`text-[10px] px-1.5 py-0.2 rounded font-bold ${s.type === 'Male' ? 'bg-blue-950 text-blue-300' : 'bg-pink-950 text-pink-300'}`}>
                        {s.type}
                      </span>
                    </div>

                    {/* Edit & Delete Controls for Shed */}
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => handleStartEditShed(s)}
                        className="p-1.5 bg-slate-700/60 hover:bg-slate-700 text-slate-300 rounded-lg text-xs"
                        title="Edit Shed Details"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handleDeleteShed(s.id)}
                        className="p-1.5 bg-slate-700/60 hover:bg-rose-950 text-slate-400 hover:text-rose-400 rounded-lg text-xs"
                        title="Delete Shed"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-4 gap-1 text-center bg-slate-900/60 p-2 rounded-xl text-xs">
                    <div>
                      <span className="text-[9px] text-slate-400">BIRDS</span>
                      <div className="font-bold text-white">{s.stats.count}</div>
                    </div>
                    <div>
                      <span className="text-[9px] text-slate-400">AVG WT</span>
                      <div className="font-bold text-emerald-400">{s.stats.avg}g</div>
                    </div>
                    <div>
                      <span className="text-[9px] text-slate-400">UNIF%</span>
                      <div className="font-bold text-amber-400">{s.stats.unif}%</div>
                    </div>
                    <div>
                      <span className="text-[9px] text-slate-400">CV%</span>
                      <div className="font-bold text-sky-400">{s.stats.cv}%</div>
                    </div>
                  </div>

                  <button
                    onClick={() => {
                      setSelectedShedId(s.id);
                      setSelectedLineId(s.lines[0]?.id || 1);
                      setCurrentScreen('weigh');
                    }}
                    className="w-full bg-slate-700/60 hover:bg-slate-700 text-slate-200 text-xs font-bold py-1.5 rounded-xl transition mt-0.5 text-center"
                  >
                    Open Weighing Grid →
                  </button>
                </div>
              ))}
            </div>

          </div>
        )}

        {/* ========================================================= */}
        {/* 5. EDIT FARM & FLOCK SETUP SCREEN                         */}
        {/* ========================================================= */}
        {currentScreen === 'setup' && (
          <div className="flex-1 flex flex-col p-4 animate-in slide-in-from-right duration-150">
            
            <div className="flex items-center justify-between mb-4">
              <button 
                onClick={() => setCurrentScreen('home')} 
                className="flex items-center gap-1.5 text-xs font-bold text-slate-300 bg-slate-800 px-3 py-1.5 rounded-xl border border-slate-700 active:scale-95"
              >
                <ArrowLeft className="w-4 h-4" /> Home
              </button>
              <h2 className="text-sm font-black text-purple-400 uppercase tracking-wide">Farm Setup</h2>
            </div>

            <div className="bg-slate-800/90 p-4 rounded-2xl border border-slate-700 space-y-4 mb-4">
              <div>
                <label className="text-[11px] font-bold text-slate-400 uppercase">Farm Name</label>
                <input
                  type="text"
                  value={farmName}
                  onChange={e => setFarmName(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-sm font-bold text-white mt-1 focus:outline-none focus:border-emerald-500"
                />
              </div>

              {/* Live Real-Time Clock Controls */}
              <div className="bg-slate-950/80 p-3.5 rounded-2xl border border-slate-800 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="relative flex h-2.5 w-2.5">
                      {isLiveClock && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>}
                      <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${isLiveClock ? 'bg-emerald-500' : 'bg-slate-500'}`}></span>
                    </span>
                    <div>
                      <span className="text-xs font-bold text-white block">Auto Live Clock</span>
                      <span className="text-[10px] text-slate-400">Runs real-time in background without reload</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const next = !isLiveClock;
                      setIsLiveClock(next);
                      if (next) showToast('Live background clock resumed.');
                      else showToast('Clock paused on manual date & time.');
                    }}
                    className={`px-3 py-1 rounded-xl text-xs font-bold border transition cursor-pointer active:scale-95 ${
                      isLiveClock 
                        ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40' 
                        : 'bg-slate-800 text-slate-400 border-slate-700'
                    }`}
                  >
                    {isLiveClock ? 'Active (Live)' : 'Manual Mode'}
                  </button>
                </div>

                <div className="bg-slate-900/90 p-2.5 rounded-xl border border-slate-800 flex items-center justify-between text-xs">
                  <span className="text-slate-400 font-medium">Top Bar Clock:</span>
                  <span className="font-mono font-bold text-emerald-400 bg-emerald-500/10 px-2.5 py-1 rounded-lg border border-emerald-500/20">
                    {formattedDateTime}
                  </span>
                </div>

                <div className="flex items-center justify-between text-xs pt-1 border-t border-slate-800/80">
                  <span className="text-slate-400">Show Ticking Seconds (:ss)</span>
                  <button
                    type="button"
                    onClick={() => setShowLiveSeconds(prev => !prev)}
                    className={`px-2.5 py-0.5 rounded-lg text-[11px] font-bold border transition cursor-pointer active:scale-95 ${
                      showLiveSeconds 
                        ? 'bg-sky-500/20 text-sky-400 border-sky-500/40' 
                        : 'bg-slate-800 text-slate-400 border-slate-700'
                    }`}
                  >
                    {showLiveSeconds ? 'Enabled' : 'Disabled'}
                  </button>
                </div>

                {/* If manual mode, show manual pickers */}
                {!isLiveClock && (
                  <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-800/80">
                    <div>
                      <label className="text-[10px] font-bold text-slate-400 uppercase">Fixed Date</label>
                      <input
                        type="date"
                        value={date}
                        onChange={e => setDate(e.target.value)}
                        className="w-full bg-slate-950 border border-slate-700 rounded-xl px-2.5 py-1.5 text-xs font-bold text-white mt-1 focus:outline-none focus:border-emerald-500 font-mono"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-slate-400 uppercase">Fixed Time</label>
                      <input
                        type="time"
                        value={recordTime}
                        onChange={e => setRecordTime(e.target.value)}
                        className="w-full bg-slate-950 border border-slate-700 rounded-xl px-2.5 py-1.5 text-xs font-bold text-white mt-1 focus:outline-none focus:border-emerald-500 font-mono"
                      />
                    </div>
                  </div>
                )}
              </div>

              <div>
                <label className="text-[11px] font-bold text-slate-400 uppercase">Age Week</label>
                <select
                  value={ageWeek}
                  onChange={e => setAgeWeek(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-sm font-bold text-white mt-1 focus:outline-none focus:border-emerald-500"
                >
                  {Object.keys(BENCHMARKS).map(w => (
                    <option key={w} value={w}>{w}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-[11px] font-bold text-slate-400 uppercase">Season</label>
                <select
                  value={season}
                  onChange={e => setSeason(e.target.value as any)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-sm font-bold text-white mt-1 focus:outline-none focus:border-emerald-500"
                >
                  <option value="Summer">Summer Brooding</option>
                  <option value="Winter">Winter Brooding</option>
                </select>
              </div>
            </div>

            <button
              onClick={() => {
                showToast('Farm settings saved successfully!');
                setCurrentScreen('home');
              }}
              className="w-full bg-purple-600 hover:bg-purple-500 py-3 rounded-xl font-black text-sm text-white shadow-md active:scale-95"
            >
              Save & Back to Home
            </button>
          </div>
        )}

        {/* ========================================================= */}
        {/* MODAL: ADD NEW SHED                                       */}
        {/* ========================================================= */}
        {showAddShedModal && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-sm p-4 space-y-4">
              <div className="flex justify-between items-center">
                <h3 className="font-black text-base text-white">Create New Shed</h3>
                <button onClick={() => setShowAddShedModal(false)} className="text-slate-400 hover:text-white">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div>
                <label className="text-xs text-slate-400 uppercase font-semibold">Shed Name</label>
                <input
                  type="text"
                  placeholder="e.g. Shed 11"
                  value={newShedName}
                  onChange={e => setNewShedName(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm font-bold text-white mt-1 focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="text-xs text-slate-400 uppercase font-semibold">Flock Gender</label>
                <div className="grid grid-cols-2 gap-2 mt-1">
                  <button
                    type="button"
                    onClick={() => setNewShedType('Female')}
                    className={`py-2 rounded-xl text-xs font-bold border transition ${
                      newShedType === 'Female' 
                        ? 'bg-pink-950/80 text-pink-300 border-pink-700' 
                        : 'bg-slate-950 text-slate-400 border-slate-800'
                    }`}
                  >
                    ♀ Female
                  </button>
                  <button
                    type="button"
                    onClick={() => setNewShedType('Male')}
                    className={`py-2 rounded-xl text-xs font-bold border transition ${
                      newShedType === 'Male' 
                        ? 'bg-blue-950/80 text-blue-300 border-blue-700' 
                        : 'bg-slate-950 text-slate-400 border-slate-800'
                    }`}
                  >
                    ♂ Male
                  </button>
                </div>
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddShedModal(false)}
                  className="flex-1 bg-slate-800 py-2.5 rounded-xl text-xs font-bold text-slate-300"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleCreateShed}
                  className="flex-1 bg-emerald-600 py-2.5 rounded-xl text-xs font-black text-slate-950"
                >
                  Create Shed
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ========================================================= */}
        {/* MODAL: EDIT SHED DETAILS                                  */}
        {/* ========================================================= */}
        {editingShedId && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-sm p-4 space-y-4">
              <div className="flex justify-between items-center">
                <h3 className="font-black text-base text-white">Edit Shed</h3>
                <button onClick={() => setEditingShedId(null)} className="text-slate-400 hover:text-white">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div>
                <label className="text-xs text-slate-400 uppercase font-semibold">Shed Name</label>
                <input
                  type="text"
                  value={editShedName}
                  onChange={e => setEditShedName(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm font-bold text-white mt-1 focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="text-xs text-slate-400 uppercase font-semibold">Flock Gender</label>
                <div className="grid grid-cols-2 gap-2 mt-1">
                  <button
                    type="button"
                    onClick={() => setEditShedType('Female')}
                    className={`py-2 rounded-xl text-xs font-bold border transition ${
                      editShedType === 'Female' 
                        ? 'bg-pink-950/80 text-pink-300 border-pink-700' 
                        : 'bg-slate-950 text-slate-400 border-slate-800'
                    }`}
                  >
                    ♀ Female
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditShedType('Male')}
                    className={`py-2 rounded-xl text-xs font-bold border transition ${
                      editShedType === 'Male' 
                        ? 'bg-blue-950/80 text-blue-300 border-blue-700' 
                        : 'bg-slate-950 text-slate-400 border-slate-800'
                    }`}
                  >
                    ♂ Male
                  </button>
                </div>
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setEditingShedId(null)}
                  className="flex-1 bg-slate-800 py-2.5 rounded-xl text-xs font-bold text-slate-300"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSaveEditShed}
                  className="flex-1 bg-emerald-600 py-2.5 rounded-xl text-xs font-black text-slate-950"
                >
                  Save Changes
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ========================================================= */}
        {/* MODAL: CONFIRM DELETE PEN LINE                           */}
        {/* ========================================================= */}
        {linePendingDelete && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-sm p-5 space-y-4 shadow-2xl">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-rose-500/20 text-rose-400 rounded-xl">
                  <Trash2 className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="font-black text-base text-white">Delete {linePendingDelete.name}?</h3>
                  <p className="text-xs text-slate-400">Contains {linePendingDelete.weights.length} weighed birds</p>
                </div>
              </div>
              <p className="text-xs text-rose-300/90 bg-rose-950/40 p-3 rounded-xl border border-rose-800/40">
                Are you sure? All {linePendingDelete.weights.length} recorded bird weights for <strong>{linePendingDelete.name}</strong> will be permanently deleted.
              </p>
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setLinePendingDelete(null)}
                  className="flex-1 bg-slate-800 hover:bg-slate-750 py-2.5 rounded-xl text-xs font-bold text-slate-300 active:scale-95 transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => executeDeleteLine(linePendingDelete.id)}
                  className="flex-1 bg-rose-600 hover:bg-rose-500 py-2.5 rounded-xl text-xs font-black text-white shadow-lg shadow-rose-950 active:scale-95 transition cursor-pointer"
                >
                  Yes, Delete Line
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ========================================================= */}
        {/* MODAL: CONFIRM DELETE SHED                                */}
        {/* ========================================================= */}
        {shedPendingDelete && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-sm p-5 space-y-4 shadow-2xl">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-rose-500/20 text-rose-400 rounded-xl">
                  <Trash2 className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="font-black text-base text-white">Delete {shedPendingDelete.name}?</h3>
                  <p className="text-xs text-slate-400">This will remove the shed and all its pen lines.</p>
                </div>
              </div>
              <p className="text-xs text-rose-300/90 bg-rose-950/40 p-3 rounded-xl border border-rose-800/40">
                Are you sure you want to delete <strong>{shedPendingDelete.name}</strong>? This action cannot be undone.
              </p>
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setShedPendingDelete(null)}
                  className="flex-1 bg-slate-800 hover:bg-slate-750 py-2.5 rounded-xl text-xs font-bold text-slate-300 active:scale-95 transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => executeDeleteShed(shedPendingDelete.id)}
                  className="flex-1 bg-rose-600 hover:bg-rose-500 py-2.5 rounded-xl text-xs font-black text-white shadow-lg shadow-rose-950 active:scale-95 transition cursor-pointer"
                >
                  Yes, Delete Shed
                </button>
              </div>
            </div>
          </div>
        )}

        {/* On-Screen Mobile Toast Notification */}
        {toastMessage && (
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 w-[90%] max-w-sm bg-slate-900/95 border border-emerald-500/60 text-white px-4 py-3 rounded-2xl shadow-2xl flex items-center gap-3 backdrop-blur-md z-50 animate-in fade-in slide-in-from-bottom duration-200">
            <div className="p-2 bg-emerald-500/20 text-emerald-400 rounded-xl shrink-0">
              <CheckCircle2 className="w-5 h-5" />
            </div>
            <p className="text-xs font-bold leading-snug text-slate-100 flex-1">
              {toastMessage}
            </p>
            <button onClick={() => setToastMessage(null)} className="text-slate-400 hover:text-white p-1">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

      </div>
    </div>
  );
}
