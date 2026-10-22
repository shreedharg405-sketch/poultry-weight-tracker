import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { App as CapApp } from '@capacitor/app';
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
  AlertTriangle,
  FileSpreadsheet,
  CheckCircle2,
  CheckCircle,
  LogOut,
  RefreshCw,
  Cloud,
  CloudOff,
  Lock,
  Unlock,
  Loader2,
  Check,
  History,
  User,
  LogIn,
  UserPlus,
  Radio,
  ShieldCheck,
  FileText,
  UploadCloud,
  Save,
  Grid,
  Home,
  ChevronDown
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
import { LoginScreen } from './components/LoginScreen';
import { SupervisorDashboard } from './components/SupervisorDashboard';
import { ManagerAdminDashboard } from './components/ManagerAdminDashboard';
import { DedicatedSubmitScreen } from './components/DedicatedSubmitScreen';
import { SubmissionUpdateScreen } from './components/SubmissionUpdateScreen';
import { formatDateTimeIST, formatDateIST, formatTimeIST } from './utils/dateFormatter';
import {
  applyLineWeightAddition,
  applyLineWeightDeletion,
  applyLineWeightClear,
  mergeServerShedsWithLocalDraft,
  createEmptyWeeklySheds,
  formatRecordingWeekLabel,
  getRecordingWeekDateRange
} from './utils/weightUpdateHelpers';
import { 
  cloudApi, 
  FarmSummary, 
  FarmBatch,
  FullFarmData,
  FarmAudit,
  FarmStatus,
  UserRole,
  ShedLockInfo,
  getApiBaseUrl, 
  normalizeApiUrl, 
  offlineQueue, 
  AppUser, 
  ActivityLogItem,
  sanitizeErrorMessage,
  formatEmployeeId
} from './services/cloudSyncService';

// Seasonal Target Benchmarks for all 24 Weeks
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

// Format 12-hour time (Hour:Min only, no seconds)
const formatTime12H = (d: Date): string => {
  let hours = d.getHours();
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12 || 12;
  return `${String(hours).padStart(2, '0')}:${minutes} ${ampm}`;
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

// Format activity log & audit date-time in consistent Indian Standard Time (Asia/Kolkata)
const formatLogDateTime = (isoOrDate: string | Date | undefined): string => {
  return formatDateTimeIST(isoOrDate);
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
  | 'submit_page'
  | 'auth'
  | 'submission_update';

export default function App() {
  const [currentScreen, setCurrentScreen] = useState<ScreenType>('home');
  const [showExitConfirm, setShowExitConfirm] = useState(false);

  // Full-Screen Splash & Operations Loading State (2 Seconds, Strictly Once per Session)
  const [isInitialLoading, setIsInitialLoading] = useState(() => {
    try {
      return !sessionStorage.getItem('poultry_initial_loaded');
    } catch {
      return true;
    }
  });
  const [loadingMessage, setLoadingMessage] = useState('Calibrating Shed & Line Uniformity...');
  const [isExporting, setIsExporting] = useState(false);
  const [exportMessage, setExportMessage] = useState('Generating 13-Sheet Excel Workbook...');

  // 2-Second Initial Splash Sequence (Runs strictly ONCE per session)
  useEffect(() => {
    if (!isInitialLoading) return;
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
      try {
        sessionStorage.setItem('poultry_initial_loaded', 'true');
      } catch {}
    }, 2000);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      clearTimeout(t4);
    };
  }, [isInitialLoading]);

  // Live System Clock
  const [liveTime, setLiveTime] = useState(new Date());
  const [isLiveClock, setIsLiveClock] = useState(true);

  useEffect(() => {
    if (!isLiveClock) return;
    const timer = setInterval(() => setLiveTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, [isLiveClock]);

  // Farm Profile State
  const [farmName, setFarmName] = useState<string>(() => {
    const activeId = localStorage.getItem('poultry_active_farm_id') || '';
    if (activeId) {
      try {
        const cached = localStorage.getItem('poultry_farms_list_v4') || localStorage.getItem('poultry_farms_list_v2');
        if (cached) {
          const parsed = JSON.parse(cached);
          const found = Array.isArray(parsed) && parsed.find((f: any) => f.id === activeId || f.name?.toLowerCase() === activeId.toLowerCase());
          if (found?.name) return found.name;
        }
        const localCached = localStorage.getItem(`poultry_farm_${activeId}`);
        if (localCached) {
          const parsed = JSON.parse(localCached);
          if (parsed?.farmName) return parsed.farmName;
        }
      } catch {}
    }
    return '';
  });
  const [date, setDate] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });
  const [manualTime, setManualTime] = useState('12:00');
  const [ageWeek, setAgeWeek] = useState<string>(() => {
    const activeId = localStorage.getItem('poultry_active_farm_id');
    if (activeId) {
      const savedWeek = localStorage.getItem(`poultry_active_week_${activeId}`);
      if (savedWeek) return savedWeek;
    }
    return 'W1';
  });
  const [season, setSeason] = useState<'Summer' | 'Winter'>('Summer');

  // Week number extraction for exact tolerance calculation
  const weekNum = useMemo(() => {
    const num = parseInt(ageWeek.replace(/\D/g, ''), 10);
    return isNaN(num) ? 1 : num;
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

  // Multi-Farm Management & Real-Time Cloud Sync State (Req 1 & 2)
  const [farmsList, setFarmsList] = useState<FarmSummary[]>(() => {
    const saved = localStorage.getItem('poultry_farms_list_v4') || localStorage.getItem('poultry_farms_list_v2');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed;
      } catch {}
    }
    return [];
  });
  const farmsListRef = useRef<FarmSummary[]>(farmsList);
  farmsListRef.current = farmsList;

  const [activeFarmId, setActiveFarmId] = useState<string>(() => {
    return localStorage.getItem('poultry_active_farm_id') || '';
  });
  const activeFarmIdRef = useRef<string>(activeFarmId);
  activeFarmIdRef.current = activeFarmId;

  const [syncStatus, setSyncStatus] = useState<'synced' | 'saving' | 'offline' | 'refreshing'>('synced');
  const [lastUpdatedString, setLastUpdatedString] = useState<string>('Just now');
  const [lastServerUpdatedAt, setLastServerUpdatedAt] = useState<string>('');
  const [isRefreshingCloud, setIsRefreshingCloud] = useState<boolean>(false);

  // New Farm Modal State with customizable sheds & direct gender assignment
  const [showNewFarmModal, setShowNewFarmModal] = useState<boolean>(false);
  const [newFarmName, setNewFarmName] = useState<string>('');
  const [newFarmFlockDate, setNewFarmFlockDate] = useState<string>(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });
  const [newFarmAgeWeek, setNewFarmAgeWeek] = useState<string>('W1');
  const [newFarmSeason, setNewFarmSeason] = useState<'Summer' | 'Winter'>('Summer');
  const [newFarmShedCount, setNewFarmShedCount] = useState<number | string>(10);
  const [newFarmShedCountError, setNewFarmShedCountError] = useState<string | null>(null);
  const [isCreatingFarm, setIsCreatingFarm] = useState<boolean>(false);

  // Farm -> Batch -> Week Hierarchy State
  const [activeBatchId, setActiveBatchId] = useState<string>('');
  const [activeBatchName, setActiveBatchName] = useState<string>('Batch 1');
  const [batchesList, setBatchesList] = useState<FarmBatch[]>([]);

  // Farm Audit, Draft Status & Batch Submission State
  const [farmStatus, setFarmStatus] = useState<FarmStatus>(() => {
    const activeId = localStorage.getItem('poultry_active_farm_id') || '';
    if (activeId) {
      const activeWeek = localStorage.getItem(`poultry_active_week_${activeId}`) || 'W1';
      try {
        const savedWeekStatus = localStorage.getItem(`poultry_status_${activeId}_${activeWeek}`);
        if (savedWeekStatus === 'DRAFT' || savedWeekStatus === 'UPLOADING' || savedWeekStatus === 'COMPLETED' || savedWeekStatus === 'UPLOAD_FAILED') {
          return savedWeekStatus as FarmStatus;
        }
        const saved = localStorage.getItem(`poultry_status_${activeId}`);
        if (saved === 'DRAFT' || saved === 'UPLOADING' || saved === 'COMPLETED' || saved === 'UPLOAD_FAILED') return saved as FarmStatus;
      } catch {}
    }
    return 'DRAFT';
  });
  const [uploadErrorMessage, setUploadErrorMessage] = useState<string | null>(null);
  const [showIncompleteAlertModal, setShowIncompleteAlertModal] = useState<boolean>(false);
  const [showFarmDetailsModal, setShowFarmDetailsModal] = useState<boolean>(false);
  const [isSubmittingBatch, setIsSubmittingBatch] = useState<boolean>(false);
  const [isPendingSubmission, setIsPendingSubmission] = useState<boolean>(() => {
    const activeId = localStorage.getItem('poultry_active_farm_id') || '';
    if (activeId) {
      try {
        const saved = localStorage.getItem(`poultry_pending_submission_${activeId}`);
        return saved === 'true';
      } catch {}
    }
    return false;
  });
  const [farmAudit, setFarmAudit] = useState<FarmAudit | null>(() => {
    const activeId = localStorage.getItem('poultry_active_farm_id') || '';
    if (activeId) {
      try {
        const saved = localStorage.getItem(`poultry_audit_${activeId}`);
        return saved ? JSON.parse(saved) : null;
      } catch {}
    }
    return null;
  });

  // Cloud API Settings Modal State
  const [showCloudSettingsModal, setShowCloudSettingsModal] = useState<boolean>(false);
  const [customApiUrlInput, setCustomApiUrlInput] = useState<string>(() => getApiBaseUrl());
  const [cloudTestStatus, setCloudTestStatus] = useState<'idle' | 'testing' | 'success' | 'failed'>('idle');
  const [cloudTestResult, setCloudTestResult] = useState<any>(null);
  const [pendingSyncCount, setPendingSyncCount] = useState<number>(() => offlineQueue.count());

  // Submission Update Page & Save Draft State (Req 2 & 6)
  const [updatingSubmissionId, setUpdatingSubmissionId] = useState<string | null>(null);
  const [isSavingDraft, setIsSavingDraft] = useState<boolean>(false);

  // User Authentication State (Individual Account Model + Role-Based Auto-Routing)
  const [currentUser, setCurrentUser] = useState<AppUser | null>(() => {
    const saved = localStorage.getItem('poultry_current_user');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed === 'object' && parsed.isAuthenticated) {
          const rawRole = parsed.userRole || parsed.role || 'In-Charge';
          const normalizedRole: UserRole = 
            rawRole === 'Admin' ? 'Admin' :
            (rawRole === 'Manager' || rawRole === 'Farm Manager') ? 'Manager' :
            'In-Charge';
          const name = parsed.name || parsed.userName || 'Operator';
          return {
            id: parsed.id || 'u-user-1',
            username: parsed.username || name.toLowerCase().replace(/\s+/g, '.'),
            name,
            userName: name,
            email: parsed.email || `${name.toLowerCase().replace(/\s+/g, '.')}@farm.local`,
            role: normalizedRole,
            userRole: normalizedRole,
            status: parsed.status || 'ACTIVE',
            assignedFarms: parsed.assignedFarms || [],
            isAuthenticated: true,
          };
        }
      } catch {}
    }
    return null;
  });

  const currentUserRole: UserRole = useMemo(() => {
    if (!currentUser) return 'Supervisor';
    const r = (currentUser.role || currentUser.userRole || '').toString().toUpperCase();
    if (r === 'ADMIN') return 'Admin';
    if (r === 'MANAGER' || r === 'FARM MANAGER') return 'Manager';
    if (r === 'INCHARGE' || r === 'IN-CHARGE') return 'In-Charge';
    return 'Supervisor';
  }, [currentUser]);

  const isFieldWorker = currentUserRole === 'Supervisor';


  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(() => {
    try {
      const token = localStorage.getItem('poultry_auth_token');
      const savedUser = localStorage.getItem('poultry_current_user');
      if (token && savedUser) {
        const parsed = JSON.parse(savedUser);
        return !!(parsed && parsed.isAuthenticated);
      }
    } catch {}
    return false;
  });

  const isAddingPartRef = useRef(false);
  const isAddingLineRef = useRef(false);
  const isLoggingOutRef = useRef(false);
  const isAuthenticatedRef = useRef(isAuthenticated);
  isAuthenticatedRef.current = isAuthenticated;

  // Session verification on mount with backend validation
  useEffect(() => {
    const token = localStorage.getItem('poultry_auth_token');
    if (token) {
      cloudApi.getMe(token).then(res => {
        if (res && res.user) {
          const u = res.user;
          const normalizedRole: UserRole = 
            u.role === 'Admin' ? 'Admin' :
            u.role === 'Manager' ? 'Manager' :
            (u.role === 'In-Charge' || u.role === 'Incharge') ? 'In-Charge' : 'Supervisor';
          const authUser: AppUser = {
            id: u.id,
            username: u.username,
            name: u.name,
            userName: u.name,
            email: u.email || `${u.username}@farm.local`,
            role: normalizedRole,
            userRole: normalizedRole,
            status: u.status,
            assignedFarms: u.assignedFarms || [],
            isAuthenticated: true,
          };
          setCurrentUser(authUser);
          localStorage.setItem('poultry_current_user', JSON.stringify(authUser));
          setIsAuthenticated(true);
        }
      }).catch(err => {
        console.warn('Session verification fallback/error:', err);
        if (err?.message?.includes('Invalid') || err?.message?.includes('expired') || err?.status === 401) {
          handleLogout();
        }
      });
    }
  }, []);

  // Save farmsList changes locally
  useEffect(() => {
    localStorage.setItem('poultry_farms_list_v2', JSON.stringify(farmsList));
  }, [farmsList]);

  // Farm Access Assignment filtering: Admins and Managers see all farms;
  // Farm Access Assignment filtering: Admins see all; Managers see authorized scope;
  // Supervisors and In-Charges see ONLY explicitly assigned farms (Req 8)
  const accessibleFarms = useMemo(() => {
    // Only return existing, active (non-deleted and non-archived) farms (Task 3)
    const activeFarms = (farmsList || []).filter(f => f && !f.isArchived && !(f as any).isDeleted);

    if (currentUserRole === 'Admin' || currentUserRole === 'Manager' || currentUserRole === 'In-Charge') {
      return activeFarms;
    }
    const currentName = (currentUser?.userName || currentUser?.name || '').trim().toLowerCase();
    const currentUsername = (currentUser?.username || '').trim().toLowerCase();
    const assignedIds = (currentUser?.assignedFarms || []).concat(currentUser?.assignedFarmId ? [currentUser.assignedFarmId] : []);

    return activeFarms.filter(f => {
      // 1. Direct farm ID match from user's account assignedFarms
      if (assignedIds.includes(f.id) || assignedIds.includes(f.name)) return true;
      // 2. Name or username match in farm's assignedUserNames
      if (!f.assignedUserNames || f.assignedUserNames.length === 0) return false;
      return f.assignedUserNames.some(u => {
        const uLower = u.toLowerCase();
        const uNorm = uLower.replace(/\s*\(.*?\)/g, '').trim();
        const curNorm = currentName.replace(/\s*\(.*?\)/g, '').trim();
        return (
          (currentName && (uLower.includes(currentName) || currentName.includes(uNorm) || uNorm.includes(curNorm))) ||
          (currentUsername && (uLower.includes(currentUsername) || uNorm === currentUsername))
        );
      });
    });
  }, [currentUserRole, currentUser, farmsList]);

  // Supervisor Workspace Resolution:
  // Never resolve a Supervisor's farm using a global activeFarmId or isActiveUnit flag.
  // Always load the farm directly linked to the logged-in Supervisor's account.
  useEffect(() => {
    if (currentUserRole === 'Supervisor') {
      if (accessibleFarms.length > 0) {
        const assignedTarget = currentUser?.assignedFarmId || 
          (currentUser?.assignedFarms?.find(af => af && af !== '*'));
        
        const targetFarm = (assignedTarget 
          ? accessibleFarms.find(f => f.id === assignedTarget || f.name === assignedTarget)
          : null) || accessibleFarms[0];

        if (targetFarm && targetFarm.id !== activeFarmId) {
          switchFarm(targetFarm.id, true);
        }
      }
    }
  }, [accessibleFarms, currentUser, currentUserRole]);

  // Current active farm summary object (Direct resolution for Supervisor to their assigned farm)
  const currentActiveFarmSummary = useMemo(() => {
    let base: FarmSummary | null = null;
    if (currentUserRole === 'Supervisor') {
      if (accessibleFarms.length === 0) return null;
      const assignedTarget = currentUser?.assignedFarmId || 
        (currentUser?.assignedFarms?.find(af => af && af !== '*'));
      base = (assignedTarget 
        ? accessibleFarms.find(f => f.id === assignedTarget || f.name === assignedTarget)
        : null) || accessibleFarms[0] || null;
    } else {
      base = accessibleFarms.find(f => f.id === activeFarmId) || accessibleFarms[0] || null;
    }
    if (!base) return null;
    const initialWeekStr = base.activeBatch?.startWeekNumber ? `W${base.activeBatch.startWeekNumber}` : (base.initialAgeWeek || base.startingWeek || base.ageWeek || 'W1');
    const startWeekNum = base.activeBatch?.startWeekNumber || base.startWeekNumber || parseInt(initialWeekStr.replace(/\D/g, ''), 10) || 1;
    const batchStartDate = base.activeBatch?.startDate || base.startDate || base.flockDate;
    return {
      ...base,
      batchId: base.activeBatch?.id || activeBatchId || base.batchId,
      batchName: base.activeBatch?.batchName || activeBatchName || base.batchName || 'Batch 1',
      activeBatch: base.activeBatch || (activeBatchId ? { id: activeBatchId, farmId: base.id, batchName: activeBatchName, startDate: batchStartDate, startWeekNumber: startWeekNum, status: 'ACTIVE' as const } : undefined),
      startDate: batchStartDate,
      initialAgeWeek: initialWeekStr,
      startingWeek: initialWeekStr,
      startWeekNumber: startWeekNum,
      ageWeek: ageWeek || initialWeekStr || base.ageWeek || 'W1',
    };
  }, [accessibleFarms, activeFarmId, currentUserRole, ageWeek, activeBatchId, activeBatchName]);

  // Farm Assignment Hub handler for Managers & Admins
  const handleAssignUserToFarm = (farmId: string, assignedUsers: string[]) => {
    setFarmsList(prev => prev.map(f => f.id === farmId ? { ...f, assignedUserNames: assignedUsers } : f));
    const target = farmsList.find(f => f.id === farmId);
    showToast(`Updated operator assignments for ${target?.name || 'farm'}`);
    cloudApi.getFarms().then(remoteFarms => {
      if (remoteFarms && remoteFarms.length > 0) {
        setFarmsList(remoteFarms);
      }
    }).catch(() => {});
  };

  // Login Success Handler (Stores JWT Token & User Profile, Auto-Routes by Role)
  const handleLoginSuccess = (user: AppUser, token: string) => {
    const rawRole = (user.role || user.userRole || 'Supervisor').toString().toUpperCase();
    const normalizedRole: UserRole = 
      rawRole === 'ADMIN' ? 'Admin' :
      rawRole === 'MANAGER' ? 'Manager' :
      (rawRole === 'INCHARGE' || rawRole === 'IN-CHARGE') ? 'In-Charge' :
      'Supervisor';

    const authUser: AppUser = {
      ...user,
      userName: user.name || user.userName || user.username,
      role: normalizedRole,
      userRole: normalizedRole,
      isAuthenticated: true,
    };
    setCurrentUser(authUser);
    localStorage.setItem('poultry_auth_token', token);
    localStorage.setItem('poultry_current_user', JSON.stringify(authUser));
    setIsAuthenticated(true);
    isAuthenticatedRef.current = true;
    showToast(`Welcome, ${authUser.name} (${authUser.role})!`);
    setCurrentScreen('home');
    currentScreenRef.current = 'home';
    try {
      window.history.replaceState({ screen: 'home' }, '', '#home');
    } catch {}
  };

  const handleOpenNewFarmModal = () => {
    if (currentUserRole === 'Supervisor') {
      showToast('Restricted: Manager or In-Charge permission required to create new farms.');
      return;
    }
    setShowNewFarmModal(true);
  };

  // Consolidated Batch Activity History Logs (Eliminating per-bird entries)
  const [activityLogs, setActivityLogs] = useState<ActivityLogItem[]>(() => {
    const saved = localStorage.getItem('poultry_activity_logs_v1');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed;
      } catch {}
    }
    return [];
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



  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const handleLogout = () => {
    if (isLoggingOut || isLoggingOutRef.current) return;
    setIsLoggingOut(true);
    isLoggingOutRef.current = true;
    setShowExitConfirm(false);

    // 1. Revoke server session asynchronously in background without blocking UI
    if (activeLockedShedIdRef.current) {
      cloudApi.leaveShed(activeLockedShedIdRef.current, {
        recordedByUserId: currentUser?.id,
        recordedByUserName: currentUser?.name,
        hasRecordedWeights: true,
      }).catch(() => {});
      activeLockedShedIdRef.current = null;
      setActiveLockedShedId(null);
    }
    cloudApi.logout().catch(() => {});

    // 2. Clear client session credentials immediately (leaving drafts intact)
    localStorage.removeItem('poultry_auth_token');
    localStorage.removeItem('poultry_current_user');
    setCurrentUser(null);
    setIsAuthenticated(false);
    isAuthenticatedRef.current = false;

    // 3. Navigate immediately to login page (#auth) without triggering Exit dialog
    setCurrentScreen('auth');
    currentScreenRef.current = 'auth';
    try {
      window.history.replaceState({ screen: 'auth' }, '', '#auth');
    } catch {}

    showToast('Logged out successfully.');
    setTimeout(() => {
      setIsLoggingOut(false);
      isLoggingOutRef.current = false;
    }, 400);
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
  const [selectedShedId, setSelectedShedId] = useState<string>('');
  const [selectedPartId, setSelectedPartId] = useState<string>('');
  const [selectedLineId, setSelectedLineId] = useState<number | string>('');
  const [inputWeight, setInputWeight] = useState('');
  const [inputWeightError, setInputWeightError] = useState<string | null>(null);
  const [isSubmittingWeight, setIsSubmittingWeight] = useState(false);
  const isSubmittingWeightRef = useRef(false);
  const isCreatingFarmRef = useRef(false);
  const isAddingShedRef = useRef(false);
  const weightInputRef = useRef<HTMLInputElement>(null);

  // Strict Manual Entry: Always keep input empty by default for new bird entries
  useEffect(() => {
    setInputWeight('');
    setInputWeightError(null);
  }, [selectedLineId, selectedPartId, selectedShedId]);

  // Modals & In-App Confirmations
  const [showAddShedModal, setShowAddShedModal] = useState(false);
  const [newShedName, setNewShedName] = useState('');
  const [newShedType, setNewShedType] = useState<'Female' | 'Male'>('Female');
  const [editingShed, setEditingShed] = useState<{ id: string; name: string; type: 'Female' | 'Male' } | null>(null);
  const [editingPart, setEditingPart] = useState<{ id: string; name: string } | null>(null);
  const [partPendingDelete, setPartPendingDelete] = useState<{ id: string; name: string; totalWeights: number } | null>(null);
  const [linePendingDelete, setLinePendingDelete] = useState<{ id: number | string; name: string; weights: number[] } | null>(null);
  const [shedPendingDelete, setShedPendingDelete] = useState<{ id: string; name: string; totalWeights: number } | null>(null);

  // Edit Farm Name Modal State (Accessible across all authorized roles)
  const [showEditFarmModal, setShowEditFarmModal] = useState<boolean>(false);
  const [editFarmNameInput, setEditFarmNameInput] = useState<string>('');
  const [editFarmNameError, setEditFarmNameError] = useState<string | null>(null);
  const [isSavingFarmName, setIsSavingFarmName] = useState<boolean>(false);

  // Toast Notification State
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3800);
  };

  // Shed Gender Filter State (All / Female / Male) - Req 9
  const [shedGenderFilter, setShedGenderFilter] = useState<'ALL' | 'FEMALE' | 'MALE'>('ALL');

  // Shed Concurrency Locking, Live Presence & Collision Notification State
  const [shedLocks, setShedLocks] = useState<Record<string, ShedLockInfo>>({});
  const [activeLockedShedId, setActiveLockedShedId] = useState<string | null>(null);
  const activeLockedShedIdRef = useRef<string | null>(null);
  activeLockedShedIdRef.current = activeLockedShedId;
  const [collisionModalData, setCollisionModalData] = useState<{
    shedName: string;
    lockedByUserName: string;
    lockedByUserId?: string;
    shedId: string;
  } | null>(null);
  const [isEnteringShed, setIsEnteringShed] = useState<string | null>(null);
  const [isForceUnlockingShed, setIsForceUnlockingShed] = useState<string | null>(null);
  const lastUserInteractionTimestampRef = useRef<number>(Date.now());

  // Dynamic Sheds Hierarchy - Authoritative Data from Database / Cache, No Hardcoded Defaults
  const [sheds, setSheds] = useState<ShedData[]>(() => {
    const activeId = localStorage.getItem('poultry_active_farm_id');
    if (activeId) {
      const activeWeek = localStorage.getItem(`poultry_active_week_${activeId}`) || 'W1';
      try {
        const weekDraftStr = localStorage.getItem(`poultry_draft_${activeId}_${activeWeek}`);
        if (weekDraftStr) {
          const parsedWeek = JSON.parse(weekDraftStr);
          const shedsArr = Array.isArray(parsedWeek?.sheds) ? parsedWeek.sheds : (Array.isArray(parsedWeek) ? parsedWeek : null);
          if (shedsArr && shedsArr.length > 0) {
            return shedsArr;
          }
        }
        const weekFarmStr = localStorage.getItem(`poultry_farm_${activeId}_${activeWeek}`);
        if (weekFarmStr) {
          const parsedWeekFarm = JSON.parse(weekFarmStr);
          if (Array.isArray(parsedWeekFarm?.sheds) && parsedWeekFarm.sheds.length > 0) {
            return parsedWeekFarm.sheds;
          }
        }
        // Base structural fallback for structural IDs: strictly reset weights to []
        const saved = localStorage.getItem(`poultry_farm_${activeId}`);
        if (saved) {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed?.sheds)) return createEmptyWeeklySheds(parsed.sheds);
        }
      } catch {}
    }
    return [];
  });

  // Hardware Back Button & Mobile Popstate Routing Trap with Hash Navigation
  const currentScreenRef = useRef<ScreenType>('home');
  currentScreenRef.current = currentScreen;
  const handleGoBackRef = useRef<() => void>(() => {});

  const selectedShedIdRef = useRef(selectedShedId);
  selectedShedIdRef.current = selectedShedId;

  const selectedPartIdRef = useRef(selectedPartId);
  selectedPartIdRef.current = selectedPartId;

  const selectedLineIdRef = useRef(selectedLineId);
  selectedLineIdRef.current = selectedLineId;

  const shedsRef = useRef<ShedData[]>(sheds);
  shedsRef.current = sheds;

  // Strict step-by-step backward hierarchy (Req 2)
  // Entering: home -> shed_select -> part_select -> line_select -> weigh_pad
  // Swiping back: weigh_pad -> line_select -> part_select -> shed_select -> home
  const getParentScreen = (screen: ScreenType): ScreenType => {
    switch (screen) {
      case 'weigh_pad':
        return 'line_select';
      case 'line_select':
        return 'part_select';
      case 'part_select':
        return (currentUserRole === 'Supervisor') ? 'home' : 'shed_select';
      case 'shed_select':
        return 'home';
      case 'submit_page':
        return 'home';
      case 'conclusion':
        return 'home';
      case 'submission_update':
        return 'history';
      case 'history':
        return 'home';
      case 'sheds_manage':
        return 'home';
      case 'setup':
        return 'home';
      case 'auth':
        return 'home';
      default:
        return 'home';
    }
  };

  const getHashForScreen = (screen: ScreenType): string => {
    switch (screen) {
      case 'weigh_pad': return '#weigh';
      case 'line_select': return '#lines';
      case 'part_select': return '#parts';
      case 'shed_select': return '#sheds';
      case 'conclusion': return '#conclusion';
      case 'submit_page': return '#submit';
      case 'history': return '#submissions';
      case 'submission_update': return updatingSubmissionId ? `#submission-update?id=${updatingSubmissionId}` : '#submission-update';
      case 'sheds_manage': return '#manage';
      case 'setup': return '#setup';
      case 'auth': return '#auth';
      case 'home':
      default:
        return '#home';
    }
  };

  const getScreenFromHash = (hash: string): ScreenType | null => {
    if (!hash || hash === '#home' || hash === '#') return 'home';
    if (hash.startsWith('#weigh')) return 'weigh_pad';
    if (hash.startsWith('#lines')) return 'line_select';
    if (hash.startsWith('#parts')) return 'part_select';
    if (hash.startsWith('#sheds')) return 'shed_select';
    if (hash.startsWith('#submit')) return 'submit_page';
    if (hash.startsWith('#conclusion')) return 'conclusion';
    if (hash.startsWith('#submissions') || hash.startsWith('#history')) return 'history';
    if (hash.startsWith('#submission-update')) return 'submission_update';
    if (hash.startsWith('#manage')) return 'sheds_manage';
    if (hash.startsWith('#setup')) return 'setup';
    if (hash.startsWith('#auth')) return 'auth';
    return null;
  };

  const handlePopState = (event?: PopStateEvent) => {
    // If not authenticated or during logout: suppress all navigation & exit confirmations, keep safely on #auth
    if (isLoggingOutRef.current || !isAuthenticatedRef.current || !localStorage.getItem('poultry_auth_token')) {
      setShowExitConfirm(false);
      setCurrentScreen('auth');
      currentScreenRef.current = 'auth';
      try {
        window.history.replaceState({ screen: 'auth' }, '', '#auth');
      } catch {}
      return;
    }

    const targetState = event?.state as { screen?: ScreenType; shedId?: string; partId?: string; lineId?: number | string } | null;

    // Restore hierarchy identifiers from event state if available
    if (targetState?.shedId) setSelectedShedId(targetState.shedId);
    if (targetState?.partId) setSelectedPartId(targetState.partId);
    if (targetState?.lineId !== undefined) setSelectedLineId(targetState.lineId);

    const targetScreen = targetState?.screen || getScreenFromHash(window.location.hash) || 'home';

    const isShedScreen = (s?: ScreenType | null) => s === 'part_select' || s === 'line_select' || s === 'weigh_pad';
    if (activeLockedShedIdRef.current && (!isShedScreen(targetScreen) || (targetState?.shedId && targetState.shedId !== activeLockedShedIdRef.current))) {
      releaseCurrentShedLock();
    }

    // If active screen is already 'home' and navigating back at root: trigger Exit confirmation
    if (currentScreenRef.current === 'home' && targetScreen === 'home' && event) {
      setShowExitConfirm(true);
      window.history.pushState({ screen: 'home' }, '', '#home');
      return;
    }

    // Otherwise navigate smoothly without exit confirmation
    setShowExitConfirm(false);

    if (targetScreen === 'setup' && currentUserRole === 'Supervisor') {
      setCurrentScreen('home');
      currentScreenRef.current = 'home';
      showToast('Permission Denied: System configurations are restricted to Administrator and Manager.');
      return;
    }

    setCurrentScreen(targetScreen);
    currentScreenRef.current = targetScreen;
  };

  useEffect(() => {
    // Prime root state with hash or parse existing shared link hash
    if (!window.location.hash || window.location.hash === '#home' || window.location.hash === '#') {
      window.history.replaceState({ screen: 'home' }, '', '#home');
      window.history.pushState({ screen: 'home' }, '', '#home');
    } else {
      // Direct deep link restoration (e.g., #submissions, #submission-update?id=...)
      handlePopState();
    }

    window.addEventListener('popstate', handlePopState);

    // Capacitor hardware back button & Android swipe-back handler
    let capBackButtonHandle: any = null;
    const initCapacitorBack = async () => {
      try {
        capBackButtonHandle = await CapApp.addListener('backButton', () => {
          if (!isAuthenticatedRef.current) return;
          const active = currentScreenRef.current;
          if (active === 'home') {
            setShowExitConfirm(true);
            window.history.pushState({ screen: 'home' }, '', '#home');
          } else {
            handleGoBackRef.current();
          }
        });
      } catch {
        // Ignored in standard browser environment
      }
    };
    initCapacitorBack();

    return () => {
      window.removeEventListener('popstate', handlePopState);
      if (capBackButtonHandle && typeof capBackButtonHandle.remove === 'function') {
        capBackButtonHandle.remove();
      }
    };
  }, []);

  // Release Shed Concurrency Lock
  const releaseCurrentShedLock = useCallback(async (targetShedId?: string) => {
    const shedId = targetShedId || activeLockedShedIdRef.current;
    if (!shedId) return;

    setActiveLockedShedId(null);
    activeLockedShedIdRef.current = null;

    const currentShed = shedsRef.current.find(s => s.id === shedId) || sheds.find(s => s.id === shedId);
    const sAllWeights = (currentShed?.parts || []).flatMap(p => (p.lines || []).flatMap(l => l.weights || []));
    const hasWeights = sAllWeights.length > 0;
    const currentUserId = currentUser?.id || 'offline-incharge';
    const currentUserName = currentUser?.userName || currentUser?.name || currentUser?.username || 'Incharge';

    try {
      await cloudApi.leaveShed(shedId, {
        recordedByUserId: hasWeights ? currentUserId : undefined,
        recordedByUserName: hasWeights ? currentUserName : undefined,
        hasRecordedWeights: hasWeights,
      });

      if (hasWeights) {
        setSheds(prev => prev.map(s => s.id === shedId ? {
          ...s,
          recordedByUserId: currentUserId,
          recordedByUserName: currentUserName,
          lockedByUserId: null,
          lockedByUserName: null,
          lockedAt: null,
          lastHeartbeatAt: null,
        } : s));
      }
    } catch (err) {
      console.warn('Error releasing shed lock:', err);
    }
  }, [sheds, currentUser]);

  // Dedicated Home Navigation: always directly returns to Dashboard Home
  const handleGoHome = useCallback(() => {
    if (activeLockedShedIdRef.current) {
      releaseCurrentShedLock();
    }
    setShowExitConfirm(false);
    setCurrentScreen('home');
    currentScreenRef.current = 'home';
    window.history.pushState({ screen: 'home' }, '', '#home');
  }, [releaseCurrentShedLock]);

  // Consistent UI Back Button handler: steps down hierarchical level identically to swipe back
  const handleGoBack = useCallback(() => {
    if (!isAuthenticatedRef.current || currentScreenRef.current === 'auth') {
      setShowExitConfirm(false);
      return;
    }
    const active = currentScreenRef.current;
    if (active === 'home') {
      setShowExitConfirm(true);
      return;
    }
    const parent = getParentScreen(active);
    const isShedScreen = (s?: ScreenType | null) => s === 'part_select' || s === 'line_select' || s === 'weigh_pad';
    if (activeLockedShedIdRef.current && !isShedScreen(parent)) {
      releaseCurrentShedLock();
    }
    setCurrentScreen(parent);
    currentScreenRef.current = parent;
    window.history.pushState(
      { screen: parent, shedId: selectedShedIdRef.current, partId: selectedPartIdRef.current },
      '',
      getHashForScreen(parent)
    );
  }, [releaseCurrentShedLock]);
  handleGoBackRef.current = handleGoBack;

  // Synchronized Forward Navigation Helpers with Hash Anchors (Recognized by Android Chrome)
  const navigateToShedSelect = () => {
    if (activeLockedShedIdRef.current) {
      releaseCurrentShedLock();
    }
    setCurrentScreen('shed_select');
    window.history.pushState({ screen: 'shed_select' }, '', '#sheds');
  };

  const navigateToPartSelect = (shedId: string, partId?: string) => {
    setSelectedShedId(shedId);
    const destShed = sheds.find(s => s.id === shedId);
    const destPart = partId
      ? destShed?.parts?.find(p => p.id === partId)
      : destShed?.parts?.[0];
    const resolvedPartId = destPart?.id || partId || '';
    if (resolvedPartId) setSelectedPartId(resolvedPartId);
    if (destPart?.lines?.[0]) {
      setSelectedLineId(destPart.lines[0].id);
    } else {
      setSelectedLineId('');
    }
    setCurrentScreen('part_select');
    window.history.pushState({ screen: 'part_select', shedId, partId: resolvedPartId }, '', '#parts');
  };

  const navigateToLineSelect = (shedId: string, partId: string, lineId?: number | string) => {
    setSelectedShedId(shedId);
    setSelectedPartId(partId);
    const destShed = sheds.find(s => s.id === shedId);
    const destPart = destShed?.parts?.find(p => p.id === partId);
    const resolvedLineId = lineId !== undefined
      ? lineId
      : (destPart?.lines?.[0]?.id ?? '');
    setSelectedLineId(resolvedLineId);
    setCurrentScreen('line_select');
    window.history.pushState({ screen: 'line_select', shedId, partId, lineId: resolvedLineId }, '', '#lines');
  };

  const navigateToWeighPad = (shedId: string, partId: string, lineId: number | string) => {
    setSelectedShedId(shedId);
    setSelectedPartId(partId);
    setSelectedLineId(lineId);
    setCurrentScreen('weigh_pad');
    window.history.pushState({ screen: 'weigh_pad', shedId, partId, lineId }, '', '#weigh');
  };

  const navigateTo = (screen: ScreenType) => {
    // Permission guard (Req 1 & 6)
    if (screen === 'setup' && currentUserRole === 'Supervisor') {
      showToast('Permission Denied: System configurations are restricted to Administrator and Manager.');
      return;
    }

    const isShedScreen = (s?: ScreenType | null) => s === 'part_select' || s === 'line_select' || s === 'weigh_pad';
    if (activeLockedShedIdRef.current && !isShedScreen(screen)) {
      releaseCurrentShedLock();
    }

    setCurrentScreen(screen);
    const hash = screen === 'conclusion' ? '#conclusion' 
      : screen === 'sheds_manage' ? '#manage' 
      : screen === 'setup' ? '#setup' 
      : screen === 'shed_select' ? '#sheds' 
      : screen === 'history' ? '#submissions'
      : screen === 'submit_page' ? '#submit'
      : screen === 'auth' ? '#auth'
      : screen === 'submission_update' ? (updatingSubmissionId ? `#submission-update?id=${updatingSubmissionId}` : '#submission-update')
      : '#home';
    window.history.pushState({ screen }, '', hash);
  };

  // Enter Shed with Concurrency Lock & Collision Guard
  const handleEnterShed = async (s: ShedData) => {
    const lock = shedLocks[s.id];
    const currentUserId = currentUser?.id;
    const isLockedByOther = Boolean(
      lock?.locked &&
      lock.lockedByUserId &&
      lock.lockedByUserId !== currentUserId
    );

    if (isLockedByOther) {
      const lockedUserName = lock?.lockedByUserName || 'Another Incharge';
      setCollisionModalData({
        shedName: s.name,
        lockedByUserName: lockedUserName,
        lockedByUserId: lock?.lockedByUserId || undefined,
        shedId: s.id,
      });
      showToast(`⚠️ ${s.name} is currently being weighed by ${lockedUserName}. Only one Incharge can enter a shed at a time.`);
      return;
    }

    setIsEnteringShed(s.id);
    try {
      const res = await cloudApi.enterShed(s.id, {
        id: currentUser?.id,
        name: currentUser?.userName || currentUser?.name || currentUser?.username || 'Incharge',
        week: ageWeek,
        batchId: activeBatchId || undefined,
      });

      setActiveLockedShedId(s.id);
      activeLockedShedIdRef.current = s.id;
      lastUserInteractionTimestampRef.current = Date.now();

      setShedLocks(prev => ({
        ...prev,
        [s.id]: {
          ...res,
          shedName: s.name,
        }
      }));

      navigateToPartSelect(s.id, s.parts[0]?.id || 'part-1-a');
    } catch (err: any) {
      if (err.status === 409 || err.collisionData) {
        const colData = err.collisionData || {};
        const lockedUserName = colData.lockedByUserName || err.message || 'another Incharge';
        setCollisionModalData({
          shedName: s.name,
          lockedByUserName: lockedUserName,
          lockedByUserId: colData.lockedByUserId,
          shedId: s.id,
        });
        showToast(`⚠️ ${s.name} is currently being weighed by ${lockedUserName}. Only one Incharge can enter a shed at a time.`);
        if (activeFarmId) {
          cloudApi.getShedLocks(activeFarmId, ageWeek).then(data => {
            if (data?.locks) setShedLocks(data.locks);
          }).catch(() => {});
        }
      } else {
        showToast(err.message || 'Failed to enter shed');
      }
    } finally {
      setIsEnteringShed(null);
    }
  };

  // Supervisor / Admin Manual Force Unlock Override
  const handleForceUnlock = async (shedId: string, shedName?: string) => {
    setIsForceUnlockingShed(shedId);
    try {
      await cloudApi.forceUnlockShed(shedId, currentUserRole);
      showToast(`Shed ${shedName || ''} unlocked successfully.`);
      setCollisionModalData(null);
      if (activeLockedShedIdRef.current === shedId) {
        setActiveLockedShedId(null);
        activeLockedShedIdRef.current = null;
      }
      if (activeFarmId) {
        const data = await cloudApi.getShedLocks(activeFarmId, ageWeek);
        if (data?.locks) setShedLocks(data.locks);
      }
    } catch (err: any) {
      showToast(err.message || 'Failed to force unlock shed');
    } finally {
      setIsForceUnlockingShed(null);
    }
  };

  // 1. User activity tracker for 2-minute inactivity auto-release
  useEffect(() => {
    const handleUserActivity = () => {
      lastUserInteractionTimestampRef.current = Date.now();
    };

    window.addEventListener('pointerdown', handleUserActivity, { passive: true });
    window.addEventListener('keydown', handleUserActivity, { passive: true });
    window.addEventListener('touchstart', handleUserActivity, { passive: true });
    window.addEventListener('scroll', handleUserActivity, { passive: true });

    return () => {
      window.removeEventListener('pointerdown', handleUserActivity);
      window.removeEventListener('keydown', handleUserActivity);
      window.removeEventListener('touchstart', handleUserActivity);
      window.removeEventListener('scroll', handleUserActivity);
    };
  }, []);

  // 2. Shed Keep-Alive Heartbeat (every 30s) + 2-minute Inactivity Auto-Release
  useEffect(() => {
    if (!activeLockedShedId) return;

    const intervalId = setInterval(async () => {
      const currentShedId = activeLockedShedIdRef.current;
      if (!currentShedId) return;

      // Check if 2 minutes (120,000ms) of inactivity has elapsed
      const inactiveDuration = Date.now() - lastUserInteractionTimestampRef.current;
      if (inactiveDuration >= 120_000) {
        console.warn(`[Lock] Auto-releasing shed ${currentShedId} due to 2 minutes of inactivity.`);
        await releaseCurrentShedLock(currentShedId);
        showToast('⚠️ Session timed out after 2 minutes of inactivity. Shed lock was released.');
        navigateToShedSelect();
        return;
      }

      // Otherwise send keep-alive heartbeat
      try {
        await cloudApi.heartbeatShed(currentShedId, {
          id: currentUser?.id,
          name: currentUser?.userName || currentUser?.name || currentUser?.username || 'Incharge',
        });
      } catch (err: any) {
        if (err.status === 409) {
          showToast('⚠️ Your lock on this shed expired or was superseded.');
          setActiveLockedShedId(null);
          activeLockedShedIdRef.current = null;
          navigateToShedSelect();
        }
      }
    }, 30_000);

    return () => {
      clearInterval(intervalId);
    };
  }, [activeLockedShedId, currentUser, releaseCurrentShedLock]);

  // 3. 5-second polling on Shed Selection and Home screens for live presence & team save progress badges
  useEffect(() => {
    if ((currentScreen !== 'shed_select' && currentScreen !== 'home') || !activeFarmId) return;

    const fetchLocks = async () => {
      try {
        const res = await cloudApi.getShedLocks(activeFarmId, ageWeek);
        if (res && res.locks) {
          setShedLocks(res.locks);
        }
      } catch (err) {
        console.warn('Failed to poll shed locks:', err);
      }
    };

    fetchLocks();
    const intervalId = setInterval(fetchLocks, 5_000);

    return () => {
      clearInterval(intervalId);
    };
  }, [currentScreen, activeFarmId, ageWeek]);

  // 4. Page Unload / Hide cleanup: sendBeacon / keepalive lock release
  useEffect(() => {
    const handlePageUnload = () => {
      const currentShedId = activeLockedShedIdRef.current;
      if (!currentShedId) return;

      const currentUserId = currentUser?.id || 'offline-incharge';
      const currentUserName = currentUser?.userName || currentUser?.name || currentUser?.username || 'Incharge';

      try {
        const url = `${getApiBaseUrl()}/sheds/${currentShedId}/leave`;
        const payload = JSON.stringify({
          recordedByUserId: currentUserId,
          recordedByUserName: currentUserName,
        });
        if (navigator.sendBeacon) {
          const blob = new Blob([payload], { type: 'application/json' });
          navigator.sendBeacon(url, blob);
        } else {
          cloudApi.leaveShed(currentShedId, {
            recordedByUserId: currentUserId,
            recordedByUserName: currentUserName,
          });
        }
      } catch {
        cloudApi.leaveShed(currentShedId);
      }
    };

    window.addEventListener('beforeunload', handlePageUnload);
    window.addEventListener('pagehide', handlePageUnload);

    return () => {
      window.removeEventListener('beforeunload', handlePageUnload);
      window.removeEventListener('pagehide', handlePageUnload);
    };
  }, [currentUser]);

  const handleCancelExit = () => {
    setShowExitConfirm(false);
    window.history.pushState({ screen: 'home' }, '', '#home');
  };

  const handleConfirmExit = async () => {
    setShowExitConfirm(false);
    try {
      await CapApp.exitApp();
    } catch {
      try {
        window.close();
      } catch {}
      window.history.go(-2);
    }
  };

  // Switch Active Farm (Week-aware)
  const switchFarm = useCallback(async (targetFarmId: string, silent = false) => {
    setActiveFarmId(targetFarmId);
    activeFarmIdRef.current = targetFarmId;
    localStorage.setItem('poultry_active_farm_id', targetFarmId);
    if (!silent) setSyncStatus('refreshing');

    // Immediately resolve and set farm name from farmsList or localStorage
    const knownFarm = farmsListRef.current.find(f => f.id === targetFarmId || f.name.toLowerCase() === targetFarmId.toLowerCase());
    if (knownFarm?.name) {
      setFarmName(knownFarm.name);
    } else {
      const localCached = localStorage.getItem(`poultry_farm_${targetFarmId}`);
      if (localCached) {
        try {
          const parsed = JSON.parse(localCached);
          if (parsed.farmName) setFarmName(parsed.farmName);
        } catch {}
      }
    }

    // Determine target week: prefer saved active week, then farm's known start week, fallback to W1
    const knownStartWeek = knownFarm?.activeBatch?.startWeekNumber 
      ? `W${knownFarm.activeBatch.startWeekNumber}`
      : (knownFarm?.initialAgeWeek || knownFarm?.startingWeek || knownFarm?.ageWeek || 'W1');
    const targetWeek = localStorage.getItem(`poultry_active_week_${targetFarmId}`) || knownStartWeek;
    setAgeWeek(targetWeek);

    // Immediately restore local draft if available strictly for targetWeek
    const weekDraft = localStorage.getItem(`poultry_draft_${targetFarmId}_${targetWeek}`);
    if (weekDraft) {
      try {
        const parsed = JSON.parse(weekDraft);
        const shedsArr = Array.isArray(parsed?.sheds) ? parsed.sheds : (Array.isArray(parsed) ? parsed : null);
        if (shedsArr && shedsArr.length > 0) {
          shedsRef.current = shedsArr;
          setSheds(shedsArr);
          if (shedsArr[0]) {
            setSelectedShedId(shedsArr[0].id);
            if (shedsArr[0].parts?.[0]) {
              setSelectedPartId(shedsArr[0].parts[0].id);
              if (shedsArr[0].parts[0].lines?.[0]) setSelectedLineId(shedsArr[0].parts[0].lines[0].id);
            }
          }
        } else {
          shedsRef.current = [];
          setSheds([]);
        }
      } catch {
        shedsRef.current = [];
        setSheds([]);
      }
    } else {
      // Isolate farm state: reset previous farm's in-memory sheds and weights immediately
      shedsRef.current = [];
      setSheds([]);
      setSelectedShedId('');
      setSelectedPartId('');
      setSelectedLineId('');
    }

    // Restore local audit, draft status & pending status for target farm and week
    const localWeekStatus = localStorage.getItem(`poultry_status_${targetFarmId}_${targetWeek}`) as FarmStatus | null;
    const localStatus = localWeekStatus || (localStorage.getItem(`poultry_status_${targetFarmId}`) as FarmStatus | null);
    if (localStatus === 'DRAFT' || localStatus === 'UPLOADING' || localStatus === 'COMPLETED' || localStatus === 'UPLOAD_FAILED') {
      setFarmStatus(localStatus);
    } else {
      setFarmStatus('DRAFT');
    }

    const localAuditStr = localStorage.getItem(`poultry_audit_${targetFarmId}_${targetWeek}`) || localStorage.getItem(`poultry_audit_${targetFarmId}`);
    if (localAuditStr) {
      try { setFarmAudit(JSON.parse(localAuditStr)); } catch {}
    } else {
      setFarmAudit(null);
    }
    const localPending = localStorage.getItem(`poultry_pending_submission_${targetFarmId}`);
    setIsPendingSubmission(localPending === 'true');

    try {
      const data = await cloudApi.getFarmDetails(targetFarmId, targetWeek, activeBatchId || undefined);
      if (data) {
        setFarmName(data.name);
        setDate(data.flockDate || new Date().toISOString().split('T')[0]);
        setAgeWeek(targetWeek || data.ageWeek || 'W1');
        setSeason((data.season as any) || 'Summer');
        if (data.activeBatch) {
          setActiveBatchId(data.activeBatch.id);
          setActiveBatchName(data.activeBatch.batchName);
        } else if (data.batchId) {
          setActiveBatchId(data.batchId);
          setActiveBatchName(data.batchName || 'Batch 1');
        }
        if (Array.isArray(data.batches)) {
          setBatchesList(data.batches);
        }
        if (data.status) {
          setFarmStatus(data.status);
          localStorage.setItem(`poultry_status_${targetFarmId}_${targetWeek}`, data.status);
          localStorage.setItem(`poultry_status_${targetFarmId}`, data.status);
        }
        if (data.audit && localPending !== 'true') {
          setFarmAudit(data.audit);
          localStorage.setItem(`poultry_audit_${targetFarmId}_${targetWeek}`, JSON.stringify(data.audit));
        }
        if (Array.isArray(data.sheds)) {
          const merged = mergeServerShedsWithLocalDraft(data.sheds, shedsRef.current, targetFarmId, targetWeek);
          shedsRef.current = merged;
          setSheds(merged);
          if (merged.length > 0 && (!selectedShedIdRef.current || !merged.some(s => s.id === selectedShedIdRef.current))) {
            setSelectedShedId(merged[0].id);
            selectedShedIdRef.current = merged[0].id;
            const firstPart = merged[0].parts?.[0];
            if (firstPart) {
              setSelectedPartId(firstPart.id);
              selectedPartIdRef.current = firstPart.id;
              if (firstPart.lines?.[0]) setSelectedLineId(firstPart.lines[0].id);
              else setSelectedLineId('');
            }
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
      // If offline, check local cache for this farm strictly scoped
      const weekCached = localStorage.getItem(`poultry_farm_${targetFarmId}_${targetWeek}`);
      const localCached = weekCached || localStorage.getItem(`poultry_farm_${targetFarmId}`);
      if (localCached) {
        try {
          const parsed = JSON.parse(localCached);
          if (Array.isArray(parsed.sheds)) {
            const baseSheds = weekCached ? parsed.sheds : createEmptyWeeklySheds(parsed.sheds);
            const merged = mergeServerShedsWithLocalDraft(baseSheds, shedsRef.current, targetFarmId, targetWeek);
            shedsRef.current = merged;
            setSheds(merged);
            if (merged.length > 0) {
              setSelectedShedId(merged[0].id);
              selectedShedIdRef.current = merged[0].id;
              const firstPart = merged[0].parts?.[0];
              if (firstPart) {
                setSelectedPartId(firstPart.id);
                selectedPartIdRef.current = firstPart.id;
                if (firstPart.lines?.[0]) setSelectedLineId(firstPart.lines[0].id);
                else setSelectedLineId('');
              } else {
                setSelectedPartId('');
                selectedPartIdRef.current = '';
                setSelectedLineId('');
              }
            } else {
              setSelectedShedId('');
              selectedShedIdRef.current = '';
              setSelectedPartId('');
              selectedPartIdRef.current = '';
              setSelectedLineId('');
            }
          }
          if (parsed.farmName) setFarmName(parsed.farmName);
          if (parsed.date) setDate(parsed.date);
          if (parsed.ageWeek) setAgeWeek(parsed.ageWeek);
          if (parsed.season) setSeason(parsed.season);
        } catch {}
      }
    }
  }, [activeBatchId]);

  // Switch Batch for Active Farm (Manager & Admin)
  const handleSelectBatch = useCallback(async (batchId: string) => {
    setActiveBatchId(batchId);
    const found = batchesList.find(b => b.id === batchId);
    if (found) {
      setActiveBatchName(found.batchName);
    }
    try {
      const data = await cloudApi.getFarmDetails(activeFarmId, ageWeek, batchId);
      if (data && Array.isArray(data.sheds)) {
        shedsRef.current = data.sheds;
        setSheds(data.sheds);
      }
    } catch (e) {
      console.warn('Could not load farm batch details:', e);
    }
  }, [activeFarmId, ageWeek, batchesList]);

  // Switch Recording Week for Active Farm (Req Steps 2 & 3)
  const handleSwitchWeek = useCallback(async (newWeek: string) => {
    const cleanWeek = (newWeek || '').trim().toUpperCase();
    if (!cleanWeek || cleanWeek === ageWeek) return;

    // 1. Synchronously persist the outgoing week's draft
    if (activeFarmId) {
      const currentSnapshot = shedsRef.current;
      localStorage.setItem(`poultry_draft_${activeFarmId}_${ageWeek}`, JSON.stringify({ sheds: currentSnapshot, updatedAt: Date.now() }));
      localStorage.setItem(`poultry_status_${activeFarmId}_${ageWeek}`, farmStatus);
      if (farmAudit) {
        localStorage.setItem(`poultry_audit_${activeFarmId}_${ageWeek}`, JSON.stringify(farmAudit));
      }
      localStorage.setItem(`poultry_farm_${activeFarmId}_${ageWeek}`, JSON.stringify({ sheds: currentSnapshot, farmName, date, ageWeek, season }));
    }

    // 2. Set new active week
    setAgeWeek(cleanWeek);
    setShedLocks({});
    setInputWeight('');
    setInputWeightError(null);
    if (activeFarmId) {
      localStorage.setItem(`poultry_active_week_${activeFarmId}`, cleanWeek);
    }

    // 3. Check for existing local draft for newWeek
    const localWeekDraft = activeFarmId ? localStorage.getItem(`poultry_draft_${activeFarmId}_${cleanWeek}`) : null;
    const localWeekStatus = activeFarmId ? (localStorage.getItem(`poultry_status_${activeFarmId}_${cleanWeek}`) as FarmStatus | null) : null;
    const localWeekAudit = activeFarmId ? localStorage.getItem(`poultry_audit_${activeFarmId}_${cleanWeek}`) : null;

    if (localWeekDraft) {
      try {
        const parsed = JSON.parse(localWeekDraft);
        const shedsArr = Array.isArray(parsed?.sheds) ? parsed.sheds : (Array.isArray(parsed) ? parsed : null);
        if (shedsArr && shedsArr.length > 0) {
          shedsRef.current = shedsArr;
          setSheds(shedsArr);
          setFarmStatus(localWeekStatus || 'DRAFT');
          if (localWeekAudit) {
            try { setFarmAudit(JSON.parse(localWeekAudit)); } catch { setFarmAudit(null); }
          } else {
            setFarmAudit(null);
          }
          if (shedsArr[0]) {
            setSelectedShedId(shedsArr[0].id);
            if (shedsArr[0].parts?.[0]) {
              setSelectedPartId(shedsArr[0].parts[0].id);
              if (shedsArr[0].parts[0].lines?.[0]) setSelectedLineId(shedsArr[0].parts[0].lines[0].id);
            }
          }
          showToast(`Switched to ${cleanWeek} (Draft restored)`);
          return;
        }
      } catch {}
    }

    // 4. Query cloud for this week
    if (activeFarmId) {
      try {
        setSyncStatus('refreshing');
        const cloudFarm = await cloudApi.getFarmDetails(activeFarmId, cleanWeek);
        if (cloudFarm && Array.isArray(cloudFarm.sheds) && cloudFarm.sheds.length > 0) {
          const baseStructuralSheds = createEmptyWeeklySheds(shedsRef.current.length > 0 ? shedsRef.current : sheds, cleanWeek);
          const merged = mergeServerShedsWithLocalDraft(cloudFarm.sheds, baseStructuralSheds, activeFarmId, cleanWeek);
          shedsRef.current = merged;
          setSheds(merged);
          setFarmStatus(cloudFarm.status || 'DRAFT');
          if (cloudFarm.audit) setFarmAudit(cloudFarm.audit);
          else setFarmAudit(null);
          localStorage.setItem(`poultry_draft_${activeFarmId}_${cleanWeek}`, JSON.stringify({ sheds: merged, updatedAt: Date.now() }));
          localStorage.setItem(`poultry_status_${activeFarmId}_${cleanWeek}`, cloudFarm.status || 'DRAFT');
          setSyncStatus('synced');
          showToast(`Switched to ${cleanWeek} (${cloudFarm.status || 'Loaded'})`);
          return;
        }
      } catch (err) {
        console.warn('Could not fetch cloud data for week switch:', err);
      }
    }

    // 5. Initialize clean empty sheds using base structure (all sheds, parts, lines with weights: [])
    const baseSheds = shedsRef.current.length > 0 ? shedsRef.current : sheds;
    const emptyWeeklySheds = createEmptyWeeklySheds(baseSheds, cleanWeek);
    shedsRef.current = emptyWeeklySheds;
    setSheds(emptyWeeklySheds);
    setFarmStatus('DRAFT');
    setFarmAudit(null);
    setSyncStatus('synced');

    if (activeFarmId) {
      localStorage.setItem(`poultry_draft_${activeFarmId}_${cleanWeek}`, JSON.stringify({ sheds: emptyWeeklySheds, updatedAt: Date.now() }));
      localStorage.setItem(`poultry_status_${activeFarmId}_${cleanWeek}`, 'DRAFT');
      localStorage.setItem(`poultry_farm_${activeFarmId}_${cleanWeek}`, JSON.stringify({ sheds: emptyWeeklySheds, farmName, date, ageWeek: cleanWeek, season }));
    }
    showToast(`Switched to ${cleanWeek} (New draft started)`);
  }, [ageWeek, activeFarmId, farmStatus, farmAudit, sheds, farmName, date, season]);

  // Week Status Map (which weeks are COMPLETED vs DRAFT for the active farm)
  const weekStatusMap = useMemo<Record<string, 'COMPLETED' | 'DRAFT'>>(() => {
    const map: Record<string, 'COMPLETED' | 'DRAFT'> = {};
    if (!activeFarmId) return map;

    for (let i = 1; i <= 24; i++) {
      const w = `W${i}`;
      const savedStatus = localStorage.getItem(`poultry_status_${activeFarmId}_${w}`);
      if (savedStatus === 'COMPLETED') {
        map[w] = 'COMPLETED';
      }
    }

    const farmObj = farmsList.find(f => f.id === activeFarmId);
    if (farmObj && Array.isArray((farmObj as any).submissions)) {
      for (const sub of (farmObj as any).submissions) {
        if (sub.flockAge && sub.status === 'COMPLETED') {
          map[sub.flockAge.toUpperCase()] = 'COMPLETED';
        }
      }
    }
    return map;
  }, [activeFarmId, farmsList, farmStatus]);

  // Initial Startup Bootstrap: Load Farms from Cloud with Offline Fallback
  const hasInitializedFarmsRef = useRef(false);
  useEffect(() => {
    if (hasInitializedFarmsRef.current) return;
    hasInitializedFarmsRef.current = true;

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
              activeFarmIdRef.current = savedActive;
            }
          }
        } catch {}
      }

      // 2. Fetch live farms from cloud backend
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

  // Local Storage Persistence for active farm & offline redundancy (Week-aware)
  useEffect(() => {
    localStorage.setItem(
      'poultry_flock_db_v3',
      JSON.stringify({ sheds, farmName, date, ageWeek, season })
    );
    if (activeFarmId) {
      localStorage.setItem(`poultry_active_week_${activeFarmId}`, ageWeek);
      localStorage.setItem(
        `poultry_farm_${activeFarmId}_${ageWeek}`,
        JSON.stringify({ sheds, farmName, date, ageWeek, season })
      );
      localStorage.setItem(
        `poultry_farm_${activeFarmId}`,
        JSON.stringify({ sheds, farmName, date, ageWeek, season })
      );
      // Persist active draft whenever unsubmitted
      if (farmStatus !== 'COMPLETED') {
        localStorage.setItem(
          `poultry_draft_${activeFarmId}_${ageWeek}`,
          JSON.stringify({ sheds, updatedAt: Date.now() })
        );
        localStorage.setItem(
          `poultry_draft_${activeFarmId}`,
          JSON.stringify({ sheds, updatedAt: Date.now() })
        );
      }
    }
  }, [sheds, farmName, date, ageWeek, season, activeFarmId, farmStatus]);

  // Debounced Cloud Auto-Sync for active farm draft (Serialized, non-blocking)
  const autosaveTimerRef = useRef<any>(null);
  const autosaveSeqRef = useRef<number>(0);

  useEffect(() => {
    if (!activeFarmId || sheds.length === 0 || farmStatus === 'COMPLETED') return;

    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current);
    }

    setSyncStatus('saving');
    const seq = ++autosaveSeqRef.current;

    autosaveTimerRef.current = setTimeout(async () => {
      try {
        const synced = await cloudApi.syncFullFarm(activeFarmId, {
          sheds,
          name: farmName,
          flockDate: date,
          ageWeek,
          season,
          status: 'DRAFT',
          progressPercentage: completionStats.progressPercent
        });
        if (autosaveSeqRef.current === seq) {
          if (synced?.updatedAt) {
            setLastServerUpdatedAt(synced.updatedAt);
          }
          setSyncStatus('synced');
          setLastUpdatedString('Draft saved just now');
        }
      } catch (err) {
        if (autosaveSeqRef.current === seq) {
          // Preserve locally, no intrusive error alerts
          setSyncStatus('offline');
          setLastUpdatedString('Draft saved locally (offline)');
        }
      }
    }, 1500);

    return () => {
      if (autosaveTimerRef.current) {
        clearTimeout(autosaveTimerRef.current);
      }
    };
  }, [sheds, activeFarmId, farmStatus, farmName, date, ageWeek, season]);

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
              const full = await cloudApi.getFarmDetails(activeFarmId, ageWeek);
              if (full && full.sheds) {
                const merged = mergeServerShedsWithLocalDraft(full.sheds, shedsRef.current, activeFarmId, ageWeek);
                shedsRef.current = merged;
                setSheds(merged);
                setFarmName(full.name);
                setDate(full.flockDate);
                if (full.ageWeek && !ageWeek) {
                  setAgeWeek(full.ageWeek);
                }
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
  }, [activeFarmId, ageWeek, lastServerUpdatedAt, inputWeight, syncStatus]);

  // Real-Time Cross-Phone Shed Save & Lock Polling (Every 800ms)
  const liveStatePollRef = useRef<any>(null);
  useEffect(() => {
    if (!activeFarmId || !ageWeek) return;
    const poll = async () => {
      // Do not interrupt while actively entering bird weights on weigh_pad
      const activeScreen = currentScreenRef.current;
      if (activeScreen === 'weigh_pad') return;
      try {
        const data = await cloudApi.getLiveState(activeFarmId, ageWeek, activeBatchId || undefined);
        if (data?.locks) {
          setShedLocks(prev => ({ ...prev, ...data.locks }));

          // Automatically sync saved shed weights across all in-charges in real time!
          let hasShedChanges = false;
          const currentSheds = shedsRef.current || [];
          const updatedSheds = currentSheds.map(s => {
            const lk = data.locks[s.id];
            if (!lk) return s;
            if (lk.savedStatus === 'SAVED' && lk.weights && Array.isArray(lk.weights)) {
              const currentTotal = (s.parts || []).flatMap(p => (p.lines || []).flatMap(l => l.weights || [])).length;
              if (currentTotal !== lk.totalBirdCount || (s as any).savedStatus !== 'SAVED') {
                hasShedChanges = true;
                const weightsMap = new Map<string, number[]>(
                  lk.weights.map((item: any) => [String(item.lineId), item.weights || []])
                );
                return {
                  ...s,
                  savedStatus: 'SAVED',
                  savedByUserName: lk.savedByUserName,
                  totalBirdCount: lk.totalBirdCount,
                  parts: (s.parts || []).map(p => ({
                    ...p,
                    lines: (p.lines || []).map(l => ({
                      ...l,
                      weights: weightsMap.has(String(l.id)) ? weightsMap.get(String(l.id))! : (l.weights || [])
                    }))
                  }))
                };
              }
            }
            return s;
          });

          if (hasShedChanges) {
            shedsRef.current = updatedSheds;
            setSheds(updatedSheds);
            try {
              localStorage.setItem(`poultry_draft_${activeFarmId}_${ageWeek}`, JSON.stringify({ sheds: updatedSheds, updatedAt: Date.now() }));
            } catch {}
          }
        }
      } catch {}
    };
    liveStatePollRef.current = setInterval(poll, 800);
    return () => {
      if (liveStatePollRef.current) clearInterval(liveStatePollRef.current);
    };
  }, [activeFarmId, ageWeek, activeBatchId, farmStatus]);

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
      const full = await cloudApi.getFarmDetails(activeFarmId, ageWeek);
      if (full && full.sheds) {
        const merged = mergeServerShedsWithLocalDraft(full.sheds, shedsRef.current, activeFarmId, ageWeek);
        shedsRef.current = merged;
        setSheds(merged);
        setFarmName(full.name);
        setDate(full.flockDate);
        if (full.ageWeek && !ageWeek) {
          setAgeWeek(full.ageWeek);
        }
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

  // Create New Farm Handler with Configurable Sheds & Direct Gender Assignment
  const handleCreateFarm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isCreatingFarmRef.current) return;
    const trimmedName = newFarmName.trim();
    if (!trimmedName) {
      showToast('Please enter a farm name');
      return;
    }

    const countNum = Number(newFarmShedCount);
    if (!newFarmShedCount || isNaN(countNum) || !Number.isInteger(countNum)) {
      setNewFarmShedCountError('Number of sheds must be a whole number between 1 and 40.');
      showToast('Please enter a valid whole number of sheds (1–40).');
      return;
    }
    if (countNum < 1) {
      setNewFarmShedCountError('Minimum 1 shed is required.');
      showToast('Minimum 1 shed is required.');
      return;
    }
    if (countNum > 40) {
      setNewFarmShedCountError('Maximum 40 sheds allowed per farm.');
      showToast('Maximum 40 sheds allowed per farm.');
      return;
    }
    setNewFarmShedCountError(null);

    isCreatingFarmRef.current = true;
    setIsCreatingFarm(true);
    try {
      // Automatically configure Shed 1 through Shed N with default type 'Female'
      const shedsPayload = Array.from({ length: countNum }, (_, idx) => ({
        name: `Shed ${idx + 1}`,
        type: 'Female' as const,
      }));

      const created = await cloudApi.createFarm({
        name: trimmedName,
        flockDate: newFarmFlockDate,
        ageWeek: newFarmAgeWeek,
        season: newFarmSeason,
        shedCount: countNum,
        sheds: shedsPayload,
      });

      if (created) {
        const shedCount = Array.isArray(created.sheds) ? created.sheds.length : (created._count?.sheds ?? shedsPayload.length);
        const newSummary: FarmSummary = {
          id: created.id,
          name: created.name,
          flockDate: created.flockDate,
          ageWeek: created.ageWeek,
          season: created.season,
          status: 'DRAFT',
          progressPercentage: 0,
          updatedAt: created.updatedAt,
          _count: { sheds: shedCount },
          initialAgeWeek: created.ageWeek,
          startingWeek: created.ageWeek,
          startWeekNumber: parseInt(created.ageWeek.replace(/\D/g, ''), 10) || 1,
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
        if (Array.isArray(created.sheds)) {
          shedsRef.current = created.sheds;
          setSheds(created.sheds);
          if (created.sheds.length > 0) {
            setSelectedShedId(created.sheds[0].id);
            const p1 = created.sheds[0].parts?.[0];
            if (p1) {
              setSelectedPartId(p1.id);
              if (p1.lines?.[0]) setSelectedLineId(p1.lines[0].id);
              else setSelectedLineId('');
            } else {
              setSelectedPartId('');
              setSelectedLineId('');
            }
          } else {
            setSelectedShedId('');
            setSelectedPartId('');
            setSelectedLineId('');
          }
        } else {
          shedsRef.current = [];
          setSheds([]);
          setSelectedShedId('');
          setSelectedPartId('');
          setSelectedLineId('');
        }
        setLastServerUpdatedAt(created.updatedAt);
        setLastUpdatedString('Just now');
        setSyncStatus('synced');
        setShowNewFarmModal(false);
        setNewFarmName('');
        setNewFarmShedCount(10);
        setNewFarmShedCountError(null);
        setIsPendingSubmission(true);
        setFarmAudit(null);
        localStorage.setItem(`poultry_pending_submission_${created.id}`, 'true');
        showToast(`Created Farm: ${created.name} (${shedCount} sheds)`);
      }
    } catch (err: any) {
      console.error('Create farm error:', err);
      showToast(err?.message || 'Failed to create farm on server. Please try again.');
    } finally {
      isCreatingFarmRef.current = false;
      setIsCreatingFarm(false);
    }
  };

  // Rename Farm Handler (Supported across all authorized roles)
  const handleRenameFarm = async (farmId: string, newName: string) => {
    const trimmed = newName.trim();
    if (!trimmed) {
      showToast('Farm name cannot be blank.');
      throw new Error('Farm name cannot be blank.');
    }
    try {
      await cloudApi.updateFarmDetails(farmId, { name: trimmed });
      setFarmsList(prev => prev.map(f => f.id === farmId ? { ...f, name: trimmed } : f));
      if (activeFarmId === farmId) {
        setFarmName(trimmed);
      }
      if (currentUser && currentUser.assignedFarms) {
        const oldFarm = farmsList.find(f => f.id === farmId);
        if (oldFarm && currentUser.assignedFarms.includes(oldFarm.name)) {
          const updatedAssigned = currentUser.assignedFarms.map(af => af === oldFarm.name ? trimmed : af);
          const updatedUser = { ...currentUser, assignedFarms: updatedAssigned };
          setCurrentUser(updatedUser);
          localStorage.setItem('poultry_current_user', JSON.stringify(updatedUser));
        }
      }
      const updated = await cloudApi.getFarms();
      if (updated && updated.length > 0) {
        setFarmsList(updated);
        localStorage.setItem('poultry_farms_list_v4', JSON.stringify(updated));
      }
      showToast(`Farm renamed to "${trimmed}"`);
    } catch (err: any) {
      showToast(err.message || 'Failed to rename farm');
      throw err;
    }
  };

  // Toggle Line-Wise Female/Male Gender Selection (Req 2)
  const handleToggleLineGender = async (lineId: string | number, newGender: 'Female' | 'Male') => {
    const uppercaseGender = newGender.toUpperCase() as 'MALE' | 'FEMALE';
    setSheds(prev => {
      const next = prev.map(s => ({
        ...s,
        parts: s.parts.map(p => ({
          ...p,
          lines: p.lines.map(l => String(l.id) === String(lineId) ? { ...l, gender: uppercaseGender } : l)
        }))
      }));
      shedsRef.current = next;
      try {
        localStorage.setItem(`poultry_draft_${activeFarmId}_${ageWeek}`, JSON.stringify({ sheds: next, updatedAt: Date.now() }));
      } catch {}
      return next;
    });

    try {
      await cloudApi.updateLineGender(lineId, uppercaseGender);
      const targetStd = newGender === 'Male' ? stdWeightMale : stdWeightFemale;
      showToast(`Line standard updated to ${newGender === 'Male' ? '♂ Male' : '♀ Female'} (STD: ${targetStd}g)`);
    } catch {
      showToast(`Line standard set to ${newGender === 'Male' ? '♂ Male' : '♀ Female'}`);
    }
  };

  // Toggle Shed-Wise Female/Male Gender Selection (Fallback)
  const handleToggleShedGender = async (shedId: string, newGender: 'Female' | 'Male') => {
    setSheds(prev => prev.map(s => s.id === shedId ? { ...s, type: newGender } : s));
    try {
      await cloudApi.updateShed(shedId, { type: newGender });
      showToast(`Shed gender set to ${newGender === 'Male' ? '♂ Male' : '♀ Female'}`);
    } catch (err: any) {
      offlineQueue.enqueue({
        type: 'UPDATE_SHED',
        payload: { shedId, data: { type: newGender } }
      });
      setPendingSyncCount(offlineQueue.count());
      showToast(`Shed gender updated to ${newGender} (offline queued)`);
    }
  };

  // Delete / Archive Farm Handler (Req 3: Admin Only)
  const handleDeleteFarm = async (farmId: string, options?: { mode?: 'archive' | 'permanent'; confirmFarmName?: string }) => {
    const mode = options?.mode || 'archive';

    // 1. Scoped Farm Deletion / Archival Logic (Target by ID Only)
    // - For hard delete: farms.filter(farm => farm.id !== targetFarmId)
    // - For archive: farms.map(farm => farm.id === targetFarmId ? { ...farm, isArchived: true, status: 'ARCHIVED' } : farm)
    let nextFarms: FarmSummary[] = [];
    setFarmsList(prev => {
      if (!Array.isArray(prev)) return [];
      const updated = mode === 'permanent'
        ? prev.filter(farm => farm.id !== farmId)
        : prev.map(farm => farm.id === farmId ? { ...farm, isArchived: true, status: 'ARCHIVED' as FarmStatus } : farm);
      nextFarms = updated;
      try {
        localStorage.setItem('poultry_farms_list_v4', JSON.stringify(updated));
      } catch {}
      return updated;
    });

    // Cascade-revoke user farm access from current session (Task 3)
    if (currentUser && currentUser.assignedFarms) {
      const deletedFarmObj = (farmsList || []).find(f => f.id === farmId);
      const deletedName = deletedFarmObj?.name || options?.confirmFarmName || '';
      const updatedAssigned = currentUser.assignedFarms.filter(af => af !== farmId && af !== deletedName);
      const updatedUser = { ...currentUser, assignedFarms: updatedAssigned };
      setCurrentUser(updatedUser);
      try {
        localStorage.setItem('poultry_current_user', JSON.stringify(updatedUser));
      } catch {}
    }

    // 2. Handle Currently Selected Farm Fallback:
    const remainingActive = nextFarms.filter(f => !f.isArchived);
    if (activeFarmId === farmId) {
      if (remainingActive.length > 0) {
        switchFarm(remainingActive[0].id);
      } else {
        setActiveFarmId('');
        try {
          localStorage.removeItem('poultry_active_farm_id');
        } catch {}
      }
    }

    try {
      await cloudApi.deleteFarm(farmId, options);
      // Refresh farms list from cloud
      const updatedFarms = await cloudApi.getFarms();
      if (Array.isArray(updatedFarms)) {
        setFarmsList(updatedFarms);
        try {
          localStorage.setItem('poultry_farms_list_v4', JSON.stringify(updatedFarms));
        } catch {}

        // Fallback for active farm selection
        const remaining = updatedFarms.filter(f => !f.isArchived);
        if (activeFarmId === farmId || (activeFarmId && !remaining.some(f => f.id === activeFarmId))) {
          if (remaining.length > 0) {
            switchFarm(remaining[0].id);
          } else {
            setActiveFarmId('');
            try {
              localStorage.removeItem('poultry_active_farm_id');
            } catch {}
          }
        }
      }
      showToast(mode === 'permanent' ? 'Farm permanently removed' : 'Farm safely archived');
    } catch (err: any) {
      // Re-fetch in case of failure without wiping out
      const reverted = await cloudApi.getFarms().catch(() => null);
      if (reverted && Array.isArray(reverted) && reverted.length > 0) {
        setFarmsList(reverted);
      }
      showToast(err.message || 'Failed to delete farm');
      throw err;
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
            const merged = mergeServerShedsWithLocalDraft(full.sheds, shedsRef.current, activeFarmId);
            shedsRef.current = merged;
            setSheds(merged);
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
          showToast(`Connected to server (${result.latencyMs || 0}ms)`);
        } else {
          showToast('Server is not connected');
        }
      } else {
        setCloudTestStatus('failed');
        showToast('Server is not connected');
      }
    } catch (err: any) {
      setCloudTestStatus('failed');
      setCloudTestResult({
        online: false,
        error: 'Server is not connected'
      });
      showToast('Server is not connected');
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

  // Active Pointers (Null safe for farms with 0 sheds or parts)
  const activeShed = sheds.find(s => s.id === selectedShedId) || sheds[0] || null;
  const activePart = activeShed?.parts?.find(p => p.id === selectedPartId) || activeShed?.parts?.[0] || null;
  const activeLine = activePart?.lines?.find(l => String(l.id) === String(selectedLineId)) || activePart?.lines?.[0] || null;

  // LINE-LEVEL GENDER SELECTION & DYNAMIC STANDARD WEIGHT (Req 2)
  const activeLineGender = (activeLine?.gender || (activeShed?.type === 'Male' ? 'MALE' : 'FEMALE')).toUpperCase() === 'MALE' ? 'Male' : 'Female';
  const activeStd = activeLineGender === 'Male' ? stdWeightMale : stdWeightFemale;
  const activeBands = useMemo(() => getGradingBands(activeStd, weekNum), [activeStd, weekNum]);

  // Real-time Calculations
  const lineStats = useMemo(() => {
    if (!activeLine) return calculateFlockStats([], activeStd, weekNum);
    return calculateFlockStats(activeLine.weights || [], activeStd, weekNum);
  }, [activeLine, activeStd, weekNum]);

  const partStats = useMemo(() => {
    if (!activePart) return calculateFlockStats([], activeStd, weekNum);
    const weights = (activePart.lines || []).flatMap(l => l.weights || []);
    return calculateFlockStats(weights, activeStd, weekNum);
  }, [activePart, activeStd, weekNum]);

  const shedStats = useMemo(() => {
    if (!activeShed) return calculateFlockStats([], activeStd, weekNum);
    const weights = (activeShed.parts || []).flatMap(p => (p.lines || []).flatMap(l => l.weights || []));
    return calculateFlockStats(weights, activeStd, weekNum);
  }, [activeShed, activeStd, weekNum]);

  // Consolidated Overall Calculations dynamically aggregated by Line Gender
  const consolidated = useMemo(() => {
    const femaleWeights = sheds
      .flatMap(s => s.parts.flatMap(p => p.lines.filter(l => {
        const g = (l.gender || (s.type === 'Male' ? 'MALE' : 'FEMALE')).toUpperCase();
        return g === 'FEMALE';
      }).flatMap(l => l.weights)));

    const maleWeights = sheds
      .flatMap(s => s.parts.flatMap(p => p.lines.filter(l => {
        const g = (l.gender || (s.type === 'Male' ? 'MALE' : 'FEMALE')).toUpperCase();
        return g === 'MALE';
      }).flatMap(l => l.weights)));

    const fStats = calculateFlockStats(femaleWeights, stdWeightFemale, weekNum);
    const mStats = calculateFlockStats(maleWeights, stdWeightMale, weekNum);

    const shedSummaries = sheds.map((s, idx) => {
      const allW = s.parts.flatMap(p => p.lines.flatMap(l => l.weights));
      const sGender = (s.type === 'Male' ? 'Male' : 'Female');
      const std = sGender === 'Male' ? stdWeightMale : stdWeightFemale;
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

    (sheds || []).forEach(shed => {
      const parts = shed.parts || [];
      if (parts.length === 0) {
        totalLines++;
        incomplete.push({
          shedId: shed.id,
          shedName: shed.name,
          partId: '',
          partName: 'Part A',
          lineId: '',
          lineName: 'Line 1',
          path: `${shed.name} (no parts or lines configured yet)`
        });
        return;
      }

      parts.forEach(part => {
        const lines = part.lines || [];
        if (lines.length === 0) {
          totalLines++;
          incomplete.push({
            shedId: shed.id,
            shedName: shed.name,
            partId: part.id,
            partName: part.name,
            lineId: '',
            lineName: 'Line 1',
            path: `${shed.name} › ${part.name} (no lines configured yet)`
          });
          return;
        }

        lines.forEach(line => {
          totalLines++;
          const weights = line.weights || [];
          if (weights.length >= 10) {
            completedLines++;
          } else {
            incomplete.push({
              shedId: shed.id,
              shedName: shed.name,
              partId: part.id,
              partName: part.name,
              lineId: line.id,
              lineName: line.name,
              path: `${shed.name} › ${part.name} › ${line.name} (${weights.length}/10 birds weighed)`
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
    const targetShed = sheds.find(s => s.id === shedId);
    let targetPartId = partId;
    let targetLineId = lineId;

    if (targetShed && (!targetShed.parts || targetShed.parts.length === 0)) {
      const newPartId = `part-${Date.now()}`;
      const newLineId = `line-${Date.now()}`;
      const newPart: ShedPart = {
        id: newPartId,
        name: 'Part A',
        lines: [{ id: newLineId, name: 'Line 1', weights: [] }]
      };
      setSheds(prev => prev.map(s => s.id === shedId ? { ...s, parts: [newPart] } : s));
      targetPartId = newPartId;
      targetLineId = newLineId;
    } else if (targetShed && targetShed.parts?.[0] && (!targetShed.parts[0].lines || targetShed.parts[0].lines.length === 0)) {
      const newLineId = `line-${Date.now()}`;
      setSheds(prev => prev.map(s => s.id === shedId ? {
        ...s,
        parts: s.parts.map((p, idx) => idx === 0 ? { ...p, lines: [{ id: newLineId, name: 'Line 1', weights: [] }] } : p)
      } : s));
      targetPartId = targetShed.parts[0].id;
      targetLineId = newLineId;
    }

    setSelectedShedId(shedId);
    setSelectedPartId(targetPartId);
    setSelectedLineId(targetLineId);
    setShowIncompleteAlertModal(false);
    navigateTo('weigh_pad');
  };

  // Helper to transition session to editable DRAFT state
  const markSessionAsDraft = useCallback((_reason?: string) => {
    if (farmStatus === 'COMPLETED') return;
    const now = new Date();
    const draftTimestamp = `Date(${formatDateDMY(now)}) - Time(${formatTime12H(now)})`;
    const editorName = currentUser?.userName || currentUser?.name || 'Suresh Kumar';
    const editorRole = currentUserRole;

    setFarmStatus('DRAFT');
    localStorage.setItem(`poultry_status_${activeFarmId}_${ageWeek}`, 'DRAFT');
    localStorage.setItem(`poultry_status_${activeFarmId}`, 'DRAFT');
    setIsPendingSubmission(true);
    localStorage.setItem(`poultry_pending_submission_${activeFarmId}`, 'true');

    const updatedAudit: FarmAudit = {
      ...(farmAudit || {}),
      status: 'DRAFT',
      lastSavedAsDraftAt: draftTimestamp,
      lastEditedBy: editorName,
      lastEditedRole: editorRole,
      isPendingSubmission: true,
    };
    setFarmAudit(updatedAudit);
    localStorage.setItem(`poultry_audit_${activeFarmId}_${ageWeek}`, JSON.stringify(updatedAudit));
    localStorage.setItem(`poultry_audit_${activeFarmId}`, JSON.stringify(updatedAudit));

    setFarmsList(prev => prev.map(f => f.id === activeFarmId ? {
      ...f,
      status: 'DRAFT',
      progressPercentage: completionStats.progressPercent
    } : f));
  }, [activeFarmId, ageWeek, completionStats.progressPercent, currentUser, currentUserRole, farmAudit]);

  // Explicit Save Draft action (Accessible across all authenticated roles)
  const handleManualSaveDraft = useCallback(async () => {
    setIsSavingDraft(true);
    try {
      const now = new Date();
      const draftTimestamp = now.toISOString();
      const editorName = currentUser?.userName || currentUser?.name || 'Field Operator';
      const editorRole = currentUserRole;

      // 1. Mark session as DRAFT in state and storage
      setFarmStatus('DRAFT');
      localStorage.setItem(`poultry_status_${activeFarmId}_${ageWeek}`, 'DRAFT');
      localStorage.setItem(`poultry_status_${activeFarmId}`, 'DRAFT');
      setIsPendingSubmission(true);
      localStorage.setItem(`poultry_pending_submission_${activeFarmId}`, 'true');

      // 2. Persist current sheds weights across all storage keys
      localStorage.setItem(`poultry_draft_${activeFarmId}_${ageWeek}`, JSON.stringify({ sheds, updatedAt: Date.now() }));
      localStorage.setItem(`poultry_draft_${activeFarmId}`, JSON.stringify({ sheds, updatedAt: Date.now() }));
      localStorage.setItem(`poultry_farm_${activeFarmId}_${ageWeek}`, JSON.stringify({ sheds, farmName, date, ageWeek, season }));
      localStorage.setItem(`poultry_farm_${activeFarmId}`, JSON.stringify({ sheds, farmName, date, ageWeek, season }));
      localStorage.setItem('poultry_flock_db_v3', JSON.stringify({ sheds, farmName, date, ageWeek, season }));
      localStorage.setItem(`poultry_sheds_${activeFarmId}`, JSON.stringify(sheds));

      // 3. Update and persist farm audit
      const updatedAudit: FarmAudit = {
        ...(farmAudit || {}),
        status: 'DRAFT',
        lastSavedAsDraftAt: draftTimestamp,
        lastEditedBy: editorName,
        lastEditedRole: editorRole,
        isPendingSubmission: true,
      };
      setFarmAudit(updatedAudit);
      localStorage.setItem(`poultry_audit_${activeFarmId}_${ageWeek}`, JSON.stringify(updatedAudit));
      localStorage.setItem(`poultry_audit_${activeFarmId}`, JSON.stringify(updatedAudit));

      // 4. Update farms list state
      setFarmsList(prev => prev.map(f => f.id === activeFarmId ? {
        ...f,
        status: 'DRAFT',
        progressPercentage: completionStats.progressPercent
      } : f));

      // 5. Cloud synchronization with local fallback
      try {
        if (activeFarmId) {
          const synced = await cloudApi.syncFullFarm(activeFarmId, {
            sheds,
            name: farmName,
            flockDate: date,
            ageWeek,
            season,
            status: 'DRAFT',
            progressPercentage: completionStats.progressPercent
          });
          if (synced?.updatedAt) {
            setLastServerUpdatedAt(synced.updatedAt);
          }
          if (Array.isArray(synced?.sheds) && synced.sheds.length > 0) {
            const merged = mergeServerShedsWithLocalDraft(synced.sheds, shedsRef.current, activeFarmId, ageWeek);
            shedsRef.current = merged;
            setSheds(merged);
            localStorage.setItem(`poultry_draft_${activeFarmId}_${ageWeek}`, JSON.stringify({ sheds: merged, updatedAt: Date.now() }));
            localStorage.setItem(`poultry_draft_${activeFarmId}`, JSON.stringify({ sheds: merged, updatedAt: Date.now() }));
            localStorage.setItem(`poultry_farm_${activeFarmId}_${ageWeek}`, JSON.stringify({ sheds: merged, farmName, date, ageWeek, season }));
            localStorage.setItem(`poultry_farm_${activeFarmId}`, JSON.stringify({ sheds: merged, farmName, date, ageWeek, season }));
            localStorage.setItem(`poultry_sheds_${activeFarmId}`, JSON.stringify(merged));
          }
          setSyncStatus('synced');
          setLastUpdatedString('Draft saved just now');
          showToast('✓ Draft saved successfully to cloud & local storage! You can safely switch sheds or weeks.');
        } else {
          showToast('✓ Draft saved locally! You can resume anytime.');
        }
      } catch (cloudErr) {
        console.warn('Draft cloud sync offline, draft retained locally:', cloudErr);
        setSyncStatus('offline');
        showToast('✓ Draft saved locally (Offline mode)! Your entered weights are safely preserved.');
      }
    } catch (err: any) {
      console.error('Failed to save draft:', err);
      showToast(`Failed to save draft: ${err.message || 'Storage error'}`);
    } finally {
      setIsSavingDraft(false);
    }
  }, [activeFarmId, completionStats.progressPercent, currentUser, currentUserRole, sheds, farmName, date, ageWeek, season, farmAudit]);

  // =========================================================================
  // STAGE 2: SHED-WISE "SAVE SHED" (TEAM VISIBLE, NOT SUBMISSION HISTORY)
  // =========================================================================
  const [isSavingShed, setIsSavingShed] = useState(false);

  const handleSaveShed = useCallback(async (targetShed?: ShedData) => {
    const shedToSave = targetShed || activeShed;
    if (!shedToSave) return;
    setIsSavingShed(true);
    try {
      const userName = currentUser?.userName || currentUser?.name || currentUser?.username || 'Incharge 1';
      const userId = currentUser?.id || 'incharge-1';

      // 1. Compute total birds weighed in this shed
      const shedBirdWeights = (shedToSave.parts || []).flatMap(p => (p.lines || []).flatMap(l => l.weights || []));
      const totalBirdCount = shedBirdWeights.length;

      // 2. Extract line weights payload
      const weightsPayload: Array<{ lineId: string; weights: number[] }> = [];
      for (const p of shedToSave.parts || []) {
        for (const l of p.lines || []) {
          weightsPayload.push({
            lineId: String(l.id),
            weights: l.weights || [],
          });
        }
      }

      // 3. Persist locally first
      localStorage.setItem(`poultry_shed_${shedToSave.id}_${ageWeek}`, JSON.stringify(shedToSave));

      // 4. Call Stage 2 API: POST /api/sheds/:shedId/save-shed
      // Persists weights into Farm+Week workspace, marks SAVED, releases lock, visible to team, NEVER writes to SubmissionHistory
      const res = await cloudApi.saveShed(shedToSave.id, {
        farmId: activeFarmId,
        week: ageWeek,
        batchId: activeBatchId || undefined,
        userId,
        userName,
        totalBirdCount,
        weights: weightsPayload,
      });

      // 5. Update local shed lock state immediately so the badge updates
      setShedLocks(prev => ({
        ...prev,
        [shedToSave.id]: {
          ...(prev[shedToSave.id] || { shedId: shedToSave.id }),
          locked: false,
          lockedByUserId: null,
          lockedByUserName: null,
          savedStatus: 'SAVED',
          savedByUserName: userName,
          savedByUserId: userId,
          totalBirdCount: res.totalBirdCount ?? totalBirdCount,
          savedAt: new Date().toISOString(),
        }
      }));

      // Update sheds state so the saved weights and status persist in memory & draft
      setSheds(prev => prev.map(sh => sh.id === shedToSave.id ? ({ ...shedToSave, savedStatus: 'SAVED', savedByUserName: userName, totalBirdCount } as any) : sh));
      shedsRef.current = shedsRef.current.map(sh => sh.id === shedToSave.id ? ({ ...shedToSave, savedStatus: 'SAVED', savedByUserName: userName, totalBirdCount } as any) : sh);
      if (activeFarmId) {
        localStorage.setItem(`poultry_draft_${activeFarmId}_${ageWeek}`, JSON.stringify({ sheds: shedsRef.current, updatedAt: Date.now() }));
      }

      // Release active locked shed in local client
      if (activeLockedShedId === shedToSave.id) {
        setActiveLockedShedId(null);
        activeLockedShedIdRef.current = null;
      }

      showToast(`✅ ${shedToSave.name} saved! Birds count: ${totalBirdCount}. Shared with team.`);

      // Navigate back to shed selection
      navigateTo('shed_select');

      // Refresh farm and locks
      if (activeFarmId) {
        cloudApi.getShedLocks(activeFarmId, ageWeek).then(data => {
          if (data?.locks) setShedLocks(data.locks);
        }).catch(() => {});
      }
    } catch (err: any) {
      console.error('Failed to save shed:', err);
      showToast(`Failed to save shed: ${err.message || 'Storage error'}`);
    } finally {
      setIsSavingShed(false);
    }
  }, [activeShed, currentUser, activeFarmId, ageWeek, activeLockedShedId, navigateTo, showToast]);

  // =========================================================================
  // STAGE 3: OVERALL FARM "FINAL SUBMIT" (WRITES TO SUBMISSION HISTORY)
  // =========================================================================
  const [isSubmittingOverallFarm, setIsSubmittingOverallFarm] = useState(false);
  const [showOverallSubmitConfirmModal, setShowOverallSubmitConfirmModal] = useState(false);

  const handleOverallFarmFinalSubmit = useCallback(async () => {
    if (!activeFarmId) return;
    setIsSubmittingOverallFarm(true);
    try {
      const userName = currentUser?.userName || currentUser?.name || 'Field Supervisor';
      const userRole = currentUserRole;

      let res: any;
      try {
        res = await cloudApi.submitOverallFarm(activeFarmId, ageWeek, {
          submittedBy: userName,
          submittedRole: userRole,
          batchId: activeBatchId || undefined,
          batchName: activeBatchName || undefined,
          sheds: shedsRef.current,
        });
      } catch (cloudErr: any) {
        console.warn('Cloud submission returned error, completing locally:', cloudErr);
        const currentNum = parseInt(ageWeek.replace(/\D/g, ''), 10) || 1;
        res = {
          success: true,
          submissionId: `sub-${Date.now()}`,
          status: 'COMPLETED',
          totalBirds: shedsRef.current.reduce((acc, s) => acc + (s.parts || []).reduce((pAcc, p) => pAcc + (p.lines || []).reduce((lAcc, l) => lAcc + (l.weights?.length || 0), 0), 0), 0),
          nextWeek: `W${currentNum + 1}`,
        };
      }

      setFarmStatus('COMPLETED');
      localStorage.setItem(`poultry_status_${activeFarmId}_${ageWeek}`, 'COMPLETED');
      localStorage.setItem(`poultry_status_${activeFarmId}`, 'COMPLETED');
      setIsPendingSubmission(false);

      // Auto-unlock next week
      const currentNum = parseInt(ageWeek.replace(/\D/g, ''), 10) || 1;
      const nextWeekStr = res?.nextWeek || `W${currentNum + 1}`;
      localStorage.setItem(`poultry_active_week_${activeFarmId}`, nextWeekStr);
      localStorage.setItem(`poultry_status_${activeFarmId}_${nextWeekStr}`, 'DRAFT');

      // Guarantee 100% empty state for next week: retain sheds/parts/lines layout, reset weights to [] and status to PENDING
      const nextWeekCleanSheds = createEmptyWeeklySheds(shedsRef.current, nextWeekStr);
      localStorage.setItem(`poultry_draft_${activeFarmId}_${nextWeekStr}`, JSON.stringify({ sheds: nextWeekCleanSheds, updatedAt: Date.now() }));

      // Cleanly transition active week state to the fresh next week
      setAgeWeek(nextWeekStr);
      shedsRef.current = nextWeekCleanSheds;
      setSheds(nextWeekCleanSheds);
      setFarmStatus('DRAFT');
      setShedLocks({});
      setInputWeight('');
      setInputWeightError(null);

      showToast(`🎉 Overall Farm Final Submission Complete! Week ${ageWeek} finalized. Week ${nextWeekStr} unlocked.`);
      setShowOverallSubmitConfirmModal(false);

      // Navigate to conclusion / history
      navigateTo('conclusion');
    } catch (err: any) {
      console.error('Failed to submit overall farm:', err);
      showToast(`Overall farm submission failed: ${err.message || 'Submission error'}`);
    } finally {
      setIsSubmittingOverallFarm(false);
    }
  }, [activeFarmId, ageWeek, currentUser, currentUserRole, activeBatchId, activeBatchName, navigateTo, showToast]);

  // --- WEIGHING PAD WEIGHT HANDLERS (Local Staging & Draft Workflow) ---
  const handleAddWeight = () => {
    // Prevent duplicate submissions from rapid multi-taps
    if (isSubmittingWeightRef.current) return;
    isSubmittingWeightRef.current = true;
    setIsSubmittingWeight(true);

    try {
      const raw = inputWeight.trim();

      // 1. Validation: Reject empty input
      if (!raw) {
        const errMsg = 'Weight is required. Please enter a valid bird weight.';
        setInputWeightError(errMsg);
        showToast(`⚠️ ${errMsg}`);
        return;
      }

      // 2. Validation: Reject negative, non-numeric, or malformed values
      if (!/^\d+(\.\d+)?$/.test(raw)) {
        let errMsg = 'Please enter a valid numeric weight.';
        if (raw.startsWith('-') || /^-/.test(raw)) {
          errMsg = 'Weight cannot be negative. Please enter a positive weight.';
        }
        setInputWeightError(errMsg);
        showToast(`⚠️ ${errMsg}`);
        return;
      }

      const val = parseFloat(raw);

      // 3. Validation: Reject zero or negative values
      if (isNaN(val) || val <= 0) {
        const errMsg = 'Weight must be greater than zero.';
        setInputWeightError(errMsg);
        showToast(`⚠️ ${errMsg}`);
        return;
      }

      // 4. Validation: Upper bound sanity check
      if (val > 15000) {
        const errMsg = 'Weight exceeds maximum allowable limit (15,000g).';
        setInputWeightError(errMsg);
        showToast(`⚠️ ${errMsg}`);
        return;
      }

      const currentShed = shedsRef.current.find(s => s.id === selectedShedId) || shedsRef.current[0] || null;
      const currentPart = currentShed?.parts?.find(p => p.id === selectedPartId) || currentShed?.parts?.[0] || null;
      const currentLine = currentPart?.lines?.find(l => String(l.id) === String(selectedLineId)) || currentPart?.lines?.[0] || null;

      if (!currentShed || !currentPart || !currentLine) {
        const errMsg = 'Please select a valid shed, part, and line before saving weight.';
        setInputWeightError(errMsg);
        showToast(`⚠️ ${errMsg}`);
        return;
      }

      // Guard: Strict one-time submission lock
      if (farmStatus === 'COMPLETED') {
        showToast("This week's body-weight submission has already been completed and locked.");
        return;
      }

      // 1. Synchronously get latest state from shedsRef to prevent rapid-click race conditions
      const nextSheds = applyLineWeightAddition(shedsRef.current, currentShed.id, currentPart.id, currentLine.id, val);
      shedsRef.current = nextSheds;
      setSheds(nextSheds);

      // Immediately persist to local storage outside of React state updater
      if (activeFarmId) {
        const lineWeights = nextSheds.find(s => s.id === currentShed.id)?.parts?.find(p => p.id === currentPart.id)?.lines?.find(l => String(l.id) === String(currentLine.id))?.weights || [];
        localStorage.setItem(`flock_draft_${activeFarmId}_${ageWeek}_${currentShed.id}_${currentPart.id}_${currentLine.id}`, JSON.stringify({ weights: lineWeights }));
        localStorage.setItem(`poultry_draft_${activeFarmId}_${ageWeek}`, JSON.stringify({ sheds: nextSheds, updatedAt: Date.now() }));
        localStorage.setItem(`poultry_farm_${activeFarmId}_${ageWeek}`, JSON.stringify({ sheds: nextSheds, farmName, date, ageWeek, season }));
      }

      // 2. Automatically mark session as DRAFT
      markSessionAsDraft('Added bird weight');

      // Clear the input only after a successful save; clear any error
      setInputWeight('');
      setInputWeightError(null);

      // Keep focus on input for convenient continuous mobile/keyboard entry
      setTimeout(() => {
        weightInputRef.current?.focus();
      }, 50);
    } catch (err: any) {
      console.error('Failed to add weight:', err);
      showToast(`Failed to add weight: ${err?.message || 'Storage error'}`);
      // Preserve entered text if saving fails
    } finally {
      setTimeout(() => {
        isSubmittingWeightRef.current = false;
        setIsSubmittingWeight(false);
      }, 300);
    }
  };

  const handleDeleteWeight = (idx: number) => {
    const currentShed = shedsRef.current.find(s => s.id === selectedShedId) || shedsRef.current[0] || null;
    const currentPart = currentShed?.parts?.find(p => p.id === selectedPartId) || currentShed?.parts?.[0] || null;
    const currentLine = currentPart?.lines?.find(l => String(l.id) === String(selectedLineId)) || currentPart?.lines?.[0] || null;

    if (!currentShed || !currentPart || !currentLine) return;
    if (idx < 0 || idx >= currentLine.weights.length) return;

    if (farmStatus === 'COMPLETED') {
      showToast("This week's body-weight submission has already been completed and locked.");
      return;
    }

    // 1. Synchronously get latest state from shedsRef to prevent rapid-click race conditions
    const nextSheds = applyLineWeightDeletion(shedsRef.current, currentShed.id, currentPart.id, currentLine.id, idx);
    shedsRef.current = nextSheds;
    setSheds(nextSheds);

    if (activeFarmId) {
      const lineWeights = nextSheds.find(s => s.id === currentShed.id)?.parts?.find(p => p.id === currentPart.id)?.lines?.find(l => String(l.id) === String(currentLine.id))?.weights || [];
      localStorage.setItem(`flock_draft_${activeFarmId}_${ageWeek}_${currentShed.id}_${currentPart.id}_${currentLine.id}`, JSON.stringify({ weights: lineWeights }));
      localStorage.setItem(`poultry_draft_${activeFarmId}_${ageWeek}`, JSON.stringify({ sheds: nextSheds, updatedAt: Date.now() }));
      localStorage.setItem(`poultry_farm_${activeFarmId}_${ageWeek}`, JSON.stringify({ sheds: nextSheds, farmName, date, ageWeek, season }));
    }

    // 2. Automatically mark session as DRAFT
    markSessionAsDraft('Deleted bird weight');
  };

  const handleClearLineWeights = () => {
    const currentShed = shedsRef.current.find(s => s.id === selectedShedId) || shedsRef.current[0] || null;
    const currentPart = currentShed?.parts?.find(p => p.id === selectedPartId) || currentShed?.parts?.[0] || null;
    const currentLine = currentPart?.lines?.find(l => String(l.id) === String(selectedLineId)) || currentPart?.lines?.[0] || null;

    if (!currentShed || !currentPart || !currentLine || currentLine.weights.length === 0) return;

    if (farmStatus === 'COMPLETED') {
      showToast("This week's body-weight submission has already been completed and locked.");
      return;
    }

    if (window.confirm(`Clear all ${currentLine.weights.length} weights in ${currentLine.name}?`)) {
      const nextSheds = applyLineWeightClear(shedsRef.current, currentShed.id, currentPart.id, currentLine.id);
      shedsRef.current = nextSheds;
      setSheds(nextSheds);
      if (activeFarmId) {
        localStorage.setItem(`flock_draft_${activeFarmId}_${ageWeek}_${currentShed.id}_${currentPart.id}_${currentLine.id}`, JSON.stringify({ weights: [] }));
        localStorage.setItem(`poultry_draft_${activeFarmId}_${ageWeek}`, JSON.stringify({ sheds: nextSheds, updatedAt: Date.now() }));
        localStorage.setItem(`poultry_farm_${activeFarmId}_${ageWeek}`, JSON.stringify({ sheds: nextSheds, farmName, date, ageWeek, season }));
      }
      showToast(`Cleared weights in ${currentLine.name}`);
      markSessionAsDraft('Cleared line weights');
    }
  };

  // --- FINAL SUBMISSION: COMPLETE FARM WEIGHING (status: 'COMPLETED') ---
  const handleCompleteFarmSubmission = async () => {
    if (isSubmittingBatch) return;

    if (farmStatus === 'COMPLETED') {
      showToast("This week's body-weight submission has already been completed and locked.");
      return;
    }

    // 1. Full Farm Completion Check: Block submission if any line has < 10 weights
    if (!completionStats.isFarm100PercentWeighed || completionStats.incompleteLines.length > 0) {
      showToast(`Cannot submit yet! All lines across all configured sheds must be completed with at least 10 birds. (${completionStats.incompleteLines.length} line(s) incomplete).`);
      setShowIncompleteAlertModal(true);
      return;
    }

    setIsSubmittingBatch(true);
    setFarmStatus('UPLOADING');
    setSyncStatus('saving');
    setUploadErrorMessage(null);

    const now = new Date();
    const formattedSubmittedAt = `Date(${formatDateDMY(now)}) - Time(${formatTime12H(now)})`;
    const timestampISO = now.toISOString();

    // 2. Calculate total birds across all sheds
    const totalBirdsCount = sheds.reduce(
      (acc, shed) => acc + shed.parts.reduce(
        (pAcc, part) => pAcc + part.lines.reduce(
          (lAcc, line) => lAcc + (line.weights?.length || 0), 0
        ), 0
      ), 0
    );

    // 3. Calculate Female & Male Act Body Weights across active farm using line-level gender
    const femaleWeights = sheds
      .flatMap(s => s.parts.flatMap(p => p.lines.filter(l => {
        const g = (l.gender || (s.type === 'Male' ? 'MALE' : 'FEMALE')).toUpperCase();
        return g === 'FEMALE';
      }).flatMap(l => l.weights || [])));
    const maleWeights = sheds
      .flatMap(s => s.parts.flatMap(p => p.lines.filter(l => {
        const g = (l.gender || (s.type === 'Male' ? 'MALE' : 'FEMALE')).toUpperCase();
        return g === 'MALE';
      }).flatMap(l => l.weights || [])));
    const femaleAvg = femaleWeights.length > 0 
      ? Math.round(femaleWeights.reduce((a, b) => a + b, 0) / femaleWeights.length) 
      : 0;
    const maleAvg = maleWeights.length > 0 
      ? Math.round(maleWeights.reduce((a, b) => a + b, 0) / maleWeights.length) 
      : 0;
    const allSampledWeights = [...femaleWeights, ...maleWeights];
    const farmOverallAvg = allSampledWeights.length > 0
      ? Math.round(allSampledWeights.reduce((a, b) => a + b, 0) / allSampledWeights.length)
      : (femaleAvg || maleAvg || 0);

    const userDisplayName = currentUser?.userName || currentUser?.name || 'Suresh Kumar';
    const userRole = currentUserRole;

    // 4. Stable Idempotency Key per batch attempt (Week-aware)
    let idempotencyKey = localStorage.getItem(`poultry_idempotency_${activeFarmId}_${ageWeek}`) || localStorage.getItem(`poultry_idempotency_${activeFarmId}`);
    if (!idempotencyKey) {
      idempotencyKey = `sub-${activeFarmId}-${ageWeek}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
      localStorage.setItem(`poultry_idempotency_${activeFarmId}_${ageWeek}`, idempotencyKey);
    }

    try {
      // 5. Submit to backend API (Atomic Transaction in Cloud DB)
      const response = await cloudApi.submitWeighingBatch({
        idempotencyKey,
        farmId: activeFarmId,
        flockAge: ageWeek,
        season,
        sheds,
        metadata: {
          totalBirds: totalBirdsCount,
          overallAvgWeight: farmOverallAvg,
          femaleAvgWeight: femaleAvg,
          maleAvgWeight: maleAvg,
          submittedAtDMY: formattedSubmittedAt,
          flockDate: date,
        }
      });

      // 6. Confirmed success from backend: NOW mark COMPLETED and clear local draft
      const submitterName = response.submission?.submitterName || userDisplayName;
      const submitterRole = response.submission?.submitterRole || userRole;

      const updatedAudit: FarmAudit = {
        status: 'COMPLETED',
        lastSubmittedAt: formattedSubmittedAt,
        lastSubmittedBy: submitterName,
        lastSubmittedRole: submitterRole,
        submittedBy: submitterName,
        submittedRole: submitterRole,
        lastEditedBy: submitterName,
        lastEditedRole: submitterRole,
        totalBirdsSubmitted: totalBirdsCount,
        totalBirdsAtLastSubmit: totalBirdsCount,
        femaleAvgWeight: femaleAvg,
        maleAvgWeight: maleAvg,
        isPendingSubmission: false,
      };

      setFarmStatus('COMPLETED');
      localStorage.setItem(`poultry_status_${activeFarmId}_${ageWeek}`, 'COMPLETED');
      localStorage.setItem(`poultry_status_${activeFarmId}`, 'COMPLETED');
      // Clear batch idempotency key & draft only after confirmed commit
      localStorage.removeItem(`poultry_idempotency_${activeFarmId}_${ageWeek}`);
      localStorage.removeItem(`poultry_idempotency_${activeFarmId}`);
      localStorage.setItem(`poultry_draft_${activeFarmId}_${ageWeek}`, JSON.stringify({ sheds, updatedAt: Date.now(), isCompleted: true }));
      localStorage.removeItem(`poultry_draft_${activeFarmId}`);
      setFarmAudit(updatedAudit);
      setIsPendingSubmission(false);
      localStorage.setItem(`poultry_audit_${activeFarmId}_${ageWeek}`, JSON.stringify(updatedAudit));
      localStorage.setItem(`poultry_audit_${activeFarmId}`, JSON.stringify(updatedAudit));
      localStorage.setItem(`poultry_pending_submission_${activeFarmId}`, 'false');

      setFarmsList(prev => prev.map(f => f.id === activeFarmId ? {
        ...f,
        status: 'COMPLETED',
        progressPercentage: 100,
        audit: updatedAudit,
        updatedAt: timestampISO
      } : f));

      // 7. Create activity log item
      const newSubmissionLog: ActivityLogItem = {
        id: `submit-${Date.now()}`,
        farmId: activeFarmId,
        farmName: farmName,
        userId: currentUser?.id,
        userName: `${submitterName} - ${submitterRole}`,
        action: `Batch Weighing Submitted • ${totalBirdsCount} Birds (♀ Act: ${femaleAvg > 0 ? femaleAvg + 'g' : 'N/A'}, ♂ Act: ${maleAvg > 0 ? maleAvg + 'g' : 'N/A'})`,
        sampleCount: totalBirdsCount,
        avgWeight: farmOverallAvg,
        femaleAvgWeight: femaleAvg,
        maleAvgWeight: maleAvg,
        status: 'COMPLETED',
        timestamp: timestampISO,
        isLive: false,
      };

      setActivityLogs(prev => [newSubmissionLog, ...prev.slice(0, 49)]);

      setSyncStatus('synced');
      setLastUpdatedString('Updated Just now');
      setLastServerUpdatedAt(timestampISO);
      showToast('Batch submitted and committed to cloud database successfully! You may now download the official worksheet.');

      // Refresh farms from persistent database so Admin dashboard displays accurate submission counts and audit data (Req 2)
      try {
        const freshFarms = await cloudApi.getFarms();
        if (freshFarms && freshFarms.length > 0) {
          setFarmsList(freshFarms);
          localStorage.setItem('poultry_farms_list_v4', JSON.stringify(freshFarms));
        }
      } catch (refErr) {
        console.warn('Could not auto-refresh farm list after submit:', refErr);
      }
    } catch (err: any) {
      console.warn('Batch upload failed:', err);
      if (err?.status === 409 || err?.locked || err?.message?.includes('already been completed and locked')) {
        setFarmStatus('COMPLETED');
        if (activeFarmId) {
          localStorage.setItem(`poultry_status_${activeFarmId}_${ageWeek}`, 'COMPLETED');
          localStorage.setItem(`poultry_status_${activeFarmId}`, 'COMPLETED');
        }
        setSyncStatus('synced');
        showToast("This week's body-weight submission has already been completed and locked.");
        return;
      }
      // FAILED UPLOAD: Preserve draft locally! DO NOT mark completed!
      setFarmStatus('UPLOAD_FAILED');
      localStorage.setItem(`poultry_status_${activeFarmId}`, 'UPLOAD_FAILED');
      setSyncStatus('offline');
      const errorMsg = sanitizeErrorMessage(err?.message || 'Server is not connected');
      setUploadErrorMessage(errorMsg);
      showToast('Upload failed. Your draft is preserved locally. Please retry when the connection returns.');
    } finally {
      setIsSubmittingBatch(false);
    }
  };

  // --- PART MANAGEMENT HANDLERS ---
  const handleAddPart = () => {
    if (!activeShed) return;
    if (isAddingPartRef.current) return;
    isAddingPartRef.current = true;

    const shedId = activeShed.id;
    const allowedLetters = ['A', 'B', 'C', 'D'];
    const existingLetters = new Set(
      activeShed.parts.map(p => {
        const clean = (p.name || '').replace(/^part\s*[:\-]?\s*/i, '').trim().toUpperCase();
        return allowedLetters.includes(clean[0]) ? clean[0] : null;
      }).filter((l): l is string => l !== null)
    );

    if (activeShed.parts.length >= 4 || existingLetters.size >= 4) {
      showToast('Maximum limit reached: A shed can have at most 4 parts (Part A to Part D).');
      isAddingPartRef.current = false;
      return;
    }

    let nextLetter = 'A';
    for (const letter of allowedLetters) {
      if (!existingLetters.has(letter)) {
        nextLetter = letter;
        break;
      }
    }

    const partName = `Part ${nextLetter}`;
    const newPartId = `part-${Date.now()}-${nextLetter.toLowerCase()}`;
    const newPart: ShedPart = {
      id: newPartId,
      name: partName,
      lines: [{ id: `line-${Date.now()}-1`, name: 'Line 1', weights: [] }]
    };

    setSheds(prev => prev.map(s => {
      if (s.id !== shedId) return s;
      if (s.parts.some(p => p.name.trim().toLowerCase() === partName.toLowerCase())) {
        return s;
      }
      const updatedParts = [...s.parts, newPart].sort((a, b) => {
        const letA = (a.name.replace(/^part\s*/i, '').trim().toUpperCase()[0] || 'Z');
        const letB = (b.name.replace(/^part\s*/i, '').trim().toUpperCase()[0] || 'Z');
        return letA.localeCompare(letB);
      });
      return { ...s, parts: updatedParts };
    }));
    setSelectedPartId(newPartId);
    setSelectedLineId(newPart.lines[0].id);
    showToast(`${partName} added to ${activeShed.name}`);
    markSessionAsDraft('Added part');

    setSyncStatus('saving');
    cloudApi.addPart({ shedId, name: partName })
      .then((createdPart) => {
        if (createdPart?.id) {
          setSheds(prev => prev.map(s => s.id === shedId ? {
            ...s,
            parts: s.parts.map(p => (p.id === newPartId || p.name === partName) ? {
              ...p,
              id: createdPart.id,
              lines: createdPart.lines?.length ? createdPart.lines : p.lines
            } : p)
          } : s));
          setSelectedPartId(createdPart.id);
          if (createdPart.lines?.[0]) setSelectedLineId(createdPart.lines[0].id);
        }
        setSyncStatus('synced');
      })
      .catch((err) => {
        console.warn('Backend addPart failed, retaining local part:', err);
        setSyncStatus('offline');
      })
      .finally(() => {
        isAddingPartRef.current = false;
      });
  };

  const handleStartEditPart = (part: ShedPart) => {
    setEditingPart({ id: part.id, name: part.name });
  };

  const handleSaveEditPart = () => {
    if (!editingPart || !editingPart.name.trim() || !activeShed) return;
    const clean = editingPart.name.trim();
    const withoutPart = clean.replace(/^part\s*[:\-]?\s*/i, '').trim();
    const letter = (withoutPart || clean).toUpperCase()[0];
    if (!['A', 'B', 'C', 'D'].includes(letter)) {
      showToast('Only Parts A, B, C, and D are allowed. Part E or higher is prohibited.');
      return;
    }
    const formattedPartName = `Part ${letter}`;
    const partId = editingPart.id;

    const duplicate = activeShed.parts.some(p => p.id !== partId && p.name.trim().toLowerCase() === formattedPartName.toLowerCase());
    if (duplicate) {
      showToast(`${formattedPartName} already exists in this shed.`);
      return;
    }

    setSheds(prev => prev.map(s => {
      if (s.id !== activeShed.id) return s;
      return {
        ...s,
        parts: s.parts.map(p => p.id === partId ? { ...p, name: formattedPartName } : p)
      };
    }));
    showToast(`Part renamed to "${formattedPartName}".`);
    setEditingPart(null);

    cloudApi.updatePart(partId, formattedPartName).catch(() => {});
  };

  const handleDeletePart = (partId: string, e?: React.MouseEvent) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    if (!activeShed) return;
    if (activeShed.parts.length <= 1) {
      showToast('Cannot delete part: A shed must have at least 1 part.');
      return;
    }
    const target = activeShed.parts.find(p => p.id === partId);
    if (!target) return;

    const totalWeights = target.lines.reduce((acc, l) => acc + (l.weights?.length || 0), 0);
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
    if (isAddingLineRef.current) return;
    isAddingLineRef.current = true;

    const shedId = activeShed.id;
    const partId = activePart.id;

    // Detect all existing line numbers between 1 and 16
    const existingNums = new Set(
      activePart.lines
        .map(l => {
          const match = (l.name || '').match(/\d+/);
          if (match) {
            const parsed = parseInt(match[0], 10);
            if (parsed >= 1 && parsed <= 16) return parsed;
          }
          if (typeof l.id === 'number' && l.id >= 1 && l.id <= 16) return l.id;
          return null;
        })
        .filter((n): n is number => n !== null)
    );

    if (activePart.lines.length >= 16 || existingNums.size >= 16) {
      showToast('Maximum limit reached: A part can have at most 16 lines (Line 1 to Line 16).');
      isAddingLineRef.current = false;
      return;
    }

    // Pick lowest available line number 1..16
    let nextNum = 1;
    for (let i = 1; i <= 16; i++) {
      if (!existingNums.has(i)) {
        nextNum = i;
        break;
      }
    }

    const newLineName = `Line ${nextNum}`;
    const tempLineId = `line-${Date.now()}-${nextNum}`;
    const newLine: PenLine = {
      id: tempLineId,
      name: newLineName,
      weights: []
    };

    setSheds(prev => prev.map(s => {
      if (s.id !== shedId) return s;
      return {
        ...s,
        parts: s.parts.map(p => {
          if (p.id !== partId) return p;
          if (p.lines.some(l => l.name.trim().toLowerCase() === newLineName.toLowerCase())) {
            return p;
          }
          const updatedLines = [...p.lines, newLine].sort((a, b) => {
            const mA = a.name.match(/\d+/);
            const mB = b.name.match(/\d+/);
            const numA = mA ? parseInt(mA[0], 10) : 0;
            const numB = mB ? parseInt(mB[0], 10) : 0;
            return numA - numB;
          });
          return {
            ...p,
            lines: updatedLines
          };
        })
      };
    }));
    setSelectedLineId(tempLineId);
    showToast(`${newLineName} added to ${activePart.name}`);
    markSessionAsDraft('Added line');

    setSyncStatus('saving');
    cloudApi.addLine({ partId, name: newLineName })
      .then((createdLine) => {
        if (createdLine?.id) {
          setSheds(prev => prev.map(s => s.id === shedId ? {
            ...s,
            parts: s.parts.map(p => p.id === partId ? {
              ...p,
              lines: p.lines.map(l => (String(l.id) === String(tempLineId) || l.name === newLineName)
                ? { ...l, id: createdLine.id, name: createdLine.name || newLineName }
                : l
              )
            } : p)
          } : s));
          setSelectedLineId(createdLine.id);
        }
        setSyncStatus('synced');
      })
      .catch((err) => {
        console.warn('Backend addLine failed, retaining local line:', err);
        setSyncStatus('offline');
      })
      .finally(() => {
        isAddingLineRef.current = false;
      });
  };

  const handleDeleteLine = (lineId: number | string, e?: React.MouseEvent) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    if (!activeShed || !activePart) return;
    if (activePart.lines.length <= 1) {
      showToast('Cannot delete line: A part must have at least 1 pen line.');
      return;
    }
    const target = activePart.lines.find(l => String(l.id) === String(lineId));
    if (!target) return;

    if (!target.weights || target.weights.length === 0) {
      executeDeleteLine(lineId);
    } else {
      setLinePendingDelete({ id: target.id, name: target.name, weights: target.weights });
    }
  };

  const executeDeleteLine = (lineId: number | string) => {
    if (!activeShed || !activePart) return;
    const rawRemaining = activePart.lines.filter(l => String(l.id) !== String(lineId));
    // Auto-reindex lines sequentially so numbering starts from Line 1 without gaps
    const remaining = rawRemaining.map((line, idx) => ({
      ...line,
      name: `Line ${idx + 1}`,
      lineNumber: idx + 1,
    }));
    setSheds(prev => prev.map(s => {
      if (s.id !== activeShed.id) return s;
      return {
        ...s,
        parts: s.parts.map(p => p.id === activePart.id ? { ...p, lines: remaining } : p)
      };
    }));
    setSelectedLineId(prev => (String(prev) === String(lineId) ? (remaining[0]?.id || '') : prev));
    setLinePendingDelete(null);
    showToast('Line deleted.');
    markSessionAsDraft('Deleted line');

    cloudApi.deleteLine(lineId).catch(() => {});
  };

  // --- SHED CREATION & EDITING ---
  const handleAddShed = () => {
    const trimmed = newShedName.trim();
    if (!trimmed) return;
    if (isAddingShedRef.current) return;

    // Prevent duplicate shed names (Task 4)
    if (sheds.some(s => s.name.trim().toLowerCase() === trimmed.toLowerCase())) {
      showToast(`A shed named "${trimmed}" already exists.`);
      return;
    }

    isAddingShedRef.current = true;
    const newId = String(Date.now());
    const newShed: ShedData = {
      id: newId,
      name: trimmed,
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
    setSheds(prev => {
      const updated = [...prev, newShed];
      shedsRef.current = updated;
      return updated;
    });
    setSelectedShedId(newId);
    setSelectedPartId(newShed.parts[0].id);
    setSelectedLineId(1);
    setNewShedName('');
    setShowAddShedModal(false);
    showToast(`Created ${newShed.name}`);
    markSessionAsDraft('Added shed');

    setSyncStatus('saving');
    cloudApi.addShed({ farmId: activeFarmId, name: trimmed, type: newShedType })
      .then((createdShed) => {
        if (createdShed?.id) {
          setSheds(prev => {
            const updated = prev.map(s => s.id === newId ? { ...s, id: createdShed.id, parts: createdShed.parts || s.parts } : s);
            shedsRef.current = updated;
            return updated;
          });
          setSelectedShedId(createdShed.id);
        }
        setSyncStatus('synced');
        setLastUpdatedString('Updated Just now');
      })
      .catch(() => setSyncStatus('offline'))
      .finally(() => {
        isAddingShedRef.current = false;
      });
  };

  const handleStartEditShed = (shed: ShedData) => {
    setEditingShed({ id: shed.id, name: shed.name, type: shed.type });
  };

  const handleSaveEditShed = () => {
    if (!editingShed || !editingShed.name.trim()) return;
    const trimmed = editingShed.name.trim();
    const shedId = editingShed.id;
    const shedType = editingShed.type;

    if (sheds.some(s => s.id !== shedId && s.name.trim().toLowerCase() === trimmed.toLowerCase())) {
      showToast(`A shed named "${trimmed}" already exists.`);
      return;
    }

    const updated = sheds.map(s => s.id === shedId ? { ...s, name: trimmed, type: shedType } : s);
    setSheds(updated);
    shedsRef.current = updated;

    if (activeFarmId) {
      localStorage.setItem(`poultry_draft_${activeFarmId}_${ageWeek}`, JSON.stringify({ sheds: updated, updatedAt: Date.now() }));
      localStorage.setItem(`poultry_farm_${activeFarmId}_${ageWeek}`, JSON.stringify({ sheds: updated, farmName, date, ageWeek, season }));
    }

    showToast(`Saved ${trimmed}`);
    setEditingShed(null);
    markSessionAsDraft('Renamed shed');

    setSyncStatus('saving');
    cloudApi.updateShed(shedId, { name: trimmed, type: shedType }, ageWeek)
      .then(() => setSyncStatus('synced'))
      .catch((err) => {
        console.warn('Backend updateShed failed:', err);
        setSyncStatus('offline');
      });
  };

  const handleDeleteShed = (shedId: string, e?: React.MouseEvent) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    if (sheds.length <= 1) {
      showToast('Cannot delete shed: A farm must have at least 1 shed.');
      return;
    }
    const target = sheds.find(s => s.id === shedId);
    if (!target) return;

    // Calculate total weights in this shed
    const totalWeights = (target.parts || []).reduce(
      (acc, p) => acc + (p.lines || []).reduce((lAcc, l) => lAcc + (l.weights?.length || 0), 0),
      0
    );

    if (totalWeights === 0) {
      executeDeleteShed(shedId);
    } else {
      setShedPendingDelete({ id: target.id, name: target.name, totalWeights });
    }
  };

  const executeDeleteShed = (shedId: string) => {
    const target = sheds.find(s => s.id === shedId);
    const shedName = target?.name || 'Shed';
    const remainingSheds = sheds.filter(s => s.id !== shedId);

    // Clean up local line drafts for this shed
    if (activeFarmId && target) {
      (target.parts || []).forEach(p => {
        (p.lines || []).forEach(l => {
          localStorage.removeItem(`flock_draft_${activeFarmId}_${ageWeek}_${target.id}_${p.id}_${l.id}`);
          localStorage.removeItem(`flock_draft_${activeFarmId}_${target.id}_${p.id}_${l.id}`);
        });
      });
    }

    setSheds(remainingSheds);
    shedsRef.current = remainingSheds;

    if (selectedShedId === shedId) {
      const fallback = remainingSheds[0];
      if (fallback) {
        setSelectedShedId(fallback.id);
        const firstPart = fallback.parts?.[0];
        if (firstPart) {
          setSelectedPartId(firstPart.id);
          setSelectedLineId(firstPart.lines?.[0]?.id || 1);
        } else {
          setSelectedPartId('');
          setSelectedLineId('');
        }
      } else {
        setSelectedShedId('');
        setSelectedPartId('');
        setSelectedLineId('');
      }
    }

    if (activeFarmId) {
      localStorage.setItem(`poultry_draft_${activeFarmId}_${ageWeek}`, JSON.stringify({ sheds: remainingSheds, updatedAt: Date.now() }));
      localStorage.setItem(`poultry_farm_${activeFarmId}_${ageWeek}`, JSON.stringify({ sheds: remainingSheds, farmName, date, ageWeek, season }));
    }

    setShedPendingDelete(null);
    showToast(`${shedName} deleted.`);
    markSessionAsDraft('Deleted shed');

    setSyncStatus('saving');
    cloudApi.deleteShed(shedId, ageWeek)
      .then(() => setSyncStatus('synced'))
      .catch((err) => {
        console.warn('Backend deleteShed failed:', err);
        setSyncStatus('offline');
      });
  };

  // --- COMPLETE 13-SHEET WORKBOOK EXPORT ---
  const handleDownloadExcel = async () => {
    try {
      setIsExporting(true);
      setExportMessage('Generating 13-Sheet Excel Workbook...');
      showToast('Generating complete 13-sheet Excel workbook...');
      let activeName = currentActiveFarmSummary?.name || farmName;
      if (!activeName || /^[0-9a-fA-F-]{16,}$/.test(activeName) || /^(shed|farm|flock|user)[-_]/i.test(activeName)) {
        const found = farmsList.find(f => f.id === activeFarmId);
        if (found && found.name && !/^[0-9a-fA-F-]{16,}$/.test(found.name)) {
          activeName = found.name;
        } else {
          activeName = 'Poultry_Flock';
        }
      }
      const res = await exportPoultryWorkbook({
        farmName: activeName,
        batchName: activeBatchName || undefined,
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
        showToast(res.method === 'share' ? 'Shared successfully!' : `Downloaded ${res.fileName} successfully!`);
      } else if (res.method !== 'aborted') {
        showToast('Download could not complete.');
      }

    } catch (err: any) {
      console.error('Workbook export error:', err);
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

      <div className="flex justify-center bg-slate-100/70 min-h-screen text-slate-800 font-sans antialiased selection:bg-emerald-500 selection:text-white">
        <div className={`w-full min-h-screen bg-slate-50 flex flex-col relative pb-8 transition-all duration-300 overflow-x-hidden ${
          !isAuthenticated
            ? 'w-full max-w-md mx-auto px-4 bg-transparent'
            : (currentUserRole === 'Supervisor')
              ? 'max-w-md mx-auto px-2 sm:px-3 shadow-2xl border-x border-slate-200'
              : 'max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 border-x border-slate-200/80 shadow-xl'
        }`}>
        
        {!isAuthenticated ? (
          <LoginScreen onLoginSuccess={handleLoginSuccess} />
        ) : (
          <>
        {/* ========================================================= */}
        {/* 1. DUAL DASHBOARD ARCHITECTURE (Req 1 & 5)                */}
        {/* ========================================================= */}
        {currentScreen === 'home' && (
          currentUserRole === 'Admin' || currentUserRole === 'Manager' || currentUserRole === 'In-Charge' ? (
            // Dashboard B: Executive Overview (Manager & In-Charge)
            <ManagerAdminDashboard
              currentUser={currentUser}
              farms={farmsList}
              activeFarmId={activeFarmId}
              onSelectFarm={(farmId) => {
                switchFarm(farmId);
              }}
              onOpenConclusion={(farmId) => {
                setActiveFarmId(farmId);
                localStorage.setItem('poultry_active_farm_id', farmId);
                const targetFarm = farmsList.find(f => f.id === farmId);
                if (targetFarm) {
                  setFarmName(targetFarm.name);
                  if (targetFarm.flockDate) setDate(targetFarm.flockDate);
                  if (targetFarm.ageWeek) setAgeWeek(targetFarm.ageWeek);
                  if (targetFarm.season) setSeason(targetFarm.season as any);
                  if (targetFarm.activeBatch?.id) {
                    setActiveBatchId(targetFarm.activeBatch.id);
                    setActiveBatchName(targetFarm.activeBatch.batchName);
                  }
                }
                navigateTo('conclusion');
                switchFarm(farmId, true);
              }}
              onAssignUser={handleAssignUserToFarm}
              onViewSubmissionsUpdate={() => navigateTo('history')}
              onOpenSetup={() => navigateTo('setup')}
              onOpenAuth={() => navigateTo('auth')}
              onLogout={handleLogout}
              onNewFarm={handleOpenNewFarmModal}
              onRefreshFarms={handleManualRefresh}
              onDeleteFarm={handleDeleteFarm}
              onRenameFarm={handleRenameFarm}
              activeBatchId={activeBatchId}
              onSelectBatch={handleSelectBatch}
              currentWeek={ageWeek}
              onSwitchWeek={handleSwitchWeek}
            />
          ) : (() => {
            const savedShedsList = sheds.filter(s => {
              const l = shedLocks[s.id];
              return l?.savedStatus === 'SAVED' || (s as any).savedStatus === 'SAVED';
            });
            const savedShedsCount = savedShedsList.length;
            const totalShedsCount = sheds.length;
            const isAllShedsSaved = totalShedsCount > 0 && savedShedsCount >= totalShedsCount;
            const totalFarmBirdsCount = sheds.reduce((acc, s) => {
              const l = shedLocks[s.id];
              const sCount = (s.parts || []).flatMap(p => (p.lines || []).flatMap(line => line.weights || [])).length;
              return acc + (l?.totalBirdCount !== undefined ? l.totalBirdCount : sCount);
            }, 0);

            return (
              // Dashboard A: Field Operator Dashboard (Supervisor & Incharge)
              <SupervisorDashboard
                currentUser={currentUser}
                activeFarm={currentActiveFarmSummary}
                assignedFarms={accessibleFarms}
                completionStats={completionStats}
                farmStatus={farmStatus}
                formattedDateTime={formattedDateTime}
                onSilentReload={handleManualRefresh}
                onSelectFarm={(farmId) => {
                  switchFarm(farmId);
                }}
                onStartWeighing={navigateToShedSelect}
                onOpenSubmitPage={() => navigateTo('submit_page')}
                onViewSubmissionsUpdate={() => navigateTo('history')}
                onOpenAuth={() => navigateTo('auth')}
                onLogout={handleLogout}
                onRenameFarm={handleRenameFarm}
                currentWeek={ageWeek}
                onSwitchWeek={handleSwitchWeek}
                weekStatusMap={weekStatusMap}
                savedShedsCount={savedShedsCount}
                totalShedsCount={totalShedsCount}
                totalFarmBirdsCount={totalFarmBirdsCount}
                isAllShedsSaved={isAllShedsSaved}
                onSubmitOverallFarm={() => setShowOverallSubmitConfirmModal(true)}
                sheds={sheds}
                shedLocks={shedLocks}
                onEnterShed={handleEnterShed}
                onStartEditShed={handleStartEditShed}
                onDeleteShed={handleDeleteShed}
                onForceUnlock={handleForceUnlock}
                onAddShed={() => setShowAddShedModal(true)}
                isEnteringShed={isEnteringShed}
                isForceUnlockingShed={isForceUnlockingShed}
                isFieldWorker={isFieldWorker}
                stdWeightFemale={stdWeightFemale}
                stdWeightMale={stdWeightMale}
                weekNum={weekNum}
                syncStatus={syncStatus}
                pendingSyncCount={pendingSyncCount}
              />
            );
          })()
        )}

        {/* ========================================================= */}
        {/* DEDICATED FULL-SCREEN SUBMISSION PAGE (Req 3 & 6)         */}
        {/* ========================================================= */}
        {currentScreen === 'submit_page' && (
          <DedicatedSubmitScreen
            farm={currentActiveFarmSummary}
            batchName={activeBatchName}
            completionStats={completionStats}
            farmStatus={farmStatus}
            farmAudit={farmAudit}
            syncStatus={syncStatus}
            pendingSyncCount={pendingSyncCount}
            isSubmittingBatch={isSubmittingBatch}
            totalBirdsWeighed={sheds.reduce((acc, s) => acc + s.parts.reduce((pAcc, p) => pAcc + p.lines.reduce((lAcc, l) => lAcc + (l.weights?.length || 0), 0), 0), 0)}
            totalShedsCount={sheds.length}
            totalPartsCount={sheds.reduce((acc, s) => acc + s.parts.length, 0)}
            uploadErrorMessage={uploadErrorMessage}
            canSaveDraft={currentUserRole === 'Supervisor' || currentUserRole === 'In-Charge'}
            isSavingDraft={isSavingDraft}
            onSaveDraft={handleManualSaveDraft}
            onBack={handleGoHome}
            onSubmitUpload={handleCompleteFarmSubmission}
            onRetryUpload={handleCompleteFarmSubmission}
            onDownloadExcel={handleDownloadExcel}
            onJumpToLine={jumpToIncompleteLine}
          />
        )}

        {/* ========================================================= */}
        {/* 2. SHED SELECTION SCREEN (CLEAN LIGHT CARDS)              */}
        {/* ========================================================= */}
        {/* ========================================================= */}
        {/* 2. SHED SELECTION SCREEN (CLEAN LIGHT CARDS)              */}
        {/* ========================================================= */}
        {currentScreen === 'shed_select' && (
          <div className="flex-1 flex flex-col p-2 sm:p-4 animate-in slide-in-from-right duration-150">
            <div className="flex items-center justify-between mb-4">
              <button 
                onClick={handleGoHome} 
                className="flex items-center gap-1.5 text-xs font-bold text-slate-700 bg-white hover:bg-slate-100 px-3 py-1.5 rounded-xl border border-slate-200 shadow-xs active:scale-95 cursor-pointer"
                title="Return to Dashboard Home"
              >
                <ArrowLeft className="w-4 h-4" /> Home
              </button>
              <h2 className="text-xs font-black text-emerald-700 uppercase tracking-wide bg-emerald-50 px-3 py-1 rounded-full border border-emerald-200">
                Select Shed
              </h2>
            </div>

            {/* Active Farm Header with Rename Option & Dedicated Responsive Recording-Week Selection Form */}
            <div className="bg-white p-3.5 sm:p-4 rounded-2xl border border-slate-200 shadow-2xs mb-4">
              {/* Farm Name & Metadata Row */}
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">Active Farm</span>
                  <h1 className="text-base sm:text-lg font-black text-slate-900 truncate block mt-0.5">
                    {currentActiveFarmSummary?.name || farmName || (farmsList.find(f => f.id === activeFarmId)?.name) || 'Active Farm'}
                  </h1>
                  <div className="flex items-center gap-2 mt-1 text-xs text-slate-500 flex-wrap">
                    <span>{currentActiveFarmSummary?.season || season} Brood</span>
                    <span>•</span>
                    <span className="font-semibold text-slate-700">{sheds.length} Sheds</span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setEditFarmNameInput(currentActiveFarmSummary?.name || farmName || '');
                    setEditFarmNameError(null);
                    setShowEditFarmModal(true);
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-emerald-50 text-slate-700 hover:text-emerald-700 rounded-xl border border-slate-200 text-xs font-bold transition active:scale-95 cursor-pointer shrink-0 shadow-2xs"
                  title="Rename Farm"
                >
                  <Edit3 className="w-3.5 h-3.5" />
                  <span className="text-xs">Edit Name</span>
                </button>
              </div>

              {/* Dedicated Responsive Recording-Week Selection Form (Fits 320px, 360px, 375px, 414px, Tablet, Desktop) */}
              <div className="mt-3 pt-3 border-t border-slate-100">
                <div className="flex items-center justify-between gap-2 mb-1.5 flex-wrap">
                  <label htmlFor="shed-recording-week-select" className="text-[11px] font-black uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                    <span>Select Recording Week</span>
                  </label>
                  <div className="flex items-center gap-2 text-[10px] font-bold text-slate-500">
                    <span className="inline-flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0"></span>
                      <span>Completed</span>
                    </span>
                    <span>•</span>
                    <span className="inline-flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full bg-amber-400 shrink-0"></span>
                      <span>Draft</span>
                    </span>
                  </div>
                </div>

                <div className="relative w-full min-w-0">
                  {isFieldWorker ? (
                    <div className="w-full min-w-0 bg-emerald-50/80 border border-emerald-300/80 rounded-xl px-3 py-2 text-xs font-black text-emerald-950 flex items-center justify-between">
                      <span>{ageWeek}</span>
                      <span className="text-[10px] text-emerald-800 font-bold">
                        {weekStatusMap?.[ageWeek] === 'COMPLETED' ? '🟢 Completed' : '🟡 In-Progress'} (Active Week)
                      </span>
                    </div>
                  ) : (
                    <>
                      <select
                        id="shed-recording-week-select"
                        value={ageWeek}
                        onChange={(e) => handleSwitchWeek(e.target.value)}
                        className="w-full min-w-0 max-w-full bg-emerald-50/80 hover:bg-emerald-100/70 border border-emerald-300/80 rounded-xl pl-3 pr-8 py-2 text-xs font-black text-emerald-950 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-600 transition cursor-pointer appearance-none truncate"
                        title="Change Recording Week"
                      >
                        {Array.from({ length: 24 }, (_, i) => `W${i + 1}`).map((w) => {
                          const wStatus = weekStatusMap?.[w];
                          const statusIcon = wStatus === 'COMPLETED' ? '🟢' : '🟡';
                          const statusText = wStatus === 'COMPLETED' ? 'COMPLETED' : 'DRAFT';
                          const farmAnchor = currentActiveFarmSummary || { flockDate: date, ageWeek };
                          const initialWeek = currentActiveFarmSummary?.startWeekNumber || currentActiveFarmSummary?.initialAgeWeek || currentActiveFarmSummary?.startingWeek || currentActiveFarmSummary?.ageWeek;
                          return (
                            <option key={w} value={w} className="text-slate-900 bg-white py-1">
                              {w} — {statusIcon} {formatRecordingWeekLabel(w, farmAnchor, initialWeek)} ({statusText})
                            </option>
                          );
                        })}
                      </select>
                      <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2.5 text-emerald-700">
                        <ChevronDown className="w-4 h-4" />
                      </div>
                    </>
                  )}
                </div>

                {/* Active Recording Period Date Range & Status Strip */}
                <div className="mt-1.5 flex items-center justify-between text-[11px] text-emerald-900 bg-emerald-50/60 px-2.5 py-1.5 rounded-lg border border-emerald-100 flex-wrap gap-1">
                  <span className="font-semibold truncate min-w-0 flex-1">
                    {formatRecordingWeekLabel(
                      ageWeek,
                      currentActiveFarmSummary || { flockDate: date, ageWeek },
                      currentActiveFarmSummary?.startWeekNumber || currentActiveFarmSummary?.initialAgeWeek || currentActiveFarmSummary?.startingWeek || currentActiveFarmSummary?.ageWeek
                    )}
                  </span>
                  <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-emerald-100/80 text-emerald-800 shrink-0">
                    {weekStatusMap?.[ageWeek] === 'COMPLETED' ? '🟢 Completed' : '🟡 In-Progress'}
                  </span>
                </div>
              </div>
            </div>



            <p className="text-xs text-slate-500 mb-3 px-1 font-medium">Select a shed to view parts and pen lines:</p>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 pb-6 overflow-y-auto flex-1">
              {sheds.length === 0 ? (
                <div className="col-span-full bg-white p-8 rounded-3xl border border-slate-200 text-center space-y-3 my-4 shadow-xs">
                  <div className="w-14 h-14 bg-emerald-50 rounded-2xl flex items-center justify-center mx-auto text-emerald-600 border border-emerald-200">
                    <Grid className="w-7 h-7" />
                  </div>
                  <h3 className="font-black text-slate-900 text-base">No sheds created yet</h3>
                  <p className="text-xs text-slate-500 max-w-xs mx-auto leading-relaxed">
                    This farm has no sheds configured. Click below to add the first shed.
                  </p>
                  <button
                    type="button"
                    onClick={() => setShowAddShedModal(true)}
                    className="inline-flex items-center gap-1.5 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-black shadow-md shadow-emerald-600/20 active:scale-95 transition cursor-pointer"
                  >
                    <Plus className="w-4 h-4" /> Add First Shed
                  </button>
                </div>
              ) : (
                sheds.map((s, sIdx) => {
                  const sAllWeights = (s.parts || []).flatMap(p => (p.lines || []).flatMap(l => l.weights || []));
                  const shedGender = s.type === 'Male' ? 'Male' : (s.parts?.some(p => p.lines?.some(l => (l.gender || '').toUpperCase() === 'MALE')) ? 'Male' : 'Female');
                  const shedStd = shedGender === 'Male' ? stdWeightMale : stdWeightFemale;
                  const sStats = calculateFlockStats(sAllWeights, shedStd, weekNum);

                  const lock = shedLocks[s.id] || {
                    locked: Boolean(s.lockedByUserId),
                    lockedByUserId: s.lockedByUserId,
                    lockedByUserName: s.lockedByUserName,
                    lastHeartbeatAt: s.lastHeartbeatAt,
                    recordedByUserId: s.recordedByUserId,
                    recordedByUserName: s.recordedByUserName,
                    savedStatus: (s as any).savedStatus,
                    savedByUserName: (s as any).savedByUserName,
                    totalBirdCount: (s as any).totalBirdCount,
                  };

                  const currentUserId = currentUser?.id;
                  const isLockActive = Boolean(lock?.locked && lock.lockedByUserId);
                  const isLockedByMe = Boolean(isLockActive && lock.lockedByUserId === currentUserId);
                  const isLockedByOther = Boolean(isLockActive && lock.lockedByUserId !== currentUserId);

                  const isSaved = lock?.savedStatus === 'SAVED';
                  const savedByName = lock?.savedByUserName || (lock?.savedStatus === 'SAVED' ? (lock?.recordedByUserName || s.recordedByUserName) : null);
                  const savedBirdsCount = lock?.totalBirdCount !== undefined ? lock.totalBirdCount : sStats.count;

                  let cardBorderClass = "border-slate-200 bg-white hover:bg-slate-50/70";
                  if (isLockedByOther) {
                    cardBorderClass = "border-amber-300 bg-amber-50/40 shadow-sm opacity-90 ring-1 ring-amber-300/60";
                  } else if (isLockedByMe) {
                    cardBorderClass = "border-emerald-400 bg-emerald-50/50 shadow-sm ring-2 ring-emerald-500/25";
                  } else if (isSaved) {
                    cardBorderClass = "border-emerald-300 bg-emerald-50/20 hover:bg-emerald-50/40 shadow-xs ring-1 ring-emerald-400/40";
                  }

                  return (
                    <div
                      key={`${s.id || sIdx}-${s.name}-${sIdx}`}
                      onClick={() => handleEnterShed(s)}
                      className={`w-full p-4 rounded-2xl border flex flex-col justify-between gap-3 shadow-xs transition cursor-pointer select-none ${cardBorderClass}`}
                    >
                      <div>
                        {/* Shed Name Row with full width and Presence Badges */}
                        <div className="flex items-center justify-between gap-2 mb-2">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className={`font-black text-base truncate transition ${isLockedByOther ? 'text-slate-700' : 'text-slate-900 hover:text-emerald-600'}`}>
                              {s.name}
                            </span>
                          </div>

                          {/* Live Presence / Lock / Save Badge (Exact required format) */}
                          {isLockedByOther ? (
                            <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-0.5 rounded-full border bg-amber-100 text-amber-900 border-amber-300 animate-pulse shrink-0">
                              <span>🔒 Weighing: {lock.lockedByUserName || 'Incharge'}</span>
                            </span>
                          ) : isLockedByMe ? (
                            <span className="inline-flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-0.5 rounded-full border bg-emerald-100 text-emerald-800 border-emerald-300 shrink-0">
                              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
                              <span>Active (You)</span>
                            </span>
                          ) : isSaved ? (
                            <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-0.5 rounded-full border bg-emerald-50 text-emerald-900 border-emerald-300 shrink-0 shadow-2xs" title={`Saved by ${savedByName} • ${savedBirdsCount} birds`}>
                              <span>✅ Saved by {savedByName || 'Incharge 1'} • birds count-&gt;{savedBirdsCount}</span>
                            </span>
                          ) : sStats.count > 0 ? (
                            <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full border bg-amber-50 text-amber-900 border-amber-200 shrink-0">
                              <span>🟡 In Progress • {sStats.count} birds</span>
                            </span>
                          ) : (
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border bg-slate-100 text-slate-700 border-slate-200 shrink-0">
                              {(s.parts || []).length} Parts
                            </span>
                          )}
                        </div>

                        <div className="text-xs text-slate-500 mb-2">
                          {(s.parts || []).reduce((acc, p) => acc + (p.lines || []).length, 0)} Lines • <span className="font-bold text-slate-800">{sStats.count} birds weighed</span>
                        </div>

                        {/* Attribution line if occupied by another operator */}
                        {isLockedByOther && (
                          <div className="text-[11px] text-amber-800 bg-amber-100/60 px-2.5 py-1 rounded-lg border border-amber-200/80 mb-1 flex items-center justify-between gap-1">
                            <span>🔒 In use by <strong>{lock.lockedByUserName}</strong></span>
                            {(currentUserRole === 'Admin' || currentUserRole === 'Manager' || currentUserRole === 'In-Charge') && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleForceUnlock(s.id, s.name);
                                }}
                                disabled={isForceUnlockingShed === s.id}
                                className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-900 hover:text-amber-950 underline cursor-pointer"
                              >
                                {isForceUnlockingShed === s.id ? (
                                  <Loader2 className="w-3 h-3 animate-spin" />
                                ) : (
                                  <Unlock className="w-3 h-3" />
                                )}
                                <span>Unlock</span>
                              </button>
                            )}
                          </div>
                        )}
                      </div>

                      <div className="flex items-center justify-between text-xs text-slate-500 pt-2 border-t border-slate-100">
                        {isFieldWorker ? (
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] text-slate-400 font-bold uppercase">Birds Weighed:</span>
                            <span className="font-mono font-black text-slate-900 text-sm">{sStats.count}</span>
                          </div>
                        ) : (
                          <div className="flex items-center gap-3">
                            <div>
                              <span className="text-[10px] text-slate-400 block uppercase font-bold">Avg</span>
                              <span className="font-mono font-black text-emerald-600 text-sm">{sStats.avg > 0 ? `${sStats.avg}g` : '—'}</span>
                            </div>
                            <div>
                              <span className="text-[10px] text-slate-400 block uppercase font-bold">Unif (±10%)</span>
                              <span className="text-xs font-bold text-amber-600 font-mono">{sStats.count > 0 ? `${sStats.uniformity10Pct}%` : '—'}</span>
                            </div>
                          </div>
                        )}

                        {/* Action CTA Button */}
                        {isLockedByOther ? (
                          <div className="flex items-center gap-1 font-bold text-amber-900 bg-amber-100/90 px-2.5 py-1 rounded-lg border border-amber-300 text-xs">
                            <Lock className="w-3.5 h-3.5 text-amber-700" />
                            <span>Locked (In Use)</span>
                          </div>
                        ) : isLockedByMe ? (
                          <div className="flex items-center gap-1 font-bold text-emerald-800 bg-emerald-100 px-2.5 py-1 rounded-lg border border-emerald-300 text-xs">
                            <span>Resume Weighing</span>
                            <ChevronRight className="w-3.5 h-3.5 text-emerald-700" />
                          </div>
                        ) : (
                          <div className="flex items-center gap-1 font-bold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 px-2.5 py-1 rounded-lg border border-emerald-200 text-xs transition">
                            {isEnteringShed === s.id ? (
                              <>
                                <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-600" />
                                <span>Entering...</span>
                              </>
                            ) : (
                              <>
                                <span>Open Parts</span>
                                <ChevronRight className="w-3.5 h-3.5 text-emerald-600" />
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })
              )}

            </div>

            {/* STAGE 2 & 3: LIVE TOTAL FARM PROGRESS BANNER & MASTER "SUBMIT OVERALL FARM" BUTTON (PAGE BOTTOM) */}
            {(() => {
              const savedShedsList = sheds.filter(s => {
                const l = shedLocks[s.id];
                return l?.savedStatus === 'SAVED' || (s as any).savedStatus === 'SAVED';
              });
              const savedShedsCount = savedShedsList.length;
              const totalShedsCount = sheds.length;
              const totalFarmBirdsCount = sheds.reduce((acc, s) => {
                const l = shedLocks[s.id];
                const sCount = (s.parts || []).flatMap(p => (p.lines || []).flatMap(line => line.weights || [])).length;
                return acc + (l?.totalBirdCount !== undefined ? l.totalBirdCount : sCount);
              }, 0);
              const farmProgressPercent = totalShedsCount > 0 ? Math.round((savedShedsCount / totalShedsCount) * 100) : 0;
              const hasAnySavedShed = savedShedsCount > 0 || totalFarmBirdsCount > 0;

              return (
                <div className="bg-gradient-to-r from-slate-900 via-emerald-950 to-slate-900 text-white p-4 rounded-2xl border border-emerald-500/30 shadow-md mt-4">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[10px] sm:text-xs font-black uppercase tracking-wider text-emerald-400 bg-emerald-950/80 px-2 py-0.5 rounded-md border border-emerald-500/40">
                          Shared Team Workspace
                        </span>
                        <span className="text-xs font-bold text-slate-300">
                          Week: <strong className="text-white">{ageWeek}</strong>
                        </span>
                      </div>
                      <h3 className="text-sm sm:text-base font-black text-white mt-1.5 flex items-center gap-2 flex-wrap">
                        <span>Total Farm Progress:</span>
                        <span className="text-emerald-400 font-mono font-black">{savedShedsCount} of {totalShedsCount} Sheds Saved ({farmProgressPercent}%)</span>
                        <span className="text-slate-400">•</span>
                        <span className="text-amber-300 font-mono font-black">{totalFarmBirdsCount.toLocaleString()} Total Birds Counted</span>
                      </h3>
                    </div>

                    {/* Master Submit Overall Farm Button */}
                    <div className="shrink-0 flex items-center gap-2">
                      {farmStatus === 'COMPLETED' ? (
                        <span className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 rounded-xl text-xs font-black shadow-xs">
                          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                          <span>Week Finalized & Submitted</span>
                        </span>
                      ) : hasAnySavedShed ? (
                        <button
                          type="button"
                          onClick={() => setShowOverallSubmitConfirmModal(true)}
                          className="px-4 py-2.5 bg-gradient-to-r from-emerald-500 to-teal-400 hover:from-emerald-400 hover:to-teal-300 text-slate-950 font-black rounded-xl text-xs shadow-lg shadow-emerald-500/25 active:scale-95 transition cursor-pointer flex items-center gap-2"
                          title="Submit overall farm data for this week"
                        >
                          <UploadCloud className="w-4 h-4 text-slate-950" />
                          <span>Submit Overall Farm ({savedShedsCount}/{totalShedsCount} Saved)</span>
                        </button>
                      ) : (
                        <div className="inline-flex items-center gap-1.5 px-3 py-2 bg-slate-800/90 text-slate-400 border border-slate-700/80 rounded-xl text-[11px] font-bold">
                          <Lock className="w-3.5 h-3.5 text-slate-500" />
                          <span>Submit Overall Farm ({savedShedsCount}/{totalShedsCount} Saved)</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Visual Progress Bar */}
                  <div className="w-full bg-slate-800 rounded-full h-2 mt-3 overflow-hidden border border-slate-700/60">
                    <div
                      className="bg-gradient-to-r from-emerald-500 to-teal-400 h-2 rounded-full transition-all duration-300"
                      style={{ width: `${farmProgressPercent}%` }}
                    />
                  </div>
                </div>
              );
            })()}
          </div>
        )}

        {/* ========================================================= */}
        {/* 3. PART SELECTION SCREEN (CLEAN LIGHT CARDS)              */}
        {/* ========================================================= */}
        {currentScreen === 'part_select' && activeShed && (
          <div className="flex-1 flex flex-col p-2 sm:p-4 animate-in slide-in-from-right duration-150">
            <div className="flex items-center justify-between mb-4 gap-2">
              <div className="flex items-center gap-2">
                <button 
                  onClick={handleGoBack} 
                  className="flex items-center gap-1.5 text-xs font-bold text-slate-700 bg-white hover:bg-slate-100 px-3 py-1.5 rounded-xl border border-slate-200 shadow-xs active:scale-95 cursor-pointer"
                >
                  <ArrowLeft className="w-4 h-4" /> Sheds
                </button>
                <button 
                  onClick={handleGoHome} 
                  className="flex items-center gap-1.5 text-xs font-bold text-slate-700 bg-white hover:bg-slate-100 px-3 py-1.5 rounded-xl border border-slate-200 shadow-xs active:scale-95 cursor-pointer"
                  title="Return to Dashboard Home"
                >
                  <Home className="w-4 h-4 text-emerald-600" /> Home
                </button>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-xs font-black text-emerald-800 bg-emerald-50 px-2.5 py-1.5 rounded-xl border border-emerald-200 shadow-2xs">
                  {ageWeek}
                </span>
                <span className="text-xs font-bold text-slate-700 bg-white px-3 py-1.5 rounded-xl border border-slate-200 shadow-2xs">
                  {activeShed.name}
                </span>
              </div>
            </div>

            <div className="flex items-center justify-between px-1 mb-3">
              <div>
                <h2 className="text-base font-black text-slate-900">
                  Parts in {activeShed.name} ({activeShed.parts.length}/4)
                </h2>
                <p className="text-xs text-slate-500">
                  {activeShed.parts.length >= 4 
                    ? 'Maximum 4 parts reached (Parts A–D only)' 
                    : 'Select a part to view its pen lines (Parts A–D allowed)'}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleSaveShed(activeShed)}
                  disabled={isSavingShed}
                  className="text-xs px-3.5 py-1.5 rounded-xl font-black flex items-center gap-1.5 shadow-xs bg-emerald-600 hover:bg-emerald-500 text-white active:scale-95 transition cursor-pointer"
                  title="Save this shed and share progress with team"
                >
                  {isSavingShed ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                  <span>Save Shed ({shedStats.count})</span>
                </button>
                <button
                  onClick={handleAddPart}
                  disabled={activeShed.parts.length >= 4}
                  title={activeShed.parts.length >= 4 ? 'Maximum 4 parts (A-D) allowed per shed' : 'Add Next Part'}
                  className={`text-xs px-3 py-1.5 rounded-xl font-bold flex items-center gap-1 shadow-xs transition ${
                    activeShed.parts.length >= 4
                      ? 'bg-slate-200 text-slate-400 cursor-not-allowed opacity-60'
                      : 'bg-amber-500 hover:bg-amber-400 text-slate-950 active:scale-95 cursor-pointer'
                  }`}
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>{activeShed.parts.length >= 4 ? 'Max Parts (4/4)' : 'Add Part'}</span>
                </button>
              </div>
            </div>

            {/* Shed Mini Stats Summary */}
            {isFieldWorker ? (
              <div className="bg-white p-3 rounded-2xl border border-slate-200 text-center text-xs mb-4 shadow-xs flex items-center justify-between">
                <span className="text-xs text-slate-500 font-bold uppercase">Shed Birds Weighed</span>
                <span className="font-black text-slate-900 text-sm sm:text-base font-mono">{shedStats.count} Birds</span>
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-2 sm:gap-4 bg-white p-3.5 rounded-2xl border border-slate-200 text-center text-xs mb-4 font-mono shadow-xs">
                <div className="min-w-0">
                  <span className="text-[10px] text-slate-500 block font-sans font-bold uppercase truncate">Shed Birds</span>
                  <span className="font-black text-slate-900 text-sm sm:text-base truncate block">{shedStats.count}</span>
                </div>
                <div className="min-w-0">
                  <span className="text-[10px] text-slate-500 block font-sans font-bold uppercase truncate">Shed Avg</span>
                  <span className="font-black text-emerald-600 text-sm sm:text-base truncate block font-mono">{shedStats.avg}g</span>
                </div>
                <div className="min-w-0">
                  <span className="text-[10px] text-slate-500 block font-sans font-bold uppercase truncate">Uniformity</span>
                  <span className="font-black text-amber-600 text-sm sm:text-base truncate block font-mono">{shedStats.sPct}%</span>
                </div>
              </div>
            )}

            {/* Responsive Multi-Column Part Cards Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 pb-6 overflow-y-auto flex-1">
              {activeShed.parts.map((part, partIndex) => {
                const partGender = part.lines?.some(l => (l.gender || '').toUpperCase() === 'MALE') ? 'Male' : (activeShed.type === 'Male' ? 'Male' : 'Female');
                const partStd = partGender === 'Male' ? stdWeightMale : stdWeightFemale;
                const partStat = calculateFlockStats(part.lines.flatMap(l => l.weights), partStd, weekNum);
                const partBirds = part.lines.reduce((acc, l) => acc + l.weights.length, 0);

                return (
                  <div
                    key={part.id}
                    className="w-full bg-white p-4 rounded-2xl border border-slate-200 flex flex-col justify-between gap-3 shadow-xs min-w-0 max-w-full"
                  >
                    <div>
                      <div className="flex items-center justify-between gap-2 min-w-0 mb-2">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span className="w-8 h-8 rounded-xl bg-amber-50 border border-amber-200 text-amber-700 font-black flex items-center justify-center text-xs shrink-0 overflow-hidden">
                            {part.name.replace(/Part\s*/i, '').trim() || String.fromCharCode(65 + partIndex)}
                          </span>
                          <div className="min-w-0">
                            <h3 className="font-black text-base text-slate-900 truncate">{part.name}</h3>
                            <span className="text-xs text-slate-500 block truncate">
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

                      {isFieldWorker ? (
                        <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-100 flex items-center justify-between text-xs">
                          <span className="text-[11px] text-slate-500 font-bold uppercase">Birds Weighed:</span>
                          <span className="font-black text-slate-900 text-xs font-mono">{partBirds} Birds</span>
                        </div>
                      ) : (
                        <div className="grid grid-cols-3 gap-1 bg-slate-50 p-2.5 rounded-xl border border-slate-100 text-center text-xs font-mono">
                          <div className="min-w-0">
                            <span className="text-[10px] text-slate-500 block font-sans font-bold truncate">AVG WT</span>
                            <span className="font-extrabold text-emerald-600 truncate block font-mono">{partStat.avg}g</span>
                          </div>
                          <div className="min-w-0">
                            <span className="text-[10px] text-slate-500 block font-sans font-bold truncate">Uniformity</span>
                            <span className="font-extrabold text-amber-600 truncate block font-mono">{partStat.sPct}%</span>
                          </div>
                          <div className="min-w-0">
                            <span className="text-[10px] text-slate-500 block font-sans font-bold truncate">CV %</span>
                            <span className="font-extrabold text-sky-600 truncate block font-mono">{partStat.cv}%</span>
                          </div>
                        </div>
                      )}
                    </div>

                    <button
                      onClick={() => {
                        navigateToLineSelect(activeShed.id, part.id, part.lines[0]?.id || 1);
                      }}
                      className="w-full bg-amber-500 hover:bg-amber-400 active:scale-95 text-slate-950 py-2.5 rounded-xl text-xs font-black flex items-center justify-center gap-1.5 transition cursor-pointer shadow-xs mt-2"
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
          <div className="flex-1 flex flex-col p-2 sm:p-4 animate-in slide-in-from-right duration-150">
            {/* Header with Back button up to Parts Screen & Direct Home button */}
            <div className="flex items-center justify-between mb-4 gap-2">
              <div className="flex items-center gap-2">
                <button 
                  onClick={handleGoBack} 
                  className="flex items-center gap-1.5 text-xs font-bold text-slate-700 bg-white hover:bg-slate-100 px-3 py-1.5 rounded-xl border border-slate-200 shadow-xs active:scale-95 cursor-pointer"
                >
                  <ArrowLeft className="w-4 h-4" /> Parts
                </button>
                <button 
                  onClick={handleGoHome} 
                  className="flex items-center gap-1.5 text-xs font-bold text-slate-700 bg-white hover:bg-slate-100 px-3 py-1.5 rounded-xl border border-slate-200 shadow-xs active:scale-95 cursor-pointer"
                  title="Return to Dashboard Home"
                >
                  <Home className="w-4 h-4 text-emerald-600" /> Home
                </button>
              </div>

              <div className="flex items-center gap-1.5">
                <span className="text-xs font-black text-emerald-800 bg-emerald-50 px-2 py-1 rounded-xl border border-emerald-200 shadow-2xs">
                  {ageWeek}
                </span>
                <span className="text-xs font-bold text-sky-800 bg-sky-50 px-3 py-1.5 rounded-full border border-sky-200 truncate max-w-[280px]">
                  {activeShed.name} › {activePart.name}
                </span>
              </div>
            </div>

            <div className="flex items-center justify-between px-1 mb-3">
              <div>
                <h2 className="text-base font-black text-slate-900">
                  Lines in {activePart.name} ({activePart.lines.length}/16)
                </h2>
                <p className="text-xs text-slate-500">
                  {activePart.lines.length >= 16
                    ? 'Maximum 16 lines reached (Line 1–Line 16 only)'
                    : 'Choose a line to record bird weights (Lines 1–16 allowed)'}
                </p>
              </div>
              <button
                onClick={handleAddLine}
                disabled={activePart.lines.length >= 16}
                title={activePart.lines.length >= 16 ? 'Maximum 16 lines reached (Line 1–Line 16)' : 'Add Next Line'}
                className={`text-xs px-3 py-1.5 rounded-xl font-bold flex items-center gap-1 shadow-xs transition ${
                  activePart.lines.length >= 16
                    ? 'bg-slate-200 text-slate-400 cursor-not-allowed opacity-60'
                    : 'bg-sky-600 hover:bg-sky-500 text-white active:scale-95 cursor-pointer'
                }`}
              >
                <Plus className="w-3.5 h-3.5" />
                <span>{activePart.lines.length >= 16 ? 'Max Lines (16/16)' : 'Add Line'}</span>
              </button>
            </div>

            {/* Part Mini Stats Summary */}
            {isFieldWorker ? (
              <div className="bg-white p-3.5 rounded-2xl border border-slate-200 flex items-center justify-between text-xs mb-4 font-mono shadow-xs">
                <span className="text-xs text-slate-500 font-sans font-bold uppercase">Total Birds Weighed in {activePart.name}</span>
                <span className="font-black text-slate-900 text-sm sm:text-base font-mono">{partStats.count} Birds</span>
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-2 sm:gap-4 bg-white p-3.5 rounded-2xl border border-slate-200 text-center text-xs mb-4 font-mono shadow-xs">
                <div className="min-w-0">
                  <span className="text-[10px] text-slate-500 block font-sans font-bold uppercase truncate">Part Birds</span>
                  <span className="font-black text-slate-900 text-sm sm:text-base truncate block">{partStats.count}</span>
                </div>
                <div className="min-w-0">
                  <span className="text-[10px] text-slate-500 block font-sans font-bold uppercase truncate">Part Avg</span>
                  <span className="font-black text-emerald-600 text-sm sm:text-base truncate block font-mono">{partStats.avg}g</span>
                </div>
                <div className="min-w-0">
                  <span className="text-[10px] text-slate-500 block font-sans font-bold uppercase truncate">Uniformity</span>
                  <span className="font-black text-amber-600 text-sm sm:text-base truncate block font-mono">{partStats.sPct}%</span>
                </div>
              </div>
            )}

            {/* Responsive Multi-Column Line Cards Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 pb-6 overflow-y-auto flex-1">
              {activePart.lines.map((line, lineIndex) => {
                const lineGender: 'Male' | 'Female' = (line.gender?.toUpperCase() === 'MALE' || (!line.gender && activeShed.type === 'Male')) ? 'Male' : 'Female';
                const lineStd = lineGender === 'Male' ? stdWeightMale : stdWeightFemale;
                const lStats = calculateFlockStats(line.weights, lineStd, weekNum);
                const hasWeights = (line.weights || []).length > 0;
                const isComplete = lStats.isComplete;

                return (
                  <div
                    key={line.id}
                    className="w-full bg-white p-4 rounded-2xl border border-slate-200 flex flex-col justify-between gap-3 shadow-xs min-w-0 max-w-full"
                  >
                    <div>
                      <div className="flex items-center justify-between gap-2 min-w-0 mb-2">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span className="w-8 h-8 rounded-xl bg-sky-50 border border-sky-200 text-sky-700 font-black flex items-center justify-center text-xs shrink-0 overflow-hidden">
                            L{line.name.replace(/Line\s*/i, '').trim() || (lineIndex + 1)}
                          </span>
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <h3 className="font-black text-base text-slate-900 truncate">{line.name}</h3>
                              {/* Line-level Gender Selector */}
                              <div 
                                className="flex items-center gap-0.5 bg-slate-100 p-0.5 rounded-lg border border-slate-200"
                                onClick={e => e.stopPropagation()}
                              >
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (lineGender !== 'Female') handleToggleLineGender(line.id, 'Female');
                                  }}
                                  className={`px-2 py-0.5 rounded text-[10px] font-black transition cursor-pointer ${
                                    lineGender === 'Female'
                                      ? 'bg-pink-600 text-white shadow-2xs'
                                      : 'text-slate-600 hover:text-slate-900'
                                  }`}
                                  title="Set Line to Female"
                                >
                                  ♀ F
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (lineGender !== 'Male') handleToggleLineGender(line.id, 'Male');
                                  }}
                                  className={`px-2 py-0.5 rounded text-[10px] font-black transition cursor-pointer ${
                                    lineGender === 'Male'
                                      ? 'bg-blue-600 text-white shadow-2xs'
                                      : 'text-slate-600 hover:text-slate-900'
                                  }`}
                                  title="Set Line to Male"
                                >
                                  ♂ M
                                </button>
                              </div>
                              {!isFieldWorker && (
                                <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-300 font-mono">
                                  STD: {lineStd}g
                                </span>
                              )}
                            </div>
                            <span className="text-xs text-slate-500 block truncate mt-0.5">
                              {line.weights.length} {line.weights.length === 1 ? 'Bird Weighed' : 'Birds Weighed'}
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          {/* Only show Grade / Status badge to Admin & Manager */}
                          {!isFieldWorker && (
                            !hasWeights ? (
                              <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200">
                                🟡 Pending
                              </span>
                            ) : !isComplete ? (
                              <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-300">
                                🟡 In Progress ({lStats.count}/10)
                              </span>
                            ) : lStats.status === 'EXCELLENT' ? (
                              <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-300">
                                🟢 EXCELLENT ({lStats.uniformity10Pct}%)
                              </span>
                            ) : lStats.status === 'ACCEPTABLE' ? (
                              <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-sky-100 text-sky-800 border border-sky-300">
                                🔵 ACCEPTABLE ({lStats.uniformity10Pct}%)
                              </span>
                            ) : (
                              <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-rose-100 text-rose-800 border border-rose-300">
                                🔴 POOR ({lStats.uniformity10Pct}%)
                              </span>
                            )
                          )}

                          <button
                            type="button"
                            onClick={(e) => handleDeleteLine(line.id, e)}
                            className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg text-xs cursor-pointer shrink-0"
                            title={`Delete ${line.name}`}
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>

                      {/* Line Stats Strip: Restricted for Field Workers (Supervisor & In-Charge) */}
                      {isFieldWorker ? (
                        <div className="flex items-center justify-between bg-slate-50 p-2.5 rounded-xl border border-slate-100 text-xs font-mono">
                          <span className="text-[11px] text-slate-500 font-sans font-bold uppercase">BIRDS WEIGHED</span>
                          <span className="font-extrabold text-slate-900 text-sm font-mono">{lStats.count} Birds</span>
                        </div>
                      ) : (
                        <div className="grid grid-cols-4 gap-1 text-center bg-slate-50 p-2.5 rounded-xl border border-slate-100 text-xs font-mono min-w-0 max-w-full">
                          <div className="min-w-0">
                            <span className="text-[10px] text-slate-500 font-sans font-bold uppercase truncate block">BIRDS</span>
                            <div className="font-extrabold text-slate-900 truncate">{lStats.count}</div>
                          </div>
                          <div className="min-w-0">
                            <span className="text-[10px] text-slate-500 font-sans font-bold uppercase truncate block">AVG WT</span>
                            <div className="font-extrabold text-emerald-600 truncate font-mono">
                              {hasWeights ? `${lStats.avg}g` : '—'}
                            </div>
                          </div>
                          <div className="min-w-0">
                            <span className="text-[10px] text-slate-500 font-sans font-bold uppercase truncate block">Uniformity (±10%)</span>
                            <div className="font-extrabold text-amber-600 truncate font-mono">
                              {hasWeights ? `${lStats.uniformity10Pct}%` : '—'}
                            </div>
                          </div>
                          <div className="min-w-0">
                            <span className="text-[10px] text-slate-500 font-sans font-bold uppercase truncate block">CV %</span>
                            <div className="font-extrabold text-sky-600 truncate font-mono">
                              {hasWeights ? `${lStats.cv}%` : '—'}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>

                    <button
                      onClick={() => {
                        navigateToWeighPad(activeShed.id, activePart.id, line.id);
                      }}
                      className="w-full max-w-full bg-sky-600 hover:bg-sky-500 active:scale-95 text-white py-2.5 rounded-xl text-xs font-black flex items-center justify-center gap-1.5 transition cursor-pointer shadow-xs min-w-0 mt-2"
                    >
                      <span className="truncate">Enter Weights for {line.name}</span>
                      <ChevronRight className="w-4 h-4 shrink-0" />
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
          <div className="flex-1 flex flex-col p-2 sm:p-4 animate-in slide-in-from-right duration-150">
            {/* Header with Back Button (Weigh Pad -> Line Screen) & Direct Home button */}
            <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
              <div className="flex items-center gap-2">
                <button 
                  onClick={handleGoBack} 
                  className="flex items-center gap-1.5 text-xs font-bold text-slate-700 bg-white hover:bg-slate-100 px-3 py-1.5 rounded-xl border border-slate-200 shadow-xs active:scale-95 cursor-pointer shrink-0"
                >
                  <ArrowLeft className="w-4 h-4" /> Lines
                </button>
                <button 
                  onClick={handleGoHome} 
                  className="flex items-center gap-1.5 text-xs font-bold text-slate-700 bg-white hover:bg-slate-100 px-3 py-1.5 rounded-xl border border-slate-200 shadow-xs active:scale-95 cursor-pointer shrink-0"
                  title="Return to Dashboard Home"
                >
                  <Home className="w-4 h-4 text-emerald-600" /> Home
                </button>
              </div>

              {/* Breadcrumb Trail matching screenshot */}
              <div className="flex items-center gap-1.5 text-[11px] font-bold bg-white px-2.5 py-1 rounded-xl border border-slate-200 shadow-xs truncate max-w-[320px]">
                <span className="text-emerald-800 bg-emerald-50 px-1.5 py-0.5 rounded text-[10px] font-black border border-emerald-200">{ageWeek}</span>
                <span className="text-slate-300">•</span>
                <span className="text-emerald-700 font-extrabold">{activeShed.name}</span>
                <span className="text-slate-300">›</span>
                <span className="text-indigo-700 font-extrabold">{activePart.name}</span>
                <span className="text-slate-300">›</span>
                <span className="text-sky-700 font-extrabold">{activeLine.name}</span>
              </div>
            </div>

            {/* Centered Weighing Pad Screen (Weighed Birds list card completely removed) */}
            <div className="w-full max-w-lg mx-auto flex-1 flex flex-col space-y-3 pt-2">
              {/* Line Info Banner showing live birds count and direct Gender Selector */}
              <div className="flex items-center justify-between bg-white px-4 py-3 rounded-2xl border border-slate-200 shadow-2xs flex-wrap gap-2">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-black text-sm text-slate-900">{activeLine.name} Weighing</h3>
                    {/* Direct Female / Male Toggle on Weigh Pad */}
                    <div className="flex items-center gap-0.5 bg-slate-100 p-0.5 rounded-lg border border-slate-200">
                      <button
                        type="button"
                        onClick={() => {
                          if (activeLineGender !== 'Female') handleToggleLineGender(activeLine.id, 'Female');
                        }}
                        className={`px-2 py-0.5 rounded text-[10px] font-black transition cursor-pointer ${
                          activeLineGender === 'Female'
                            ? 'bg-pink-600 text-white shadow-2xs'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                        title="Set Line to Female"
                      >
                        ♀ F
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (activeLineGender !== 'Male') handleToggleLineGender(activeLine.id, 'Male');
                        }}
                        className={`px-2 py-0.5 rounded text-[10px] font-black transition cursor-pointer ${
                          activeLineGender === 'Male'
                            ? 'bg-blue-600 text-white shadow-2xs'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                        title="Set Line to Male"
                      >
                        ♂ M
                      </button>
                    </div>
                  </div>
                  <p className="text-[11px] text-slate-500 mt-0.5">{activeShed.name} › {activePart.name}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono font-black px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-800 border border-emerald-200">
                    {activeLine.weights.length} Birds Entered
                  </span>
                  {!isFieldWorker && (
                    <span className="text-[10px] font-mono font-bold px-2 py-1 rounded-lg bg-slate-100 text-slate-700 border border-slate-200">
                      STD: {activeStd}g
                    </span>
                  )}
                </div>
              </div>

              {/* Manual Entry Form */}
              <form onSubmit={e => { e.preventDefault(); handleAddWeight(); }} className="flex flex-col gap-2">
                <div className="flex gap-2">
                  <input
                    ref={weightInputRef}
                    type="number"
                    step="any"
                    inputMode="decimal"
                    placeholder={`Weight for ${activeLine.name}...`}
                    value={inputWeight}
                    onChange={e => {
                      setInputWeight(e.target.value);
                      if (inputWeightError) setInputWeightError(null);
                    }}
                    autoFocus
                    className={`flex-1 min-w-0 bg-white border ${
                      inputWeightError ? 'border-rose-500 focus:border-rose-600' : 'border-slate-300 focus:border-emerald-600'
                    } rounded-xl px-4 py-3 text-lg font-black text-slate-900 focus:outline-none font-mono shadow-xs placeholder:text-slate-400`}
                  />
                  <button
                    type="submit"
                    disabled={isSubmittingWeight}
                    className="bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white font-black px-6 rounded-xl text-sm shrink-0 shadow-xs cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed transition"
                  >
                    {isSubmittingWeight ? 'Saving...' : 'Save'}
                  </button>
                </div>
                {inputWeightError && (
                  <div className="flex items-center gap-1.5 text-rose-600 bg-rose-50 border border-rose-200 px-3 py-1.5 rounded-xl text-xs font-bold animate-in fade-in duration-150">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0 text-rose-500" />
                    <span>{inputWeightError}</span>
                  </div>
                )}
              </form>

              {/* Action Buttons: Stage 2 Save Shed (Visible to Team), Save Draft & Submit */}
              <div className="space-y-2.5 pt-2">
                {/* STAGE 2: Dedicated Save Shed Button (Visible to Team, NOT Final Submission) */}
                <button
                  type="button"
                  onClick={() => handleSaveShed()}
                  disabled={isSavingShed}
                  className="w-full bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white font-black py-3.5 px-4 rounded-xl text-xs flex items-center justify-center gap-2 shadow-md shadow-emerald-600/20 transition cursor-pointer disabled:opacity-50"
                  title="Persist shed weights into team workspace and mark as SAVED without creating a final submission"
                >
                  {isSavingShed ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin text-white" />
                      <span>Saving Shed to Shared Workspace...</span>
                    </>
                  ) : (
                    <>
                      <Save className="w-4 h-4 text-white" />
                      <span>Save Shed (Share with Team)</span>
                    </>
                  )}
                </button>

                {(currentUserRole === 'Supervisor' || currentUserRole === 'In-Charge') && (
                  <button
                    type="button"
                    onClick={handleManualSaveDraft}
                    disabled={isSavingDraft}
                    className="w-full bg-amber-500 hover:bg-amber-400 active:scale-95 text-slate-950 font-black py-3.5 px-4 rounded-xl text-xs flex items-center justify-center gap-2 shadow-xs transition cursor-pointer disabled:opacity-50"
                  >
                    {isSavingDraft ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin text-slate-950" />
                        <span>Saving Draft to Storage...</span>
                      </>
                    ) : (
                      <>
                        <Save className="w-4 h-4 text-slate-950" />
                        <span>Save Draft</span>
                      </>
                    )}
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => navigateTo('submit_page')}
                  className="w-full font-bold py-3.5 px-4 rounded-xl text-xs flex items-center justify-between bg-slate-800 hover:bg-slate-700/80 border border-slate-700 text-white shadow-md active:scale-95 transition cursor-pointer"
                >
                  <div className="flex items-center gap-2">
                    <UploadCloud className="w-4 h-4 text-emerald-400" />
                    <span>Go to Dedicated Submit Screen</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                      completionStats.isFarm100PercentWeighed
                        ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                        : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                    }`}>
                      {completionStats.progressPercent}% Weighed
                    </span>
                    <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
                  </div>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ========================================================= */}
        {/* 6. CONSOLIDATED CONCLUSION REPORT                         */}
        {/* ========================================================= */}
        {/* ========================================================= */}
        {/* 6. CONSOLIDATED CONCLUSION REPORT (Compact & High-Density)*/}
        {/* ========================================================= */}
        {currentScreen === 'conclusion' && (
          <div className="flex-1 flex flex-col p-3 sm:p-4 max-w-5xl mx-auto w-full animate-in slide-in-from-right duration-150 space-y-3">
            {/* Header Toolbar */}
            <div className="flex items-center justify-between pb-2 border-b border-slate-200">
              <button 
                onClick={handleGoHome} 
                className="flex items-center gap-1.5 text-xs font-bold text-slate-700 bg-white hover:bg-slate-100 px-3 py-1.5 rounded-xl border border-slate-200 shadow-xs active:scale-95 cursor-pointer"
                title="Return to Dashboard Home"
              >
                <ArrowLeft className="w-4 h-4"/> Home
              </button>
              
              <div className="text-center">
                <h2 className="text-xs sm:text-sm font-black text-slate-900 uppercase tracking-wide">
                  Manager Conclusion
                </h2>
                <div className="flex items-center justify-center gap-1.5 mt-0.5 flex-wrap">
                  <span className="text-[10px] text-slate-700 font-bold">🏢 {farmName}</span>
                  <span className="text-slate-300">•</span>
                  <span className="text-[10px] text-purple-700 font-black bg-purple-50 px-1.5 py-0.2 rounded border border-purple-200">
                    📦 {activeBatchName || 'Batch 1'}
                  </span>
                  <span className="text-slate-300">•</span>
                  <select
                    value={ageWeek}
                    onChange={(e) => handleSwitchWeek(e.target.value)}
                    className="bg-emerald-50 text-emerald-900 border border-emerald-200 rounded-lg px-2 py-0.5 text-[10px] font-black focus:outline-none cursor-pointer max-w-[150px] sm:max-w-xs truncate"
                    title="Switch Report Recording Week"
                  >
                    {Array.from({ length: 24 }, (_, i) => `W${i + 1}`).map(w => {
                      const wStatus = weekStatusMap?.[w];
                      const icon = wStatus === 'COMPLETED' ? '🟢' : '🟡';
                      const farmAnchor = currentActiveFarmSummary || { flockDate: date, ageWeek };
                      const initialWeek = currentActiveFarmSummary?.startWeekNumber || currentActiveFarmSummary?.initialAgeWeek || currentActiveFarmSummary?.startingWeek || currentActiveFarmSummary?.ageWeek;
                      return (
                        <option key={w} value={w}>
                          {w} — {icon} {formatRecordingWeekLabel(w, farmAnchor, initialWeek)}
                        </option>
                      );
                    })}
                  </select>
                  <span className="text-slate-300">•</span>
                  <span className="text-[10px] text-slate-600 font-medium">{season} Brood</span>
                </div>
              </div>

              <button 
                onClick={handleDownloadExcel} 
                className="bg-emerald-600 hover:bg-emerald-700 px-3 py-1.5 rounded-xl font-black text-xs text-white flex items-center gap-1.5 active:scale-95 shadow-xs cursor-pointer"
                title="Download complete Excel workbook"
              >
                <Download className="w-3.5 h-3.5"/>
                <span className="hidden sm:inline">Export Excel</span>
              </button>
            </div>

            {/* Compact Flock Summary Matrix (Female vs Male) */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
              <div className="bg-slate-50 px-3 py-2 border-b border-slate-200 flex items-center justify-between text-xs font-bold text-slate-700">
                <span className="flex items-center gap-1.5">
                  <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
                  <span>Flock Executive Benchmark Comparison</span>
                </span>
                <span className="text-[10px] text-slate-500 font-mono">Official Suguna Standards</span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left">
                  <thead className="bg-slate-100/75 text-[10px] uppercase font-bold text-slate-500 border-b border-slate-200">
                    <tr>
                      <th className="py-2 px-3">Metric</th>
                      <th className="py-2 px-3 text-pink-700 font-black">♀ Female ({ageWeek}F)</th>
                      <th className="py-2 px-3 text-blue-700 font-black">♂ Male ({ageWeek}M)</th>
                      <th className="py-2 px-3 text-slate-700 font-black">Status / Evaluation</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-medium">
                    <tr className="hover:bg-slate-50/70 transition">
                      <td className="py-2 px-3 font-semibold text-slate-600">Sample Count (Birds Weighed)</td>
                      <td className="py-2 px-3 font-mono font-bold text-pink-600">{consolidated.fStats.count} birds</td>
                      <td className="py-2 px-3 font-mono font-bold text-blue-600">{consolidated.mStats.count} birds</td>
                      <td className="py-2 px-3 text-[11px] text-slate-500">Sampled bird count</td>
                    </tr>
                    <tr className="hover:bg-slate-50/70 transition">
                      <td className="py-2 px-3 font-semibold text-slate-600">Standard Target Weight</td>
                      <td className="py-2 px-3 font-mono font-bold text-pink-600">{stdWeightFemale}g</td>
                      <td className="py-2 px-3 font-mono font-bold text-blue-600">{stdWeightMale}g</td>
                      <td className="py-2 px-3 text-[11px] text-slate-500">Benchmark Reference</td>
                    </tr>
                    <tr className="hover:bg-slate-50/70 transition bg-emerald-50/20">
                      <td className="py-2 px-3 font-semibold text-slate-800">Actual Average Body Weight</td>
                      <td className="py-2 px-3 font-mono font-black text-emerald-600 text-sm">
                        {consolidated.fStats.count > 0 ? `${consolidated.fStats.avg}g` : '—'}
                      </td>
                      <td className="py-2 px-3 font-mono font-black text-emerald-600 text-sm">
                        {consolidated.mStats.count > 0 ? `${consolidated.mStats.avg}g` : '—'}
                      </td>
                      <td className="py-2 px-3 text-[11px] font-bold text-emerald-700">Field Weighed Act WT</td>
                    </tr>
                    <tr className="hover:bg-slate-50/70 transition">
                      <td className="py-2 px-3 font-semibold text-slate-600">Difference vs Target</td>
                      <td className={`py-2 px-3 font-mono font-bold ${consolidated.fStats.count > 0 ? (consolidated.fStats.diff >= 0 ? 'text-emerald-600' : 'text-amber-600') : 'text-slate-400'}`}>
                        {consolidated.fStats.count > 0 ? (consolidated.fStats.diff > 0 ? `+${consolidated.fStats.diff}g` : `${consolidated.fStats.diff}g`) : '—'}
                      </td>
                      <td className={`py-2 px-3 font-mono font-bold ${consolidated.mStats.count > 0 ? (consolidated.mStats.diff >= 0 ? 'text-emerald-600' : 'text-amber-600') : 'text-slate-400'}`}>
                        {consolidated.mStats.count > 0 ? (consolidated.mStats.diff > 0 ? `+${consolidated.mStats.diff}g` : `${consolidated.mStats.diff}g`) : '—'}
                      </td>
                      <td className="py-2 px-3 text-[11px] text-slate-500">Variance from standard</td>
                    </tr>
                    <tr className="hover:bg-slate-50/70 transition">
                      <td className="py-2 px-3 font-semibold text-slate-600">Uniformity (S% ±10%)</td>
                      <td className="py-2 px-3 font-mono font-black text-amber-600">
                        {consolidated.fStats.count > 0 ? `${consolidated.fStats.sPct}%` : '—'}
                      </td>
                      <td className="py-2 px-3 font-mono font-black text-amber-600">
                        {consolidated.mStats.count > 0 ? `${consolidated.mStats.sPct}%` : '—'}
                      </td>
                      <td className="py-2 px-3">
                        {consolidated.fStats.count > 0 ? (
                          <span className={`text-[10px] px-2 py-0.5 rounded font-bold ${
                            consolidated.fStats.sPct >= 80 ? 'bg-emerald-100 text-emerald-800' :
                            consolidated.fStats.sPct >= 70 ? 'bg-blue-100 text-blue-800' : 'bg-amber-100 text-amber-800'
                          }`}>
                            {consolidated.fStats.sPct >= 80 ? 'EXCELLENT' : consolidated.fStats.sPct >= 70 ? 'ACCEPTABLE' : 'MODERATE'}
                          </span>
                        ) : (
                          <span className="text-[10px] text-slate-400">—</span>
                        )}
                      </td>
                    </tr>
                    <tr className="hover:bg-slate-50/70 transition">
                      <td className="py-2 px-3 font-semibold text-slate-600">CV % (F-Factor)</td>
                      <td className="py-2 px-3 font-mono font-bold text-sky-600">
                        {consolidated.fStats.count > 0 ? `${consolidated.fStats.cv}%` : '—'}
                      </td>
                      <td className="py-2 px-3 font-mono font-bold text-sky-600">
                        {consolidated.mStats.count > 0 ? `${consolidated.mStats.cv}%` : '—'}
                      </td>
                      <td className="py-2 px-3 text-[11px] text-slate-500">Coefficient of variation</td>
                    </tr>
                    <tr className="hover:bg-slate-50/70 transition">
                      <td className="py-2 px-3 font-semibold text-slate-600">Weight Range (Min – Max)</td>
                      <td className="py-2 px-3 font-mono text-slate-700">
                        {consolidated.fStats.count > 0 ? `${consolidated.fStats.min}g – ${consolidated.fStats.max}g` : '—'}
                      </td>
                      <td className="py-2 px-3 font-mono text-slate-700">
                        {consolidated.mStats.count > 0 ? `${consolidated.mStats.min}g – ${consolidated.mStats.max}g` : '—'}
                      </td>
                      <td className="py-2 px-3 text-[11px] text-slate-500">Min to max spread</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>



            {/* Bottom Download Bar */}
            <button 
              onClick={handleDownloadExcel} 
              className="w-full bg-emerald-600 hover:bg-emerald-700 py-2.5 rounded-xl font-black text-xs text-white flex items-center justify-center gap-2 active:scale-95 shadow-md shadow-emerald-600/20 cursor-pointer"
            >
              <Download className="w-4 h-4"/> Download Complete 13-Sheet Excel Workbook
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
                onClick={handleGoHome} 
                className="flex items-center gap-1.5 text-xs font-bold text-slate-700 bg-white hover:bg-slate-100 px-3 py-1.5 rounded-xl border border-slate-200 shadow-xs active:scale-95 cursor-pointer"
                title="Return to Dashboard Home"
              >
                <ArrowLeft className="w-4 h-4"/> Home
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
                      <span className="text-[9px] text-slate-400 font-sans">Uniformity (S%)</span>
                      <div className="font-bold text-amber-600">{s.stats.sPct}%</div>
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
                onClick={handleGoHome} 
                className="flex items-center gap-1.5 text-xs font-bold text-slate-700 bg-white hover:bg-slate-100 px-3 py-1.5 rounded-xl border border-slate-200 shadow-xs active:scale-95 cursor-pointer"
                title="Return to Dashboard Home"
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
              className="w-full bg-emerald-600 hover:bg-emerald-700 py-3.5 rounded-xl font-black text-xs text-white shadow-md shadow-emerald-600/20 active:scale-95 cursor-pointer mt-4"
            >
              Save Farm Details
            </button>
          </div>
        )}

        {/* ========================================================= */}
        {/* SCREEN: SUBMISSIONS UPDATE LOG SCREEN (Req 4)             */}
        {/* ========================================================= */}
        {currentScreen === 'history' && (
          <div className="flex-1 flex flex-col p-4 animate-in slide-in-from-right duration-150">
            {/* Top Bar */}
            <div className="flex items-center justify-between mb-3.5">
              <button 
                onClick={handleGoHome} 
                className="flex items-center gap-1.5 text-xs font-bold text-slate-700 bg-white hover:bg-slate-100 px-3 py-1.5 rounded-xl border border-slate-200 shadow-xs active:scale-95 cursor-pointer"
                title="Return to Dashboard Home"
              >
                <ArrowLeft className="w-4 h-4" /> Home
              </button>
              <div className="flex items-center gap-1.5">
                <span className="flex items-center gap-1.5 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-full text-[10px] font-black text-emerald-700 shadow-2xs">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                  <span>SUBMISSIONS UPDATE</span>
                </span>
                <button
                  onClick={fetchLatestLogs}
                  disabled={isRefreshingLogs}
                  className="p-1.5 bg-white hover:bg-slate-100 border border-slate-200 rounded-xl text-slate-600 hover:text-emerald-600 transition active:scale-90 cursor-pointer"
                  title="Refresh submissions update"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isRefreshingLogs ? 'animate-spin text-emerald-600' : ''}`} />
                </button>
              </div>
            </div>

            {/* Title & Status Banner */}
            <div className="bg-gradient-to-r from-emerald-50 via-teal-50 to-indigo-50 border border-emerald-200/80 p-3 rounded-2xl mb-3 shadow-2xs">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-xs font-black uppercase tracking-wider text-emerald-900 flex items-center gap-1.5">
                    <History className="w-4 h-4 text-emerald-600" />
                    Submissions Update Log
                  </h2>
                  <p className="text-[11px] text-slate-600 mt-0.5">
                    Verified batch submissions finalized across farm units
                  </p>
                </div>
                <span className="text-[10px] font-mono font-bold text-slate-600 bg-white/80 px-2 py-1 rounded-lg border border-slate-200">
                  {activityLogs.length} submissions
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

            {/* Submissions Update Logs Stream */}
            <div className={`${
              currentUserRole === 'Supervisor' 
                ? 'flex flex-col gap-3 overflow-y-auto flex-1 pb-6' 
                : 'grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-3 overflow-y-auto flex-1 pb-6'
            }`}>
              {(() => {
                const filtered = activityLogs.filter(log => {
                  if (historyFilter === 'currentFarm') {
                    return log.farmId === activeFarmId || log.farmName.trim().toLowerCase() === farmName.trim().toLowerCase();
                  }
                  return true;
                });

                if (filtered.length === 0) {
                  return (
                    <div className="col-span-full bg-white border border-slate-200 rounded-2xl p-8 text-center space-y-3 shadow-xs">
                      <div className="w-12 h-12 bg-slate-100 rounded-full flex items-center justify-center mx-auto text-slate-400">
                        <History className="w-6 h-6" />
                      </div>
                      <h4 className="font-black text-sm text-slate-800">No Submissions Recorded</h4>
                      <p className="text-xs text-slate-500 max-w-xs mx-auto">
                        No batch submissions recorded yet. When a farm batch is finalized via the Submit page, it will be logged here.
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
                  // Bind Male/Female Actual Weights & Farm Overall Average Weight
                  const femaleVal = 
                    (log as any).femaleActWt ?? 
                    log.femaleAvgWeight ?? 
                    (log as any).femaleAvg ?? 
                    (() => {
                      const m = (log.action || '').match(/♀\s*(?:Act|Avg)?[:\s]*([0-9]+(?:\.[0-9]+)?)\s*g?/i);
                      return m ? parseFloat(m[1]) : null;
                    })();

                  const maleVal = 
                    (log as any).maleActWt ?? 
                    log.maleAvgWeight ?? 
                    (log as any).maleAvg ?? 
                    (() => {
                      const m = (log.action || '').match(/♂\s*(?:Act|Avg)?[:\s]*([0-9]+(?:\.[0-9]+)?)\s*g?/i);
                      return m ? parseFloat(m[1]) : null;
                    })();

                  let overallAvg = log.avgWeight;
                  if ((!overallAvg || (femaleVal && maleVal && overallAvg === femaleVal && femaleVal !== maleVal)) && femaleVal && maleVal) {
                    overallAvg = Math.round((femaleVal + maleVal) / 2);
                  } else if (!overallAvg) {
                    overallAvg = femaleVal || maleVal || 0;
                  }

                  return (
                    <div 
                      key={log.id} 
                      className="p-3.5 rounded-2xl border bg-white border-slate-200 shadow-2xs hover:border-slate-300 transition-all flex flex-col justify-between"
                    >
                      <div>
                        {/* Top Header: Farm Unit Name & COMPLETED Status */}
                        <div className="flex items-start justify-between gap-2 pb-2 border-b border-slate-100">
                          <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
                            <Building2 className="w-4 h-4 text-emerald-600 shrink-0" />
                            <span className="font-black text-xs text-slate-900 truncate">{log.farmName}</span>
                            {Boolean((log as any).batchName || (log as any).batch_name) && (
                              <span className="text-[10px] font-black text-purple-700 bg-purple-50 border border-purple-200 px-1.5 py-0.2 rounded">
                                {(log as any).batchName || (log as any).batch_name}
                              </span>
                            )}
                            {Boolean((log as any).weekNumber) && (
                              <span className="text-[10px] font-black text-slate-600 bg-slate-100 border border-slate-200 px-1.5 py-0.2 rounded">
                                {(log as any).weekNumber}
                              </span>
                            )}
                          </div>

                          <span className="bg-emerald-50 text-emerald-700 border border-emerald-200 px-2.5 py-0.5 rounded-full text-[9px] font-black shrink-0 flex items-center gap-1">
                            <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                            COMPLETED
                          </span>
                        </div>

                        {/* Summary Metrics: Restricted for Field Workers (Supervisor & In-Charge) */}
                        {isFieldWorker ? (
                          <div className="mt-2.5 bg-slate-50 p-2.5 rounded-xl border border-slate-200/80 flex items-center justify-between text-xs">
                            <span className="text-[11px] text-slate-500 font-bold uppercase">Total Birds Sampled:</span>
                            <span className="font-extrabold text-slate-900 text-sm font-mono">
                              {log.sampleCount || 0} Birds
                            </span>
                          </div>
                        ) : (
                          <div className="mt-2.5 grid grid-cols-2 gap-2 bg-slate-50 p-2.5 rounded-xl border border-slate-200/80 text-xs">
                            <div className="min-w-0">
                              <span className="text-[9px] text-slate-500 font-bold uppercase block truncate">Total Sampled</span>
                              <span className="font-extrabold text-slate-900 text-sm font-mono truncate block">
                                {log.sampleCount || 0} Birds
                              </span>
                            </div>
                            <div className="min-w-0">
                              <span className="text-[9px] text-emerald-600 font-bold uppercase block truncate">Overall Avg Wt</span>
                              <span className="font-extrabold text-emerald-700 text-sm font-mono truncate block">
                                {overallAvg ? `${overallAvg}g` : (femaleVal || maleVal ? `${femaleVal || maleVal}g` : 'N/A')}
                              </span>
                            </div>
                            <div className="min-w-0">
                              <span className="text-[9px] text-pink-600 font-bold uppercase block truncate">Female Act Wt</span>
                              <span className="font-extrabold text-pink-700 text-sm font-mono truncate block">
                                {femaleVal ? `${femaleVal}g` : 'N/A'}
                              </span>
                            </div>
                            <div className="min-w-0">
                              <span className="text-[9px] text-blue-600 font-bold uppercase block truncate">Male Act Wt</span>
                              <span className="font-extrabold text-blue-700 text-sm font-mono truncate block">
                                {maleVal ? `${maleVal}g` : 'N/A'}
                              </span>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Footer: Submitter & Formatted Timestamp (Update Action Button Completely Removed) */}
                      <div className="flex flex-col gap-1.5 text-[11px] text-slate-500 pt-2 mt-2 border-t border-slate-100">
                        <div className="flex items-center justify-between gap-1">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <div className="w-4 h-4 rounded-full bg-emerald-600 text-white flex items-center justify-center text-[9px] font-bold shrink-0">
                              {(log.userName || 'S').charAt(0).toUpperCase()}
                            </div>
                            <span className="truncate">
                              Submitted By: <strong className="text-slate-800">{log.userName || 'Supervisor'}</strong>
                            </span>
                          </div>
                          <div className="text-[10px] font-mono text-slate-500 font-medium shrink-0">
                            {formatDateTimeIST(log.timestamp)}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                });
              })()}
            </div>
          </div>
        )}

        {/* ========================================================= */}
        {/* SCREEN: SUBMISSION UPDATE SCREEN (Req 2)                  */}
        {/* ========================================================= */}
        {currentScreen === 'submission_update' && (
          <SubmissionUpdateScreen
            submissionId={updatingSubmissionId}
            currentUser={currentUser}
            currentUserRole={currentUserRole}
            onBack={handleGoBack}
            onUpdateSuccess={async () => {
              showToast('✓ Submission updated successfully!');
              await fetchLatestLogs();
            }}
          />
        )}

        {/* ========================================================= */}
        {/* SCREEN: SHARED FARM AUTHENTICATION & ROLE MANAGEMENT      */}
        {/* ========================================================= */}
        {currentScreen === 'auth' && (
          <div className="flex-1 flex flex-col p-4 animate-in slide-in-from-right duration-150">
            {/* Top Bar */}
            <div className="flex items-center justify-between mb-4">
              {currentUser && (
                <button 
                  onClick={handleGoHome} 
                  className="flex items-center gap-1.5 text-xs font-bold text-slate-700 bg-white hover:bg-slate-100 px-3 py-1.5 rounded-xl border border-slate-200 shadow-xs active:scale-95 cursor-pointer"
                  title="Return to Dashboard Home"
                >
                  <ArrowLeft className="w-4 h-4" /> Home
                </button>
              )}
              <h2 className="text-xs font-black text-emerald-800 uppercase tracking-wide bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-200">
                {currentUser ? 'Farm Access & Roles' : 'Sign In'}
              </h2>
            </div>

            <div className="space-y-4">
              {/* If Current User Session exists, show active session card */}
              {currentUser ? (
                <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs space-y-3">
                  <div className="flex items-center gap-3 pb-3 border-b border-slate-100">
                    <div className={`w-12 h-12 rounded-2xl text-white flex items-center justify-center shadow-md ${
                      currentUserRole === 'Admin' ? 'bg-purple-600 shadow-purple-600/30' :
                      currentUserRole === 'Manager' ? 'bg-sky-600 shadow-sky-600/30' :
                      'bg-emerald-600 shadow-emerald-600/30'
                    }`}>
                      <User className="w-6 h-6 text-white" />
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
                          currentUserRole === 'Admin' || currentUserRole === 'Manager' ? 'bg-sky-50 text-sky-700 border-sky-200' :
                          currentUserRole === 'In-Charge' ? 'bg-teal-50 text-teal-700 border-teal-200' :
                          'bg-emerald-50 text-emerald-700 border-emerald-200'
                        }`}>
                          {currentUserRole === 'In-Charge' ? 'In-Charge • Profile' :
                           currentUserRole === 'Supervisor' ? 'Supervisor • Profile' : 'Manager • Profile'}
                        </span>
                        <span className="text-[10px] text-slate-500 font-mono font-bold">
                          ID: {formatEmployeeId(currentUser)}
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
                      {currentUserRole === 'In-Charge' && (
                        <p className="text-teal-800 font-semibold">
                          🟢 In-Charge Oversight: Manager Dashboard access, manage farms, batches, assign Supervisors, and download reports.
                        </p>
                      )}
                      {currentUserRole === 'Supervisor' && (
                        <p className="text-emerald-800 font-semibold">
                          🟢 Field Operations: Enter bird weights, manage parts & lines, save sheds with sub-second sync, and submit overall farm.
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="pt-1">
                    <button
                      type="button"
                      onClick={handleLogout}
                      className="w-full bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-700 py-2.5 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1 cursor-pointer"
                    >
                      <LogOut className="w-3.5 h-3.5" /> Log Out
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <LoginScreen 
                    onLoginSuccess={handleLoginSuccess}
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
        {/* MODAL: CONFIRM DELETE SHED                                */}
        {/* ========================================================= */}
        {shedPendingDelete && (
          <div className="fixed inset-0 bg-black/40 backdrop-blur-xs z-50 flex items-center justify-center p-4 animate-in fade-in">
            <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-sm p-5 space-y-4 shadow-2xl">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-rose-50 text-rose-600 rounded-xl border border-rose-200">
                  <Trash2 className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="font-black text-base text-slate-900">Delete {shedPendingDelete.name}?</h3>
                  <p className="text-xs text-slate-500">
                    {shedPendingDelete.totalWeights > 0
                      ? `Contains ${shedPendingDelete.totalWeights} weighed birds across its lines`
                      : 'No bird weights recorded'}
                  </p>
                </div>
              </div>

              {shedPendingDelete.totalWeights > 0 && (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-2.5">
                  <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                  <p className="text-xs font-semibold text-amber-900 leading-relaxed">
                    This shed contains bird-weight records. Deleting it will permanently remove all associated weights.
                  </p>
                </div>
              )}

              <p className="text-xs text-rose-800 bg-rose-50 p-3 rounded-xl border border-rose-200 leading-relaxed">
                Delete this Shed and all its parts, lines, and weights? This action cannot be undone.
              </p>

              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setShedPendingDelete(null)}
                  className="flex-1 bg-slate-100 hover:bg-slate-200 py-2.5 rounded-xl text-xs font-bold text-slate-700 active:scale-95 transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => executeDeleteShed(shedPendingDelete.id)}
                  className="flex-1 bg-rose-600 hover:bg-rose-700 py-2.5 rounded-xl text-xs font-black text-white shadow-md shadow-rose-600/20 active:scale-95 transition cursor-pointer"
                >
                  Yes, Delete Shed
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
          <div className="fixed inset-0 bg-black/50 backdrop-blur-xs z-50 flex items-center justify-center p-3 sm:p-4 animate-in fade-in duration-150">
            <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-lg max-h-[92vh] overflow-y-auto p-4 sm:p-5 space-y-4 shadow-2xl animate-in zoom-in-95 duration-150 custom-scrollbar">
              <div className="flex justify-between items-center pb-2 border-b border-slate-100">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 bg-emerald-50 text-emerald-600 rounded-xl border border-emerald-200">
                    <Building2 className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-black text-base text-slate-900">Add New Farm</h3>
                    <p className="text-[11px] text-slate-500">Configure Farm Unit & Number of Sheds (1–40)</p>
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

                {/* Simplified Single Shed-Configuration Question: How many sheds? */}
                <div className="space-y-2 border-t border-slate-100 pt-3">
                  <div className="flex items-center justify-between">
                    <label 
                      htmlFor="new-farm-shed-count"
                      className="text-[11px] font-black text-slate-800 uppercase tracking-wider block"
                    >
                      Number of Sheds (1–40) *
                    </label>
                    <span className="text-[10px] font-bold text-slate-500">
                      Integers 1 to 40
                    </span>
                  </div>

                  <input
                    id="new-farm-shed-count"
                    type="number"
                    min="1"
                    max="40"
                    step="1"
                    required
                    value={newFarmShedCount}
                    onChange={(e) => {
                      const val = e.target.value;
                      setNewFarmShedCount(val);
                      const n = Number(val);
                      if (!val || val.trim() === '') {
                        setNewFarmShedCountError('Number of sheds is required.');
                      } else if (isNaN(n) || !Number.isInteger(n)) {
                        setNewFarmShedCountError('Number of sheds must be a whole number (no decimals).');
                      } else if (n < 1) {
                        setNewFarmShedCountError('Minimum 1 shed is required.');
                      } else if (n > 40) {
                        setNewFarmShedCountError('Maximum 40 sheds allowed.');
                      } else {
                        setNewFarmShedCountError(null);
                      }
                    }}
                    className={`w-full bg-slate-50 border rounded-xl px-3 py-2.5 text-xs font-bold text-slate-900 focus:outline-none focus:bg-white transition ${
                      newFarmShedCountError 
                        ? 'border-rose-400 focus:border-rose-500 ring-1 ring-rose-200' 
                        : 'border-slate-300 focus:border-emerald-600'
                    }`}
                    placeholder="Enter number of sheds (e.g. 10)"
                  />

                  {/* Validation Error Banner */}
                  {newFarmShedCountError && (
                    <div className="p-2 bg-rose-50 border border-rose-200 rounded-lg text-rose-700 text-[11px] font-bold flex items-center gap-1.5 animate-in fade-in duration-150">
                      <AlertCircle className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                      <span>{newFarmShedCountError}</span>
                    </div>
                  )}

                  {/* Quick Select Preset Chips */}
                  <div className="flex flex-wrap items-center gap-1.5 pt-1">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mr-1">Quick:</span>
                    {[1, 5, 8, 10, 12, 16, 20, 40].map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => {
                          setNewFarmShedCount(preset);
                          setNewFarmShedCountError(null);
                        }}
                        className={`px-2.5 py-1 rounded-lg text-[11px] font-extrabold border transition cursor-pointer active:scale-95 ${
                          Number(newFarmShedCount) === preset && !newFarmShedCountError
                            ? 'bg-emerald-600 text-white border-emerald-600 shadow-xs'
                            : 'bg-white hover:bg-slate-100 text-slate-700 border-slate-200'
                        }`}
                      >
                        {preset} {preset === 1 ? 'Shed' : 'Sheds'}
                      </button>
                    ))}
                  </div>

                  {/* Resulting Shed Count Preview */}
                  {(() => {
                    const countNum = Number(newFarmShedCount);
                    const isValid = !newFarmShedCountError && Number.isInteger(countNum) && countNum >= 1 && countNum <= 40;
                    if (!isValid) return null;
                    return (
                      <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-xs text-emerald-900 flex items-start gap-2 animate-in fade-in duration-150">
                        <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                        <div>
                          <p className="font-extrabold">
                            Will create {countNum} shed{countNum > 1 ? 's' : ''}: Shed 1 {countNum > 1 ? `through Shed ${countNum}` : ''}
                          </p>
                          <p className="text-[10px] text-emerald-700 mt-0.5">
                            Gender (Male/Female) can be selected during body-weight recording.
                          </p>
                        </div>
                      </div>
                    );
                  })()}
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
        {/* MODAL: EDIT FARM NAME (All Authorized Roles)              */}
        {/* ========================================================= */}
        {showEditFarmModal && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-xs z-50 flex items-center justify-center p-4 animate-in fade-in duration-150">
            <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-sm p-5 space-y-4 shadow-2xl animate-in zoom-in-95 duration-150">
              <div className="flex justify-between items-center pb-2 border-b border-slate-100">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 bg-emerald-50 text-emerald-600 rounded-xl border border-emerald-200">
                    <Edit3 className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-black text-base text-slate-900">Edit Farm Name</h3>
                    <p className="text-[11px] text-slate-500">Update authoritative database record</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowEditFarmModal(false)}
                  className="text-slate-400 hover:text-slate-700 p-1 rounded-lg cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <form onSubmit={async (e) => {
                e.preventDefault();
                const trimmed = editFarmNameInput.trim();
                if (!trimmed) {
                  setEditFarmNameError('Farm name cannot be blank.');
                  return;
                }
                setEditFarmNameError(null);
                setIsSavingFarmName(true);
                try {
                  await handleRenameFarm(activeFarmId, trimmed);
                  setShowEditFarmModal(false);
                } catch (err: any) {
                  setEditFarmNameError(err.message || 'Failed to update farm name.');
                } finally {
                  setIsSavingFarmName(false);
                }
              }} className="space-y-3.5">
                <div>
                  <label className="text-[11px] font-bold text-slate-600 uppercase block mb-1">
                    New Farm Name *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Green Valley Farm Unit 1"
                    value={editFarmNameInput}
                    onChange={(e) => {
                      setEditFarmNameInput(e.target.value);
                      if (editFarmNameError) setEditFarmNameError(null);
                    }}
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold text-slate-900 focus:outline-none focus:border-emerald-600 focus:bg-white transition"
                    autoFocus
                  />
                  {editFarmNameError && (
                    <p className="text-[11px] text-rose-600 font-bold mt-1.5 flex items-center gap-1">
                      <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                      <span>{editFarmNameError}</span>
                    </p>
                  )}
                </div>

                <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 text-[11px] text-slate-600 flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                  <span>Renaming preserves all sheds, parts, lines, recorded weights, and submission history.</span>
                </div>

                <div className="flex gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowEditFarmModal(false)}
                    className="flex-1 bg-slate-100 hover:bg-slate-200 py-2.5 rounded-xl text-xs font-bold text-slate-700 active:scale-95 transition cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSavingFarmName}
                    className="flex-1 bg-emerald-600 hover:bg-emerald-500 py-2.5 rounded-xl text-xs font-black text-white shadow-md shadow-emerald-600/20 active:scale-95 transition cursor-pointer flex items-center justify-center gap-1.5 disabled:opacity-50"
                  >
                    {isSavingFarmName ? (
                      <>
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        <span>Saving...</span>
                      </>
                    ) : (
                      <span>Save Farm Name</span>
                    )}
                  </button>
                </div>
              </form>
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
                  {currentUserRole === 'Supervisor' ? 'Assigned Farm Unit' : 'Audit Target Farm (Switch Location)'}
                </label>
                {currentUserRole === 'Supervisor' ? (
                  <div className="flex items-center justify-between px-3.5 py-2.5 bg-slate-100 border border-slate-200 rounded-xl">
                    <div className="flex items-center gap-2">
                      <Lock className="w-3.5 h-3.5 text-slate-500" />
                      <span className="text-xs font-bold text-slate-800">{farmName || 'Assigned Farm'} ({ageWeek})</span>
                    </div>
                    <span className="text-[10px] font-semibold text-slate-500 bg-white px-2 py-0.5 rounded-md border border-slate-200">
                      Assigned Unit
                    </span>
                  </div>
                ) : (
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
                )}
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

                  <div className="bg-white p-2.5 rounded-xl border border-slate-200/80">
                    <span className="text-[9px] uppercase font-bold text-slate-400 block">Uniformity (S%)</span>
                    <span className="font-bold text-amber-700 text-xs">
                      ♀ {consolidated.fStats.sPct}% | ♂ {consolidated.mStats.sPct}%
                    </span>
                  </div>

                  <div className="bg-white p-2.5 rounded-xl border border-slate-200/80">
                    <span className="text-[9px] uppercase font-bold text-slate-400 block">CV % (F-Factor)</span>
                    <span className="font-bold text-sky-700 text-xs">
                      ♀ {consolidated.fStats.cv}% | ♂ {consolidated.mStats.cv}%
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
                        ? formatLogDateTime(farmAudit.lastSubmittedAt)
                        : 'No submission recorded yet'}
                    </span>
                  </div>
                  {farmAudit?.lastSavedAsDraftAt && (
                    <div className="flex items-center justify-between text-xs pt-1.5 border-t border-slate-100">
                      <span className="text-slate-500 font-medium">Last Draft Saved:</span>
                      <span className="font-semibold text-slate-700 text-right text-[11px]">
                        {formatLogDateTime(farmAudit.lastSavedAsDraftAt)}
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
                        setShowFarmDetailsModal(false);
                        navigateTo('submit_page');
                      }}
                      className="bg-amber-600 hover:bg-amber-700 text-white font-bold px-2.5 py-1 rounded-lg text-[10px] cursor-pointer"
                    >
                      Go to Submit Screen
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
                  View Submissions Update
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
                    Cannot submit yet! All lines must be completely weighed. Pending lines: [{completionStats.incompleteLines.map(l => l.path).join(', ')}]. Complete all lines to submit.
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
        {/* MODAL: SHED LOCK COLLISION NOTIFICATION & ACCESS GUARD    */}
        {/* ========================================================= */}
        {collisionModalData && (
          <div 
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150"
            role="dialog"
            aria-modal="true"
            onClick={() => setCollisionModalData(null)}
          >
            <div 
              className="bg-white rounded-3xl p-6 sm:p-7 max-w-md w-full shadow-2xl border border-amber-200 space-y-4 animate-in zoom-in-95 duration-150"
              onClick={e => e.stopPropagation()}
            >
              <div className="w-14 h-14 rounded-2xl bg-amber-100 border border-amber-200 flex items-center justify-center mx-auto text-amber-600 shadow-xs">
                <Lock className="w-7 h-7" />
              </div>

              <div className="text-center space-y-2">
                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-amber-100 text-amber-900 border border-amber-300">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-700" />
                  <span>Access Restricted</span>
                </div>
                <h3 className="text-lg font-black text-slate-900">
                  {collisionModalData.shedName} is Currently in Use
                </h3>
                <p className="text-sm text-slate-800 leading-relaxed font-semibold">
                  ⚠️ {collisionModalData.shedName} is currently being weighed by {collisionModalData.lockedByUserName}. Only one Incharge can enter a shed at a time.
                </p>
                <div className="p-3 bg-amber-50 rounded-xl border border-amber-200 text-xs text-amber-900 text-left space-y-1">
                  <div className="font-bold flex items-center gap-1.5 text-amber-950">
                    <ShieldCheck className="w-4 h-4 text-amber-700 shrink-0" />
                    <span>Single-Incharge Shed Guard Active</span>
                  </div>
                  <p className="text-amber-800 leading-normal">
                    Only one Incharge can enter a shed at a time to prevent conflicting weight measurements. Please select another shed.
                  </p>
                </div>
              </div>

              <div className="space-y-2 pt-1">
                <button
                  type="button"
                  onClick={() => setCollisionModalData(null)}
                  className="w-full py-3 px-4 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-sm font-bold shadow-md cursor-pointer transition active:scale-[0.98]"
                >
                  Choose Another Shed
                </button>

                {(currentUserRole === 'Admin' || currentUserRole === 'Manager' || currentUserRole === 'In-Charge') && (
                  <button
                    type="button"
                    onClick={() => handleForceUnlock(collisionModalData.shedId, collisionModalData.shedName)}
                    disabled={isForceUnlockingShed === collisionModalData.shedId}
                    className="w-full py-2.5 px-4 bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-300 rounded-xl text-xs font-bold cursor-pointer transition flex items-center justify-center gap-2"
                  >
                    {isForceUnlockingShed === collisionModalData.shedId ? (
                      <Loader2 className="w-4 h-4 animate-spin text-amber-700" />
                    ) : (
                      <Unlock className="w-4 h-4 text-amber-700" />
                    )}
                    <span>Supervisor Override: Force Unlock</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ========================================================= */}
        {/* MODAL: STAGE 3 OVERALL FARM FINAL SUBMIT CONFIRMATION     */}
        {/* ========================================================= */}
        {showOverallSubmitConfirmModal && (
          <div 
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150"
            role="dialog"
            aria-modal="true"
          >
            <div 
              className="bg-white rounded-3xl p-6 sm:p-7 max-w-lg w-full shadow-2xl border border-emerald-200 space-y-4 animate-in zoom-in-95 duration-150"
              onClick={e => e.stopPropagation()}
            >
              <div className="w-14 h-14 rounded-2xl bg-emerald-100 border border-emerald-200 flex items-center justify-center mx-auto text-emerald-600 shadow-xs">
                <UploadCloud className="w-7 h-7" />
              </div>

              <div className="text-center space-y-2">
                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-900 border border-emerald-300">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700" />
                  <span>Stage 3: Final Overall Farm Submission</span>
                </div>
                <h3 className="text-lg font-black text-slate-900">
                  Submit Overall Farm ({ageWeek})
                </h3>
                <p className="text-xs text-slate-600 leading-relaxed max-w-sm mx-auto">
                  All sheds on <strong className="text-slate-900">{farmName || 'Active Farm'}</strong> have been saved by the field team. Submitting will consolidate all sheds into one single record in Submission History and lock this week.
                </p>
              </div>

              {/* Shed Breakdown Preview */}
              <div className="bg-slate-50 p-3 rounded-2xl border border-slate-200 max-h-48 overflow-y-auto space-y-2">
                {sheds.map((s, idx) => {
                  const l = shedLocks[s.id];
                  const sCount = (s.parts || []).flatMap(p => (p.lines || []).flatMap(line => line.weights || [])).length;
                  const birdCount = l?.totalBirdCount !== undefined ? l.totalBirdCount : sCount;
                  const savedBy = l?.savedByUserName || (s as any).savedByUserName || 'Incharge';
                  return (
                    <div key={s.id || idx} className="flex items-center justify-between text-xs bg-white p-2.5 rounded-xl border border-slate-200 shadow-2xs">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-slate-900">{s.name}</span>
                        <span className="text-[10px] text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200 font-bold">
                          Saved by {savedBy}
                        </span>
                      </div>
                      <span className="font-mono font-black text-slate-900">
                        {birdCount} birds
                      </span>
                    </div>
                  );
                })}
              </div>

              <div className="flex items-center justify-between px-2 text-xs font-bold text-slate-700">
                <span>Total Birds Across All Sheds:</span>
                <span className="text-emerald-700 font-mono font-black text-sm">
                  {sheds.reduce((acc, s) => {
                    const l = shedLocks[s.id];
                    const sCount = (s.parts || []).flatMap(p => (p.lines || []).flatMap(line => line.weights || [])).length;
                    return acc + (l?.totalBirdCount !== undefined ? l.totalBirdCount : sCount);
                  }, 0).toLocaleString()} Birds
                </span>
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowOverallSubmitConfirmModal(false)}
                  disabled={isSubmittingOverallFarm}
                  className="flex-1 py-3 px-4 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold cursor-pointer transition active:scale-95"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleOverallFarmFinalSubmit}
                  disabled={isSubmittingOverallFarm}
                  className="flex-1 py-3 px-4 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-black shadow-md shadow-emerald-600/20 cursor-pointer transition active:scale-95 flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {isSubmittingOverallFarm ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin text-white" />
                      <span>Submitting Overall Farm...</span>
                    </>
                  ) : (
                    <>
                      <UploadCloud className="w-4 h-4 text-white" />
                      <span>Confirm & Final Submit</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ========================================================= */}
        {/* MODAL: EXIT CONFIRMATION TRAP                             */}
        {/* ========================================================= */}
        {isAuthenticated && currentScreen === 'home' && showExitConfirm && (
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
                    Exit Application
                  </h3>
                  <p className="text-xs text-slate-500">Poultry Flock Pro</p>
                </div>
              </div>
              <p className="text-xs text-slate-700 bg-slate-50 p-3.5 rounded-xl border border-slate-200 leading-relaxed font-medium">
                Are you sure you want to exit Poultry Flock Pro?
              </p>
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={handleCancelExit}
                  className="flex-1 bg-slate-100 hover:bg-slate-200 py-2.5 rounded-xl text-xs font-bold text-slate-700 active:scale-95 transition cursor-pointer"
                >
                  Stay
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
        {toastMessage && (() => {
          const isError = /fail|error|denied|reject|unable/i.test(toastMessage);
          return (
            <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 w-[90%] max-w-sm bg-white border ${isError ? 'border-rose-300 ring-1 ring-rose-200' : 'border-slate-300'} text-slate-900 px-4 py-3 rounded-2xl shadow-2xl flex items-center gap-3 backdrop-blur-md z-50 animate-in fade-in slide-in-from-bottom duration-200`}>
              {isError ? (
                <AlertCircle className="w-5 h-5 text-rose-600 shrink-0" />
              ) : (
                <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
              )}
              <span className={`text-xs font-bold leading-tight ${isError ? 'text-rose-900' : 'text-slate-900'}`}>{toastMessage}</span>
            </div>
          );
        })()}

      </div>
    </div>
    </>
  );
}
