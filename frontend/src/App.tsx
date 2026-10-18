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
  Lock,
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
  FullFarmData,
  FarmAudit,
  FarmStatus,
  UserRole,
  getApiBaseUrl, 
  normalizeApiUrl, 
  offlineQueue, 
  AppUser, 
  ActivityLogItem,
  sanitizeErrorMessage
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
    return 'W18';
  });
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
  const [newFarmAgeWeek, setNewFarmAgeWeek] = useState<string>('W18');
  const [newFarmSeason, setNewFarmSeason] = useState<'Summer' | 'Winter'>('Summer');
  const [newFarmShedCount, setNewFarmShedCount] = useState<number | string>(10);
  const [newFarmShedCountError, setNewFarmShedCountError] = useState<string | null>(null);
  const [isCreatingFarm, setIsCreatingFarm] = useState<boolean>(false);

  // Farm Audit, Draft Status & Batch Submission State
  const [farmStatus, setFarmStatus] = useState<FarmStatus>(() => {
    const activeId = localStorage.getItem('poultry_active_farm_id') || '';
    if (activeId) {
      const activeWeek = localStorage.getItem(`poultry_active_week_${activeId}`) || 'W18';
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
          const rawRole = parsed.userRole || parsed.role || 'Supervisor';
          const normalizedRole: UserRole = 
            rawRole === 'Admin' ? 'Admin' :
            (rawRole === 'Manager' || rawRole === 'Farm Manager') ? 'Manager' :
            (rawRole === 'In-Charge' || rawRole === 'Incharge') ? 'In-Charge' :
            'Supervisor';
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
    const r = (currentUser.role || currentUser.userRole || '') as string;
    if (r === 'Admin') return 'Admin';
    if (r === 'Manager' || r === 'Farm Manager') return 'Manager';
    if (r === 'In-Charge' || r === 'Incharge') return 'In-Charge';
    return 'Supervisor';
  }, [currentUser]);

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
    if (currentUserRole === 'Admin') {
      return farmsList;
    }
    if (currentUserRole === 'Manager') {
      const assignedIds = currentUser?.assignedFarms || [];
      if (assignedIds.length > 0 && !assignedIds.includes('*')) {
        return farmsList.filter(f => assignedIds.includes(f.id) || assignedIds.includes(f.name));
      }
      return farmsList;
    }
    const currentName = (currentUser?.userName || currentUser?.name || '').trim().toLowerCase();
    const currentUsername = (currentUser?.username || '').trim().toLowerCase();
    const assignedIds = currentUser?.assignedFarms || [];

    return farmsList.filter(f => {
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

  // Auto-switch to assigned farm if current active farm is not in supervisor's accessible farms
  useEffect(() => {
    if (currentUserRole === 'Supervisor' || currentUserRole === 'In-Charge') {
      if (accessibleFarms.length > 0) {
        const isCurrentActiveValid = accessibleFarms.some(f => f.id === activeFarmId);
        if (!isCurrentActiveValid) {
          switchFarm(accessibleFarms[0].id, true);
        }
      }
    }
  }, [accessibleFarms, activeFarmId, currentUserRole]);

  // Current active farm summary object (Strict isolation - returns null if supervisor has 0 assigned farms)
  const currentActiveFarmSummary = useMemo(() => {
    let base: FarmSummary | null = null;
    if (currentUserRole === 'Supervisor' || currentUserRole === 'In-Charge') {
      if (accessibleFarms.length === 0) return null;
      base = accessibleFarms.find(f => f.id === activeFarmId) || accessibleFarms[0] || null;
    } else {
      base = accessibleFarms.find(f => f.id === activeFarmId) || accessibleFarms[0] || null;
    }
    if (!base) return null;
    return {
      ...base,
      ageWeek: ageWeek || base.ageWeek || 'W18',
    };
  }, [accessibleFarms, activeFarmId, currentUserRole, ageWeek]);

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
    const rawRole = user.role || user.userRole || 'Supervisor';
    const normalizedRole: UserRole = 
      rawRole === 'Admin' ? 'Admin' :
      rawRole === 'Manager' ? 'Manager' :
      (rawRole === 'In-Charge' || rawRole === 'Incharge') ? 'In-Charge' : 'Supervisor';

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
    if (currentUserRole === 'Supervisor' || currentUserRole === 'In-Charge') {
      showToast('Restricted: Manager or Admin permission required to create new farms.');
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

  // Dynamic Sheds Hierarchy - Authoritative Data from Database / Cache, No Hardcoded Defaults
  const [sheds, setSheds] = useState<ShedData[]>(() => {
    const activeId = localStorage.getItem('poultry_active_farm_id');
    if (activeId) {
      const activeWeek = localStorage.getItem(`poultry_active_week_${activeId}`) || 'W18';
      try {
        const weekDraftStr = localStorage.getItem(`poultry_draft_${activeId}_${activeWeek}`);
        if (weekDraftStr) {
          const parsedWeek = JSON.parse(weekDraftStr);
          if (Array.isArray(parsedWeek?.sheds) && parsedWeek.sheds.length > 0) {
            return parsedWeek.sheds;
          }
        }
        const draftStr = localStorage.getItem(`poultry_draft_${activeId}`);
        if (draftStr) {
          const parsedDraft = JSON.parse(draftStr);
          if (Array.isArray(parsedDraft?.sheds) && parsedDraft.sheds.length > 0) {
            return parsedDraft.sheds;
          }
        }
        const saved = localStorage.getItem(`poultry_farm_${activeId}`);
        if (saved) {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed?.sheds)) return parsed.sheds;
        }
      } catch {}
    }
    return [];
  });

  // Hardware Back Button & Mobile Popstate Routing Trap with Hash Navigation
  const currentScreenRef = useRef<ScreenType>('home');
  currentScreenRef.current = currentScreen;

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
        return 'shed_select';
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

    // If active screen is already 'home' and navigating back at root: trigger Exit confirmation
    if (currentScreenRef.current === 'home' && targetScreen === 'home' && event) {
      setShowExitConfirm(true);
      window.history.pushState({ screen: 'home' }, '', '#home');
      return;
    }

    // Otherwise navigate smoothly without exit confirmation
    setShowExitConfirm(false);
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
    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, []);

  // Dedicated Home Navigation: always directly returns to Dashboard Home
  const handleGoHome = useCallback(() => {
    setShowExitConfirm(false);
    setCurrentScreen('home');
    currentScreenRef.current = 'home';
    window.history.pushState({ screen: 'home' }, '', '#home');
  }, []);

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
    setCurrentScreen(parent);
    currentScreenRef.current = parent;
    window.history.pushState(
      { screen: parent, shedId: selectedShedIdRef.current, partId: selectedPartIdRef.current },
      '',
      getHashForScreen(parent)
    );
  }, []);

  // Synchronized Forward Navigation Helpers with Hash Anchors (Recognized by Android Chrome)
  const navigateToShedSelect = () => {
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
    if (screen === 'setup' && (currentUserRole === 'Supervisor' || currentUserRole === 'In-Charge')) {
      showToast('Permission Denied: System configuration is restricted to Administrator.');
      return;
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

    // Determine target week for this farm
    const targetWeek = localStorage.getItem(`poultry_active_week_${targetFarmId}`) || knownFarm?.ageWeek || 'W18';
    setAgeWeek(targetWeek);

    // Immediately restore local draft if available (week key first, fallback to farm key)
    const weekDraft = localStorage.getItem(`poultry_draft_${targetFarmId}_${targetWeek}`);
    const localDraft = weekDraft || localStorage.getItem(`poultry_draft_${targetFarmId}`);
    if (localDraft) {
      try {
        const parsed = JSON.parse(localDraft);
        if (Array.isArray(parsed?.sheds) && parsed.sheds.length > 0) {
          shedsRef.current = parsed.sheds;
          setSheds(parsed.sheds);
          if (parsed.sheds[0]) {
            setSelectedShedId(parsed.sheds[0].id);
            if (parsed.sheds[0].parts?.[0]) {
              setSelectedPartId(parsed.sheds[0].parts[0].id);
              if (parsed.sheds[0].parts[0].lines?.[0]) setSelectedLineId(parsed.sheds[0].parts[0].lines[0].id);
            }
          }
        }
      } catch {}
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
      const data = await cloudApi.getFarmDetails(targetFarmId, targetWeek);
      if (data) {
        setFarmName(data.name);
        setDate(data.flockDate || new Date().toISOString().split('T')[0]);
        setAgeWeek(data.ageWeek || targetWeek || 'W18');
        setSeason((data.season as any) || 'Summer');
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
      // If offline, check local cache for this farm
      const localCached = localStorage.getItem(`poultry_farm_${targetFarmId}`);
      if (localCached) {
        try {
          const parsed = JSON.parse(localCached);
          if (Array.isArray(parsed.sheds)) {
            const merged = mergeServerShedsWithLocalDraft(parsed.sheds, shedsRef.current, targetFarmId, targetWeek);
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
  }, []);

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
      // Also update legacy fallback key
      localStorage.setItem(`poultry_draft_${activeFarmId}`, JSON.stringify({ sheds: currentSnapshot, updatedAt: Date.now() }));
    }

    // 2. Set new active week
    setAgeWeek(cleanWeek);
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
        if (Array.isArray(parsed?.sheds) && parsed.sheds.length > 0) {
          shedsRef.current = parsed.sheds;
          setSheds(parsed.sheds);
          setFarmStatus(localWeekStatus || 'DRAFT');
          if (localWeekAudit) {
            try { setFarmAudit(JSON.parse(localWeekAudit)); } catch { setFarmAudit(null); }
          } else {
            setFarmAudit(null);
          }
          if (parsed.sheds[0]) {
            setSelectedShedId(parsed.sheds[0].id);
            if (parsed.sheds[0].parts?.[0]) {
              setSelectedPartId(parsed.sheds[0].parts[0].id);
              if (parsed.sheds[0].parts[0].lines?.[0]) setSelectedLineId(parsed.sheds[0].parts[0].lines[0].id);
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
          const hasAnyWeights = cloudFarm.sheds.some((s: any) => s.parts?.some((p: any) => p.lines?.some((l: any) => l.weights?.length > 0)));
          if (hasAnyWeights) {
            const merged = mergeServerShedsWithLocalDraft(cloudFarm.sheds, shedsRef.current, activeFarmId, cleanWeek);
            shedsRef.current = merged;
            setSheds(merged);
            setFarmStatus(cloudFarm.status || 'COMPLETED');
            if (cloudFarm.audit) setFarmAudit(cloudFarm.audit);
            localStorage.setItem(`poultry_draft_${activeFarmId}_${cleanWeek}`, JSON.stringify({ sheds: merged, updatedAt: Date.now() }));
            localStorage.setItem(`poultry_status_${activeFarmId}_${cleanWeek}`, cloudFarm.status || 'COMPLETED');
            setSyncStatus('synced');
            showToast(`Switched to ${cleanWeek} (${cloudFarm.status || 'Loaded'})`);
            return;
          }
        }
      } catch (err) {
        console.warn('Could not fetch cloud data for week switch:', err);
      }
    }

    // 5. Initialize clean empty sheds using base structure (all sheds, parts, lines with weights: [])
    const baseSheds = shedsRef.current.length > 0 ? shedsRef.current : sheds;
    const emptyWeeklySheds = createEmptyWeeklySheds(baseSheds);
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

  // Toggle Shed-Wise Female/Male Gender Selection
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

  const activeStd = activeShed?.type === 'Male' ? stdWeightMale : stdWeightFemale;
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

      // Guard: Confirmation if editing a previously completed record
      if (farmStatus === 'COMPLETED') {
        if (currentUserRole === 'Supervisor' || currentUserRole === 'In-Charge') {
          showToast('Permission Denied: Completed submissions cannot be modified by Supervisor or Incharge.');
          return;
        }
        const confirmReopen = window.confirm(
          'This farm record was COMPLETED & SUBMITTED.\n\nAdding or modifying weights will mark the session as DRAFT until all lines are weighed and re-submitted.\n\nDo you want to continue?'
        );
        if (!confirmReopen) return;
      }

      // 1. Synchronously get latest state from shedsRef to prevent rapid-click race conditions
      const nextSheds = applyLineWeightAddition(shedsRef.current, currentShed.id, currentPart.id, currentLine.id, val);
      shedsRef.current = nextSheds;
      setSheds(nextSheds);

      // Immediately persist to local storage outside of React state updater
      if (activeFarmId) {
        localStorage.setItem(`poultry_draft_${activeFarmId}_${ageWeek}`, JSON.stringify({ sheds: nextSheds, updatedAt: Date.now() }));
        localStorage.setItem(`poultry_draft_${activeFarmId}`, JSON.stringify({ sheds: nextSheds, updatedAt: Date.now() }));
        localStorage.setItem(`poultry_farm_${activeFarmId}_${ageWeek}`, JSON.stringify({ sheds: nextSheds, farmName, date, ageWeek, season }));
        localStorage.setItem(`poultry_farm_${activeFarmId}`, JSON.stringify({ sheds: nextSheds, farmName, date, ageWeek, season }));
        localStorage.setItem(`poultry_sheds_${activeFarmId}`, JSON.stringify(nextSheds));
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
      if (currentUserRole === 'Supervisor' || currentUserRole === 'In-Charge') {
        showToast('Permission Denied: Completed submissions cannot be modified by Supervisor or Incharge.');
        return;
      }
      const confirmReopen = window.confirm(
        'This farm record was COMPLETED & SUBMITTED.\n\nDeleting weights will mark the session as DRAFT until all lines are weighed and re-submitted.\n\nDo you want to continue?'
      );
      if (!confirmReopen) return;
    }

    // 1. Synchronously get latest state from shedsRef to prevent rapid-click race conditions
    const nextSheds = applyLineWeightDeletion(shedsRef.current, currentShed.id, currentPart.id, currentLine.id, idx);
    shedsRef.current = nextSheds;
    setSheds(nextSheds);

    if (activeFarmId) {
      localStorage.setItem(`poultry_draft_${activeFarmId}_${ageWeek}`, JSON.stringify({ sheds: nextSheds, updatedAt: Date.now() }));
      localStorage.setItem(`poultry_draft_${activeFarmId}`, JSON.stringify({ sheds: nextSheds, updatedAt: Date.now() }));
      localStorage.setItem(`poultry_farm_${activeFarmId}_${ageWeek}`, JSON.stringify({ sheds: nextSheds, farmName, date, ageWeek, season }));
      localStorage.setItem(`poultry_farm_${activeFarmId}`, JSON.stringify({ sheds: nextSheds, farmName, date, ageWeek, season }));
      localStorage.setItem(`poultry_sheds_${activeFarmId}`, JSON.stringify(nextSheds));
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
      if (currentUserRole === 'Supervisor' || currentUserRole === 'In-Charge') {
        showToast('Permission Denied: Completed submissions cannot be modified by Supervisor or Incharge.');
        return;
      }
      const confirmReopen = window.confirm(
        'This farm record was COMPLETED & SUBMITTED.\n\nClearing weights will mark the session as DRAFT until all lines are weighed and re-submitted.\n\nDo you want to continue?'
      );
      if (!confirmReopen) return;
    }

    if (window.confirm(`Clear all ${currentLine.weights.length} weights in ${currentLine.name}?`)) {
      const nextSheds = applyLineWeightClear(shedsRef.current, currentShed.id, currentPart.id, currentLine.id);
      shedsRef.current = nextSheds;
      setSheds(nextSheds);
      if (activeFarmId) {
        localStorage.setItem(`poultry_draft_${activeFarmId}_${ageWeek}`, JSON.stringify({ sheds: nextSheds, updatedAt: Date.now() }));
        localStorage.setItem(`poultry_draft_${activeFarmId}`, JSON.stringify({ sheds: nextSheds, updatedAt: Date.now() }));
        localStorage.setItem(`poultry_farm_${activeFarmId}_${ageWeek}`, JSON.stringify({ sheds: nextSheds, farmName, date, ageWeek, season }));
        localStorage.setItem(`poultry_farm_${activeFarmId}`, JSON.stringify({ sheds: nextSheds, farmName, date, ageWeek, season }));
        localStorage.setItem(`poultry_sheds_${activeFarmId}`, JSON.stringify(nextSheds));
      }
      showToast(`Cleared weights in ${currentLine.name}`);
      markSessionAsDraft('Cleared line weights');
    }
  };

  // --- FINAL SUBMISSION: COMPLETE FARM WEIGHING (status: 'COMPLETED') ---
  const handleCompleteFarmSubmission = async () => {
    if (isSubmittingBatch) return;

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

    // 3. Calculate Female & Male Act Body Weights across active farm
    const femaleWeights = sheds
      .filter(s => s.type === 'Female')
      .flatMap(s => s.parts.flatMap(p => p.lines.flatMap(l => l.weights || [])));
    const maleWeights = sheds
      .filter(s => s.type === 'Male')
      .flatMap(s => s.parts.flatMap(p => p.lines.flatMap(l => l.weights || [])));
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
    if (farmStatus === 'COMPLETED' || currentActiveFarmSummary?.status === 'COMPLETED') {
      showToast('Permission Denied: Completed submissions cannot be modified.');
      return;
    }
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
    if (farmStatus === 'COMPLETED' || currentActiveFarmSummary?.status === 'COMPLETED') {
      showToast('Permission Denied: Completed submissions cannot be modified.');
      return;
    }
    setEditingPart({ id: part.id, name: part.name });
  };

  const handleSaveEditPart = () => {
    if (!editingPart || !editingPart.name.trim() || !activeShed) return;
    if (farmStatus === 'COMPLETED' || currentActiveFarmSummary?.status === 'COMPLETED') {
      showToast('Permission Denied: Completed submissions cannot be modified.');
      setEditingPart(null);
      return;
    }
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
    if (farmStatus === 'COMPLETED' || currentActiveFarmSummary?.status === 'COMPLETED') {
      showToast('Permission Denied: Completed submissions cannot be modified.');
      return;
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
    if (farmStatus === 'COMPLETED' || currentActiveFarmSummary?.status === 'COMPLETED') {
      showToast('Permission Denied: Completed submissions cannot be modified.');
      return;
    }
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
    if (farmStatus === 'COMPLETED' || currentActiveFarmSummary?.status === 'COMPLETED') {
      showToast('Permission Denied: Completed submissions cannot be modified.');
      return;
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
    const remaining = activePart.lines.filter(l => String(l.id) !== String(lineId));
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
            : (currentUserRole === 'Supervisor' || currentUserRole === 'In-Charge')
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
          currentUserRole === 'Admin' || currentUserRole === 'Manager' ? (
            // Dashboard B: Executive Overview (Manager & Admin)
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
            />
          ) : (
            // Dashboard A: Field Operator Dashboard (Supervisor & Incharge)
            <SupervisorDashboard
              currentUser={currentUser}
              activeFarm={currentActiveFarmSummary}
              assignedFarms={accessibleFarms}
              completionStats={completionStats}
              farmStatus={farmStatus}
              formattedDateTime={formattedDateTime}
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
            />
          )
        )}

        {/* ========================================================= */}
        {/* DEDICATED FULL-SCREEN SUBMISSION PAGE (Req 3 & 6)         */}
        {/* ========================================================= */}
        {currentScreen === 'submit_page' && (
          <DedicatedSubmitScreen
            farm={currentActiveFarmSummary}
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
                      return (
                        <option key={w} value={w} className="text-slate-900 bg-white py-1">
                          {w} — {statusIcon} {formatRecordingWeekLabel(w, currentActiveFarmSummary?.flockDate || date)} ({statusText})
                        </option>
                      );
                    })}
                  </select>
                  <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2.5 text-emerald-700">
                    <ChevronDown className="w-4 h-4" />
                  </div>
                </div>

                {/* Active Recording Period Date Range & Status Strip */}
                <div className="mt-1.5 flex items-center justify-between text-[11px] text-emerald-900 bg-emerald-50/60 px-2.5 py-1.5 rounded-lg border border-emerald-100 flex-wrap gap-1">
                  <span className="font-semibold truncate min-w-0 flex-1">
                    {formatRecordingWeekLabel(ageWeek, currentActiveFarmSummary?.flockDate || date)}
                  </span>
                  <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-emerald-100/80 text-emerald-800 shrink-0">
                    {weekStatusMap?.[ageWeek] === 'COMPLETED' ? '🟢 Completed' : '🟡 In-Progress'}
                  </span>
                </div>
              </div>

              {/* Dedicated Full-Width Shed Gender Filter Bar */}
              <div className="pt-3 mt-3 border-t border-slate-100 flex items-center justify-between flex-wrap gap-2">
                <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">Filter Sheds:</span>
                <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl border border-slate-200 shadow-2xs max-w-full overflow-x-auto">
                  <button
                    type="button"
                    onClick={() => setShedGenderFilter('ALL')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-black transition cursor-pointer shrink-0 ${
                      shedGenderFilter === 'ALL'
                        ? 'bg-slate-900 text-white shadow-xs'
                        : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200'
                    }`}
                  >
                    All ({sheds.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setShedGenderFilter('FEMALE')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-black transition cursor-pointer flex items-center gap-1 shrink-0 ${
                      shedGenderFilter === 'FEMALE'
                        ? 'bg-pink-600 text-white shadow-xs'
                        : 'text-pink-700 hover:bg-pink-100'
                    }`}
                  >
                    <span>♀ Female</span>
                    <span>({sheds.filter(s => s.type !== 'Male').length})</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setShedGenderFilter('MALE')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-black transition cursor-pointer flex items-center gap-1 shrink-0 ${
                      shedGenderFilter === 'MALE'
                        ? 'bg-blue-600 text-white shadow-xs'
                        : 'text-blue-700 hover:bg-blue-100'
                    }`}
                  >
                    <span>♂ Male</span>
                    <span>({sheds.filter(s => s.type === 'Male').length})</span>
                  </button>
                </div>
              </div>
            </div>

            <p className="text-xs text-slate-500 mb-3 px-1 font-medium">Choose a shed or toggle its Female / Male flock gender:</p>

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
                (shedGenderFilter === 'ALL'
                  ? sheds
                  : shedGenderFilter === 'FEMALE'
                    ? sheds.filter(s => s.type !== 'Male')
                    : sheds.filter(s => s.type === 'Male')
                ).map(s => {
                  const sStd = s.type === 'Male' ? stdWeightMale : stdWeightFemale;
                  const sStats = calculateFlockStats((s.parts || []).flatMap(p => (p.lines || []).flatMap(l => l.weights || [])), sStd, weekNum);
                  return (
                    <div
                      key={s.id}
                      className="w-full bg-white hover:bg-slate-50/70 p-4 rounded-2xl border border-slate-200 flex flex-col justify-between gap-3 shadow-xs transition"
                    >
                      <div>
                        {/* Shed Name Row with full width */}
                        <div 
                          className="flex items-center justify-between gap-2 mb-2 cursor-pointer"
                          onClick={() => navigateToPartSelect(s.id, s.parts[0]?.id || 'part-1-a')}
                        >
                          <span className="font-black text-base text-slate-900 hover:text-emerald-600 transition truncate">
                            {s.name}
                          </span>
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border shrink-0 ${
                            s.type === 'Male'
                              ? 'bg-blue-50 text-blue-700 border-blue-200'
                              : 'bg-pink-50 text-pink-700 border-pink-200'
                          }`}>
                            {s.type === 'Male' ? '♂ Male' : '♀ Female'}
                          </span>
                        </div>

                        {/* Interactive High-Contrast Shed-Wise Female/Male Selection on its own row */}
                        <div 
                          className="flex items-center justify-between gap-2 p-1.5 bg-slate-50 rounded-xl border border-slate-200/80 mb-2" 
                          onClick={e => e.stopPropagation()}
                        >
                          <span className="text-[11px] font-bold text-slate-500 pl-1">Flock Gender:</span>
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (s.type !== 'Female') handleToggleShedGender(s.id, 'Female');
                              }}
                              className={`px-2.5 py-1 rounded-lg text-xs font-black transition cursor-pointer flex items-center gap-1 ${
                                s.type === 'Female'
                                  ? 'bg-pink-600 text-white shadow-xs'
                                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200'
                              }`}
                              title="Set shed to Female"
                            >
                              <span>♀ Female</span>
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (s.type !== 'Male') handleToggleShedGender(s.id, 'Male');
                              }}
                              className={`px-2.5 py-1 rounded-lg text-xs font-black transition cursor-pointer flex items-center gap-1 ${
                                s.type === 'Male'
                                  ? 'bg-blue-600 text-white shadow-xs'
                                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200'
                              }`}
                              title="Set shed to Male"
                            >
                              <span>♂ Male</span>
                            </button>
                          </div>
                        </div>

                        <div className="text-xs text-slate-500 mb-2">
                          {(s.parts || []).length} {(s.parts || []).length === 1 ? 'Part' : 'Parts'} • {sStats.count} birds weighed
                        </div>
                      </div>

                      <div 
                        className="flex items-center justify-between text-xs text-slate-500 pt-2 border-t border-slate-100 cursor-pointer"
                        onClick={() => navigateToPartSelect(s.id, s.parts[0]?.id || 'part-1-a')}
                      >
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
                        <div className="flex items-center gap-1 font-bold text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-lg border border-emerald-200">
                          <span>Open Parts</span>
                          <ChevronRight className="w-3.5 h-3.5 text-emerald-600" />
                        </div>
                      </div>
                    </div>
                  );
                })
              )}

              <button
                onClick={() => setShowAddShedModal(true)}
                className="col-span-full py-3.5 bg-white hover:bg-slate-50 text-emerald-700 rounded-2xl text-xs font-bold flex items-center justify-center gap-1.5 border border-dashed border-emerald-300 transition cursor-pointer shadow-xs"
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
                <div 
                  className="flex items-center gap-1 bg-slate-100 p-0.5 rounded-lg border border-slate-200" 
                  onClick={e => e.stopPropagation()}
                >
                  <button
                    type="button"
                    onClick={() => {
                      if (activeShed.type !== 'Female') handleToggleShedGender(activeShed.id, 'Female');
                    }}
                    className={`px-2 py-0.5 rounded text-[10px] font-black transition cursor-pointer ${
                      activeShed.type === 'Female'
                        ? 'bg-pink-600 text-white shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    ♀ Female
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (activeShed.type !== 'Male') handleToggleShedGender(activeShed.id, 'Male');
                    }}
                    className={`px-2 py-0.5 rounded text-[10px] font-black transition cursor-pointer ${
                      activeShed.type === 'Male'
                        ? 'bg-blue-600 text-white shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    ♂ Male
                  </button>
                </div>
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

            {/* Shed Mini Stats Summary */}
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

            {/* Responsive Multi-Column Part Cards Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 pb-6 overflow-y-auto flex-1">
              {activeShed.parts.map((part, partIndex) => {
                const partStat = calculateFlockStats(part.lines.flatMap(l => l.weights), activeStd, weekNum);
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

            {/* Responsive Multi-Column Line Cards Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 pb-6 overflow-y-auto flex-1">
              {activePart.lines.map((line, lineIndex) => {
                const lStats = calculateFlockStats(line.weights, activeStd, weekNum);
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
                              <span className={`text-[10px] font-black px-2 py-0.2 rounded-full border ${
                                activeShed.type === 'Male'
                                  ? 'bg-blue-100 text-blue-900 border-blue-300'
                                  : 'bg-pink-100 text-pink-900 border-pink-300'
                              }`}>
                                {activeShed.name} ({activeShed.type === 'Male' ? '♂ Male' : '♀ Female'})
                              </span>
                            </div>
                            <span className="text-xs text-slate-500 block truncate">
                              {line.weights.length} {line.weights.length === 1 ? 'Bird Weighed' : 'Birds Weighed'}
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          {/* Line Status / Grade Badge */}
                          {!hasWeights ? (
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

              <div 
                className="flex items-center gap-1 bg-slate-100 p-0.5 rounded-lg border border-slate-200 shrink-0" 
                onClick={e => e.stopPropagation()}
              >
                <button
                  type="button"
                  onClick={() => {
                    if (activeShed.type !== 'Female') handleToggleShedGender(activeShed.id, 'Female');
                  }}
                  className={`px-2 py-0.5 rounded text-[10px] font-black transition cursor-pointer ${
                    activeShed.type === 'Female'
                      ? 'bg-pink-600 text-white shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                  title="Set shed to Female"
                >
                  ♀ Female
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (activeShed.type !== 'Male') handleToggleShedGender(activeShed.id, 'Male');
                  }}
                  className={`px-2 py-0.5 rounded text-[10px] font-black transition cursor-pointer ${
                    activeShed.type === 'Male'
                      ? 'bg-blue-600 text-white shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                  title="Set shed to Male"
                >
                  ♂ Male
                </button>
              </div>
            </div>

            {/* Responsive 2-Column Grid on Laptop (lg:grid lg:grid-cols-12 lg:gap-5) */}
            <div className="lg:grid lg:grid-cols-12 lg:gap-5 flex-1 items-start">
              {/* Left Column on Laptop (lg:col-span-7): Metrics, Input, Chips & Actions */}
              <div className="lg:col-span-7 flex flex-col space-y-2.5">
                {/* Real-Time Metric Strip for Current Line & Part */}
                <div className="bg-white p-3 rounded-2xl border border-slate-200 grid grid-cols-4 gap-1 text-center shadow-xs">
                  <div className="min-w-0">
                    <span className="text-[10px] text-slate-500 font-bold uppercase truncate block">Weighed</span>
                    <div className="text-base font-black text-slate-900">{lineStats.count}</div>
                    <span className="text-[9px] text-slate-400 block font-semibold truncate">Part: {partStats.count}</span>
                  </div>
                  <div className="min-w-0">
                    <span className="text-[10px] text-slate-500 font-bold uppercase truncate block">Avg Wt</span>
                    <div className="text-base font-black text-emerald-600 font-mono">
                      {lineStats.count > 0 ? `${lineStats.avg}g` : '—'}
                    </div>
                    <span className="text-[9px] text-slate-400 block font-semibold truncate">Part: {partStats.count > 0 ? `${partStats.avg}g` : '—'}</span>
                  </div>
                  <div className="min-w-0">
                    <span className="text-[10px] text-slate-500 font-bold uppercase truncate block">Uniformity (±10%)</span>
                    <div className="text-base font-black text-amber-600 font-mono">
                      {lineStats.count > 0 ? `${lineStats.uniformity10Pct}%` : '—'}
                    </div>
                    <span className="text-[9px] text-slate-400 block font-semibold truncate">Part: {partStats.count > 0 ? `${partStats.uniformity10Pct}%` : '—'}</span>
                  </div>
                  <div className="min-w-0">
                    <span className="text-[10px] text-slate-500 font-bold uppercase truncate block">CV %</span>
                    <div className="text-base font-black text-sky-600 font-mono">
                      {lineStats.count > 0 ? `${lineStats.cv}%` : '—'}
                    </div>
                    <span className="text-[9px] text-slate-400 block font-semibold truncate">Part: {partStats.count > 0 ? `${partStats.cv}%` : '—'}</span>
                  </div>
                </div>

                {/* Live Line Status Indicator */}
                <div className="flex items-center justify-between bg-slate-50 px-3 py-1.5 rounded-xl border border-slate-200 text-xs">
                  <span className="text-[11px] font-bold text-slate-600">
                    {activeLine.name} Uniformity Status:
                  </span>
                  {lineStats.count === 0 ? (
                    <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-slate-200 text-slate-700">
                      🟡 Pending (0 Birds)
                    </span>
                  ) : !lineStats.isComplete ? (
                    <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-300">
                      🟡 In Progress ({lineStats.count}/10 birds)
                    </span>
                  ) : lineStats.status === 'EXCELLENT' ? (
                    <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-300">
                      🟢 EXCELLENT ({lineStats.uniformity10Pct}%)
                    </span>
                  ) : lineStats.status === 'ACCEPTABLE' ? (
                    <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-sky-100 text-sky-800 border border-sky-300">
                      🔵 ACCEPTABLE ({lineStats.uniformity10Pct}%)
                    </span>
                  ) : (
                    <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-rose-100 text-rose-800 border border-rose-300">
                      🔴 POOR ({lineStats.uniformity10Pct}%)
                    </span>
                  )}
                </div>

                {/* Manual Entry Form - Compact & Fast */}
                <form onSubmit={e => { e.preventDefault(); handleAddWeight(); }} className="flex flex-col gap-1.5">
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
                      } rounded-xl px-3 py-2 text-base font-black text-slate-900 focus:outline-none font-mono shadow-xs placeholder:text-slate-400`}
                    />
                    <button
                      type="submit"
                      disabled={isSubmittingWeight}
                      className="bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white font-black px-5 rounded-xl text-xs shrink-0 shadow-xs cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed transition"
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

                {/* Action Buttons: Save Draft (Supervisor & Incharge) & Go to Submit Screen */}
                <div className="space-y-2 pt-1">
                  {(currentUserRole === 'Supervisor' || currentUserRole === 'In-Charge') && (
                    <button
                      type="button"
                      onClick={handleManualSaveDraft}
                      disabled={isSavingDraft}
                      className="w-full bg-amber-500 hover:bg-amber-400 active:scale-95 text-slate-950 font-black py-3 px-4 rounded-xl text-xs flex items-center justify-center gap-2 shadow-xs transition cursor-pointer disabled:opacity-50"
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
                    className="w-full font-bold py-3 px-4 rounded-xl text-xs flex items-center justify-between bg-slate-800 hover:bg-slate-700/80 border border-slate-700 text-white shadow-md active:scale-95 transition cursor-pointer"
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

              {/* Right Column on Laptop (lg:col-span-5): Weighed Birds List with Live Grading Badges */}
              <div className="lg:col-span-5 bg-white rounded-2xl border border-slate-200 p-3 shadow-xs mt-3 lg:mt-0 flex flex-col min-h-[320px] lg:min-h-[480px]">
                <div className="flex justify-between items-center text-xs text-slate-500 pb-2 mb-2 border-b border-slate-100">
                  <span className="font-bold text-slate-900">{activeLine.name} Birds ({activeLine.weights.length})</span>
                  <span className="text-[11px] font-mono font-semibold text-slate-600">
                    Target: {activeStd}g (±{activeBands.tolerance}g)
                  </span>
                </div>

                <div className="flex-1 overflow-y-auto max-h-[300px] lg:max-h-[420px] pr-1">
                  {activeLine.weights.length === 0 ? (
                    <div className="text-center py-12 text-xs text-slate-400">
                      No birds recorded in {activeLine.name} yet. Tap chips or enter weights on the left.
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
                </div>

                {activeLine.weights.length > 0 && (
                  <div className="pt-2.5 mt-2.5 border-t border-slate-100 text-center">
                    <button
                      onClick={handleClearLineWeights}
                      className="text-[11px] font-bold text-rose-600 hover:text-rose-700 active:scale-95 transition cursor-pointer"
                    >
                      Clear All {activeLine.weights.length} Weights in {activeLine.name}
                    </button>
                  </div>
                )}
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
                  Consolidated Flock Conclusion (Cons)
                </h2>
                <div className="flex items-center justify-center gap-1.5 mt-0.5 flex-wrap">
                  <span className="text-[10px] text-slate-600 font-bold">{farmName}</span>
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
                      return (
                        <option key={w} value={w}>
                          {w} — {icon} {formatRecordingWeekLabel(w, currentActiveFarmSummary?.flockDate || date)}
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
                      <td className="py-2 px-3 font-semibold text-slate-600">Standard Target Weight</td>
                      <td className="py-2 px-3 font-mono font-bold text-pink-600">{stdWeightFemale}g</td>
                      <td className="py-2 px-3 font-mono font-bold text-blue-600">{stdWeightMale}g</td>
                      <td className="py-2 px-3 text-[11px] text-slate-500">Benchmark Reference</td>
                    </tr>
                    <tr className="hover:bg-slate-50/70 transition bg-emerald-50/20">
                      <td className="py-2 px-3 font-semibold text-slate-800">Actual Average Body Weight</td>
                      <td className="py-2 px-3 font-mono font-black text-emerald-600 text-sm">{consolidated.fStats.avg}g</td>
                      <td className="py-2 px-3 font-mono font-black text-emerald-600 text-sm">{consolidated.mStats.avg}g</td>
                      <td className="py-2 px-3 text-[11px] font-bold text-emerald-700">Field Weighed Act WT</td>
                    </tr>
                    <tr className="hover:bg-slate-50/70 transition">
                      <td className="py-2 px-3 font-semibold text-slate-600">Difference vs Target</td>
                      <td className={`py-2 px-3 font-mono font-bold ${consolidated.fStats.diff >= 0 ? 'text-emerald-600' : 'text-amber-600'}`}>
                        {consolidated.fStats.diff > 0 ? `+${consolidated.fStats.diff}` : consolidated.fStats.diff}g
                      </td>
                      <td className={`py-2 px-3 font-mono font-bold ${consolidated.mStats.diff >= 0 ? 'text-emerald-600' : 'text-amber-600'}`}>
                        {consolidated.mStats.diff > 0 ? `+${consolidated.mStats.diff}` : consolidated.mStats.diff}g
                      </td>
                      <td className="py-2 px-3 text-[11px] text-slate-500">Variance from standard</td>
                    </tr>
                    <tr className="hover:bg-slate-50/70 transition">
                      <td className="py-2 px-3 font-semibold text-slate-600">Uniformity (S% ±10%)</td>
                      <td className="py-2 px-3 font-mono font-black text-amber-600">{consolidated.fStats.sPct}%</td>
                      <td className="py-2 px-3 font-mono font-black text-amber-600">{consolidated.mStats.sPct}%</td>
                      <td className="py-2 px-3">
                        <span className={`text-[10px] px-2 py-0.5 rounded font-bold ${
                          consolidated.fStats.sPct >= 80 ? 'bg-emerald-100 text-emerald-800' :
                          consolidated.fStats.sPct >= 70 ? 'bg-blue-100 text-blue-800' : 'bg-amber-100 text-amber-800'
                        }`}>
                          {consolidated.fStats.sPct >= 80 ? 'EXCELLENT' : consolidated.fStats.sPct >= 70 ? 'ACCEPTABLE' : 'MODERATE'}
                        </span>
                      </td>
                    </tr>
                    <tr className="hover:bg-slate-50/70 transition">
                      <td className="py-2 px-3 font-semibold text-slate-600">CV % (F-Factor)</td>
                      <td className="py-2 px-3 font-mono font-bold text-sky-600">{consolidated.fStats.cv}%</td>
                      <td className="py-2 px-3 font-mono font-bold text-sky-600">{consolidated.mStats.cv}%</td>
                      <td className="py-2 px-3 text-[11px] text-slate-500">Coefficient of variation</td>
                    </tr>
                    <tr className="hover:bg-slate-50/70 transition">
                      <td className="py-2 px-3 font-semibold text-slate-600">Weight Range (Min – Max)</td>
                      <td className="py-2 px-3 font-mono text-slate-700">{consolidated.fStats.min}g – {consolidated.fStats.max}g</td>
                      <td className="py-2 px-3 font-mono text-slate-700">{consolidated.mStats.min}g – {consolidated.mStats.max}g</td>
                      <td className="py-2 px-3 text-[11px] text-slate-500">Min to max spread</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            {/* Compact Shed-Wise Conclusion Breakdown Table */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden flex-1">
              <div className="bg-slate-50 px-3 py-2 border-b border-slate-200 flex items-center justify-between text-xs font-bold text-slate-700">
                <span className="flex items-center gap-1.5">
                  <Layers className="w-4 h-4 text-emerald-600" />
                  <span>Shed-Wise Conclusion Breakdown ({consolidated.shedSummaries.length} Sheds)</span>
                </span>
                <span className="text-[10px] text-slate-500">Shed 1 to 10 Individual Results</span>
              </div>

              <div className="overflow-x-auto max-h-60 overflow-y-auto">
                <table className="w-full text-xs text-left">
                  <thead className="bg-slate-100/75 text-[10px] uppercase font-bold text-slate-500 border-b border-slate-200 sticky top-0">
                    <tr>
                      <th className="py-2 px-3">Shed</th>
                      <th className="py-2 px-3">Sex</th>
                      <th className="py-2 px-3">Birds</th>
                      <th className="py-2 px-3 text-emerald-700">Act Wt</th>
                      <th className="py-2 px-3">Min</th>
                      <th className="py-2 px-3">Max</th>
                      <th className="py-2 px-3">CV %</th>
                      <th className="py-2 px-3 text-rose-700">MB %</th>
                      <th className="py-2 px-3 text-amber-700">B %</th>
                      <th className="py-2 px-3 text-emerald-700">S %</th>
                      <th className="py-2 px-3 text-sky-700">A %</th>
                      <th className="py-2 px-3 text-purple-700">MA %</th>
                      <th className="py-2 px-3 text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-medium">
                    {consolidated.shedSummaries.map((s, idx) => (
                      <tr key={s.id || idx} className="hover:bg-slate-50/70 transition">
                        <td className="py-2 px-3 font-bold text-slate-800">{s.name}</td>
                        <td className="py-2 px-3">
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                            s.type === 'Male' ? 'bg-blue-100 text-blue-800' : 'bg-pink-100 text-pink-800'
                          }`}>
                            {s.type === 'Male' ? '♂ Male' : '♀ Female'}
                          </span>
                        </td>
                        <td className="py-2 px-3 font-mono">{s.stats.count > 0 ? `${s.stats.count}b` : '0b'}</td>
                        <td className="py-2 px-3 font-mono font-bold text-emerald-600">{s.stats.count > 0 ? `${s.stats.avg}g` : '—'}</td>
                        <td className="py-2 px-3 font-mono text-slate-500">{s.stats.count > 0 ? `${s.stats.min}g` : '—'}</td>
                        <td className="py-2 px-3 font-mono text-slate-500">{s.stats.count > 0 ? `${s.stats.max}g` : '—'}</td>
                        <td className="py-2 px-3 font-mono text-sky-600">{s.stats.count > 0 ? `${s.stats.cv}%` : '—'}</td>
                        <td className="py-2 px-3 font-mono font-bold text-rose-600">{s.stats.count > 0 ? `${s.stats.mbPct}%` : '—'}</td>
                        <td className="py-2 px-3 font-mono font-bold text-amber-600">{s.stats.count > 0 ? `${s.stats.bPct}%` : '—'}</td>
                        <td className="py-2 px-3 font-mono font-bold text-emerald-600">{s.stats.count > 0 ? `${s.stats.sPct}%` : '—'}</td>
                        <td className="py-2 px-3 font-mono font-bold text-sky-600">{s.stats.count > 0 ? `${s.stats.aPct}%` : '—'}</td>
                        <td className="py-2 px-3 font-mono font-bold text-purple-600">{s.stats.count > 0 ? `${s.stats.maPct}%` : '—'}</td>
                        <td className="py-2 px-3 text-center">
                          <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold ${
                            s.stats.count === 0 ? 'bg-slate-100 text-slate-500' :
                            s.stats.sPct >= 80 ? 'bg-emerald-100 text-emerald-800' :
                            s.stats.sPct >= 70 ? 'bg-blue-100 text-blue-800' : 'bg-amber-100 text-amber-800'
                          }`}>
                            {s.stats.count === 0 ? 'PENDING' : s.stats.sPct >= 80 ? 'EXCELLENT' : s.stats.sPct >= 70 ? 'ACCEPTABLE' : 'MODERATE'}
                          </span>
                        </td>
                      </tr>
                    ))}
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
                          <div className="flex items-center gap-1.5 min-w-0">
                            <Building2 className="w-4 h-4 text-emerald-600 shrink-0" />
                            <span className="font-black text-xs text-slate-900 truncate">{log.farmName}</span>
                          </div>

                          <span className="bg-emerald-50 text-emerald-700 border border-emerald-200 px-2.5 py-0.5 rounded-full text-[9px] font-black shrink-0 flex items-center gap-1">
                            <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                            COMPLETED
                          </span>
                        </div>

                        {/* Summary Metrics: Spacious 2x2 Grid with min-w-0 preventing text collisions */}
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
