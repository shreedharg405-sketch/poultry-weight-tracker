import React, { useState, useEffect, useMemo, useRef } from 'react';
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
  Edit3,
  X, 
  AlertCircle,
  FileSpreadsheet,
  CheckCircle2,
  LogOut
} from 'lucide-react';
import { 
  ShedData, 
  ShedPart, 
  PenLine, 
  calculateFlockStats, 
  getGradingBands, 
  getBirdGrade, 
  exportPoultryWorkbook,
  BirdGrade
} from './services/excelExportService';
import { WINTER_BROOD_STANDARDS, SUMMER_BROOD_STANDARDS } from './services/benchmarks';
import { LoadingScreen } from './components/LoadingScreen';

// Seasonal Target Benchmarks for all 23 Weeks
const BENCHMARKS: Record<'Summer' | 'Winter', Record<string, { stdF: number; stdM: number }>> = {
  Summer: SUMMER_BROOD_STANDARDS.reduce((acc, cur) => {
    acc[`W${cur.week}`] = { stdF: cur.femaleWeight, stdM: cur.maleWeight };
    return acc;
  }, {} as Record<string, { stdF: number; stdM: number }>),
  Winter: WINTER_BROOD_STANDARDS.reduce((acc, cur) => {
    acc[`W${cur.week}`] = { stdF: cur.femaleWeight, stdM: cur.maleWeight };
    return acc;
  }, {} as Record<string, { stdF: number; stdM: number }>)
};

// Format live date-month-year (DD-MM-YYYY)
const formatDateDMY = (d: Date): string => {
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}-${month}-${year}`;
};

// Format 12-hour time with seconds
const formatTime12H = (d: Date): string => {
  let hours = d.getHours();
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const seconds = String(d.getSeconds()).padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12 || 12;
  return `${String(hours).padStart(2, '0')}:${minutes}:${seconds} ${ampm}`;
};

export type ScreenType = 
  | 'home' 
  | 'shed_select' 
  | 'part_select' 
  | 'line_select' 
  | 'weigh_pad' 
  | 'conclusion' 
  | 'sheds_manage' 
  | 'setup';

export default function App() {
  const [currentScreen, setCurrentScreen] = useState<ScreenType>('home');
  const [showExitConfirm, setShowExitConfirm] = useState(false);

  // Full-Screen Splash & Operations Loading State (2 Seconds)
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [loadingMessage, setLoadingMessage] = useState('Calibrating Shed & Line Uniformity...');
  const [isExporting, setIsExporting] = useState(false);
  const [exportMessage, setExportMessage] = useState('Generating 13-Sheet Excel Workbook...');

  // 2-Second Initial Splash Sequence
  useEffect(() => {
    const t1 = setTimeout(() => {
      setLoadingMessage('Synchronizing 10 Sheds & Pen Records...');
    }, 650);
    const t2 = setTimeout(() => {
      setLoadingMessage('Verifying Body Weight Tolerances & Benchmarks...');
    }, 1300);
    const t3 = setTimeout(() => {
      setLoadingMessage('Flock Ready');
    }, 1750);
    const t4 = setTimeout(() => {
      setIsInitialLoading(false);
    }, 2000);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      clearTimeout(t4);
    };
  }, []);

  // Live System Clock
  const [liveTime, setLiveTime] = useState(new Date());
  const [isLiveClock, setIsLiveClock] = useState(true);

  useEffect(() => {
    if (!isLiveClock) return;
    const timer = setInterval(() => setLiveTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, [isLiveClock]);

  // Farm Profile State
  const [farmName, setFarmName] = useState('SAI FARM - UNIT 1');
  const [date, setDate] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });
  const [manualTime, setManualTime] = useState('12:00');
  const [ageWeek, setAgeWeek] = useState('W18');
  const [season, setSeason] = useState<'Summer' | 'Winter'>('Summer');

  // Week number extraction for exact tolerance calculation
  const weekNum = useMemo(() => {
    const num = parseInt(ageWeek.replace(/\D/g, ''), 10);
    return isNaN(num) ? 18 : num;
  }, [ageWeek]);

  const liveDateFormatted = useMemo(() => formatDateDMY(liveTime), [liveTime]);
  const liveTimeFormatted = useMemo(() => formatTime12H(liveTime), [liveTime]);
  const formattedDateTime = useMemo(() => {
    return isLiveClock 
      ? `${liveDateFormatted} | ${liveTimeFormatted}` 
      : `${date} | ${manualTime}`;
  }, [isLiveClock, liveDateFormatted, liveTimeFormatted, date, manualTime]);

  // Target standard weights
  const stdWeightFemale = BENCHMARKS[season][ageWeek]?.stdF || 1905;
  const stdWeightMale = BENCHMARKS[season][ageWeek]?.stdM || 1880;

  // Active Selections for Hierarchy
  const [selectedShedId, setSelectedShedId] = useState('1');
  const [selectedPartId, setSelectedPartId] = useState('part-1-a');
  const [selectedLineId, setSelectedLineId] = useState(1);
  const [inputWeight, setInputWeight] = useState('');

  // Modals & In-App Confirmations
  const [showAddShedModal, setShowAddShedModal] = useState(false);
  const [newShedName, setNewShedName] = useState('');
  const [newShedType, setNewShedType] = useState<'Female' | 'Male'>('Female');
  const [editingShed, setEditingShed] = useState<{ id: string; name: string; type: 'Female' | 'Male' } | null>(null);
  const [editingPart, setEditingPart] = useState<{ id: string; name: string } | null>(null);
  const [partPendingDelete, setPartPendingDelete] = useState<{ id: string; name: string; totalWeights: number } | null>(null);
  const [linePendingDelete, setLinePendingDelete] = useState<{ id: number; name: string; weights: number[] } | null>(null);

  // Toast Notification State
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3800);
  };

  // Initial 10 Sheds Hierarchy Matching Excel Sheet Structure
  const [sheds, setSheds] = useState<ShedData[]>([
    {
      id: '1',
      name: 'Shed 1',
      sheetName: 'Shed 1',
      type: 'Female',
      parts: [
        {
          id: 'part-1-a',
          name: 'Part A',
          lines: [
            { id: 1, name: 'Line 1', weights: [1270, 1290, 1300, 1300, 1330, 1370, 1380, 1390, 1400, 1450, 1850, 1950, 1985, 1990] },
            { id: 2, name: 'Line 2', weights: [1280, 1310, 1320, 1340, 1390, 1420, 1460, 1500] }
          ]
        },
        {
          id: 'part-1-b',
          name: 'Part B',
          lines: [
            { id: 1, name: 'Line 1', weights: [1270, 1290, 1300, 1350, 1380, 1400, 1450] }
          ]
        }
      ]
    },
    {
      id: '2',
      name: 'Shed 2',
      sheetName: 'Shed 2',
      type: 'Female',
      parts: [
        {
          id: 'part-2-a',
          name: 'Part A',
          lines: [{ id: 1, name: 'Line 1', weights: [1270, 1290, 1300, 1300, 1330, 1370, 1380, 1390, 1400, 1450, 1470, 1500, 1510] }]
        }
      ]
    },
    {
      id: '3',
      name: 'Shed 3',
      sheetName: 'Shed 3',
      type: 'Female',
      parts: [
        {
          id: 'part-3-a',
          name: 'Part A',
          lines: [{ id: 1, name: 'Line 1', weights: [1270, 1290, 1300, 1300, 1330, 1370, 1380, 1390, 1400, 1450, 1470, 1500] }]
        }
      ]
    },
    {
      id: '4',
      name: 'Shed 4',
      sheetName: 'Shed 4',
      type: 'Female',
      parts: [
        {
          id: 'part-4-a',
          name: 'Part A',
          lines: [{ id: 1, name: 'Line 1', weights: [1270, 1290, 1300, 1300, 1330, 1370, 1380, 1390, 1400, 1450, 1470] }]
        }
      ]
    },
    {
      id: '5',
      name: 'Shed 5',
      sheetName: 'Shed 5',
      type: 'Female',
      parts: [
        {
          id: 'part-5-a',
          name: 'Part A',
          lines: [{ id: 1, name: 'Line 1', weights: [1270, 1290, 1300, 1300, 1330, 1370, 1380, 1390, 1400, 1450] }]
        }
      ]
    },
    {
      id: '6',
      name: 'Shed 6',
      sheetName: 'Shed 6',
      type: 'Female',
      parts: [
        {
          id: 'part-6-a',
          name: 'Part A',
          lines: [{ id: 1, name: 'Line 1', weights: [1270, 1290, 1300, 1300, 1330, 1370, 1380, 1390, 1400] }]
        }
      ]
    },
    {
      id: '7',
      name: 'Shed 7',
      sheetName: 'Shed 7',
      type: 'Female',
      parts: [
        {
          id: 'part-7-a',
          name: 'Part A',
          lines: [{ id: 1, name: 'Line 1', weights: [1270, 1290, 1300, 1300, 1330, 1370, 1380, 1390] }]
        }
      ]
    },
    {
      id: '8',
      name: 'Shed 8 Male',
      sheetName: ' Shed 8 Male',
      type: 'Male',
      parts: [
        {
          id: 'part-8-a',
          name: 'Part A',
          lines: [{ id: 1, name: 'Line 1', weights: [2800, 3000, 3800, 2650, 2950, 2456, 3566, 2800, 3000, 3800] }]
        }
      ]
    },
    {
      id: '9',
      name: 'Shed 9',
      sheetName: 'Shed 9',
      type: 'Female',
      parts: [
        {
          id: 'part-9-a',
          name: 'Part A',
          lines: [{ id: 1, name: 'Line 1', weights: [1270, 1290, 1300, 1300, 1330, 1370, 1380, 1390, 1400, 1450, 1470] }]
        }
      ]
    },
    {
      id: '10',
      name: 'Shed 10',
      sheetName: 'Shed 10',
      type: 'Female',
      parts: [
        {
          id: 'part-10-a',
          name: 'Part A',
          lines: [{ id: 1, name: 'Line 1', weights: [1270, 1290, 1300, 1300, 1330, 1370, 1380, 1390, 1400, 1450, 1470, 1500] }]
        }
      ]
    }
  ]);

  // Hardware Back Button & Mobile Popstate Routing Trap
  const currentScreenRef = useRef<ScreenType>('home');
  currentScreenRef.current = currentScreen;

  const selectedShedIdRef = useRef(selectedShedId);
  selectedShedIdRef.current = selectedShedId;

  const selectedPartIdRef = useRef(selectedPartId);
  selectedPartIdRef.current = selectedPartId;

  const selectedLineIdRef = useRef(selectedLineId);
  selectedLineIdRef.current = selectedLineId;

  const handlePopState = (event?: PopStateEvent) => {
    const active = currentScreenRef.current;

    // Restore hierarchy identifiers from event state if available
    if (event?.state) {
      if (event.state.shedId) setSelectedShedId(event.state.shedId);
      if (event.state.partId) setSelectedPartId(event.state.partId);
      if (event.state.lineId !== undefined) setSelectedLineId(event.state.lineId);
    }

    if (active === 'weigh_pad') {
      setCurrentScreen('line_select');
      window.history.pushState({
        screen: 'line_select',
        shedId: selectedShedIdRef.current,
        partId: selectedPartIdRef.current
      }, '');
    } else if (active === 'line_select') {
      setCurrentScreen('part_select');
      window.history.pushState({
        screen: 'part_select',
        shedId: selectedShedIdRef.current
      }, '');
    } else if (active === 'part_select') {
      setCurrentScreen('shed_select');
      window.history.pushState({ screen: 'shed_select' }, '');
    } else if (active === 'shed_select' || active === 'conclusion' || active === 'setup' || active === 'sheds_manage') {
      setCurrentScreen('home');
      window.history.pushState({ screen: 'home' }, '');
    } else if (active === 'home') {
      // Trigger Exit Confirmation Dialog
      setShowExitConfirm(true);
      window.history.pushState({ screen: 'home' }, '');
    } else {
      setCurrentScreen('home');
      window.history.pushState({ screen: 'home' }, '');
    }
  };

  useEffect(() => {
    // Prime root state
    window.history.replaceState({ screen: 'home' }, '');
    window.history.pushState({ screen: 'home' }, '');

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // Consistent UI Back Button handler matching popstate behavior 100%
  const handleGoBack = () => {
    handlePopState();
  };

  // Synchronized Forward Navigation Helpers
  const navigateToShedSelect = () => {
    setCurrentScreen('shed_select');
    window.history.pushState({ screen: 'shed_select' }, '');
  };

  const navigateToPartSelect = (shedId: string, partId?: string) => {
    setSelectedShedId(shedId);
    if (partId) setSelectedPartId(partId);
    setCurrentScreen('part_select');
    window.history.pushState({ screen: 'part_select', shedId }, '');
  };

  const navigateToLineSelect = (shedId: string, partId: string, lineId?: number) => {
    setSelectedShedId(shedId);
    setSelectedPartId(partId);
    if (lineId !== undefined) setSelectedLineId(lineId);
    setCurrentScreen('line_select');
    window.history.pushState({ screen: 'line_select', shedId, partId }, '');
  };

  const navigateToWeighPad = (shedId: string, partId: string, lineId: number) => {
    setSelectedShedId(shedId);
    setSelectedPartId(partId);
    setSelectedLineId(lineId);
    setCurrentScreen('weigh_pad');
    window.history.pushState({ screen: 'weigh_pad', shedId, partId, lineId }, '');
  };

  const navigateTo = (screen: ScreenType) => {
    setCurrentScreen(screen);
    window.history.pushState({ screen }, '');
  };

  const handleCancelExit = () => {
    setShowExitConfirm(false);
    window.history.pushState({ screen: 'home' }, '');
  };

  const handleConfirmExit = () => {
    setShowExitConfirm(false);
    try {
      window.close();
    } catch {
      // fallback
    }
    window.history.go(-2);
  };

  // Local Storage Persistence
  useEffect(() => {
    const saved = localStorage.getItem('poultry_flock_db_v3');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed.sheds) setSheds(parsed.sheds);
        if (parsed.farmName) setFarmName(parsed.farmName);
        if (parsed.date) setDate(parsed.date);
        if (parsed.ageWeek) setAgeWeek(parsed.ageWeek);
        if (parsed.season) setSeason(parsed.season);
      } catch (e) {
        console.error('Failed to load local storage:', e);
      }
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(
      'poultry_flock_db_v3',
      JSON.stringify({ sheds, farmName, date, ageWeek, season })
    );
  }, [sheds, farmName, date, ageWeek, season]);

  // Active Pointers
  const activeShed = sheds.find(s => s.id === selectedShedId) || sheds[0];
  const activePart = activeShed?.parts.find(p => p.id === selectedPartId) || activeShed?.parts[0];
  const activeLine = activePart?.lines.find(l => l.id === selectedLineId) || activePart?.lines[0];

  const activeStd = activeShed?.type === 'Male' ? stdWeightMale : stdWeightFemale;
  const activeBands = useMemo(() => getGradingBands(activeStd, weekNum), [activeStd, weekNum]);

  // Real-time Calculations
  const lineStats = useMemo(() => {
    if (!activeLine) return calculateFlockStats([], activeStd, weekNum);
    return calculateFlockStats(activeLine.weights, activeStd, weekNum);
  }, [activeLine, activeStd, weekNum]);

  const partStats = useMemo(() => {
    if (!activePart) return calculateFlockStats([], activeStd, weekNum);
    const weights = activePart.lines.flatMap(l => l.weights);
    return calculateFlockStats(weights, activeStd, weekNum);
  }, [activePart, activeStd, weekNum]);

  const shedStats = useMemo(() => {
    if (!activeShed) return calculateFlockStats([], activeStd, weekNum);
    const weights = activeShed.parts.flatMap(p => p.lines.flatMap(l => l.weights));
    return calculateFlockStats(weights, activeStd, weekNum);
  }, [activeShed, activeStd, weekNum]);

  // Consolidated Overall Calculations
  const consolidated = useMemo(() => {
    const femaleWeights = sheds
      .filter(s => s.type === 'Female')
      .flatMap(s => s.parts.flatMap(p => p.lines.flatMap(l => l.weights)));

    const maleWeights = sheds
      .filter(s => s.type === 'Male')
      .flatMap(s => s.parts.flatMap(p => p.lines.flatMap(l => l.weights)));

    const fStats = calculateFlockStats(femaleWeights, stdWeightFemale, weekNum);
    const mStats = calculateFlockStats(maleWeights, stdWeightMale, weekNum);

    const shedSummaries = sheds.map((s, idx) => {
      const allW = s.parts.flatMap(p => p.lines.flatMap(l => l.weights));
      const std = s.type === 'Male' ? stdWeightMale : stdWeightFemale;
      return {
        ...s,
        indexNum: idx + 1,
        stats: calculateFlockStats(allW, std, weekNum)
      };
    });

    return { fStats, mStats, shedSummaries };
  }, [sheds, stdWeightFemale, stdWeightMale, weekNum]);

  // --- WEIGHING PAD WEIGHT HANDLERS ---
  const handleAddWeight = (valToAdd?: number) => {
    const val = valToAdd !== undefined ? valToAdd : parseFloat(inputWeight);
    if (!val || isNaN(val) || val <= 0 || !activeShed || !activePart || !activeLine) return;

    setSheds(prev => prev.map(s => {
      if (s.id !== activeShed.id) return s;
      return {
        ...s,
        parts: s.parts.map(p => {
          if (p.id !== activePart.id) return p;
          return {
            ...p,
            lines: p.lines.map(l => {
              if (l.id !== activeLine.id) return l;
              return { ...l, weights: [...l.weights, val] };
            })
          };
        })
      };
    }));
    setInputWeight('');
  };

  const handleDeleteWeight = (idx: number) => {
    if (!activeShed || !activePart || !activeLine) return;
    setSheds(prev => prev.map(s => {
      if (s.id !== activeShed.id) return s;
      return {
        ...s,
        parts: s.parts.map(p => {
          if (p.id !== activePart.id) return p;
          return {
            ...p,
            lines: p.lines.map(l => {
              if (l.id !== activeLine.id) return l;
              const copy = [...l.weights];
              copy.splice(idx, 1);
              return { ...l, weights: copy };
            })
          };
        })
      };
    }));
  };

  const handleClearLineWeights = () => {
    if (!activeShed || !activePart || !activeLine || activeLine.weights.length === 0) return;
    if (window.confirm(`Clear all ${activeLine.weights.length} weights in ${activeLine.name}?`)) {
      setSheds(prev => prev.map(s => {
        if (s.id !== activeShed.id) return s;
        return {
          ...s,
          parts: s.parts.map(p => {
            if (p.id !== activePart.id) return p;
            return {
              ...p,
              lines: p.lines.map(l => l.id === activeLine.id ? { ...l, weights: [] } : l)
            };
          })
        };
      }));
      showToast(`Cleared weights in ${activeLine.name}`);
    }
  };

  // --- PART MANAGEMENT HANDLERS ---
  const handleAddPart = () => {
    if (!activeShed) return;
    const charCode = 65 + activeShed.parts.length;
    const partName = `Part ${String.fromCharCode(charCode)}`;
    const newPartId = `part-${Date.now()}`;
    const newPart: ShedPart = {
      id: newPartId,
      name: partName,
      lines: [{ id: 1, name: 'Line 1', weights: [] }]
    };
    setSheds(prev => prev.map(s => s.id === activeShed.id ? { ...s, parts: [...s.parts, newPart] } : s));
    setSelectedPartId(newPartId);
    setSelectedLineId(1);
    showToast(`${partName} added to ${activeShed.name}`);
  };

  const handleStartEditPart = (part: ShedPart) => {
    setEditingPart({ id: part.id, name: part.name });
  };

  const handleSaveEditPart = () => {
    if (!editingPart || !editingPart.name.trim() || !activeShed) return;
    const trimmed = editingPart.name.trim();
    setSheds(prev => prev.map(s => {
      if (s.id !== activeShed.id) return s;
      return {
        ...s,
        parts: s.parts.map(p => p.id === editingPart.id ? { ...p, name: trimmed } : p)
      };
    }));
    showToast(`Part renamed to "${trimmed}".`);
    setEditingPart(null);
  };

  const handleDeletePart = (partId: string, e?: React.MouseEvent) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    if (!activeShed) return;
    if (activeShed.parts.length <= 1) {
      showToast('A shed must have at least 1 part.');
      return;
    }
    const target = activeShed.parts.find(p => p.id === partId);
    if (!target) return;

    const totalWeights = target.lines.reduce((acc, l) => acc + l.weights.length, 0);
    if (totalWeights === 0) {
      executeDeletePart(partId);
    } else {
      setPartPendingDelete({ id: target.id, name: target.name, totalWeights });
    }
  };

  const executeDeletePart = (partId: string) => {
    if (!activeShed) return;
    const targetPart = activeShed.parts.find(p => p.id === partId);
    const partName = targetPart?.name || 'Part';
    const remainingParts = activeShed.parts.filter(p => p.id !== partId);

    setSheds(prev => prev.map(s => {
      if (s.id !== activeShed.id) return s;
      return { ...s, parts: remainingParts };
    }));

    if (selectedPartId === partId) {
      const fallback = remainingParts[0];
      setSelectedPartId(fallback.id);
      setSelectedLineId(fallback.lines[0]?.id || 1);
    }
    showToast(`${partName} deleted.`);
    setPartPendingDelete(null);
  };

  // --- LINE / PEN MANAGEMENT HANDLERS ---
  const handleAddLine = () => {
    if (!activeShed || !activePart) return;
    const nextId = (activePart.lines.length ? Math.max(...activePart.lines.map(l => l.id)) : 0) + 1;
    const newLineName = `Line ${nextId}`;
    setSheds(prev => prev.map(s => {
      if (s.id !== activeShed.id) return s;
      return {
        ...s,
        parts: s.parts.map(p => {
          if (p.id !== activePart.id) return p;
          return {
            ...p,
            lines: [...p.lines, { id: nextId, name: newLineName, weights: [] }]
          };
        })
      };
    }));
    setSelectedLineId(nextId);
    showToast(`${newLineName} added to ${activePart.name}`);
  };

  const handleDeleteLine = (lineId: number, e?: React.MouseEvent) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    if (!activeShed || !activePart) return;
    if (activePart.lines.length <= 1) {
      showToast('A part must have at least 1 pen line.');
      return;
    }
    const target = activePart.lines.find(l => l.id === lineId);
    if (!target) return;

    if (target.weights.length === 0) {
      executeDeleteLine(lineId);
    } else {
      setLinePendingDelete({ id: target.id, name: target.name, weights: target.weights });
    }
  };

  const executeDeleteLine = (lineId: number) => {
    if (!activeShed || !activePart) return;
    const remaining = activePart.lines.filter(l => l.id !== lineId);
    setSheds(prev => prev.map(s => {
      if (s.id !== activeShed.id) return s;
      return {
        ...s,
        parts: s.parts.map(p => p.id === activePart.id ? { ...p, lines: remaining } : p)
      };
    }));
    setSelectedLineId(prev => (prev === lineId ? remaining[0].id : prev));
    setLinePendingDelete(null);
    showToast('Line deleted.');
  };

  // --- SHED CREATION & EDITING ---
  const handleAddShed = () => {
    if (!newShedName.trim()) return;
    const newId = String(Date.now());
    const newShed: ShedData = {
      id: newId,
      name: newShedName.trim(),
      sheetName: `Shed ${sheds.length + 1}`,
      type: newShedType,
      parts: [
        {
          id: `part-${Date.now()}-a`,
          name: 'Part A',
          lines: [{ id: 1, name: 'Line 1', weights: [] }]
        }
      ]
    };
    setSheds(prev => [...prev, newShed]);
    setSelectedShedId(newId);
    setSelectedPartId(newShed.parts[0].id);
    setSelectedLineId(1);
    setNewShedName('');
    setShowAddShedModal(false);
    showToast(`Created ${newShed.name}`);
  };

  const handleStartEditShed = (shed: ShedData) => {
    setEditingShed({ id: shed.id, name: shed.name, type: shed.type });
  };

  const handleSaveEditShed = () => {
    if (!editingShed || !editingShed.name.trim()) return;
    setSheds(prev => prev.map(s => s.id === editingShed.id ? { ...s, name: editingShed.name.trim(), type: editingShed.type } : s));
    showToast(`Saved ${editingShed.name}`);
    setEditingShed(null);
  };

  // --- COMPLETE 13-SHEET WORKBOOK EXPORT ---
  const handleDownloadExcel = async () => {
    try {
      setIsExporting(true);
      setExportMessage('Generating 13-Sheet Excel Workbook...');
      showToast('Generating complete 13-sheet Excel workbook...');
      const res = await exportPoultryWorkbook({
        farmName,
        dateStr: date,
        formattedDateTime,
        ageWeek,
        weekNum,
        season,
        stdWeightFemale,
        stdWeightMale,
        sheds
      });
      if (res.success) {
        showToast(res.method === 'share' ? 'Shared successfully!' : 'Downloaded successfully!');
      } else if (res.method !== 'aborted') {
        showToast('Download could not complete.');
      }
    } catch (err) {
      console.error(err);
      showToast('Error generating workbook.');
    } finally {
      setIsExporting(false);
    }
  };

  // Grade badge styling matching light theme
  const getBadgeStyle = (grade: BirdGrade) => {
    switch (grade) {
      case 'MB':
        return 'text-rose-700 bg-rose-50 border-rose-200 font-bold';
      case 'B':
        return 'text-amber-700 bg-amber-50 border-amber-200 font-bold';
      case 'S':
        return 'text-emerald-700 bg-emerald-50 border-emerald-300 font-extrabold';
      case 'A':
        return 'text-sky-700 bg-sky-50 border-sky-200 font-bold';
      case 'MA':
        return 'text-purple-700 bg-purple-50 border-purple-200 font-bold';
    }
  };

  return (
    <>
      {/* Full-Screen Hen/Rooster Logo Splash & Operations Loading Screen */}
      {isInitialLoading && <LoadingScreen message={loadingMessage} />}
      {isExporting && <LoadingScreen message={exportMessage} />}

      <div className="flex justify-center bg-slate-100 min-h-screen text-slate-800 font-sans antialiased selection:bg-emerald-500 selection:text-white">
        <div className="w-full max-w-md min-h-screen bg-slate-50 border-x border-slate-200 flex flex-col shadow-2xl relative pb-6">
        
        {/* ========================================================= */}
        {/* 1. APP HOME DASHBOARD                                     */}
        {/* ========================================================= */}
        {currentScreen === 'home' && (
          <div className="flex-1 flex flex-col p-4 animate-in fade-in duration-150">
            {/* Top Quick Profile Card */}
            <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs mb-4">
              {/* Top Row: Flock Status & Live Date/Time (Responsive flex layout prevents text overlap) */}
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-1.5 pb-2.5 border-b border-slate-100">
                <span className="text-[10px] font-bold text-emerald-700 uppercase tracking-widest bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-200 inline-block shrink-0">
                  Poultry Flock Live
                </span>
                <span className="text-[10px] sm:text-xs font-mono font-bold text-amber-800 bg-amber-50 px-2 sm:px-2.5 py-0.5 sm:py-1 rounded-lg border border-amber-200 shadow-2xs leading-tight whitespace-nowrap">
                  {formattedDateTime}
                </span>
              </div>

              {/* Full Width Farm Name (Never Truncated with ...) */}
              <h1 className="text-lg sm:text-xl font-black text-slate-900 mt-2.5 tracking-tight flex items-center gap-2 break-words leading-snug">
                <Building2 className="w-5 h-5 text-emerald-600 shrink-0" />
                <span className="break-words">{farmName}</span>
              </h1>

              {/* Tag Details */}
              <div className="flex items-center gap-2 mt-3 pt-2.5 border-t border-slate-100 text-xs">
                <span className="bg-slate-100 text-slate-700 px-2.5 py-1 rounded-lg font-bold border border-slate-200">
                  Age: {ageWeek}
                </span>
                <span className="bg-slate-100 text-slate-700 px-2.5 py-1 rounded-lg border border-slate-200">
                  {season} Brood
                </span>
                <span className="bg-slate-100 text-slate-700 px-2.5 py-1 rounded-lg border border-slate-200 font-mono">
                  {sheds.length} Sheds
                </span>
              </div>
            </div>

            {/* Quick KPI Overview */}
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div className="bg-white p-3 rounded-2xl border border-slate-200 text-center shadow-xs">
                <span className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">Female Avg (♀)</span>
                <div className="text-xl font-black text-emerald-600 font-mono mt-1">{consolidated.fStats.avg}g</div>
                <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                  Target: {stdWeightFemale}g ({consolidated.fStats.unif}% S)
                </div>
              </div>
              <div className="bg-white p-3 rounded-2xl border border-slate-200 text-center shadow-xs">
                <span className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">Male Avg (♂)</span>
                <div className="text-xl font-black text-blue-600 font-mono mt-1">{consolidated.mStats.avg}g</div>
                <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                  Target: {stdWeightMale}g ({consolidated.mStats.unif}% S)
                </div>
              </div>
            </div>

            {/* Task Action Menu */}
            <div className="space-y-3 flex-1">
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 px-1">Flock Operations</p>

              {/* 1. Enter Weights */}
              <button
                onClick={navigateToShedSelect}
                className="w-full bg-emerald-600 hover:bg-emerald-500 active:scale-[0.98] transition p-4 rounded-2xl flex items-center justify-between text-left shadow-md shadow-emerald-600/20 text-white group cursor-pointer"
              >
                <div className="flex items-center gap-3.5">
                  <div className="p-3 bg-white/20 rounded-xl text-white">
                    <Scale className="w-6 h-6" />
                  </div>
                  <div>
                    <h2 className="font-black text-base text-white">Enter Bird Weights</h2>
                    <p className="text-xs text-emerald-100">Shed › Part › Line weighing cards</p>
                  </div>
                </div>
                <ChevronRight className="w-5 h-5 text-emerald-200 group-hover:translate-x-1 transition" />
              </button>

              {/* 2. Consolidated Report */}
              <button
                onClick={() => navigateTo('conclusion')}
                className="w-full bg-white hover:bg-slate-50 active:scale-[0.98] transition p-4 rounded-2xl flex items-center justify-between text-left shadow-xs border border-slate-200 group cursor-pointer"
              >
                <div className="flex items-center gap-3.5">
                  <div className="p-3 bg-amber-50 rounded-xl text-amber-600 border border-amber-200">
                    <Sparkles className="w-6 h-6" />
                  </div>
                  <div>
                    <h2 className="font-black text-base text-slate-900">Consolidated Conclusion</h2>
                    <p className="text-xs text-slate-500">Master report, Uniformity %, CV%</p>
                  </div>
                </div>
                <ChevronRight className="w-5 h-5 text-slate-400 group-hover:translate-x-1 transition" />
              </button>

              {/* 3. Manage Sheds */}
              <button
                onClick={() => navigateTo('sheds_manage')}
                className="w-full bg-white hover:bg-slate-50 active:scale-[0.98] transition p-4 rounded-2xl flex items-center justify-between text-left shadow-xs border border-slate-200 group cursor-pointer"
              >
                <div className="flex items-center gap-3.5">
                  <div className="p-3 bg-sky-50 rounded-xl text-sky-600 border border-sky-200">
                    <Layers className="w-6 h-6" />
                  </div>
                  <div>
                    <h2 className="font-black text-base text-slate-900">Manage & Compare Sheds</h2>
                    <p className="text-xs text-slate-500">Add, rename, delete sheds & view stats</p>
                  </div>
                </div>
                <ChevronRight className="w-5 h-5 text-slate-400 group-hover:translate-x-1 transition" />
              </button>

              {/* 4. Setup */}
              <button
                onClick={() => navigateTo('setup')}
                className="w-full bg-white hover:bg-slate-50 active:scale-[0.98] transition p-4 rounded-2xl flex items-center justify-between text-left shadow-xs border border-slate-200 group cursor-pointer"
              >
                <div className="flex items-center gap-3.5">
                  <div className="p-3 bg-purple-50 rounded-xl text-purple-600 border border-purple-200">
                    <Settings className="w-6 h-6" />
                  </div>
                  <div>
                    <h2 className="font-black text-base text-slate-900">Farm & Flock Details</h2>
                    <p className="text-xs text-slate-500">Change Name, Date, Age & Export Excel</p>
                  </div>
                </div>
                <ChevronRight className="w-5 h-5 text-slate-400 group-hover:translate-x-1 transition" />
              </button>
            </div>

            {/* Quick Export in Footer */}
            <div className="mt-4 pt-3 border-t border-slate-200">
              <button
                onClick={handleDownloadExcel}
                className="w-full bg-white hover:bg-slate-100 text-slate-800 py-3 rounded-2xl font-bold text-xs flex items-center justify-center gap-2 border border-slate-300 shadow-xs active:scale-95 transition cursor-pointer"
              >
                <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
                <span>Save / Share Complete 13-Sheet .xlsx</span>
              </button>
            </div>
          </div>
        )}

        {/* ========================================================= */}
        {/* 2. SHED SELECTION SCREEN (CLEAN LIGHT CARDS)              */}
        {/* ========================================================= */}
        {currentScreen === 'shed_select' && (
          <div className="flex-1 flex flex-col p-4 animate-in slide-in-from-right duration-150">
            <div className="flex items-center justify-between mb-4">
              <button 
                onClick={handleGoBack} 
                className="flex items-center gap-1.5 text-xs font-bold text-slate-700 bg-white hover:bg-slate-100 px-3 py-1.5 rounded-xl border border-slate-200 shadow-xs active:scale-95 cursor-pointer"
              >
                <ArrowLeft className="w-4 h-4" /> Home
              </button>
              <h2 className="text-xs font-black text-emerald-700 uppercase tracking-wide bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-200">
                Select Shed
              </h2>
            </div>

            <p className="text-xs text-slate-500 mb-3 px-1 font-medium">Choose a shed to enter or view its parts:</p>

            <div className="space-y-3 overflow-y-auto flex-1 pb-4">
              {sheds.map(s => {
                const sStd = s.type === 'Male' ? stdWeightMale : stdWeightFemale;
                const sStats = calculateFlockStats(s.parts.flatMap(p => p.lines.flatMap(l => l.weights)), sStd, weekNum);
                return (
                  <button
                    key={s.id}
                    onClick={() => {
                      navigateToPartSelect(s.id, s.parts[0]?.id || 'part-1-a');
                    }}
                    className="w-full bg-white hover:bg-slate-50 active:scale-[0.98] transition p-4 rounded-2xl border border-slate-200 text-left flex items-center justify-between group shadow-xs cursor-pointer"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-black text-base text-slate-900 group-hover:text-emerald-600 transition">
                          {s.name}
                        </span>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold border ${
                          s.type === 'Male' ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-pink-50 text-pink-700 border-pink-200'
                        }`}>
                          {s.type === 'Male' ? '♂ Male' : '♀ Female'}
                        </span>
                      </div>
                      <span className="text-xs text-slate-500 mt-1 block">
                        {s.parts.length} {s.parts.length === 1 ? 'Part' : 'Parts'} • {sStats.count} birds weighed
                      </span>
                    </div>

                    <div className="text-right flex items-center gap-2.5">
                      <div>
                        <div className="text-base font-black text-emerald-600 font-mono">{sStats.avg}g</div>
                        <div className="text-[11px] text-amber-600 font-bold">{sStats.unif}% Unif</div>
                      </div>
                      <ChevronRight className="w-5 h-5 text-slate-400 group-hover:text-emerald-600 group-hover:translate-x-1 transition" />
                    </div>
                  </button>
                );
              })}

              <button
                onClick={() => setShowAddShedModal(true)}
                className="w-full py-3 bg-white hover:bg-slate-50 text-emerald-700 rounded-2xl text-xs font-bold flex items-center justify-center gap-1.5 border border-dashed border-emerald-300 transition cursor-pointer shadow-xs"
              >
                <Plus className="w-4 h-4" /> Add New Shed
              </button>
            </div>
          </div>
        )}

        {/* ========================================================= */}
        {/* 3. PART SELECTION SCREEN (CLEAN LIGHT CARDS)              */}
        {/* ========================================================= */}
        {currentScreen === 'part_select' && activeShed && (
          <div className="flex-1 flex flex-col p-4 animate-in slide-in-from-right duration-150">
            <div className="flex items-center justify-between mb-3.5">
              <button 
                onClick={handleGoBack} 
                className="flex items-center gap-1.5 text-xs font-bold text-slate-700 bg-white hover:bg-slate-100 px-3 py-1.5 rounded-xl border border-slate-200 shadow-xs active:scale-95 cursor-pointer"
              >
                <ArrowLeft className="w-4 h-4" /> Sheds
              </button>

              <span className={`text-xs font-bold px-3 py-1 rounded-full border ${
                activeShed.type === 'Male' 
                  ? 'bg-blue-50 text-blue-700 border-blue-200' 
                  : 'bg-pink-50 text-pink-700 border-pink-200'
              }`}>
                {activeShed.name} ({activeShed.type === 'Male' ? '♂' : '♀'})
              </span>
            </div>

            <div className="flex items-center justify-between px-1 mb-2.5">
              <div>
                <h2 className="text-base font-black text-slate-900">Parts in {activeShed.name}</h2>
                <p className="text-xs text-slate-500">Select a part to view its pen lines</p>
              </div>
              <button
                onClick={handleAddPart}
                className="text-xs bg-amber-500 hover:bg-amber-400 text-slate-950 px-3 py-1.5 rounded-xl font-bold flex items-center gap-1 active:scale-95 cursor-pointer shadow-xs"
              >
                <Plus className="w-3.5 h-3.5" /> Add Part
              </button>
            </div>

            {/* Shed Mini Stats Summary */}
            <div className="grid grid-cols-3 gap-1.5 bg-white p-3 rounded-2xl border border-slate-200 text-center text-xs mb-3 font-mono shadow-xs">
              <div>
                <span className="text-[10px] text-slate-400 block font-sans font-bold uppercase">Shed Birds</span>
                <span className="font-black text-slate-900 text-sm">{shedStats.count}</span>
              </div>
              <div>
                <span className="text-[10px] text-slate-400 block font-sans font-bold uppercase">Shed Avg</span>
                <span className="font-black text-emerald-600 text-sm">{shedStats.avg}g</span>
              </div>
              <div>
                <span className="text-[10px] text-slate-400 block font-sans font-bold uppercase">Uniformity</span>
                <span className="font-black text-amber-600 text-sm">{shedStats.unif}%</span>
              </div>
            </div>

            {/* Vertical Scrollable Part Cards */}
            <div className="space-y-3 overflow-y-auto flex-1 pb-4">
              {activeShed.parts.map(part => {
                const partStat = calculateFlockStats(part.lines.flatMap(l => l.weights), activeStd, weekNum);
                const partBirds = part.lines.reduce((acc, l) => acc + l.weights.length, 0);

                return (
                  <div
                    key={part.id}
                    className="w-full bg-white p-4 rounded-2xl border border-slate-200 flex flex-col gap-3 shadow-xs"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <span className="w-8 h-8 rounded-xl bg-amber-50 border border-amber-200 text-amber-700 font-black flex items-center justify-center text-xs">
                          {part.name.replace(/Part\s*/i, '') || 'P'}
                        </span>
                        <div>
                          <h3 className="font-black text-base text-slate-900">{part.name}</h3>
                          <span className="text-xs text-slate-500">
                            {part.lines.length} {part.lines.length === 1 ? 'Line' : 'Lines'} • {partBirds} birds
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => handleStartEditPart(part)}
                          className="p-1.5 text-slate-400 hover:text-amber-600 hover:bg-slate-100 rounded-lg text-xs cursor-pointer"
                          title={`Rename ${part.name}`}
                        >
                          <Edit3 className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => handleDeletePart(part.id, e)}
                          className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg text-xs cursor-pointer"
                          title={`Delete ${part.name}`}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-1 bg-slate-50 p-2.5 rounded-xl border border-slate-100 text-center text-xs font-mono">
                      <div>
                        <span className="text-[10px] text-slate-400 block font-sans font-semibold">AVG WT</span>
                        <span className="font-bold text-emerald-600">{partStat.avg}g</span>
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-400 block font-sans font-semibold">UNIF (S%)</span>
                        <span className="font-bold text-amber-600">{partStat.unif}%</span>
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-400 block font-sans font-semibold">CV %</span>
                        <span className="font-bold text-sky-600">{partStat.cv}%</span>
                      </div>
                    </div>

                    <button
                      onClick={() => {
                        navigateToLineSelect(activeShed.id, part.id, part.lines[0]?.id || 1);
                      }}
                      className="w-full bg-amber-500 hover:bg-amber-400 active:scale-95 text-slate-950 py-2.5 rounded-xl text-xs font-black flex items-center justify-center gap-1.5 transition cursor-pointer shadow-xs"
                    >
                      <span>Open Pen Lines ({part.lines.length})</span>
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ========================================================= */}
        {/* 4. LINE SELECTION SCREEN (LOOKS JUST LIKE PART SCREEN)    */}
        {/* ========================================================= */}
        {currentScreen === 'line_select' && activeShed && activePart && (
          <div className="flex-1 flex flex-col p-4 animate-in slide-in-from-right duration-150">
            {/* Header with Back button up to Parts Screen */}
            <div className="flex items-center justify-between mb-3.5">
              <button 
                onClick={handleGoBack} 
                className="flex items-center gap-1.5 text-xs font-bold text-slate-700 bg-white hover:bg-slate-100 px-3 py-1.5 rounded-xl border border-slate-200 shadow-xs active:scale-95 cursor-pointer"
              >
                <ArrowLeft className="w-4 h-4" /> Parts
              </button>

              <span className="text-xs font-bold text-sky-800 bg-sky-50 px-3 py-1 rounded-full border border-sky-200 truncate max-w-[210px]">
                {activeShed.name} › {activePart.name}
              </span>
            </div>

            <div className="flex items-center justify-between px-1 mb-2.5">
              <div>
                <h2 className="text-base font-black text-slate-900">Lines in {activePart.name}</h2>
                <p className="text-xs text-slate-500">Choose a line to record bird weights</p>
              </div>
              <button
                onClick={handleAddLine}
                className="text-xs bg-sky-600 hover:bg-sky-500 text-white px-3 py-1.5 rounded-xl font-bold flex items-center gap-1 active:scale-95 cursor-pointer shadow-xs"
              >
                <Plus className="w-3.5 h-3.5" /> Add Line
              </button>
            </div>

            {/* Part Mini Stats Summary */}
            <div className="grid grid-cols-3 gap-1.5 bg-white p-3 rounded-2xl border border-slate-200 text-center text-xs mb-3 font-mono shadow-xs">
              <div>
                <span className="text-[10px] text-slate-400 block font-sans font-bold uppercase">Part Birds</span>
                <span className="font-black text-slate-900 text-sm">{partStats.count}</span>
              </div>
              <div>
                <span className="text-[10px] text-slate-400 block font-sans font-bold uppercase">Part Avg</span>
                <span className="font-black text-emerald-600 text-sm">{partStats.avg}g</span>
              </div>
              <div>
                <span className="text-[10px] text-slate-400 block font-sans font-bold uppercase">Uniformity</span>
                <span className="font-black text-amber-600 text-sm">{partStats.unif}%</span>
              </div>
            </div>

            {/* Vertical Scrollable Line Cards (Exact Look & Feel as Part Cards) */}
            <div className="space-y-3 overflow-y-auto flex-1 pb-4">
              {activePart.lines.map(line => {
                const lStats = calculateFlockStats(line.weights, activeStd, weekNum);

                return (
                  <div
                    key={line.id}
                    className="w-full bg-white p-4 rounded-2xl border border-slate-200 flex flex-col gap-3 shadow-xs"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <span className="w-8 h-8 rounded-xl bg-sky-50 border border-sky-200 text-sky-700 font-black flex items-center justify-center text-xs">
                          L{line.id}
                        </span>
                        <div>
                          <h3 className="font-black text-base text-slate-900">{line.name}</h3>
                          <span className="text-xs text-slate-500">
                            {line.weights.length} {line.weights.length === 1 ? 'Bird Weighed' : 'Birds Weighed'}
                          </span>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={(e) => handleDeleteLine(line.id, e)}
                        className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg text-xs cursor-pointer"
                        title={`Delete ${line.name}`}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>

                    <div className="grid grid-cols-4 gap-1 text-center bg-slate-50 p-2.5 rounded-xl border border-slate-100 text-xs font-mono">
                      <div>
                        <span className="text-[10px] text-slate-400 font-sans font-semibold">BIRDS</span>
                        <div className="font-bold text-slate-900">{lStats.count}</div>
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-400 font-sans font-semibold">AVG WT</span>
                        <div className="font-bold text-emerald-600">{lStats.avg}g</div>
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-400 font-sans font-semibold">UNIF%</span>
                        <div className="font-bold text-amber-600">{lStats.unif}%</div>
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-400 font-sans font-semibold">CV%</span>
                        <div className="font-bold text-sky-600">{lStats.cv}%</div>
                      </div>
                    </div>

                    <button
                      onClick={() => {
                        navigateToWeighPad(activeShed.id, activePart.id, line.id);
                      }}
                      className="w-full bg-sky-600 hover:bg-sky-500 active:scale-95 text-white py-2.5 rounded-xl text-xs font-black flex items-center justify-center gap-1.5 transition cursor-pointer shadow-xs"
                    >
                      <span>Enter Weights for {line.name}</span>
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ========================================================= */}
        {/* 5. WEIGHING PAD SCREEN (CLEAN, NO HORIZONTAL TAB OVERFLOW)*/}
        {/* ========================================================= */}
        {currentScreen === 'weigh_pad' && activeShed && activePart && activeLine && (
          <div className="flex-1 flex flex-col p-4 animate-in slide-in-from-right duration-150">
            {/* Header with Back Button (Weigh Pad -> Line Screen) & Breadcrumb */}
            <div className="flex items-center justify-between mb-2.5">
              <button 
                onClick={handleGoBack} 
                className="flex items-center gap-1.5 text-xs font-bold text-slate-700 bg-white hover:bg-slate-100 px-3 py-1.5 rounded-xl border border-slate-200 shadow-xs active:scale-95 cursor-pointer shrink-0"
              >
                <ArrowLeft className="w-4 h-4" /> Lines
              </button>

              {/* Breadcrumb Trail matching screenshot */}
              <div className="flex items-center gap-1 text-[11px] font-bold bg-white px-2.5 py-1 rounded-xl border border-slate-200 shadow-xs truncate max-w-[210px]">
                <span className="text-emerald-700 font-extrabold">{activeShed.name}</span>
                <span className="text-slate-300">›</span>
                <span className="text-indigo-700 font-extrabold">{activePart.name}</span>
                <span className="text-slate-300">›</span>
                <span className="text-sky-700 font-extrabold">{activeLine.name}</span>
              </div>

              <span className={`text-[10px] px-2 py-1 rounded-full font-bold border shrink-0 ${
                activeShed.type === 'Male' 
                  ? 'bg-blue-50 text-blue-700 border-blue-200' 
                  : 'bg-pink-50 text-pink-700 border-pink-200'
              }`}>
                {activeShed.type === 'Male' ? '♂ M' : '♀ F'}
              </span>
            </div>

            {/* Real-Time Metric Strip for Current Line & Part (matching user's screenshot!) */}
            <div className="bg-white p-3 rounded-2xl border border-slate-200 grid grid-cols-4 gap-1 text-center mb-3 shadow-xs">
              <div>
                <span className="text-[10px] text-slate-500 font-bold uppercase">Weighed</span>
                <div className="text-base font-black text-slate-900">{lineStats.count}</div>
                <span className="text-[9px] text-slate-400 block font-semibold">Part: {partStats.count}</span>
              </div>
              <div>
                <span className="text-[10px] text-slate-500 font-bold uppercase">Avg Wt</span>
                <div className="text-base font-black text-emerald-600">{lineStats.avg}g</div>
                <span className="text-[9px] text-slate-400 block font-semibold">Part: {partStats.avg}g</span>
              </div>
              <div>
                <span className="text-[10px] text-slate-500 font-bold uppercase">Unif (S%)</span>
                <div className="text-base font-black text-amber-600">{lineStats.unif}%</div>
                <span className="text-[9px] text-slate-400 block font-semibold">Part: {partStats.unif}%</span>
              </div>
              <div>
                <span className="text-[10px] text-slate-500 font-bold uppercase">CV %</span>
                <div className="text-base font-black text-sky-600">{lineStats.cv}%</div>
                <span className="text-[9px] text-slate-400 block font-semibold">Part: {partStats.cv}%</span>
              </div>
            </div>

            {/* Manual Entry Form - Compact & Fast */}
            <form onSubmit={e => { e.preventDefault(); handleAddWeight(); }} className="flex gap-2 mb-2.5">
              <input
                type="number"
                placeholder={`Weight for ${activeLine.name}...`}
                value={inputWeight}
                onChange={e => setInputWeight(e.target.value)}
                autoFocus
                className="flex-1 min-w-0 bg-white border border-slate-300 rounded-xl px-3 py-2 text-base font-black text-slate-900 focus:outline-none focus:border-emerald-600 font-mono shadow-xs placeholder:text-slate-400"
              />
              <button
                type="submit"
                className="bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white font-black px-5 rounded-xl text-xs shrink-0 shadow-xs cursor-pointer"
              >
                Save
              </button>
            </form>

            {/* Quick-Tap Increment Chips */}
            <div className="grid grid-cols-4 gap-1.5 mb-2.5">
              {[1250, 1300, 1350, 1400, 1450, 1500, 1550, 1600].map(w => (
                <button
                  key={w}
                  type="button"
                  onClick={() => handleAddWeight(w)}
                  className="bg-white hover:bg-slate-100 active:bg-slate-200 py-1.5 rounded-xl text-xs font-mono font-bold text-slate-800 border border-slate-200 shadow-xs cursor-pointer"
                >
                  +{w}
                </button>
              ))}
            </div>

            {/* Weighed Birds List with Live Grading Badges */}
            <div className="flex-1 bg-white rounded-2xl border border-slate-200 p-3 overflow-y-auto max-h-[280px] shadow-xs">
              <div className="flex justify-between items-center text-xs text-slate-500 pb-2 mb-2 border-b border-slate-100">
                <span className="font-bold">{activeLine.name} Birds ({activeLine.weights.length})</span>
                <span className="text-[11px] font-mono font-semibold text-slate-600">
                  Target: {activeStd}g (±{activeBands.tolerance}g)
                </span>
              </div>

              {activeLine.weights.length === 0 ? (
                <div className="text-center py-8 text-xs text-slate-400">
                  No birds recorded in {activeLine.name} yet. Tap chips or enter weights above.
                </div>
              ) : (
                <div className="space-y-1.5">
                  {activeLine.weights.map((w, idx) => {
                    const grade = getBirdGrade(w, activeBands);
                    const badgeClass = getBadgeStyle(grade);

                    return (
                      <div 
                        key={idx} 
                        className="flex items-center justify-between bg-slate-50 px-3 py-1.5 rounded-xl border border-slate-100 text-xs"
                      >
                        <span className="text-slate-400 font-mono text-[11px] w-6">#{idx + 1}</span>
                        <span className="font-bold text-sm text-slate-900 font-mono">{w}g</span>
                        <span className={`px-2 py-0.5 rounded-md text-[10px] border ${badgeClass}`}>
                          {grade}
                        </span>
                        <button 
                          onClick={() => handleDeleteWeight(idx)} 
                          className="text-slate-400 hover:text-rose-600 p-1 rounded-lg cursor-pointer transition"
                          title="Delete bird"
                        >
                          <Trash2 className="w-3.5 h-3.5"/>
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}

              {activeLine.weights.length > 0 && (
                <div className="pt-3 mt-3 border-t border-slate-100 text-center">
                  <button
                    onClick={handleClearLineWeights}
                    className="text-[11px] font-bold text-rose-600 hover:text-rose-700 active:scale-95 transition"
                  >
                    Clear All {activeLine.weights.length} Weights in {activeLine.name}
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ========================================================= */}
        {/* 6. CONSOLIDATED CONCLUSION REPORT                         */}
        {/* ========================================================= */}
        {currentScreen === 'conclusion' && (
          <div className="flex-1 flex flex-col p-4 animate-in slide-in-from-right duration-150">
            <div className="flex items-center justify-between mb-4">
              <button 
                onClick={handleGoBack} 
                className="flex items-center gap-1.5 text-xs font-bold text-slate-700 bg-white hover:bg-slate-100 px-3 py-1.5 rounded-xl border border-slate-200 shadow-xs active:scale-95 cursor-pointer"
              >
                <ArrowLeft className="w-4 h-4"/> Home
              </button>
              <div className="text-right">
                <h2 className="text-xs font-black text-amber-700 uppercase tracking-wide bg-amber-50 px-2.5 py-1 rounded-full border border-amber-200 inline-block">
                  Cons Conclusion
                </h2>
              </div>
            </div>

            <div className="space-y-3 mb-4 flex-1 overflow-y-auto">
              {/* Female Overall Card */}
              <div className="bg-white border border-slate-200 p-3.5 rounded-2xl shadow-xs">
                <div className="flex justify-between items-center mb-2 pb-1.5 border-b border-slate-100">
                  <span className="font-extrabold text-xs text-pink-700 flex items-center gap-1">
                    ♀ Female Overall ({ageWeek}F)
                  </span>
                  <span className="text-[10px] text-slate-400 font-mono">Target: {stdWeightFemale}g</span>
                </div>
                <div className="grid grid-cols-3 gap-1.5 text-center text-xs mb-2 font-mono">
                  <div className="bg-slate-50 p-2 rounded-xl">
                    <span className="text-[9px] text-slate-400 block font-sans">ACT WT</span>
                    <div className="font-bold text-emerald-600 text-sm">{consolidated.fStats.avg}g</div>
                  </div>
                  <div className="bg-slate-50 p-2 rounded-xl">
                    <span className="text-[9px] text-slate-400 block font-sans">DIFF</span>
                    <div className="font-bold text-slate-700 text-sm">{consolidated.fStats.diff}g</div>
                  </div>
                  <div className="bg-slate-50 p-2 rounded-xl">
                    <span className="text-[9px] text-slate-400 block font-sans">UNIF%</span>
                    <div className="font-bold text-amber-600 text-sm">{consolidated.fStats.unif}%</div>
                  </div>
                </div>
                <div className="flex justify-between text-[11px] text-slate-500 bg-slate-50 px-2.5 py-1.5 rounded-xl">
                  <span>CV%: <strong className="text-sky-600 font-mono">{consolidated.fStats.cv}%</strong></span>
                  <span>Range: <strong className="text-slate-800 font-mono">{consolidated.fStats.min}g - {consolidated.fStats.max}g</strong></span>
                </div>
              </div>

              {/* Male Overall Card */}
              <div className="bg-white border border-slate-200 p-3.5 rounded-2xl shadow-xs">
                <div className="flex justify-between items-center mb-2 pb-1.5 border-b border-slate-100">
                  <span className="font-extrabold text-xs text-blue-700 flex items-center gap-1">
                    ♂ Male Overall ({ageWeek}M)
                  </span>
                  <span className="text-[10px] text-slate-400 font-mono">Target: {stdWeightMale}g</span>
                </div>
                <div className="grid grid-cols-3 gap-1.5 text-center text-xs mb-2 font-mono">
                  <div className="bg-slate-50 p-2 rounded-xl">
                    <span className="text-[9px] text-slate-400 block font-sans">ACT WT</span>
                    <div className="font-bold text-emerald-600 text-sm">{consolidated.mStats.avg}g</div>
                  </div>
                  <div className="bg-slate-50 p-2 rounded-xl">
                    <span className="text-[9px] text-slate-400 block font-sans">DIFF</span>
                    <div className="font-bold text-slate-700 text-sm">{consolidated.mStats.diff}g</div>
                  </div>
                  <div className="bg-slate-50 p-2 rounded-xl">
                    <span className="text-[9px] text-slate-400 block font-sans">UNIF%</span>
                    <div className="font-bold text-amber-600 text-sm">{consolidated.mStats.unif}%</div>
                  </div>
                </div>
                <div className="flex justify-between text-[11px] text-slate-500 bg-slate-50 px-2.5 py-1.5 rounded-xl">
                  <span>CV%: <strong className="text-sky-600 font-mono">{consolidated.mStats.cv}%</strong></span>
                  <span>Range: <strong className="text-slate-800 font-mono">{consolidated.mStats.min}g - {consolidated.mStats.max}g</strong></span>
                </div>
              </div>
            </div>

            <button 
              onClick={handleDownloadExcel} 
              className="w-full bg-emerald-600 hover:bg-emerald-700 py-3.5 rounded-xl font-black text-xs text-white flex items-center justify-center gap-2 active:scale-95 shadow-md shadow-emerald-600/20 cursor-pointer"
            >
              <Download className="w-4 h-4"/> Download Complete 13-Sheet Workbook
            </button>
          </div>
        )}

        {/* ========================================================= */}
        {/* 7. MANAGE & COMPARE SHEDS                                 */}
        {/* ========================================================= */}
        {currentScreen === 'sheds_manage' && (
          <div className="flex-1 flex flex-col p-4 animate-in slide-in-from-right duration-150">
            <div className="flex items-center justify-between mb-4">
              <button 
                onClick={handleGoBack} 
                className="flex items-center gap-1.5 text-xs font-bold text-slate-700 bg-white hover:bg-slate-100 px-3 py-1.5 rounded-xl border border-slate-200 shadow-xs active:scale-95 cursor-pointer"
              >
                <ArrowLeft className="w-4 h-4"/> Home
              </button>
              <button
                onClick={() => setShowAddShedModal(true)}
                className="bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1 active:scale-95 cursor-pointer shadow-xs"
              >
                <Plus className="w-3.5 h-3.5"/> Add Shed
              </button>
            </div>

            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 px-1 mb-2">
              All Sheds ({sheds.length})
            </p>

            <div className="space-y-3 overflow-y-auto flex-1 pb-4">
              {consolidated.shedSummaries.map(s => (
                <div key={s.id} className="bg-white p-3.5 rounded-2xl border border-slate-200 flex flex-col gap-2.5 shadow-xs">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="font-black text-sm text-slate-900">{s.name}</span>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold border ${
                        s.type === 'Male' ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-pink-50 text-pink-700 border-pink-200'
                      }`}>
                        {s.type}
                      </span>
                    </div>

                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleStartEditShed(s)}
                        className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg text-xs cursor-pointer"
                      >
                        <Edit2 className="w-3.5 h-3.5"/>
                      </button>
                      <button
                        onClick={() => {
                          if (sheds.length <= 1) {
                            showToast('Keep at least one shed.');
                            return;
                          }
                          if (window.confirm(`Delete ${s.name}?`)) {
                            setSheds(prev => prev.filter(sh => sh.id !== s.id));
                            showToast(`${s.name} deleted.`);
                          }
                        }}
                        className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg text-xs cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5"/>
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-4 gap-1 text-center bg-slate-50 p-2 rounded-xl text-xs font-mono">
                    <div>
                      <span className="text-[9px] text-slate-400 font-sans">BIRDS</span>
                      <div className="font-bold text-slate-900">{s.stats.count}</div>
                    </div>
                    <div>
                      <span className="text-[9px] text-slate-400 font-sans">AVG WT</span>
                      <div className="font-bold text-emerald-600">{s.stats.avg}g</div>
                    </div>
                    <div>
                      <span className="text-[9px] text-slate-400 font-sans">UNIF%</span>
                      <div className="font-bold text-amber-600">{s.stats.unif}%</div>
                    </div>
                    <div>
                      <span className="text-[9px] text-slate-400 font-sans">CV%</span>
                      <div className="font-bold text-sky-600">{s.stats.cv}%</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ========================================================= */}
        {/* 8. FARM & FLOCK SETUP SCREEN                              */}
        {/* ========================================================= */}
        {currentScreen === 'setup' && (
          <div className="flex-1 flex flex-col p-4 animate-in slide-in-from-right duration-150">
            <div className="flex items-center justify-between mb-4">
              <button 
                onClick={handleGoBack} 
                className="flex items-center gap-1.5 text-xs font-bold text-slate-700 bg-white hover:bg-slate-100 px-3 py-1.5 rounded-xl border border-slate-200 shadow-xs active:scale-95 cursor-pointer"
              >
                <ArrowLeft className="w-4 h-4"/> Home
              </button>
              <h2 className="text-xs font-black text-purple-700 uppercase tracking-wide bg-purple-50 px-2.5 py-1 rounded-full border border-purple-200">
                Farm Setup
              </h2>
            </div>

            <div className="bg-white p-4 rounded-2xl border border-slate-200 space-y-4 mb-4 shadow-xs">
              <div>
                <label className="text-[11px] font-bold text-slate-600 uppercase">Farm Name</label>
                <input
                  type="text"
                  value={farmName}
                  onChange={e => setFarmName(e.target.value)}
                  className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-sm font-bold text-slate-900 mt-1 focus:outline-none focus:border-emerald-600"
                />
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="text-[11px] font-bold text-slate-600 uppercase">Record Date</label>
                  <input
                    type="date"
                    value={date}
                    onChange={e => setDate(e.target.value)}
                    className="w-full bg-white border border-slate-300 rounded-xl px-2.5 py-2 text-xs font-bold text-slate-900 mt-1 focus:outline-none focus:border-emerald-600"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-bold text-slate-600 uppercase">Age Week</label>
                  <select
                    value={ageWeek}
                    onChange={e => setAgeWeek(e.target.value)}
                    className="w-full bg-white border border-slate-300 rounded-xl px-2.5 py-2 text-xs font-bold text-slate-900 mt-1 focus:outline-none focus:border-emerald-600"
                  >
                    {Object.keys(BENCHMARKS.Summer).map(w => (
                      <option key={w} value={w}>{w}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="text-[11px] font-bold text-slate-600 uppercase">Season</label>
                <select
                  value={season}
                  onChange={e => setSeason(e.target.value as any)}
                  className="w-full bg-white border border-slate-300 rounded-xl px-2.5 py-2 text-xs font-bold text-slate-900 mt-1 focus:outline-none focus:border-emerald-600"
                >
                  <option value="Summer">Summer Brooding</option>
                  <option value="Winter">Winter Brooding</option>
                </select>
              </div>
            </div>

            <button
              onClick={() => {
                showToast('Farm details saved!');
                navigateTo('home');
              }}
              className="w-full bg-purple-600 hover:bg-purple-700 py-3.5 rounded-xl font-black text-xs text-white shadow-md shadow-purple-600/20 active:scale-95 cursor-pointer"
            >
              Save Details
            </button>
          </div>
        )}

        {/* ========================================================= */}
        {/* MODAL: ADD SHED                                           */}
        {/* ========================================================= */}
        {showAddShedModal && (
          <div className="fixed inset-0 bg-black/40 backdrop-blur-xs z-50 flex items-center justify-center p-4 animate-in fade-in">
            <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-sm p-5 space-y-4 shadow-2xl">
              <div className="flex justify-between items-center">
                <h3 className="font-black text-base text-slate-900">Create New Shed</h3>
                <button onClick={() => setShowAddShedModal(false)} className="text-slate-400 hover:text-slate-700">
                  <X className="w-5 h-5"/>
                </button>
              </div>
              <div>
                <label className="text-xs text-slate-600 uppercase font-semibold">Shed Name</label>
                <input
                  type="text"
                  placeholder="e.g. Shed 11"
                  value={newShedName}
                  onChange={e => setNewShedName(e.target.value)}
                  className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-sm font-bold text-slate-900 mt-1 focus:outline-none focus:border-emerald-600"
                />
              </div>
              <div>
                <label className="text-xs text-slate-600 uppercase font-semibold">Flock Gender</label>
                <div className="grid grid-cols-2 gap-2 mt-1.5">
                  <button
                    type="button"
                    onClick={() => setNewShedType('Female')}
                    className={`py-2 rounded-xl text-xs font-bold border transition ${
                      newShedType === 'Female' ? 'bg-pink-50 text-pink-700 border-pink-300 shadow-xs' : 'bg-white text-slate-500 border-slate-200'
                    }`}
                  >
                    ♀ Female
                  </button>
                  <button
                    type="button"
                    onClick={() => setNewShedType('Male')}
                    className={`py-2 rounded-xl text-xs font-bold border transition ${
                      newShedType === 'Male' ? 'bg-blue-50 text-blue-700 border-blue-300 shadow-xs' : 'bg-white text-slate-500 border-slate-200'
                    }`}
                  >
                    ♂ Male
                  </button>
                </div>
              </div>
              <div className="flex gap-2 pt-1">
                <button 
                  onClick={() => setShowAddShedModal(false)} 
                  className="flex-1 bg-slate-100 hover:bg-slate-200 py-2.5 rounded-xl text-xs font-bold text-slate-700"
                >
                  Cancel
                </button>
                <button 
                  onClick={handleAddShed} 
                  className="flex-1 bg-emerald-600 hover:bg-emerald-700 py-2.5 rounded-xl text-xs font-black text-white shadow-xs"
                >
                  Create Shed
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ========================================================= */}
        {/* MODAL: EDIT SHED                                          */}
        {/* ========================================================= */}
        {editingShed && (
          <div className="fixed inset-0 bg-black/40 backdrop-blur-xs z-50 flex items-center justify-center p-4 animate-in fade-in">
            <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-sm p-5 space-y-4 shadow-2xl">
              <div className="flex justify-between items-center">
                <h3 className="font-black text-base text-slate-900">Edit Shed</h3>
                <button onClick={() => setEditingShed(null)} className="text-slate-400 hover:text-slate-700">
                  <X className="w-5 h-5"/>
                </button>
              </div>
              <div>
                <label className="text-xs text-slate-600 uppercase font-semibold">Shed Name</label>
                <input
                  type="text"
                  value={editingShed.name}
                  onChange={e => setEditingShed({ ...editingShed, name: e.target.value })}
                  className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-sm font-bold text-slate-900 mt-1 focus:outline-none focus:border-emerald-600"
                />
              </div>
              <div>
                <label className="text-xs text-slate-600 uppercase font-semibold">Flock Gender</label>
                <div className="grid grid-cols-2 gap-2 mt-1.5">
                  <button
                    type="button"
                    onClick={() => setEditingShed({ ...editingShed, type: 'Female' })}
                    className={`py-2 rounded-xl text-xs font-bold border transition ${
                      editingShed.type === 'Female' ? 'bg-pink-50 text-pink-700 border-pink-300' : 'bg-white text-slate-500 border-slate-200'
                    }`}
                  >
                    ♀ Female
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingShed({ ...editingShed, type: 'Male' })}
                    className={`py-2 rounded-xl text-xs font-bold border transition ${
                      editingShed.type === 'Male' ? 'bg-blue-50 text-blue-700 border-blue-300' : 'bg-white text-slate-500 border-slate-200'
                    }`}
                  >
                    ♂ Male
                  </button>
                </div>
              </div>
              <div className="flex gap-2 pt-1">
                <button 
                  onClick={() => setEditingShed(null)} 
                  className="flex-1 bg-slate-100 hover:bg-slate-200 py-2.5 rounded-xl text-xs font-bold text-slate-700"
                >
                  Cancel
                </button>
                <button 
                  onClick={handleSaveEditShed} 
                  className="flex-1 bg-emerald-600 hover:bg-emerald-700 py-2.5 rounded-xl text-xs font-black text-white shadow-xs"
                >
                  Save Changes
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ========================================================= */}
        {/* MODAL: RENAME PART                                        */}
        {/* ========================================================= */}
        {editingPart && (
          <div className="fixed inset-0 bg-black/40 backdrop-blur-xs z-50 flex items-center justify-center p-4 animate-in fade-in">
            <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-sm p-4 space-y-4 shadow-xl">
              <div className="flex justify-between items-center">
                <h3 className="font-black text-base text-slate-900">Rename Part</h3>
                <button onClick={() => setEditingPart(null)} className="text-slate-400 hover:text-slate-700">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div>
                <label className="text-xs text-slate-600 uppercase font-semibold">Part Name</label>
                <input
                  type="text"
                  value={editingPart.name}
                  onChange={e => setEditingPart({ ...editingPart, name: e.target.value })}
                  placeholder="e.g. Part A, North Wing"
                  className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-sm font-bold text-slate-900 mt-1 focus:outline-none focus:border-indigo-600 shadow-xs"
                />
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setEditingPart(null)}
                  className="flex-1 bg-slate-100 hover:bg-slate-200 py-2.5 rounded-xl text-xs font-bold text-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSaveEditPart}
                  className="flex-1 bg-indigo-600 hover:bg-indigo-700 py-2.5 rounded-xl text-xs font-black text-white shadow-xs"
                >
                  Save Changes
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ========================================================= */}
        {/* MODAL: CONFIRM DELETE PART                                */}
        {/* ========================================================= */}
        {partPendingDelete && (
          <div className="fixed inset-0 bg-black/40 backdrop-blur-xs z-50 flex items-center justify-center p-4 animate-in fade-in">
            <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-sm p-5 space-y-4 shadow-2xl">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-rose-50 text-rose-600 rounded-xl border border-rose-200">
                  <Trash2 className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="font-black text-base text-slate-900">Delete {partPendingDelete.name}?</h3>
                  <p className="text-xs text-slate-500">Contains {partPendingDelete.totalWeights} weighed birds across its lines</p>
                </div>
              </div>
              <p className="text-xs text-rose-800 bg-rose-50 p-3 rounded-xl border border-rose-200 leading-relaxed">
                Delete this Part and all its lines/weights? All {partPendingDelete.totalWeights} recorded bird weights will be permanently deleted.
              </p>
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setPartPendingDelete(null)}
                  className="flex-1 bg-slate-100 hover:bg-slate-200 py-2.5 rounded-xl text-xs font-bold text-slate-700 active:scale-95 transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => executeDeletePart(partPendingDelete.id)}
                  className="flex-1 bg-rose-600 hover:bg-rose-700 py-2.5 rounded-xl text-xs font-black text-white shadow-md shadow-rose-600/20 active:scale-95 transition cursor-pointer"
                >
                  Yes, Delete Part
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ========================================================= */}
        {/* MODAL: CONFIRM DELETE PEN LINE                           */}
        {/* ========================================================= */}
        {linePendingDelete && (
          <div className="fixed inset-0 bg-black/40 backdrop-blur-xs z-50 flex items-center justify-center p-4 animate-in fade-in">
            <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-sm p-5 space-y-4 shadow-2xl">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-rose-50 text-rose-600 rounded-xl border border-rose-200">
                  <Trash2 className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="font-black text-base text-slate-900">Delete {linePendingDelete.name}?</h3>
                  <p className="text-xs text-slate-500">{linePendingDelete.weights.length} weighed birds recorded in this line</p>
                </div>
              </div>
              <p className="text-xs text-rose-800 bg-rose-50 p-3 rounded-xl border border-rose-200 leading-relaxed">
                This pen line contains {linePendingDelete.weights.length} recorded bird weights. Deleting it will remove all these weights from flock calculations.
              </p>
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setLinePendingDelete(null)}
                  className="flex-1 bg-slate-100 hover:bg-slate-200 py-2.5 rounded-xl text-xs font-bold text-slate-700 active:scale-95 transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => executeDeleteLine(linePendingDelete.id)}
                  className="flex-1 bg-rose-600 hover:bg-rose-700 py-2.5 rounded-xl text-xs font-black text-white shadow-md shadow-rose-600/20 active:scale-95 transition cursor-pointer"
                >
                  Yes, Delete Line
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ========================================================= */}
        {/* MODAL: EXIT CONFIRMATION TRAP                             */}
        {/* ========================================================= */}
        {showExitConfirm && (
          <div 
            className="fixed inset-0 bg-black/50 backdrop-blur-xs z-50 flex items-center justify-center p-4 animate-in fade-in duration-150"
            role="dialog"
            aria-modal="true"
          >
            <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-sm p-5 space-y-4 shadow-2xl animate-in zoom-in-95 duration-150">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-amber-50 text-amber-600 rounded-xl border border-amber-200">
                  <LogOut className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="font-black text-base text-slate-900">
                    Exit Application?
                  </h3>
                  <p className="text-xs text-slate-500">Poultry Weight & Uniformity Tracker</p>
                </div>
              </div>
              <p className="text-xs text-slate-700 bg-slate-50 p-3.5 rounded-xl border border-slate-200 leading-relaxed">
                Do you want to exit the application?
              </p>
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={handleCancelExit}
                  className="flex-1 bg-slate-100 hover:bg-slate-200 py-2.5 rounded-xl text-xs font-bold text-slate-700 active:scale-95 transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleConfirmExit}
                  className="flex-1 bg-rose-600 hover:bg-rose-700 py-2.5 rounded-xl text-xs font-black text-white shadow-md shadow-rose-600/20 active:scale-95 transition cursor-pointer flex items-center justify-center gap-1.5"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  Exit
                </button>
              </div>
            </div>
          </div>
        )}

        {/* On-Screen Mobile Toast Notification */}
        {toastMessage && (
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 w-[90%] max-w-sm bg-white border border-slate-300 text-slate-900 px-4 py-3 rounded-2xl shadow-2xl flex items-center gap-3 backdrop-blur-md z-50 animate-in fade-in slide-in-from-bottom duration-200">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
            <span className="text-xs font-bold leading-tight">{toastMessage}</span>
          </div>
        )}

      </div>
    </div>
    </>
  );
}
