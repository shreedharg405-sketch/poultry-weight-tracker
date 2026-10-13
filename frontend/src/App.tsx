import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
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
  CheckCircle,
  LogOut,
  RefreshCw,
  Cloud,
  CloudOff,
  Loader2,
  Check,
  History,
  User,
  LogIn,
  UserPlus,
  Radio,
  ShieldCheck,
  FileText,
  UploadCloud
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
import { SharedLoginScreen } from './components/SharedLoginScreen';
import { 
  cloudApi, 
  FarmSummary, 
  FullFarmData,
  FarmAudit,
  FarmStatus,
  UserRole,
  getApiBaseUrl, 
  normalizeApiUrl, 
  offlineQueue, 
  AppUser, 
  ActivityLogItem 
} from './services/cloudSyncService';

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

// Format Last Updated string (e.g., "Updated Today at 10:45 AM")
const formatLastUpdated = (dateInput?: string | Date): string => {
  if (!dateInput) return 'Just now';
  const d = new Date(dateInput);
  if (isNaN(d.getTime())) return 'Just now';
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const timeStr = formatTime12H(d);
  if (isToday) {
    return `Today at ${timeStr}`;
  }
  return `${formatDateDMY(d)} at ${timeStr}`;
};

// Format activity log & audit date-time: Date(DD-MM-YYYY) - Time(HH:MM:SS AM/PM)
const formatLogDateTime = (isoOrDate: string | Date | undefined): string => {
  if (!isoOrDate) return 'Not yet submitted';
  const d = new Date(isoOrDate);
  if (isNaN(d.getTime())) return 'Just now';
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  let hours = d.getHours();
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const seconds = String(d.getSeconds()).padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12 || 12;
  return `Date(${day}-${month}-${year}) - Time(${String(hours).padStart(2, '0')}:${minutes}:${seconds} ${ampm})`;
};

export type ScreenType = 
  | 'home' 
  | 'shed_select' 
  | 'part_select' 
  | 'line_select' 
  | 'weigh_pad' 
  | 'conclusion' 
  | 'sheds_manage' 
  | 'setup'
  | 'history'
  | 'auth';

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

  // Multi-Farm Management & Real-Time Cloud Sync State
  const [farmsList, setFarmsList] = useState<FarmSummary[]>([
    {
      id: 'farm-sai-1',
      name: 'SAI FARM - UNIT 1',
      flockDate: new Date().toISOString().split('T')[0],
      ageWeek: 'W18',
      season: 'Summer',
      updatedAt: new Date().toISOString(),
      _count: { sheds: 10 }
    }
  ]);
  const [activeFarmId, setActiveFarmId] = useState<string>('farm-sai-1');
  const [syncStatus, setSyncStatus] = useState<'synced' | 'saving' | 'offline' | 'refreshing'>('synced');
  const [lastUpdatedString, setLastUpdatedString] = useState<string>('Just now');
  const [lastServerUpdatedAt, setLastServerUpdatedAt] = useState<string>('');
  const [isRefreshingCloud, setIsRefreshingCloud] = useState<boolean>(false);

  // New Farm Modal State with dynamic shed count & sex split
  const [showNewFarmModal, setShowNewFarmModal] = useState<boolean>(false);
  const [newFarmName, setNewFarmName] = useState<string>('');
  const [newFarmFlockDate, setNewFarmFlockDate] = useState<string>(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });
  const [newFarmAgeWeek, setNewFarmAgeWeek] = useState<string>('W18');
  const [newFarmSeason, setNewFarmSeason] = useState<'Summer' | 'Winter'>('Summer');
  const [newFarmShedCount, setNewFarmShedCount] = useState<number>(10);
  const [newFarmSexSplit, setNewFarmSexSplit] = useState<'last_male' | 'all_female' | 'all_male'>('last_male');
  const [isCreatingFarm, setIsCreatingFarm] = useState<boolean>(false);

  // Farm Audit, Draft Status & Batch Submission State
  const [farmStatus, setFarmStatus] = useState<FarmStatus>(() => {
    try {
      const saved = localStorage.getItem('poultry_status_farm-sai-1');
      if (saved === 'DRAFT' || saved === 'COMPLETED') return saved;
    } catch {}
    return 'DRAFT';
  });
  const [showIncompleteAlertModal, setShowIncompleteAlertModal] = useState<boolean>(false);
  const [showFarmDetailsModal, setShowFarmDetailsModal] = useState<boolean>(false);
  const [isSubmittingBatch, setIsSubmittingBatch] = useState<boolean>(false);
  const [isPendingSubmission, setIsPendingSubmission] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('poultry_pending_submission_farm-sai-1');
      return saved === 'true';
    } catch {
      return false;
    }
  });
  const [farmAudit, setFarmAudit] = useState<FarmAudit | null>(() => {
    try {
      const saved = localStorage.getItem('poultry_audit_farm-sai-1');
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });

  // Cloud API Settings Modal State
  const [showCloudSettingsModal, setShowCloudSettingsModal] = useState<boolean>(false);
  const [customApiUrlInput, setCustomApiUrlInput] = useState<string>(() => getApiBaseUrl());
  const [cloudTestStatus, setCloudTestStatus] = useState<'idle' | 'testing' | 'success' | 'failed'>('idle');
  const [cloudTestResult, setCloudTestResult] = useState<any>(null);
  const [pendingSyncCount, setPendingSyncCount] = useState<number>(() => offlineQueue.count());

  // User Authentication State (Single Shared Farm Account Model + Role-Based Access)
  const [currentUser, setCurrentUser] = useState<AppUser | null>(() => {
    const saved = localStorage.getItem('poultry_current_user');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed === 'object' && parsed.isAuthenticated) {
          const rawRole = parsed.userRole || parsed.role || 'Supervisor';
          const normalizedRole: UserRole = 
            rawRole === 'Admin' ? 'Admin' :
            (rawRole === 'Manager' || rawRole === 'Farm Manager') ? 'Manager' :
            'Supervisor';
          const name = parsed.userName || parsed.name || 'Suresh Kumar';
          return {
            id: parsed.id || 'u-user-1',
            name,
            userName: name,
            email: parsed.email || `${name.toLowerCase().replace(/\s+/g, '.')}@farm.local`,
            role: normalizedRole,
            userRole: normalizedRole,
            isAuthenticated: true,
          };
        }
      } catch {}
    }
    return null;
  });

  const currentUserRole: UserRole = useMemo(() => {
    if (!currentUser) return 'Supervisor';
    if (currentUser.userRole) return currentUser.userRole;
    if (currentUser.role === 'Admin') return 'Admin';
    if (currentUser.role === 'Manager' || currentUser.role === 'Farm Manager') return 'Manager';
    return 'Supervisor';
  }, [currentUser]);

  const [isSwitchingUser, setIsSwitchingUser] = useState<boolean>(false);

  // Shared Farm Login Handler (Single Account Model + Role-Based Identity)
  const handleSharedLoginSuccess = (user: { name: string; role: UserRole }) => {
    const newUser: AppUser = {
      id: `u-${Date.now()}`,
      name: user.name,
      userName: user.name,
      email: `${user.name.toLowerCase().replace(/\s+/g, '.')}@farm.local`,
      role: user.role,
      userRole: user.role,
      isAuthenticated: true,
    };
    setCurrentUser(newUser);
    // Explicitly persist role-based session: { isAuthenticated: true, userName, userRole }
    localStorage.setItem('poultry_current_user', JSON.stringify({
      isAuthenticated: true,
      userName: user.name,
      userRole: user.role,
      name: user.name,
      role: user.role,
      id: newUser.id,
      email: newUser.email,
    }));
    setIsSwitchingUser(false);
    showToast(`Welcome, ${user.name} (${user.role})!`);
    setCurrentScreen('home');
  };

  const handleOpenNewFarmModal = () => {
    if (currentUserRole === 'Supervisor') {
      showToast('Restricted: Manager or Admin permission required to create new farms.');
      return;
    }
    setShowNewFarmModal(true);
  };

  // Consolidated Batch Activity History Logs (Eliminating per-bird entries)
  const [activityLogs, setActivityLogs] = useState<ActivityLogItem[]>(() => {
    const saved = localStorage.getItem('poultry_activity_logs_v1');
    if (saved) {
      try { return JSON.parse(saved); } catch {}
    }
    return [
      {
        id: 'log-1',
        farmId: 'farm-sai-1',
        farmName: 'SAI FARM - UNIT 1',
        userName: 'Suresh Kumar (Weighing Supervisor)',
        action: 'Batch Weighing Submitted • 240 Birds (♀ Act: 1420g, ♂ Act: 3120g)',
        sampleCount: 240,
        avgWeight: 1420,
        femaleAvgWeight: 1420,
        maleAvgWeight: 3120,
        timestamp: new Date(Date.now() - 1000 * 60 * 30).toISOString(),
        status: 'COMPLETED',
        isLive: false,
      },
      {
        id: 'log-2',
        farmId: 'farm-green-valley',
        farmName: 'GREEN VALLEY FARM',
        userName: 'Anand M. (Flock Manager)',
        action: 'Batch Weighing Submitted • 180 Birds (♀ Act: 1395g, ♂ Act: 2980g)',
        sampleCount: 180,
        avgWeight: 1395,
        femaleAvgWeight: 1395,
        maleAvgWeight: 2980,
        timestamp: new Date(Date.now() - 1000 * 60 * 120).toISOString(),
        status: 'COMPLETED',
        isLive: false,
      }
    ];
  });
  const [historyFilter, setHistoryFilter] = useState<'all' | 'live' | 'currentFarm'>('all');
  const [isRefreshingLogs, setIsRefreshingLogs] = useState(false);

  // Sync Current User & Activity Logs to localStorage
  useEffect(() => {
    if (currentUser) {
      localStorage.setItem('poultry_current_user', JSON.stringify(currentUser));
    } else {
      localStorage.removeItem('poultry_current_user');
    }
  }, [currentUser]);

  useEffect(() => {
    localStorage.setItem('poultry_activity_logs_v1', JSON.stringify(activityLogs));
  }, [activityLogs]);



  const handleLogout = () => {
    if (confirm('Are you sure you want to log out from this session?')) {
      setCurrentUser(null);
      localStorage.removeItem('poultry_current_user');
      setIsSwitchingUser(false);
      showToast('Logged out successfully.');
      navigateTo('auth');
    }
  };

  const fetchLatestLogs = async () => {
    setIsRefreshingLogs(true);
    try {
      const remoteLogs = await cloudApi.getLogs({ limit: 50 });
      if (remoteLogs && remoteLogs.length > 0) {
        setActivityLogs(remoteLogs);
        showToast('Activity logs refreshed');
      }
    } catch (err) {
      console.warn('Could not refresh logs:', err);
    } finally {
      setIsRefreshingLogs(false);
    }
  };

  // Active Selections for Hierarchy
  const [selectedShedId, setSelectedShedId] = useState('1');
  const [selectedPartId, setSelectedPartId] = useState('part-1-a');
  const [selectedLineId, setSelectedLineId] = useState<number | string>(1);
  const [inputWeight, setInputWeight] = useState('');

  // Modals & In-App Confirmations
  const [showAddShedModal, setShowAddShedModal] = useState(false);
  const [newShedName, setNewShedName] = useState('');
  const [newShedType, setNewShedType] = useState<'Female' | 'Male'>('Female');
  const [editingShed, setEditingShed] = useState<{ id: string; name: string; type: 'Female' | 'Male' } | null>(null);
  const [editingPart, setEditingPart] = useState<{ id: string; name: string } | null>(null);
  const [partPendingDelete, setPartPendingDelete] = useState<{ id: string; name: string; totalWeights: number } | null>(null);
  const [linePendingDelete, setLinePendingDelete] = useState<{ id: number | string; name: string; weights: number[] } | null>(null);

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

  // Hardware Back Button & Mobile Popstate Routing Trap with Hash Navigation
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
    const targetState = event?.state as { screen?: ScreenType; shedId?: string; partId?: string; lineId?: number | string } | null;
    const hash = window.location.hash;

    // Restore hierarchy identifiers from event state if available
    if (targetState?.shedId) setSelectedShedId(targetState.shedId);
    if (targetState?.partId) setSelectedPartId(targetState.partId);
    if (targetState?.lineId !== undefined) setSelectedLineId(targetState.lineId);

    // Determine target screen from state or hash
    let targetScreen: ScreenType | null = null;
    if (targetState?.screen) {
      targetScreen = targetState.screen;
    } else if (hash === '#weigh') {
      targetScreen = 'weigh_pad';
    } else if (hash === '#lines') {
      targetScreen = 'line_select';
    } else if (hash === '#parts') {
      targetScreen = 'part_select';
    } else if (hash === '#sheds') {
      targetScreen = 'shed_select';
    } else if (hash === '#conclusion') {
      targetScreen = 'conclusion';
    } else if (hash === '#manage') {
      targetScreen = 'sheds_manage';
    } else if (hash === '#setup') {
      targetScreen = 'setup';
    } else if (hash === '#history') {
      targetScreen = 'history';
    } else if (hash === '#auth') {
      targetScreen = 'auth';
    } else if (hash === '#home' || !hash || hash === '') {
      targetScreen = 'home';
    }

    if (targetScreen && targetScreen !== active) {
      // Clean natural backward transition without fighting the browser history stack
      setCurrentScreen(targetScreen);
    } else if (active === 'home') {
      // Swiped back while on home -> Show Exit Confirmation Dialog
      setShowExitConfirm(true);
      window.history.pushState({ screen: 'home' }, '', '#home');
    } else {
      // Fallback hierarchy if state was lost
      if (active === 'weigh_pad') {
        setCurrentScreen('line_select');
      } else if (active === 'line_select') {
        setCurrentScreen('part_select');
      } else if (active === 'part_select') {
        setCurrentScreen('shed_select');
      } else {
        setCurrentScreen('home');
      }
    }
  };

  useEffect(() => {
    // Prime root state with hash
    if (!window.location.hash || window.location.hash === '#home' || window.location.hash === '#') {
      window.history.replaceState({ screen: 'home' }, '', '#home');
      window.history.pushState({ screen: 'home' }, '', '#home');
    }

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // Consistent UI Back Button handler: calls window.history.back() for natural parity
  const handleGoBack = () => {
    if (window.history.length > 1) {
      window.history.back();
    } else {
      const active = currentScreenRef.current;
      if (active === 'weigh_pad') setCurrentScreen('line_select');
      else if (active === 'line_select') setCurrentScreen('part_select');
      else if (active === 'part_select') setCurrentScreen('shed_select');
      else if (active === 'home') setShowExitConfirm(true);
      else setCurrentScreen('home');
    }
  };

  // Synchronized Forward Navigation Helpers with Hash Anchors (Recognized by Android Chrome)
  const navigateToShedSelect = () => {
    setCurrentScreen('shed_select');
    window.history.pushState({ screen: 'shed_select' }, '', '#sheds');
  };

  const navigateToPartSelect = (shedId: string, partId?: string) => {
    setSelectedShedId(shedId);
    if (partId) setSelectedPartId(partId);
    setCurrentScreen('part_select');
    window.history.pushState({ screen: 'part_select', shedId, partId }, '', '#parts');
  };

  const navigateToLineSelect = (shedId: string, partId: string, lineId?: number | string) => {
    setSelectedShedId(shedId);
    setSelectedPartId(partId);
    if (lineId !== undefined) setSelectedLineId(lineId);
    setCurrentScreen('line_select');
    window.history.pushState({ screen: 'line_select', shedId, partId, lineId }, '', '#lines');
  };

  const navigateToWeighPad = (shedId: string, partId: string, lineId: number | string) => {
    setSelectedShedId(shedId);
    setSelectedPartId(partId);
    setSelectedLineId(lineId);
    setCurrentScreen('weigh_pad');
    window.history.pushState({ screen: 'weigh_pad', shedId, partId, lineId }, '', '#weigh');
  };

  const navigateTo = (screen: ScreenType) => {
    setCurrentScreen(screen);
    const hash = screen === 'conclusion' ? '#conclusion' 
      : screen === 'sheds_manage' ? '#manage' 
      : screen === 'setup' ? '#setup' 
      : screen === 'shed_select' ? '#sheds' 
      : screen === 'history' ? '#history'
      : screen === 'auth' ? '#auth'
      : '#home';
    window.history.pushState({ screen }, '', hash);
  };

  const handleCancelExit = () => {
    setShowExitConfirm(false);
    window.history.pushState({ screen: 'home' }, '', '#home');
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

  // Switch Active Farm
  const switchFarm = useCallback(async (targetFarmId: string, silent = false) => {
    setActiveFarmId(targetFarmId);
    localStorage.setItem('poultry_active_farm_id', targetFarmId);
    if (!silent) setSyncStatus('refreshing');

    // Restore local audit, draft status & pending status for target farm
    const localStatus = localStorage.getItem(`poultry_status_${targetFarmId}`) as FarmStatus | null;
    if (localStatus === 'DRAFT' || localStatus === 'COMPLETED') {
      setFarmStatus(localStatus);
    } else {
      setFarmStatus('DRAFT');
    }

    const localAuditStr = localStorage.getItem(`poultry_audit_${targetFarmId}`);
    if (localAuditStr) {
      try { setFarmAudit(JSON.parse(localAuditStr)); } catch {}
    } else {
      setFarmAudit(null);
    }
    const localPending = localStorage.getItem(`poultry_pending_submission_${targetFarmId}`);
    setIsPendingSubmission(localPending === 'true');

    try {
      const data = await cloudApi.getFarmDetails(targetFarmId);
      if (data) {
        setFarmName(data.name);
        setDate(data.flockDate || new Date().toISOString().split('T')[0]);
        setAgeWeek(data.ageWeek || 'W18');
        setSeason((data.season as any) || 'Summer');
        if (data.status) {
          setFarmStatus(data.status);
          localStorage.setItem(`poultry_status_${targetFarmId}`, data.status);
        }
        if (data.audit && localPending !== 'true') {
          setFarmAudit(data.audit);
          localStorage.setItem(`poultry_audit_${targetFarmId}`, JSON.stringify(data.audit));
        }
        if (data.sheds && data.sheds.length > 0) {
          setSheds(data.sheds);
          setSelectedShedId(data.sheds[0].id);
          const firstPart = data.sheds[0].parts[0];
          if (firstPart) {
            setSelectedPartId(firstPart.id);
            if (firstPart.lines[0]) setSelectedLineId(firstPart.lines[0].id);
          }
        }
        setLastServerUpdatedAt(data.updatedAt);
        setLastUpdatedString(formatLastUpdated(data.updatedAt));
        setSyncStatus('synced');
        if (!silent) showToast(`Switched to ${data.name}`);
        return;
      }
    } catch (err) {
      console.warn('Switch farm cloud load error, falling back to local cache:', err);
      setSyncStatus('offline');
      // If offline, check local cache for this farm
      const localCached = localStorage.getItem(`poultry_farm_${targetFarmId}`);
      if (localCached) {
        try {
          const parsed = JSON.parse(localCached);
          if (parsed.sheds) setSheds(parsed.sheds);
          if (parsed.farmName) setFarmName(parsed.farmName);
          if (parsed.date) setDate(parsed.date);
          if (parsed.ageWeek) setAgeWeek(parsed.ageWeek);
          if (parsed.season) setSeason(parsed.season);
        } catch {}
      }
    }
  }, []);

  // Initial Startup Bootstrap: Load Farms from Cloud with Offline Fallback
  useEffect(() => {
    async function initCloudFarms() {
      // 1. First restore offline cached farms list immediately
      const cachedFarms = localStorage.getItem('poultry_farms_list_v4');
      const savedActive = localStorage.getItem('poultry_active_farm_id');
      if (cachedFarms) {
        try {
          const parsed = JSON.parse(cachedFarms);
          if (Array.isArray(parsed) && parsed.length > 0) {
            setFarmsList(parsed);
            if (savedActive && parsed.some(f => f.id === savedActive)) {
              setActiveFarmId(savedActive);
            }
          }
        } catch {}
      }

      // 2. Fetch live farms from Render PostgreSQL
      try {
        const remoteFarms = await cloudApi.getFarms();
        if (remoteFarms && remoteFarms.length > 0) {
          setFarmsList(remoteFarms);
          localStorage.setItem('poultry_farms_list_v4', JSON.stringify(remoteFarms));
          const targetId = (savedActive && remoteFarms.some(f => f.id === savedActive)) 
            ? savedActive 
            : remoteFarms[0].id;
          await switchFarm(targetId, true);
          setSyncStatus('synced');
          return;
        }
      } catch (err) {
        console.warn('Could not connect to Cloud backend on startup, using offline cache:', err);
        setSyncStatus('offline');
      }
    }

    initCloudFarms();
  }, [switchFarm]);

  // Local Storage Persistence for active farm & offline redundancy
  useEffect(() => {
    localStorage.setItem(
      'poultry_flock_db_v3',
      JSON.stringify({ sheds, farmName, date, ageWeek, season })
    );
    if (activeFarmId) {
      localStorage.setItem(
        `poultry_farm_${activeFarmId}`,
        JSON.stringify({ sheds, farmName, date, ageWeek, season })
      );
    }
  }, [sheds, farmName, date, ageWeek, season, activeFarmId]);

  // Real-Time Auto-Refresh / Background Cloud Polling (Every 15s)
  useEffect(() => {
    const pollInterval = setInterval(async () => {
      // If offline queue has pending items, attempt to flush them first
      if (offlineQueue.count() > 0) {
        await flushPendingQueue();
      }

      // Do not interrupt if user is on weigh pad actively typing
      if (currentScreenRef.current === 'weigh_pad' && inputWeight) return;

      try {
        const remoteFarms = await cloudApi.getFarms();
        if (remoteFarms && remoteFarms.length > 0) {
          setFarmsList(remoteFarms);
          localStorage.setItem('poultry_farms_list_v4', JSON.stringify(remoteFarms));

          const currentRemote = remoteFarms.find(f => f.id === activeFarmId);
          if (currentRemote) {
            if (currentRemote.updatedAt !== lastServerUpdatedAt) {
              const full = await cloudApi.getFarmDetails(activeFarmId);
              if (full && full.sheds) {
                setSheds(full.sheds);
                setFarmName(full.name);
                setDate(full.flockDate);
                setAgeWeek(full.ageWeek);
                setSeason(full.season as any);
                setLastServerUpdatedAt(full.updatedAt);
                setLastUpdatedString(formatLastUpdated(full.updatedAt));
                setSyncStatus('synced');
              }
            }
          }
        }

        // Background poll latest activity logs from other team devices
        try {
          const remoteLogs = await cloudApi.getLogs({ limit: 50 });
          if (remoteLogs && remoteLogs.length > 0) {
            setActivityLogs(remoteLogs);
          }
        } catch {}

        if (syncStatus === 'offline') setSyncStatus('synced');
      } catch {
        // Silently mark offline if background poll network failed
      }
    }, 15000);

    return () => clearInterval(pollInterval);
  }, [activeFarmId, lastServerUpdatedAt, inputWeight, syncStatus]);

  // Manual Pull-To-Refresh from Cloud
  const handleManualRefresh = async () => {
    setIsRefreshingCloud(true);
    setSyncStatus('refreshing');
    try {
      // First flush pending offline items if any
      if (offlineQueue.count() > 0) {
        await flushPendingQueue();
      }

      const remoteFarms = await cloudApi.getFarms();
      if (remoteFarms && remoteFarms.length > 0) {
        setFarmsList(remoteFarms);
        localStorage.setItem('poultry_farms_list_v4', JSON.stringify(remoteFarms));
      }
      const full = await cloudApi.getFarmDetails(activeFarmId);
      if (full && full.sheds) {
        setSheds(full.sheds);
        setFarmName(full.name);
        setDate(full.flockDate);
        setAgeWeek(full.ageWeek);
        setSeason(full.season as any);
        setLastServerUpdatedAt(full.updatedAt);
        setLastUpdatedString(formatLastUpdated(full.updatedAt));
      }
      setSyncStatus('synced');
      showToast('Cloud data synchronized!');
    } catch {
      setSyncStatus('offline');
      showToast('Cloud offline: showing local data');
    } finally {
      setIsRefreshingCloud(false);
    }
  };

  // Create New Farm Handler with Dynamic Shed Count & Sex Split
  const handleCreateFarm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFarmName.trim()) {
      showToast('Please enter a farm name');
      return;
    }
    setIsCreatingFarm(true);
    try {
      const created = await cloudApi.createFarm({
        name: newFarmName.trim(),
        flockDate: newFarmFlockDate,
        ageWeek: newFarmAgeWeek,
        season: newFarmSeason,
        shedCount: newFarmShedCount,
        defaultSexSplit: newFarmSexSplit
      });

      if (created) {
        const newSummary: FarmSummary = {
          id: created.id,
          name: created.name,
          flockDate: created.flockDate,
          ageWeek: created.ageWeek,
          season: created.season,
          status: 'DRAFT',
          progressPercentage: 0,
          updatedAt: created.updatedAt,
          _count: { sheds: created.sheds?.length || newFarmShedCount },
        };
        setFarmsList(prev => [newSummary, ...prev]);
        setActiveFarmId(created.id);
        localStorage.setItem('poultry_active_farm_id', created.id);
        setFarmStatus('DRAFT');
        localStorage.setItem(`poultry_status_${created.id}`, 'DRAFT');
        setFarmName(created.name);
        setDate(created.flockDate);
        setAgeWeek(created.ageWeek);
        setSeason(created.season as any);
        if (created.sheds && created.sheds.length > 0) {
          setSheds(created.sheds);
          setSelectedShedId(created.sheds[0].id);
          const p1 = created.sheds[0].parts[0];
          if (p1) {
            setSelectedPartId(p1.id);
            if (p1.lines[0]) setSelectedLineId(p1.lines[0].id);
          }
        }
        setLastServerUpdatedAt(created.updatedAt);
        setLastUpdatedString('Just now');
        setSyncStatus('synced');
        setShowNewFarmModal(false);
        setNewFarmName('');
        setIsPendingSubmission(true);
        setFarmAudit(null);
        localStorage.setItem(`poultry_pending_submission_${created.id}`, 'true');
        showToast(`Created Farm: ${created.name} (${newFarmShedCount} sheds)`);
      }
    } catch (err: any) {
      console.warn('Create farm cloud error, saving locally:', err);
      const fallbackId = `farm-${Date.now()}`;
      const fallbackSheds: ShedData[] = [];
      for (let i = 1; i <= newFarmShedCount; i++) {
        const isMale = newFarmSexSplit === 'all_male' ? true : (newFarmSexSplit === 'all_female' ? false : (newFarmShedCount > 1 ? i === newFarmShedCount : false));
        fallbackSheds.push({
          id: `shed-${fallbackId}-${i}`,
          name: isMale ? `Shed ${i} Male` : `Shed ${i}`,
          sheetName: `Shed ${i}`,
          type: isMale ? 'Male' : 'Female',
          parts: [
            {
              id: `part-${fallbackId}-${i}-a`,
              name: 'Part A',
              lines: [{ id: 1, name: 'Line 1', weights: [] }]
            }
          ]
        });
      }

      const newSummary: FarmSummary = {
        id: fallbackId,
        name: newFarmName.trim(),
        flockDate: newFarmFlockDate,
        ageWeek: newFarmAgeWeek,
        season: newFarmSeason,
        status: 'DRAFT',
        progressPercentage: 0,
        updatedAt: new Date().toISOString(),
        _count: { sheds: newFarmShedCount },
      };
      setFarmsList(prev => [newSummary, ...prev]);
      setActiveFarmId(fallbackId);
      setFarmStatus('DRAFT');
      localStorage.setItem(`poultry_status_${fallbackId}`, 'DRAFT');
      setFarmName(newFarmName.trim());
      setDate(newFarmFlockDate);
      setAgeWeek(newFarmAgeWeek);
      setSeason(newFarmSeason);
      setSheds(fallbackSheds);
      setSelectedShedId(fallbackSheds[0].id);
      setSelectedPartId(fallbackSheds[0].parts[0].id);
      setSelectedLineId(1);
      setShowNewFarmModal(false);
      setNewFarmName('');
      setIsPendingSubmission(true);
      setFarmAudit(null);
      localStorage.setItem(`poultry_pending_submission_${fallbackId}`, 'true');
      setSyncStatus('offline');
      showToast(`Created offline: ${newFarmName.trim()} (${newFarmShedCount} sheds)`);
    } finally {
      setIsCreatingFarm(false);
    }
  };

  // Flush Pending Offline Queue
  const flushPendingQueue = useCallback(async () => {
    if (offlineQueue.count() === 0) {
      setPendingSyncCount(0);
      return;
    }
    try {
      setSyncStatus('saving');
      const { successCount, remainingCount } = await offlineQueue.flush();
      setPendingSyncCount(remainingCount);
      if (successCount > 0) {
        setSyncStatus('synced');
        setLastUpdatedString('Updated Just now');
        showToast(`Synced ${successCount} offline weight record${successCount > 1 ? 's' : ''}!`);
        try {
          const full = await cloudApi.getFarmDetails(activeFarmId);
          if (full && full.sheds) {
            setSheds(full.sheds);
            setLastServerUpdatedAt(full.updatedAt);
          }
        } catch {}
      } else if (remainingCount > 0) {
        setSyncStatus('offline');
      }
    } catch (err) {
      console.warn('Queue flush error:', err);
      setSyncStatus('offline');
    }
  }, [activeFarmId]);

  // Auto-sync when internet connectivity is restored
  useEffect(() => {
    const handleOnline = () => {
      showToast('Internet restored! Syncing offline records...');
      flushPendingQueue();
    };
    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, [flushPendingQueue]);

  // Test Cloud Connection Handler
  const handleTestCloudConnection = async () => {
    setCloudTestStatus('testing');
    setCloudTestResult(null);
    try {
      const result = await cloudApi.checkHealth(customApiUrlInput.trim());
      setCloudTestResult(result);
      if (result.online) {
        setCloudTestStatus('success');
        if (result.databaseConnected) {
          showToast(`Connected! Render PostgreSQL is live (${result.latencyMs || 0}ms)`);
        } else {
          showToast(`Backend online, but DB is ${result.databaseStatus || 'disconnected'}`);
        }
      } else {
        setCloudTestStatus('failed');
        showToast(result.error || 'Connection Failed');
      }
    } catch (err: any) {
      setCloudTestStatus('failed');
      setCloudTestResult({
        online: false,
        error: err?.message || 'Could not reach backend URL'
      });
      showToast('Could not reach backend URL');
    }
  };

  // Save Custom Cloud API URL & Sync Immediately (Admin-Only RBAC Protection)
  const handleSaveCloudSettings = async () => {
    if (currentUserRole !== 'Admin') {
      showToast('Permission Denied: Only Admins can modify the cloud endpoint URL.');
      return;
    }
    const trimmed = customApiUrlInput.trim();
    if (!trimmed) {
      showToast('Please enter a valid backend URL');
      return;
    }
    const normalized = normalizeApiUrl(trimmed);
    localStorage.setItem('poultry_custom_api_url', normalized);
    setCustomApiUrlInput(normalized);
    showToast('Backend URL saved by Admin!');
    setShowCloudSettingsModal(false);

    try {
      setSyncStatus('refreshing');
      await flushPendingQueue();
      await cloudApi.syncFullFarm(activeFarmId, {
        name: farmName,
        flockDate: date,
        ageWeek,
        season,
        sheds
      }).catch(() => {});
      await handleManualRefresh();
    } catch (e) {
      console.warn('Post-save sync error:', e);
    }
  };

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

  // --------------------------------------------------------------------------
  // Draft State Management & Full Farm Completion Calculations (Pre-Submit Validation)
  // --------------------------------------------------------------------------
  const completionStats = useMemo(() => {
    let totalLines = 0;
    let completedLines = 0;
    const incomplete: Array<{
      shedId: string;
      shedName: string;
      partId: string;
      partName: string;
      lineId: number | string;
      lineName: string;
      path: string;
    }> = [];

    sheds.forEach(shed => {
      shed.parts.forEach(part => {
        part.lines.forEach(line => {
          totalLines++;
          if (line.weights && line.weights.length > 0) {
            completedLines++;
          } else {
            incomplete.push({
              shedId: shed.id,
              shedName: shed.name,
              partId: part.id,
              partName: part.name,
              lineId: line.id,
              lineName: line.name,
              path: `${shed.name} › ${part.name} › ${line.name}`
            });
          }
        });
      });
    });

    const percent = totalLines > 0 ? Math.round((completedLines / totalLines) * 100) : 0;
    return {
      totalLinesCount: totalLines,
      completedLinesCount: completedLines,
      incompleteLines: incomplete,
      progressPercent: percent,
      isFarm100PercentWeighed: totalLines > 0 && incomplete.length === 0,
    };
  }, [sheds]);

  // Jump directly to an unweighed line from the Incomplete Warning Modal
  const jumpToIncompleteLine = (shedId: string, partId: string, lineId: number | string) => {
    setSelectedShedId(shedId);
    setSelectedPartId(partId);
    setSelectedLineId(lineId);
    setShowIncompleteAlertModal(false);
    navigateTo('weigh_pad');
  };

  // Helper to transition session to editable DRAFT state
  const markSessionAsDraft = useCallback((_reason?: string) => {
    const now = new Date();
    const draftTimestamp = `Date(${formatDateDMY(now)}) - Time(${formatTime12H(now)})`;
    const editorName = currentUser?.userName || currentUser?.name || 'Suresh Kumar';
    const editorRole = currentUserRole;

    setFarmStatus('DRAFT');
    localStorage.setItem(`poultry_status_${activeFarmId}`, 'DRAFT');
    setIsPendingSubmission(true);
    localStorage.setItem(`poultry_pending_submission_${activeFarmId}`, 'true');

    setFarmAudit(prev => {
      const updated: FarmAudit = {
        ...(prev || {}),
        status: 'DRAFT',
        lastSavedAsDraftAt: draftTimestamp,
        lastEditedBy: editorName,
        lastEditedRole: editorRole,
        isPendingSubmission: true,
      };
      localStorage.setItem(`poultry_audit_${activeFarmId}`, JSON.stringify(updated));
      return updated;
    });

    setFarmsList(prev => prev.map(f => f.id === activeFarmId ? {
      ...f,
      status: 'DRAFT',
      progressPercentage: completionStats.progressPercent
    } : f));
  }, [activeFarmId, completionStats.progressPercent, currentUser, currentUserRole]);

  // --- WEIGHING PAD WEIGHT HANDLERS (Local Staging & Draft Workflow) ---
  const handleAddWeight = (valToAdd?: number) => {
    const val = valToAdd !== undefined ? valToAdd : parseFloat(inputWeight);
    if (!val || isNaN(val) || val <= 0 || !activeShed || !activePart || !activeLine) return;

    // Guard: Confirmation if editing a previously completed record
    if (farmStatus === 'COMPLETED') {
      const confirmReopen = window.confirm(
        'This farm record was COMPLETED & SUBMITTED.\n\nAdding or modifying weights will mark the session as DRAFT until all lines are weighed and re-submitted.\n\nDo you want to continue?'
      );
      if (!confirmReopen) return;
    }

    // 1. Instant local state update
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

    // 2. Automatically mark session as DRAFT
    markSessionAsDraft('Added bird weight');
  };

  const handleDeleteWeight = (idx: number) => {
    if (!activeShed || !activePart || !activeLine) return;

    if (farmStatus === 'COMPLETED') {
      const confirmReopen = window.confirm(
        'This farm record was COMPLETED & SUBMITTED.\n\nDeleting weights will mark the session as DRAFT until all lines are weighed and re-submitted.\n\nDo you want to continue?'
      );
      if (!confirmReopen) return;
    }

    // 1. Instant local state update
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

    // 2. Automatically mark session as DRAFT
    markSessionAsDraft('Deleted bird weight');
  };

  const handleClearLineWeights = () => {
    if (!activeShed || !activePart || !activeLine || activeLine.weights.length === 0) return;

    if (farmStatus === 'COMPLETED') {
      const confirmReopen = window.confirm(
        'This farm record was COMPLETED & SUBMITTED.\n\nClearing weights will mark the session as DRAFT until all lines are weighed and re-submitted.\n\nDo you want to continue?'
      );
      if (!confirmReopen) return;
    }

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
      markSessionAsDraft('Cleared line weights');
    }
  };

  // --- FINAL SUBMISSION: COMPLETE FARM WEIGHING (status: 'COMPLETED') ---
  const handleCompleteFarmSubmission = async () => {
    if (isSubmittingBatch) return;

    // 1. Full Farm Completion Check: Block submission if any line has 0 weights
    const incompleteLines: string[] = [];
    sheds.forEach(shed => {
      shed.parts.forEach(part => {
        part.lines.forEach(line => {
          if (!line.weights || line.weights.length === 0) {
            incompleteLines.push(`${shed.name} › ${part.name} › ${line.name}`);
          }
        });
      });
    });

    if (incompleteLines.length > 0) {
      setShowIncompleteAlertModal(true);
      return;
    }

    setIsSubmittingBatch(true);
    setSyncStatus('saving');

    const now = new Date();
    const formattedSubmittedAt = `Date(${formatDateDMY(now)}) - Time(${formatTime12H(now)})`;
    const timestampISO = now.toISOString();

    // 2. Calculate total birds across all sheds
    const totalBirdsWeighed = sheds.reduce(
      (acc, shed) => acc + shed.parts.reduce(
        (pAcc, part) => pAcc + part.lines.reduce(
          (lAcc, line) => lAcc + line.weights.length, 0
        ), 0
      ), 0
    );

    // 3. Calculate Female & Male Act Body Weights across active farm
    const femaleWeights = sheds
      .filter(s => s.type === 'Female')
      .flatMap(s => s.parts.flatMap(p => p.lines.flatMap(l => l.weights)));
    const maleWeights = sheds
      .filter(s => s.type === 'Male')
      .flatMap(s => s.parts.flatMap(p => p.lines.flatMap(l => l.weights)));
    const femaleAvg = femaleWeights.length > 0 
      ? Math.round(femaleWeights.reduce((a, b) => a + b, 0) / femaleWeights.length) 
      : 0;
    const maleAvg = maleWeights.length > 0 
      ? Math.round(maleWeights.reduce((a, b) => a + b, 0) / maleWeights.length) 
      : 0;

    const userDisplayName = currentUser?.userName || currentUser?.name || 'Suresh Kumar';
    const userRole = currentUserRole;

    // 4. Update FarmAudit object with COMPLETED status
    const updatedAudit: FarmAudit = {
      status: 'COMPLETED',
      lastSubmittedAt: formattedSubmittedAt,
      lastSubmittedBy: userDisplayName,
      lastSubmittedRole: userRole,
      submittedBy: userDisplayName,
      submittedRole: userRole,
      lastEditedBy: userDisplayName,
      lastEditedRole: userRole,
      totalBirdsSubmitted: totalBirdsWeighed,
      totalBirdsAtLastSubmit: totalBirdsWeighed,
      femaleAvgWeight: femaleAvg,
      maleAvgWeight: maleAvg,
      isPendingSubmission: false,
    };

    setFarmStatus('COMPLETED');
    localStorage.setItem(`poultry_status_${activeFarmId}`, 'COMPLETED');
    setFarmAudit(updatedAudit);
    setIsPendingSubmission(false);
    localStorage.setItem(`poultry_audit_${activeFarmId}`, JSON.stringify(updatedAudit));
    localStorage.setItem(`poultry_pending_submission_${activeFarmId}`, 'false');

    setFarmsList(prev => prev.map(f => f.id === activeFarmId ? {
      ...f,
      status: 'COMPLETED',
      progressPercentage: 100,
      audit: updatedAudit,
      updatedAt: timestampISO
    } : f));

    // 5. Create single consolidated submission audit log
    const newSubmissionLog: ActivityLogItem = {
      id: `submit-${Date.now()}`,
      farmId: activeFarmId,
      farmName: farmName,
      userId: currentUser?.id,
      userName: `${userDisplayName} (${userRole})`,
      action: `Batch Weighing Submitted • ${totalBirdsWeighed} Birds (♀ Act: ${femaleAvg > 0 ? femaleAvg + 'g' : 'N/A'}, ♂ Act: ${maleAvg > 0 ? maleAvg + 'g' : 'N/A'})`,
      sampleCount: totalBirdsWeighed,
      avgWeight: femaleAvg || maleAvg,
      femaleAvgWeight: femaleAvg,
      maleAvgWeight: maleAvg,
      status: 'COMPLETED',
      timestamp: timestampISO,
      isLive: false,
    };

    setActivityLogs(prev => [newSubmissionLog, ...prev.slice(0, 49)]);

    // 6. Commit and sync full farm dataset to remote store with COMPLETED status
    try {
      await cloudApi.syncFullFarm(activeFarmId, {
        name: farmName,
        flockDate: date,
        ageWeek,
        season,
        status: 'COMPLETED',
        progressPercentage: 100,
        sheds,
        audit: updatedAudit
      });

      // Also post consolidated batch log to backend
      await cloudApi.createLog({
        farmId: activeFarmId,
        userName: `${userDisplayName} (${userRole})`,
        action: newSubmissionLog.action,
        sampleCount: totalBirdsWeighed,
        avgWeight: femaleAvg || maleAvg,
        status: 'COMPLETED'
      }).catch(() => {});

      setSyncStatus('synced');
      setLastUpdatedString('Updated Just now');
      setLastServerUpdatedAt(timestampISO);
      showToast(`Farm weighing 100% complete! Submitted successfully by ${userDisplayName}.`);
    } catch (err) {
      console.warn('Batch submit offline error, queuing full sync:', err);
      offlineQueue.enqueue({
        type: 'SYNC_FARM',
        payload: {
          farmId: activeFarmId,
          data: {
            name: farmName,
            flockDate: date,
            ageWeek,
            season,
            status: 'COMPLETED',
            progressPercentage: 100,
            sheds,
            audit: updatedAudit
          }
        }
      });
      setPendingSyncCount(offlineQueue.count());
      setSyncStatus('offline');
      showToast('Farm weighing saved locally as COMPLETED (Queued for Cloud Sync)');
    } finally {
      setIsSubmittingBatch(false);
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
    markSessionAsDraft('Added part');

    setSyncStatus('saving');
    cloudApi.addPart({ shedId: activeShed.id, name: partName })
      .then((createdPart) => {
        if (createdPart?.id) {
          setSheds(prev => prev.map(s => s.id === activeShed.id ? {
            ...s,
            parts: s.parts.map(p => p.id === newPartId ? { ...p, id: createdPart.id, lines: createdPart.lines || p.lines } : p)
          } : s));
          setSelectedPartId(createdPart.id);
        }
        setSyncStatus('synced');
      })
      .catch(() => setSyncStatus('offline'));
  };

  const handleStartEditPart = (part: ShedPart) => {
    setEditingPart({ id: part.id, name: part.name });
  };

  const handleSaveEditPart = () => {
    if (!editingPart || !editingPart.name.trim() || !activeShed) return;
    const trimmed = editingPart.name.trim();
    const partId = editingPart.id;
    setSheds(prev => prev.map(s => {
      if (s.id !== activeShed.id) return s;
      return {
        ...s,
        parts: s.parts.map(p => p.id === partId ? { ...p, name: trimmed } : p)
      };
    }));
    showToast(`Part renamed to "${trimmed}".`);
    setEditingPart(null);

    cloudApi.updatePart(partId, trimmed).catch(() => {});
  };

  const handleDeletePart = (partId: string, e?: React.MouseEvent) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    if (currentUserRole === 'Supervisor') {
      showToast('Permission Denied: Supervisor cannot delete shed parts.');
      return;
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
    markSessionAsDraft('Deleted part');

    cloudApi.deletePart(partId).catch(() => {});
  };

  // --- LINE / PEN MANAGEMENT HANDLERS ---
  const handleAddLine = () => {
    if (!activeShed || !activePart) return;
    const nextId = (activePart.lines.length ? Math.max(...activePart.lines.map(l => typeof l.id === 'number' ? l.id : 0)) : 0) + 1;
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
    markSessionAsDraft('Added line');

    setSyncStatus('saving');
    cloudApi.addLine({ partId: activePart.id, name: newLineName })
      .then((createdLine) => {
        if (createdLine?.id) {
          setSheds(prev => prev.map(s => s.id === activeShed.id ? {
            ...s,
            parts: s.parts.map(p => p.id === activePart.id ? {
              ...p,
              lines: p.lines.map(l => l.id === nextId ? { ...l, id: createdLine.id } : l)
            } : p)
          } : s));
          setSelectedLineId(createdLine.id);
        }
        setSyncStatus('synced');
      })
      .catch(() => setSyncStatus('offline'));
  };

  const handleDeleteLine = (lineId: number | string, e?: React.MouseEvent) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    if (currentUserRole === 'Supervisor') {
      showToast('Permission Denied: Supervisor cannot delete pen lines.');
      return;
    }
    if (!activeShed || !activePart) return;
    if (activePart.lines.length <= 1) {
      showToast('A part must have at least 1 pen line.');
      return;
    }
    const target = activePart.lines.find(l => String(l.id) === String(lineId));
    if (!target) return;

    if (target.weights.length === 0) {
      executeDeleteLine(lineId);
    } else {
      setLinePendingDelete({ id: target.id, name: target.name, weights: target.weights });
    }
  };

  const executeDeleteLine = (lineId: number | string) => {
    if (!activeShed || !activePart) return;
    const remaining = activePart.lines.filter(l => String(l.id) !== String(lineId));
    setSheds(prev => prev.map(s => {
      if (s.id !== activeShed.id) return s;
      return {
        ...s,
        parts: s.parts.map(p => p.id === activePart.id ? { ...p, lines: remaining } : p)
      };
    }));
    setSelectedLineId(prev => (String(prev) === String(lineId) ? remaining[0].id : prev));
    setLinePendingDelete(null);
    showToast('Line deleted.');
    markSessionAsDraft('Deleted line');

    cloudApi.deleteLine(lineId).catch(() => {});
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
    markSessionAsDraft('Added shed');

    setSyncStatus('saving');
    cloudApi.addShed({ farmId: activeFarmId, name: newShedName.trim(), type: newShedType })
      .then((createdShed) => {
        if (createdShed?.id) {
          setSheds(prev => prev.map(s => s.id === newId ? { ...s, id: createdShed.id, parts: createdShed.parts || s.parts } : s));
          setSelectedShedId(createdShed.id);
        }
        setSyncStatus('synced');
        setLastUpdatedString('Updated Just now');
      })
      .catch(() => setSyncStatus('offline'));
  };

  const handleStartEditShed = (shed: ShedData) => {
    setEditingShed({ id: shed.id, name: shed.name, type: shed.type });
  };

  const handleSaveEditShed = () => {
    if (!editingShed || !editingShed.name.trim()) return;
    const trimmed = editingShed.name.trim();
    const shedId = editingShed.id;
    const shedType = editingShed.type;
    setSheds(prev => prev.map(s => s.id === shedId ? { ...s, name: trimmed, type: shedType } : s));
    showToast(`Saved ${trimmed}`);
    setEditingShed(null);

    cloudApi.updateShed(shedId, { name: trimmed, type: shedType }).catch(() => {});
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
        
        {(!currentUser || !currentUser.isAuthenticated) ? (
          <div className="flex-1 flex flex-col justify-center p-4">
            <div className="text-center mb-4">
              <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-emerald-600/10 border border-emerald-500/30 text-emerald-500 mb-2 shadow-xs">
                <ShieldCheck className="w-8 h-8" />
              </div>
              <h2 className="text-base font-black text-slate-900">Farm Team Authentication</h2>
              <p className="text-xs text-slate-500">Shared Password & Role Identity Access</p>
            </div>
            <SharedLoginScreen onLoginSuccess={handleSharedLoginSuccess} />
          </div>
        ) : (
          <>
        {/* ========================================================= */}
        {/* 1. APP HOME DASHBOARD                                     */}
        {/* ========================================================= */}
        {currentScreen === 'home' && (
          <div className="flex-1 flex flex-col p-4 animate-in fade-in duration-150">
            {/* Top User Session Pill & Live History Shortcut */}
            <div className="flex items-center justify-between mb-3 px-1">
              {currentUser ? (
                <div 
                  onClick={() => navigateTo('auth')}
                  className="flex items-center gap-2 cursor-pointer hover:opacity-90 transition bg-white px-2.5 py-1.5 rounded-xl border border-slate-200/90 shadow-2xs"
                  title="View Shared Farm Account & Role"
                >
                  <div className={`w-7 h-7 rounded-lg text-white flex items-center justify-center font-bold text-xs shadow-xs ${
                    currentUserRole === 'Admin' ? 'bg-purple-600' :
                    currentUserRole === 'Manager' ? 'bg-sky-600' : 'bg-emerald-600'
                  }`}>
                    {(currentUser.userName || currentUser.name).charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <span className="text-xs font-bold text-slate-900 block leading-tight truncate max-w-[120px]">
                      {currentUser.userName || currentUser.name}
                    </span>
                    <span className={`text-[9px] font-bold px-1.5 py-0.2 rounded leading-tight inline-block border ${
                      currentUserRole === 'Admin' ? 'bg-purple-50 text-purple-700 border-purple-200' :
                      currentUserRole === 'Manager' ? 'bg-sky-50 text-sky-700 border-sky-200' :
                      'bg-emerald-50 text-emerald-700 border-emerald-200'
                    }`}>
                      {currentUserRole}
                    </span>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => navigateTo('auth')}
                  className="flex items-center gap-1.5 text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-1.5 rounded-xl hover:bg-emerald-100 transition cursor-pointer"
                >
                  <LogIn className="w-3.5 h-3.5 text-emerald-600" /> Sign In / Login
                </button>
              )}

              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => navigateTo('history')}
                  className="flex items-center gap-1.5 text-xs font-bold text-rose-700 bg-rose-50 border border-rose-200 px-3 py-1.5 rounded-xl active:scale-95 transition cursor-pointer hover:bg-rose-100 shadow-2xs"
                >
                  <Radio className="w-3.5 h-3.5 text-rose-600 animate-pulse" />
                  <span>Live Feed</span>
                </button>
                {currentUser && (
                  <button
                    onClick={handleLogout}
                    className="p-1.5 text-slate-400 hover:text-rose-600 rounded-xl hover:bg-slate-200 transition cursor-pointer"
                    title="Log Out Session"
                  >
                    <LogOut className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>

            {/* Top Farm Switcher with Dedicated Farm Details Button (Req 1 & 4) */}
            <div className="bg-slate-900 p-3 rounded-2xl border border-slate-700 mb-3 shadow-md flex items-center justify-between">
              <div className="flex-1 mr-2">
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[9px] uppercase font-bold text-slate-400 block">Select Farm Unit</label>
                  <span className={`text-[9px] px-2 py-0.5 rounded-full font-bold flex items-center gap-1 ${
                    farmStatus === 'DRAFT' 
                      ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40' 
                      : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                  }`}>
                    {farmStatus === 'DRAFT' ? (
                      <>
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse"></span>
                        <span>🟡 DRAFT IN PROGRESS (Editing)</span>
                      </>
                    ) : (
                      <>
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                        <span>🟢 COMPLETED & SUBMITTED</span>
                      </>
                    )}
                  </span>
                </div>
                <select
                  value={activeFarmId}
                  onChange={(e) => switchFarm(e.target.value)}
                  className="w-full bg-slate-950 text-emerald-400 font-bold text-xs rounded-lg px-2.5 py-1.5 border border-slate-700 focus:outline-none focus:border-emerald-500 truncate cursor-pointer"
                >
                  {farmsList.map((farm) => (
                    <option key={farm.id} value={farm.id}>
                      {farm.name} ({farm.ageWeek}) — {farm.status === 'COMPLETED' ? '🟢 COMPLETED' : '🟡 DRAFT'}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center gap-1.5 self-end">
                <button
                  type="button"
                  onClick={() => setShowFarmDetailsModal(true)}
                  className="bg-slate-800 hover:bg-slate-700 active:scale-95 text-emerald-400 border border-slate-700 font-bold px-2.5 py-1.5 rounded-lg text-xs flex items-center gap-1 shrink-0 transition cursor-pointer"
                  title="View Dedicated Farm Details & Audit"
                >
                  <FileText className="w-3.5 h-3.5" /> Details
                </button>
                <button
                  type="button"
                  onClick={handleOpenNewFarmModal}
                  className="bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-slate-950 font-black px-2.5 py-1.5 rounded-lg text-xs flex items-center gap-1 shrink-0 transition cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" /> New Farm
                </button>
              </div>
            </div>

            {/* Progress & Draft Indicator Banner (Req 3.A) */}
            <div className="flex items-center justify-between p-2.5 rounded-xl border mb-3 bg-slate-800/90 border-slate-700 shadow-sm">
              <div className="flex items-center gap-2">
                {farmStatus === 'DRAFT' ? (
                  <>
                    <span className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-pulse shrink-0" />
                    <div>
                      <span className="text-xs font-bold text-amber-300">Draft In Progress</span>
                      <span className="text-[10px] text-slate-400 block">
                        {completionStats.completedLinesCount} / {completionStats.totalLinesCount} lines weighed ({completionStats.progressPercent}%)
                      </span>
                    </div>
                  </>
                ) : (
                  <>
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 shrink-0" />
                    <div>
                      <span className="text-xs font-bold text-emerald-400">Completed & Submitted</span>
                      <span className="text-[10px] text-slate-400 block">
                        Submitted by {farmAudit?.submittedBy || farmAudit?.lastSubmittedBy || 'Supervisor'} at {farmAudit?.lastSubmittedAt || 'Recent'}
                      </span>
                    </div>
                  </>
                )}
              </div>

              <span className="text-xs font-mono font-bold text-slate-300 shrink-0">
                {completionStats.progressPercent}% Done
              </span>
            </div>

            {/* PROMINENT BATCH SUBMIT BANNER / ACTION ON HOME (Req 2 & 3) */}
            <div className={`mb-3 p-3.5 rounded-2xl border shadow-xs flex items-center justify-between transition-all ${
              farmStatus === 'DRAFT' 
                ? 'bg-amber-500/10 border-amber-500/40 text-amber-950' 
                : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-950'
            }`}>
              <div className="flex items-center gap-2.5 min-w-0 pr-2">
                <div className={`p-2 rounded-xl shrink-0 ${
                  farmStatus === 'DRAFT' ? 'bg-amber-500 text-white animate-pulse' : 'bg-emerald-600 text-white'
                }`}>
                  <UploadCloud className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-black truncate">
                      {farmStatus === 'DRAFT' ? 'Draft Farm Weighing' : 'Farm Weighing Completed'}
                    </span>
                    <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold shrink-0 ${
                      farmStatus === 'DRAFT' ? 'bg-amber-200 text-amber-900 font-extrabold' : 'bg-emerald-200 text-emerald-900'
                    }`}>
                      {farmStatus === 'DRAFT' ? '🟡 DRAFT' : '🟢 COMPLETED'}
                    </span>
                  </div>
                  <p className="text-[10px] text-slate-500 truncate">
                    {farmStatus === 'COMPLETED' && farmAudit?.lastSubmittedAt 
                      ? `Submitted: ${farmAudit.lastSubmittedAt}`
                      : completionStats.isFarm100PercentWeighed
                        ? '100% Weighed! Ready for final submission.'
                        : `${completionStats.incompleteLines.length} lines unweighed before submission.`}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={handleCompleteFarmSubmission}
                disabled={isSubmittingBatch}
                className="bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white font-black px-3 py-2 rounded-xl text-xs flex items-center gap-1.5 shadow-md shadow-emerald-600/20 cursor-pointer shrink-0 disabled:opacity-50"
              >
                {isSubmittingBatch ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Submitting...</span>
                  </>
                ) : (
                  <>
                    <CheckCircle className="w-3.5 h-3.5" />
                    <span>Submit Farm Weighing</span>
                  </>
                )}
              </button>
            </div>

            {/* Cloud Sync Status Indicator */}
            <div className="flex items-center justify-between px-1 mb-3 text-[11px] text-slate-500 font-medium">
              <div className="flex items-center gap-1.5">
                {syncStatus === 'saving' ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 text-amber-500 animate-spin" />
                    <span className="text-amber-600 font-bold">
                      {pendingSyncCount > 0 ? `Syncing (${pendingSyncCount} pending)...` : 'Saving to Cloud...'}
                    </span>
                  </>
                ) : syncStatus === 'refreshing' ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 text-sky-500 animate-spin" />
                    <span className="text-sky-600 font-bold">Syncing...</span>
                  </>
                ) : syncStatus === 'offline' ? (
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-amber-500"></span>
                    <span className="text-amber-600 font-bold">
                      Offline {pendingSyncCount > 0 ? `(${pendingSyncCount} pending)` : '(Local Cache)'}
                    </span>
                    {pendingSyncCount > 0 && (
                      <button
                        onClick={(e) => { e.stopPropagation(); flushPendingQueue(); }}
                        className="text-[10px] bg-amber-100 hover:bg-amber-200 text-amber-800 px-1.5 py-0.5 rounded font-black cursor-pointer transition active:scale-95"
                        title="Upload pending offline records now"
                      >
                        Sync Now
                      </button>
                    )}
                  </div>
                ) : (
                  <>
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></span>
                    <span className="text-emerald-700 font-bold">Live Cloud Sync Active</span>
                  </>
                )}
              </div>

              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-slate-500">Last Updated: {lastUpdatedString}</span>
                <button
                  onClick={handleManualRefresh}
                  disabled={isRefreshingCloud}
                  title="Pull latest weights from Cloud"
                  className="p-1 hover:bg-slate-200 text-slate-500 hover:text-emerald-600 rounded-md transition active:scale-90 cursor-pointer"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isRefreshingCloud ? 'animate-spin text-emerald-600' : ''}`} />
                </button>
                <button
                  onClick={() => setShowCloudSettingsModal(true)}
                  title="Configure Cloud Backend URL"
                  className="p-1 hover:bg-slate-200 text-slate-500 hover:text-slate-800 rounded-md transition active:scale-90 cursor-pointer"
                >
                  <Cloud className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

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

              {/* 2. Live Activity Updates Card */}
              <button
                onClick={() => navigateTo('history')}
                className="w-full bg-white hover:bg-slate-50 active:scale-[0.98] transition p-4 rounded-2xl flex items-center justify-between text-left shadow-xs border border-slate-200 group cursor-pointer"
              >
                <div className="flex items-center gap-3.5">
                  <div className="p-3 bg-rose-50 rounded-xl text-rose-600 border border-rose-200 relative">
                    <History className="w-6 h-6" />
                    <span className="absolute top-2 right-2 w-2 h-2 rounded-full bg-rose-500 animate-ping"></span>
                  </div>
                  <div>
                    <h2 className="font-black text-base text-slate-900 flex items-center gap-2">
                      Live Updates History
                      <span className="text-[10px] bg-rose-100 text-rose-700 px-2 py-0.5 rounded-full font-bold">
                        ● LIVE FEED
                      </span>
                    </h2>
                    <p className="text-xs text-slate-500">Track which farm, shed & line is being weighed in real-time</p>
                  </div>
                </div>
                <ChevronRight className="w-5 h-5 text-slate-400 group-hover:translate-x-1 transition" />
              </button>

              {/* 3. Consolidated Report */}
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

            {/* Progress & Draft Indicator Banner on Weigh Pad (Req 3.A) */}
            <div className="flex items-center justify-between p-2.5 rounded-xl border mt-3 bg-slate-800/90 border-slate-700 shadow-sm">
              <div className="flex items-center gap-2">
                {farmStatus === 'DRAFT' ? (
                  <>
                    <span className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-pulse shrink-0" />
                    <div>
                      <span className="text-xs font-bold text-amber-300">Draft In Progress</span>
                      <span className="text-[10px] text-slate-400 block">
                        {completionStats.completedLinesCount} / {completionStats.totalLinesCount} lines weighed ({completionStats.progressPercent}%)
                      </span>
                    </div>
                  </>
                ) : (
                  <>
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 shrink-0" />
                    <div>
                      <span className="text-xs font-bold text-emerald-400">Completed & Submitted</span>
                      <span className="text-[10px] text-slate-400 block">
                        Submitted by {farmAudit?.submittedBy || farmAudit?.lastSubmittedBy || 'Supervisor'} at {farmAudit?.lastSubmittedAt || 'Recent'}
                      </span>
                    </div>
                  </>
                )}
              </div>

              <span className="text-xs font-mono font-bold text-slate-300 shrink-0">
                {completionStats.progressPercent}% Done
              </span>
            </div>

            {/* Prominent Submit Farm Weighing Bar on Weigh Pad (Req 2 & 3) */}
            <div className="mt-2">
              <button
                type="button"
                onClick={handleCompleteFarmSubmission}
                disabled={isSubmittingBatch}
                className="w-full bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white font-black py-3 rounded-xl text-xs flex items-center justify-center gap-2 shadow-lg shadow-emerald-600/25 transition cursor-pointer disabled:opacity-50"
              >
                {isSubmittingBatch ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Submitting Farm Weighing Batch...</span>
                  </>
                ) : (
                  <>
                    <CheckCircle className="w-4 h-4" />
                    <span>
                      Submit Farm Weighing {farmStatus === 'DRAFT' ? `(${completionStats.progressPercent}% - ${completionStats.incompleteLines.length === 0 ? 'Ready' : `${completionStats.incompleteLines.length} Pending`})` : '(Completed)'}
                    </span>
                  </>
                )}
              </button>
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
                          if (currentUserRole !== 'Admin') {
                            showToast('Permission Denied: Only Admins can delete sheds.');
                            return;
                          }
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
                showToast('Syncing farm details to cloud...');
                cloudApi.updateFarmDetails(activeFarmId, {
                  name: farmName,
                  flockDate: date,
                  ageWeek,
                  season
                })
                  .then(() => {
                    setSyncStatus('synced');
                    setLastUpdatedString('Updated Just now');
                    showToast('Farm details synced to Cloud!');
                  })
                  .catch(() => {
                    offlineQueue.enqueue({
                      type: 'SYNC_FARM',
                      payload: {
                        farmId: activeFarmId,
                        data: { name: farmName, flockDate: date, ageWeek, season, sheds }
                      }
                    });
                    setPendingSyncCount(offlineQueue.count());
                    setSyncStatus('offline');
                    showToast('Saved locally (Queued for Cloud Sync)');
                  });
                navigateTo('home');
              }}
              className="w-full bg-purple-600 hover:bg-purple-700 py-3.5 rounded-xl font-black text-xs text-white shadow-md shadow-purple-600/20 active:scale-95 cursor-pointer"
            >
              Save Details & Sync Cloud
            </button>

            {/* Cloud Endpoint Settings Section (Req 3: Role-Protected) */}
            <div className="bg-slate-800/90 p-3.5 rounded-xl border border-slate-700 space-y-2.5 mt-4">
              <div className="flex items-center justify-between">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                  Backend Cloud Link / API Endpoint
                </label>
                <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full border ${
                  currentUserRole === 'Admin'
                    ? 'bg-purple-500/10 text-purple-300 border-purple-500/30'
                    : 'bg-slate-700/60 text-slate-400 border-slate-600'
                }`}>
                  {currentUserRole === 'Admin' ? 'Editable (Admin Only)' : 'Read-Only'}
                </span>
              </div>

              <div className="relative">
                <input
                  type="url"
                  value={customApiUrlInput}
                  onChange={(e) => setCustomApiUrlInput(e.target.value)}
                  disabled={currentUserRole !== 'Admin'}
                  placeholder="https://your-backend-service.onrender.com"
                  className={`w-full bg-slate-950 border rounded-xl px-3 py-2 text-xs font-mono font-bold focus:outline-none ${
                    currentUserRole === 'Admin'
                      ? 'border-purple-500 text-white focus:border-purple-400'
                      : 'border-slate-800 text-slate-500 cursor-not-allowed bg-slate-950/50'
                  }`}
                />
              </div>

              {currentUserRole !== 'Admin' ? (
                <p className="text-[10px] text-amber-400/80 italic">
                  Only Admins are permitted to modify the cloud connection link.
                </p>
              ) : (
                <div className="flex gap-2 pt-1">
                  <button
                    type="button"
                    onClick={handleSaveCloudSettings}
                    className="flex-1 bg-purple-600 hover:bg-purple-500 text-white font-bold py-2 rounded-xl text-xs transition active:scale-95 cursor-pointer"
                  >
                    Save & Apply Cloud Link
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowCloudSettingsModal(true)}
                    className="bg-slate-700 hover:bg-slate-600 text-slate-200 font-bold px-3 py-2 rounded-xl text-xs transition active:scale-95 cursor-pointer"
                  >
                    Diagnostics
                  </button>
                </div>
              )}
            </div>

            <div className="mt-3">
              <button
                type="button"
                onClick={() => setShowCloudSettingsModal(true)}
                className="w-full bg-slate-100 hover:bg-slate-200 py-2.5 rounded-xl text-xs font-bold text-slate-700 flex items-center justify-center gap-2 cursor-pointer transition active:scale-95"
              >
                <Cloud className="w-4 h-4 text-emerald-600" />
                Open Cloud Connection Diagnostics
              </button>
            </div>
          </div>
        )}

        {/* ========================================================= */}
        {/* SCREEN: LIVE UPDATES HISTORY SCREEN                       */}
        {/* ========================================================= */}
        {currentScreen === 'history' && (
          <div className="flex-1 flex flex-col p-4 animate-in slide-in-from-right duration-150">
            {/* Top Bar */}
            <div className="flex items-center justify-between mb-3.5">
              <button 
                onClick={handleGoBack} 
                className="flex items-center gap-1.5 text-xs font-bold text-slate-700 bg-white hover:bg-slate-100 px-3 py-1.5 rounded-xl border border-slate-200 shadow-xs active:scale-95 cursor-pointer"
              >
                <ArrowLeft className="w-4 h-4" /> Home
              </button>
              <div className="flex items-center gap-1.5">
                <span className="flex items-center gap-1.5 bg-rose-50 border border-rose-200 px-2.5 py-1 rounded-full text-[10px] font-black text-rose-700 shadow-2xs">
                  <span className="w-2 h-2 rounded-full bg-rose-500 animate-ping"></span>
                  <span>LIVE CLOUD FEED</span>
                </span>
                <button
                  onClick={fetchLatestLogs}
                  disabled={isRefreshingLogs}
                  className="p-1.5 bg-white hover:bg-slate-100 border border-slate-200 rounded-xl text-slate-600 hover:text-emerald-600 transition active:scale-90 cursor-pointer"
                  title="Refresh activity logs"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isRefreshingLogs ? 'animate-spin text-emerald-600' : ''}`} />
                </button>
              </div>
            </div>

            {/* Title & Live Status Banner */}
            <div className="bg-gradient-to-r from-rose-50 via-amber-50 to-emerald-50 border border-rose-200/80 p-3 rounded-2xl mb-3 shadow-2xs">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-xs font-black uppercase tracking-wider text-rose-900 flex items-center gap-1.5">
                    <Radio className="w-4 h-4 text-rose-600 animate-pulse" />
                    Multi-Device Live Timeline
                  </h2>
                  <p className="text-[11px] text-slate-600 mt-0.5">
                    Real-time weighing activity logged across farms and supervisors
                  </p>
                </div>
                <span className="text-[10px] font-mono font-bold text-slate-600 bg-white/80 px-2 py-1 rounded-lg border border-slate-200">
                  {activityLogs.length} updates
                </span>
              </div>
            </div>

            {/* Filter Tabs */}
            <div className="flex gap-1.5 mb-3 p-1 bg-slate-200/80 rounded-xl text-xs font-bold">
              <button
                onClick={() => setHistoryFilter('all')}
                className={`flex-1 py-1.5 rounded-lg transition text-center cursor-pointer ${
                  historyFilter === 'all' 
                    ? 'bg-white text-slate-900 shadow-xs font-black' 
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                All Farms ({activityLogs.length})
              </button>
              <button
                onClick={() => setHistoryFilter('live')}
                className={`flex-1 py-1.5 rounded-lg transition text-center cursor-pointer flex items-center justify-center gap-1 ${
                  historyFilter === 'live' 
                    ? 'bg-rose-600 text-white shadow-xs font-black' 
                    : 'text-slate-600 hover:text-rose-700'
                }`}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${historyFilter === 'live' ? 'bg-white' : 'bg-rose-500'} animate-pulse`}></span>
                Live Only
              </button>
              <button
                onClick={() => setHistoryFilter('currentFarm')}
                className={`flex-1 py-1.5 rounded-lg transition text-center cursor-pointer truncate px-1 ${
                  historyFilter === 'currentFarm' 
                    ? 'bg-white text-emerald-800 shadow-xs font-black' 
                    : 'text-slate-600 hover:text-emerald-800'
                }`}
              >
                This Farm
              </button>
            </div>

            {/* Activity Logs Stream */}
            <div className="space-y-2.5 overflow-y-auto flex-1 pb-4">
              {(() => {
                const now = Date.now();
                const filtered = activityLogs.filter(log => {
                  if (historyFilter === 'live') {
                    const ageMs = now - new Date(log.timestamp).getTime();
                    return ageMs < 120 * 1000 || log.isLive;
                  }
                  if (historyFilter === 'currentFarm') {
                    return log.farmId === activeFarmId || log.farmName.trim().toLowerCase() === farmName.trim().toLowerCase();
                  }
                  return true;
                });

                if (filtered.length === 0) {
                  return (
                    <div className="bg-white border border-slate-200 rounded-2xl p-8 text-center space-y-3 shadow-xs">
                      <div className="w-12 h-12 bg-slate-100 rounded-full flex items-center justify-center mx-auto text-slate-400">
                        <History className="w-6 h-6" />
                      </div>
                      <h4 className="font-black text-sm text-slate-800">No Activity Logs Found</h4>
                      <p className="text-xs text-slate-500 max-w-xs mx-auto">
                        {historyFilter === 'live' 
                          ? 'No birds weighed in the last 2 minutes. Enter a bird weight to trigger live broadcast!'
                          : 'No updates recorded for this filter yet. When supervisors enter bird weights, they will appear here in real time.'}
                      </p>
                      <button
                        onClick={() => navigateTo('shed_select')}
                        className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs px-4 py-2 rounded-xl transition cursor-pointer"
                      >
                        Enter Bird Weights →
                      </button>
                    </div>
                  );
                }

                return filtered.map((log) => {
                  const logDate = new Date(log.timestamp);
                  const ageMs = now - logDate.getTime();
                  const isVeryRecent = ageMs < 120 * 1000 || log.isLive;

                  return (
                    <div 
                      key={log.id} 
                      className="p-3.5 rounded-2xl border bg-white border-slate-200 shadow-2xs hover:border-slate-300 transition-all"
                    >
                      {/* Top Header: Farm Name & Completed Status */}
                      <div className="flex items-start justify-between gap-2 pb-2 border-b border-slate-100">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <Building2 className="w-4 h-4 text-emerald-600 shrink-0" />
                          <span className="font-black text-xs text-slate-900 truncate">{log.farmName}</span>
                        </div>

                        <span className="bg-emerald-50 text-emerald-700 border border-emerald-200 px-2.5 py-0.5 rounded-full text-[9px] font-black shrink-0 flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                          SUBMISSION COMPLETED
                        </span>
                      </div>

                      {/* Scope / Summary Metrics */}
                      <div className="mt-2.5 grid grid-cols-3 gap-2 bg-slate-50 p-2.5 rounded-xl border border-slate-200/80 text-xs">
                        <div>
                          <span className="text-[9px] text-slate-500 font-bold uppercase block">Total Weighed</span>
                          <span className="font-extrabold text-slate-900 text-sm font-mono">
                            {log.sampleCount || 0} Birds
                          </span>
                        </div>
                        <div>
                          <span className="text-[9px] text-pink-600 font-bold uppercase block">Female Act B.Wt</span>
                          <span className="font-extrabold text-pink-700 text-sm font-mono">
                            {log.femaleAvgWeight ? `${log.femaleAvgWeight}g` : (log.avgWeight ? `${log.avgWeight}g` : 'N/A')}
                          </span>
                        </div>
                        <div>
                          <span className="text-[9px] text-blue-600 font-bold uppercase block">Male Act B.Wt</span>
                          <span className="font-extrabold text-blue-700 text-sm font-mono">
                            {log.maleAvgWeight ? `${log.maleAvgWeight}g` : 'N/A'}
                          </span>
                        </div>
                      </div>

                      {/* Action summary text */}
                      <p className="mt-2 text-[11px] font-semibold text-slate-700 bg-slate-50/60 px-2 py-1 rounded-lg border border-slate-100">
                        {log.action}
                      </p>

                      {/* Footer: Submitted By & Formatted Timestamp: Date(DD-MM-YYYY) - Time(HH:MM:SS AM/PM) */}
                      <div className="flex items-center justify-between text-[11px] text-slate-500 pt-2 mt-2 border-t border-slate-100">
                        <div className="flex items-center gap-1.5">
                          <div className="w-4 h-4 rounded-full bg-emerald-600 text-white flex items-center justify-center text-[9px] font-bold">
                            {(log.userName || 'S').charAt(0).toUpperCase()}
                          </div>
                          <span>Submitted By: <strong className="text-slate-800">{log.userName || 'Supervisor'}</strong></span>
                        </div>
                        <span className="text-[10px] font-mono text-slate-700 font-bold">
                          {formatLogDateTime(log.timestamp)}
                        </span>
                      </div>
                    </div>
                  );
                });
              })()}
            </div>
          </div>
        )}

        {/* ========================================================= */}
        {/* SCREEN: SHARED FARM AUTHENTICATION & ROLE MANAGEMENT      */}
        {/* ========================================================= */}
        {currentScreen === 'auth' && (
          <div className="flex-1 flex flex-col p-4 animate-in slide-in-from-right duration-150">
            {/* Top Bar */}
            <div className="flex items-center justify-between mb-4">
              <button 
                onClick={handleGoBack} 
                className="flex items-center gap-1.5 text-xs font-bold text-slate-700 bg-white hover:bg-slate-100 px-3 py-1.5 rounded-xl border border-slate-200 shadow-xs active:scale-95 cursor-pointer"
              >
                <ArrowLeft className="w-4 h-4" /> Home
              </button>
              <h2 className="text-xs font-black text-emerald-800 uppercase tracking-wide bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-200">
                Farm Access & Roles
              </h2>
            </div>

            <div className="space-y-4">
              {/* If Current User Session exists and not switching, show active session card */}
              {currentUser && !isSwitchingUser ? (
                <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs space-y-3">
                  <div className="flex items-center gap-3 pb-3 border-b border-slate-100">
                    <div className={`w-12 h-12 rounded-2xl text-white flex items-center justify-center font-black text-lg shadow-md ${
                      currentUserRole === 'Admin' ? 'bg-purple-600 shadow-purple-600/30' :
                      currentUserRole === 'Manager' ? 'bg-sky-600 shadow-sky-600/30' :
                      'bg-emerald-600 shadow-emerald-600/30'
                    }`}>
                      {(currentUser.userName || currentUser.name).charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="font-black text-base text-slate-900">
                          {currentUser.userName || currentUser.name}
                        </span>
                        <span className="text-[10px] bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full font-bold">
                          Active Session
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 mt-1">
                        <span className={`text-[10px] font-black px-2 py-0.5 rounded-full border ${
                          currentUserRole === 'Admin' ? 'bg-purple-50 text-purple-700 border-purple-200' :
                          currentUserRole === 'Manager' ? 'bg-sky-50 text-sky-700 border-sky-200' :
                          'bg-emerald-50 text-emerald-700 border-emerald-200'
                        }`}>
                          {currentUserRole}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Role Permissions Breakdown */}
                  <div className="p-3 bg-slate-50 rounded-xl border border-slate-200/80 space-y-2 text-xs">
                    <div className="flex items-center justify-between pb-1.5 border-b border-slate-200/60">
                      <span className="text-slate-500 font-medium">Cloud Link Configuration:</span>
                      <span className={`font-bold text-[11px] px-2 py-0.5 rounded-full border ${
                        currentUserRole === 'Admin'
                          ? 'bg-purple-50 text-purple-700 border-purple-200'
                          : 'bg-slate-200/60 text-slate-500 border-slate-300'
                      }`}>
                        {currentUserRole === 'Admin' ? '✓ Editable (Admin Only)' : '🔒 Read-Only'}
                      </span>
                    </div>

                    <div className="text-[11px] text-slate-600 space-y-1">
                      {currentUserRole === 'Admin' && (
                        <p className="text-purple-800 font-semibold">
                          🟣 Full System Control: Manage all farms, sheds, lines, drafts, and backend API endpoints.
                        </p>
                      )}
                      {currentUserRole === 'Manager' && (
                        <p className="text-sky-800 font-semibold">
                          🔵 Operational Oversight: Add/edit flock data, sheds, lines, and submit batches. Read-only cloud endpoint.
                        </p>
                      )}
                      {currentUserRole === 'Supervisor' && (
                        <p className="text-emerald-800 font-semibold">
                          🟢 Field Operations: Enter bird weights, stage drafts, edit lines, submit completed batches. Read-only cloud link.
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => setIsSwitchingUser(true)}
                      className="flex-1 bg-slate-100 hover:bg-slate-200 py-2.5 rounded-xl text-xs font-bold text-slate-700 transition cursor-pointer"
                    >
                      Switch Account / Role
                    </button>
                    <button
                      type="button"
                      onClick={handleLogout}
                      className="flex-1 bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-700 py-2.5 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1 cursor-pointer"
                    >
                      <LogOut className="w-3.5 h-3.5" /> Log Out
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <SharedLoginScreen 
                    onLoginSuccess={(user) => {
                      setIsSwitchingUser(false);
                      handleSharedLoginSuccess(user);
                    }}
                    onCancel={currentUser ? () => setIsSwitchingUser(false) : undefined}
                  />
                </div>
              )}
            </div>
          </div>
        )}
        </>
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
        {/* MODAL: CREATE NEW FARM (Part 1 & 4)                       */}
        {/* ========================================================= */}
        {showNewFarmModal && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-xs z-50 flex items-center justify-center p-4 animate-in fade-in duration-150">
            <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-sm p-5 space-y-4 shadow-2xl animate-in zoom-in-95 duration-150">
              <div className="flex justify-between items-center pb-2 border-b border-slate-100">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 bg-emerald-50 text-emerald-600 rounded-xl border border-emerald-200">
                    <Building2 className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-black text-base text-slate-900">Add New Farm</h3>
                    <p className="text-[11px] text-slate-500">Multi-Farm Cloud Synchronization</p>
                  </div>
                </div>
                <button
                  onClick={() => setShowNewFarmModal(false)}
                  className="text-slate-400 hover:text-slate-700 p-1 rounded-lg"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <form onSubmit={handleCreateFarm} className="space-y-3.5">
                <div>
                  <label className="text-[11px] font-bold text-slate-600 uppercase block mb-1">
                    Farm Unit Name *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Green Valley Farm, Salem Unit 2"
                    value={newFarmName}
                    onChange={(e) => setNewFarmName(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold text-slate-900 focus:outline-none focus:border-emerald-600 focus:bg-white transition"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[11px] font-bold text-slate-600 uppercase block mb-1">
                      Flock Date
                    </label>
                    <input
                      type="date"
                      value={newFarmFlockDate}
                      onChange={(e) => setNewFarmFlockDate(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-300 rounded-xl px-2.5 py-2 text-xs font-bold text-slate-900 focus:outline-none focus:border-emerald-600 focus:bg-white transition"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-bold text-slate-600 uppercase block mb-1">
                      Age Week
                    </label>
                    <select
                      value={newFarmAgeWeek}
                      onChange={(e) => setNewFarmAgeWeek(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-300 rounded-xl px-2 py-2 text-xs font-bold text-slate-900 focus:outline-none focus:border-emerald-600 focus:bg-white transition"
                    >
                      {Object.keys(BENCHMARKS.Summer).map((w) => (
                        <option key={w} value={w}>{w}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="text-[11px] font-bold text-slate-600 uppercase block mb-1">
                    Brood Season Standard
                  </label>
                  <select
                    value={newFarmSeason}
                    onChange={(e) => setNewFarmSeason(e.target.value as any)}
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl px-2.5 py-2 text-xs font-bold text-slate-900 focus:outline-none focus:border-emerald-600 focus:bg-white transition"
                  >
                    <option value="Summer">Summer Brooding Curve</option>
                    <option value="Winter">Winter Brooding Curve</option>
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[11px] font-bold text-slate-600 uppercase block mb-1">
                      Number of Sheds (1-20) *
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={20}
                      value={newFarmShedCount}
                      onChange={(e) => setNewFarmShedCount(Math.max(1, Math.min(20, parseInt(e.target.value) || 1)))}
                      className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold text-slate-900 focus:outline-none focus:border-emerald-600 focus:bg-white transition"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-bold text-slate-600 uppercase block mb-1">
                      Default Shed Sex Split
                    </label>
                    <select
                      value={newFarmSexSplit}
                      onChange={(e) => setNewFarmSexSplit(e.target.value as any)}
                      className="w-full bg-slate-50 border border-slate-300 rounded-xl px-2 py-2 text-xs font-bold text-slate-900 focus:outline-none focus:border-emerald-600 focus:bg-white transition"
                    >
                      <option value="last_male">Sheds 1–{Math.max(1, newFarmShedCount - 1)} ♀, Shed {newFarmShedCount} ♂</option>
                      <option value="all_female">All Female Sheds ♀</option>
                      <option value="all_male">All Male Sheds ♂</option>
                    </select>
                  </div>
                </div>

                <div className="bg-emerald-50/70 p-3 rounded-xl border border-emerald-200 text-[11px] text-emerald-800 flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                  <span>Will auto-provision {newFarmShedCount} sheds with Part A & Line 1 ready for staged weighing.</span>
                </div>

                <div className="flex gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowNewFarmModal(false)}
                    className="flex-1 bg-slate-100 hover:bg-slate-200 py-2.5 rounded-xl text-xs font-bold text-slate-700 active:scale-95 transition cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isCreatingFarm}
                    className="flex-1 bg-emerald-600 hover:bg-emerald-500 py-2.5 rounded-xl text-xs font-black text-slate-950 shadow-md shadow-emerald-600/20 active:scale-95 transition cursor-pointer flex items-center justify-center gap-1.5"
                  >
                    {isCreatingFarm ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>Creating...</span>
                      </>
                    ) : (
                      <>
                        <Plus className="w-3.5 h-3.5" />
                        <span>Create Farm</span>
                      </>
                    )}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* ========================================================= */}
        {/* MODAL: CLOUD BACKEND SETTINGS & CONNECTION TEST            */}
        {/* ========================================================= */}
        {showCloudSettingsModal && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-xs z-50 flex items-center justify-center p-4 animate-in fade-in duration-150">
            <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-sm p-5 space-y-4 shadow-2xl animate-in zoom-in-95 duration-150">
              <div className="flex justify-between items-center pb-2 border-b border-slate-100">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 bg-sky-50 text-sky-600 rounded-xl border border-sky-200">
                    <Cloud className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-black text-base text-slate-900">Cloud Sync Settings</h3>
                    <p className="text-[11px] text-slate-500">Render PostgreSQL Backend</p>
                  </div>
                </div>
                <button
                  onClick={() => setShowCloudSettingsModal(false)}
                  className="text-slate-400 hover:text-slate-700 p-1 rounded-lg"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-3">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-[11px] font-bold text-slate-600 uppercase">
                      Backend API Endpoint URL
                    </label>
                    <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full border ${
                      currentUserRole === 'Admin'
                        ? 'bg-purple-500/10 text-purple-700 border-purple-300'
                        : 'bg-slate-100 text-slate-500 border-slate-300'
                    }`}>
                      {currentUserRole === 'Admin' ? 'Editable (Admin Only)' : 'Read-Only'}
                    </span>
                  </div>
                  <input
                    type="text"
                    value={customApiUrlInput}
                    onChange={(e) => {
                      if (currentUserRole !== 'Admin') return;
                      setCustomApiUrlInput(e.target.value);
                      setCloudTestStatus('idle');
                      setCloudTestResult(null);
                    }}
                    disabled={currentUserRole !== 'Admin'}
                    placeholder="https://your-backend.onrender.com/api"
                    className={`w-full border rounded-xl px-3 py-2 text-xs font-mono font-bold focus:outline-none transition ${
                      currentUserRole === 'Admin'
                        ? 'bg-slate-50 border-slate-300 text-slate-900 focus:border-sky-600 focus:bg-white'
                        : 'bg-slate-100 border-slate-200 text-slate-400 cursor-not-allowed'
                    }`}
                  />
                  {currentUserRole !== 'Admin' && (
                    <p className="text-[10px] text-amber-600/90 italic mt-1">
                      Only Admins are permitted to modify the cloud connection link.
                    </p>
                  )}
                  <p className="text-[10px] text-slate-400 mt-1">
                    Default: {import.meta.env.VITE_API_URL || 'https://poultry-weight-backend.onrender.com/api'}
                  </p>
                </div>

                {/* Connection Status Box */}
                <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className={`w-2.5 h-2.5 rounded-full ${
                        cloudTestStatus === 'success' ? 'bg-emerald-500' :
                        cloudTestStatus === 'failed' ? 'bg-rose-500' :
                        cloudTestStatus === 'testing' ? 'bg-amber-500 animate-spin' : 'bg-slate-400'
                      }`} />
                      <span className="text-[11px] font-bold text-slate-800">
                        {cloudTestStatus === 'idle' && 'Status: Ready to test'}
                        {cloudTestStatus === 'testing' && 'Testing connection & PostgreSQL...'}
                        {cloudTestStatus === 'success' && 'Backend Service Online'}
                        {cloudTestStatus === 'failed' && 'Connection Failed'}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={handleTestCloudConnection}
                      disabled={cloudTestStatus === 'testing'}
                      className="bg-sky-600 hover:bg-sky-700 text-white border border-sky-600 px-3 py-1 rounded-lg text-[10px] font-bold active:scale-95 transition cursor-pointer shadow-xs disabled:opacity-50"
                    >
                      {cloudTestStatus === 'testing' ? 'Testing...' : 'Test Ping'}
                    </button>
                  </div>

                  {/* Detailed Diagnostics */}
                  {cloudTestResult && (
                    <div className={`text-[10px] p-2 rounded-lg border ${
                      cloudTestResult.online
                        ? cloudTestResult.databaseConnected
                          ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                          : 'bg-amber-50 border-amber-200 text-amber-800'
                        : 'bg-rose-50 border-rose-200 text-rose-800'
                    }`}>
                      {cloudTestResult.online ? (
                        <div className="space-y-0.5">
                          <p className="font-bold flex items-center gap-1">
                            ✓ Server reachable ({cloudTestResult.latencyMs || 0}ms latency)
                          </p>
                          <p>
                            Database: {cloudTestResult.databaseConnected ? (
                              <span className="font-bold text-emerald-700">✓ PostgreSQL Connected & Operational</span>
                            ) : (
                              <span className="font-bold text-amber-700">⚠️ {cloudTestResult.databaseMessage || 'PostgreSQL not connected'}</span>
                            )}
                          </p>
                        </div>
                      ) : (
                        <p className="font-semibold leading-relaxed">
                          ⚠️ {cloudTestResult.error || 'Server unreachable'}
                        </p>
                      )}
                    </div>
                  )}

                  {/* Offline Queue Notice */}
                  {pendingSyncCount > 0 && (
                    <div className="flex items-center justify-between bg-amber-50 border border-amber-200 p-2 rounded-lg text-[10px] text-amber-900">
                      <span>Offline queue: <strong>{pendingSyncCount}</strong> pending records</span>
                      <button
                        type="button"
                        onClick={flushPendingQueue}
                        className="bg-amber-600 hover:bg-amber-700 text-white font-bold px-2 py-0.5 rounded text-[10px] cursor-pointer"
                      >
                        Sync Queue
                      </button>
                    </div>
                  )}
                </div>

                <div className="text-[11px] text-slate-500 bg-slate-50 p-2.5 rounded-xl border border-slate-100 space-y-1">
                  <p className="font-bold text-slate-700">Multi-Device Real-Time Sync Tips:</p>
                  <p>• Point both phones to the exact same Backend URL.</p>
                  <p>• When you record weights on Phone A, Phone B updates in real-time.</p>
                  <p className="text-[10px] text-slate-400 pt-0.5">Note: Accepts either base URL (e.g. <code>...onrender.com</code>) or <code>/api</code> suffix.</p>
                </div>

                {currentUserRole === 'Admin' ? (
                  <div className="flex gap-2 pt-2">
                    <button
                      type="button"
                      onClick={() => {
                        localStorage.removeItem('poultry_custom_api_url');
                        setCustomApiUrlInput(getApiBaseUrl());
                        setCloudTestStatus('idle');
                        setCloudTestResult(null);
                        showToast('Reset to default URL');
                      }}
                      className="bg-slate-100 hover:bg-slate-200 py-2.5 px-3 rounded-xl text-xs font-bold text-slate-600 active:scale-95 transition cursor-pointer"
                    >
                      Reset
                    </button>
                    <button
                      type="button"
                      onClick={handleSaveCloudSettings}
                      className="flex-1 bg-sky-600 hover:bg-sky-500 py-2.5 rounded-xl text-xs font-black text-white shadow-md shadow-sky-600/20 active:scale-95 transition cursor-pointer flex items-center justify-center gap-1.5"
                    >
                      <Check className="w-3.5 h-3.5" />
                      Save & Sync Now
                    </button>
                  </div>
                ) : (
                  <div className="pt-2">
                    <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-200 text-center">
                      <p className="text-[11px] font-bold text-slate-700">Read-Only Cloud Access Mode</p>
                      <p className="text-[10px] text-slate-500 mt-0.5">
                        Only Admins can reconfigure backend endpoints. You can use "Test Ping" above to check live server & DB status.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ========================================================= */}
        {/* MODAL: DEDICATED FARM DETAILS & AUDIT VIEW (Req 4)        */}
        {/* ========================================================= */}
        {showFarmDetailsModal && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-xs z-50 flex items-center justify-center p-4 animate-in fade-in duration-150">
            <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-md p-5 space-y-4 shadow-2xl animate-in zoom-in-95 duration-150">
              <div className="flex justify-between items-center pb-2 border-b border-slate-100">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 bg-emerald-50 text-emerald-600 rounded-xl border border-emerald-200">
                    <Building2 className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-black text-base text-slate-900">Farm Details & Audit</h3>
                    <p className="text-[11px] text-slate-500">Submission & Batch History Review</p>
                  </div>
                </div>
                <button
                  onClick={() => setShowFarmDetailsModal(false)}
                  className="text-slate-400 hover:text-slate-700 p-1 rounded-lg cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Farm Switcher within Audit Modal */}
              <div>
                <label className="text-[10px] uppercase font-bold text-slate-500 block mb-1">
                  Audit Target Farm (Switch Location)
                </label>
                <select
                  value={activeFarmId}
                  onChange={(e) => switchFarm(e.target.value)}
                  className="w-full bg-slate-50 font-bold text-xs text-slate-900 rounded-xl px-3 py-2 border border-slate-300 focus:outline-none focus:border-emerald-600 cursor-pointer"
                >
                  {farmsList.map((farm) => (
                    <option key={farm.id} value={farm.id}>
                      {farm.name} ({farm.ageWeek})
                    </option>
                  ))}
                </select>
              </div>

                {/* Audit Summary Card */}
              <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-black text-slate-900 uppercase tracking-wide">
                    {farmName}
                  </span>
                  <span className={`text-[10px] px-2.5 py-0.5 rounded-full font-black border flex items-center gap-1.5 ${
                    farmStatus === 'DRAFT' 
                      ? 'bg-amber-100 text-amber-800 border-amber-300' 
                      : 'bg-emerald-100 text-emerald-800 border-emerald-300'
                  }`}>
                    {farmStatus === 'DRAFT' ? (
                      <>
                        <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse"></span>
                        <span>🟡 DRAFT ({completionStats.progressPercent}% Weighed)</span>
                      </>
                    ) : (
                      <>
                        <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                        <span>🟢 COMPLETED & SUBMITTED</span>
                      </>
                    )}
                  </span>
                </div>

                {/* Draft Progress Bar in Audit Modal */}
                <div className="bg-white p-3 rounded-xl border border-slate-200/80 space-y-1.5">
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-slate-500 font-medium">Weighing Completion:</span>
                    <span className="font-mono font-bold text-slate-900">
                      {completionStats.completedLinesCount} / {completionStats.totalLinesCount} Lines ({completionStats.progressPercent}%)
                    </span>
                  </div>
                  <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden border border-slate-200">
                    <div 
                      className={`h-full rounded-full transition-all duration-300 ${
                        farmStatus === 'COMPLETED' ? 'bg-emerald-500' : 'bg-amber-400'
                      }`}
                      style={{ width: `${completionStats.progressPercent}%` }}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="bg-white p-2.5 rounded-xl border border-slate-200/80">
                    <span className="text-[9px] uppercase font-bold text-slate-400 block">Active Sheds & Lines</span>
                    <span className="font-bold text-slate-800 text-xs">
                      {sheds.length} Sheds ({sheds.filter(s => s.type === 'Female').length}♀, {sheds.filter(s => s.type === 'Male').length}♂)
                    </span>
                    <span className="text-[10px] text-slate-500 block">
                      {completionStats.completedLinesCount}/{completionStats.totalLinesCount} Lines Weighed
                    </span>
                  </div>

                  <div className="bg-white p-2.5 rounded-xl border border-slate-200/80">
                    <span className="text-[9px] uppercase font-bold text-slate-400 block">Flock Age & Brood</span>
                    <span className="font-bold text-slate-800 text-xs">
                      Age: {ageWeek}
                    </span>
                    <span className="text-[10px] text-slate-500 block">
                      {season} Brooding Curve
                    </span>
                  </div>

                  <div className="bg-white p-2.5 rounded-xl border border-slate-200/80">
                    <span className="text-[9px] uppercase font-bold text-slate-400 block">Total Birds Sampled</span>
                    <span className="font-extrabold text-emerald-700 text-sm font-mono">
                      {sheds.reduce((acc, s) => acc + s.parts.reduce((p, pt) => p + pt.lines.reduce((l, ln) => l + ln.weights.length, 0), 0), 0)} Birds
                    </span>
                  </div>

                  <div className="bg-white p-2.5 rounded-xl border border-slate-200/80">
                    <span className="text-[9px] uppercase font-bold text-slate-400 block">Actual Average Wt</span>
                    <span className="font-bold text-slate-800 text-xs">
                      ♀ {consolidated.fStats.avg || farmAudit?.femaleAvgWeight || 0}g | ♂ {consolidated.mStats.avg || farmAudit?.maleAvgWeight || 0}g
                    </span>
                  </div>
                </div>

                {/* Last Submission Metadata */}
                <div className="bg-white p-3 rounded-xl border border-slate-200/80 space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-500 font-medium">Last Submitted By:</span>
                    <span className="font-bold text-slate-900">
                      {farmAudit?.submittedBy || farmAudit?.lastSubmittedBy || 'Not yet submitted'}
                      {farmAudit?.submittedRole || farmAudit?.lastSubmittedRole ? ` (${farmAudit.submittedRole || farmAudit.lastSubmittedRole})` : ''}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-500 font-medium">Last Submitted Date & Time:</span>
                    <span className="font-bold font-mono text-[11px] text-slate-800 text-right">
                      {farmAudit?.lastSubmittedAt 
                        ? farmAudit.lastSubmittedAt
                        : 'No submission recorded yet'}
                    </span>
                  </div>
                  {farmAudit?.lastSavedAsDraftAt && (
                    <div className="flex items-center justify-between text-xs pt-1.5 border-t border-slate-100">
                      <span className="text-slate-500 font-medium">Last Draft Saved:</span>
                      <span className="font-semibold text-slate-700 text-right text-[11px]">
                        {farmAudit.lastSavedAsDraftAt}
                        {farmAudit.lastEditedBy ? ` by ${farmAudit.lastEditedBy} (${farmAudit.lastEditedRole || 'Supervisor'})` : ''}
                      </span>
                    </div>
                  )}
                </div>

                {farmStatus === 'DRAFT' && (
                  <div className="p-2.5 bg-amber-50 rounded-xl border border-amber-200 text-[11px] text-amber-900 flex items-center justify-between">
                    <span>
                      {completionStats.incompleteLines.length > 0 
                        ? `${completionStats.incompleteLines.length} lines need weighing before submission.` 
                        : '100% Weighed! Ready for final submission.'}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        handleCompleteFarmSubmission();
                        setShowFarmDetailsModal(false);
                      }}
                      className="bg-amber-600 hover:bg-amber-700 text-white font-bold px-2.5 py-1 rounded-lg text-[10px] cursor-pointer"
                    >
                      Submit Now
                    </button>
                  </div>
                )}
              </div>

              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    setShowFarmDetailsModal(false);
                    navigateTo('history');
                  }}
                  className="flex-1 bg-slate-100 hover:bg-slate-200 py-2.5 rounded-xl text-xs font-bold text-slate-700 active:scale-95 transition cursor-pointer flex items-center justify-center gap-1.5"
                >
                  <History className="w-3.5 h-3.5" />
                  View Audit Logs
                </button>
                <button
                  type="button"
                  onClick={() => setShowFarmDetailsModal(false)}
                  className="flex-1 bg-emerald-600 hover:bg-emerald-500 py-2.5 rounded-xl text-xs font-black text-slate-950 shadow-md shadow-emerald-600/20 active:scale-95 transition cursor-pointer"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ========================================================= */}
        {/* MODAL: INCOMPLETE FARM WEIGHING PRE-SUBMIT VALIDATION (Req 1.2) */}
        {/* ========================================================= */}
        {showIncompleteAlertModal && (
          <div 
            className="fixed inset-0 bg-black/60 backdrop-blur-xs z-50 flex items-center justify-center p-4 animate-in fade-in duration-150"
            role="dialog"
            aria-modal="true"
          >
            <div className="bg-slate-900 border border-slate-700 text-slate-100 rounded-2xl w-full max-w-md p-5 space-y-4 shadow-2xl animate-in zoom-in-95 duration-150">
              <div className="flex items-center gap-3 pb-2 border-b border-slate-800">
                <div className="p-2.5 bg-amber-500/20 text-amber-400 rounded-xl border border-amber-500/30 shrink-0">
                  <AlertCircle className="w-6 h-6 animate-pulse" />
                </div>
                <div>
                  <h3 className="font-black text-base text-slate-100">
                    Incomplete Farm Weighing!
                  </h3>
                  <p className="text-xs text-amber-300 font-medium">
                    Please complete weighing for all lines before final submission.
                  </p>
                </div>
              </div>

              <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800 space-y-2.5">
                <div className="flex justify-between items-center text-xs font-bold text-slate-400 pb-1.5 border-b border-slate-800/80">
                  <span className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-amber-400"></span>
                    Missing Lines ({completionStats.incompleteLines.length})
                  </span>
                  <span className="text-amber-400 font-mono text-[11px]">
                    {completionStats.progressPercent}% Weighed
                  </span>
                </div>

                <div className="max-h-52 overflow-y-auto space-y-2 pr-1">
                  {completionStats.incompleteLines.map((line, idx) => (
                    <div 
                      key={idx} 
                      className="flex items-center justify-between bg-slate-900 px-3 py-2 rounded-lg border border-slate-800 text-xs hover:border-slate-700 transition"
                    >
                      <div className="min-w-0 pr-2">
                        <span className="font-semibold text-slate-200 block truncate">{line.path}</span>
                        <span className="text-[10px] text-rose-400 block font-medium">0 birds weighed</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => jumpToIncompleteLine(line.shedId, line.partId, line.lineId)}
                        className="bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-slate-950 font-black px-2.5 py-1 rounded-md text-[10px] shrink-0 transition cursor-pointer flex items-center gap-1"
                      >
                        <Scale className="w-3 h-3" />
                        Weigh Now
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              <p className="text-[11px] text-slate-400 leading-relaxed bg-slate-800/60 p-2.5 rounded-xl border border-slate-700/60">
                A farm session remains in <span className="text-amber-300 font-bold">🟡 DRAFT</span> mode until 100% of all designated sheds and lines have at least 1 bird weighed.
              </p>

              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setShowIncompleteAlertModal(false)}
                  className="w-full bg-slate-800 hover:bg-slate-700 active:scale-95 text-slate-200 font-bold py-2.5 rounded-xl text-xs transition cursor-pointer"
                >
                  Continue Weighing
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
