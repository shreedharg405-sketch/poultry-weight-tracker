import React, { useState, useEffect } from 'react';
import { 
  Building2, 
  Scale, 
  ChevronRight, 
  Radio, 
  LogOut, 
  CheckCircle2, 
  AlertCircle,
  UploadCloud,
  Calendar, 
  Lock, 
  Unlock,
  ArrowRight,
  Edit2, 
  Edit3,
  X, 
  Loader2,
  Plus,
  Trash2,
  Grid,
  ChevronDown,
  Check,
  User,
  ShieldCheck,
  Cloud,
  CloudOff,
  RefreshCw,
  Warehouse
} from 'lucide-react';
import { FarmSummary, AppUser, FarmStatus, cloudApi, formatEmployeeId } from '../services/cloudSyncService';
import { formatRecordingWeekLabel } from '../utils/weightUpdateHelpers';
import { ShedData, calculateFlockStats } from '../services/excelExportService';

interface CompletionStats {
  totalLinesCount: number;
  completedLinesCount: number;
  incompleteLines: Array<{
    shedId: string;
    shedName: string;
    partId: string;
    partName: string;
    lineId: number | string;
    lineName: string;
    path: string;
  }>;
  progressPercent: number;
  isFarm100PercentWeighed: boolean;
}

export interface SupervisorDashboardProps {
  currentUser: AppUser | null;
  activeFarm: FarmSummary | null;
  assignedFarms: FarmSummary[];
  completionStats: CompletionStats;
  farmStatus: FarmStatus;
  formattedDateTime: string;
  onSelectFarm: (farmId: string) => void;
  onStartWeighing: () => void;
  onOpenSubmitPage: () => void;
  onViewSubmissionsUpdate: () => void;
  onOpenAuth: () => void;
  onLogout: () => void;
  onRenameFarm?: (farmId: string, newName: string) => Promise<void>;
  onSilentReload?: () => Promise<void>;
  currentWeek?: string;
  onSwitchWeek?: (newWeek: string) => void;
  weekStatusMap?: Record<string, 'COMPLETED' | 'DRAFT'>;
  savedShedsCount?: number;
  totalShedsCount?: number;
  totalFarmBirdsCount?: number;
  isAllShedsSaved?: boolean;
  onSubmitOverallFarm?: () => void;

  // Integrated Sheds Workspace Props
  sheds?: ShedData[];
  shedLocks?: Record<string, any>;
  onEnterShed?: (shed: ShedData) => void;
  onStartEditShed?: (shed: ShedData) => void;
  onDeleteShed?: (shedId: string, e: React.MouseEvent) => void;
  onForceUnlock?: (shedId: string, shedName: string) => void;
  onAddShed?: () => void;
  isEnteringShed?: string | null;
  isForceUnlockingShed?: string | null;
  isFieldWorker?: boolean;
  stdWeightFemale?: number;
  stdWeightMale?: number;
  weekNum?: number;
  syncStatus?: 'synced' | 'saving' | 'offline' | 'refreshing';
  pendingSyncCount?: number;
}

export const SupervisorDashboard: React.FC<SupervisorDashboardProps> = ({
  currentUser,
  activeFarm,
  assignedFarms,
  completionStats,
  farmStatus,
  formattedDateTime,
  onSelectFarm,
  onStartWeighing,
  onOpenSubmitPage,
  onViewSubmissionsUpdate,
  onOpenAuth,
  onLogout,
  onRenameFarm,
  onSilentReload,
  currentWeek,
  onSwitchWeek,
  weekStatusMap,
  savedShedsCount = 0,
  totalShedsCount = 0,
  totalFarmBirdsCount = 0,
  isAllShedsSaved = false,
  onSubmitOverallFarm,
  sheds = [],
  shedLocks = {},
  onEnterShed,
  onStartEditShed,
  onDeleteShed,
  onForceUnlock,
  onAddShed,
  isEnteringShed,
  isForceUnlockingShed,
  isFieldWorker = true,
  stdWeightFemale = 1905,
  stdWeightMale = 2540,
  weekNum = 1,
  syncStatus = 'synced',
  pendingSyncCount = 0,
}) => {
  const userDisplayName = currentUser?.userName || currentUser?.name || 'Field Operator';
  const rawRole = currentUser?.role || 'In-Charge';
  const userRole = (rawRole === 'Supervisor' || rawRole === 'Incharge') ? 'In-Charge' : rawRole;
  const userInitial = (userDisplayName.trim().charAt(0) || 'U').toUpperCase();

  // Silent Reload state
  const [isReloading, setIsReloading] = useState(false);

  const handleSilentReloadClick = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (isReloading) return;
    setIsReloading(true);
    try {
      if (onSilentReload) {
        await onSilentReload();
      }
    } catch (err) {
      console.warn('Silent reload error:', err);
    } finally {
      setTimeout(() => {
        setIsReloading(false);
      }, 400);
    }
  };

  // Modals state
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [showFarmDetailsModal, setShowFarmDetailsModal] = useState(false);

  // Rename Farm Modal State
  const [showRenameModal, setShowRenameModal] = useState(false);
  const [renameInput, setRenameInput] = useState('');
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [renameSuccess, setRenameSuccess] = useState<string | null>(null);

  // Handle hardware / swipe back navigation to close open modals
  useEffect(() => {
    const handlePop = () => {
      if (showRenameModal) {
        setShowRenameModal(false);
      } else if (showProfileModal) {
        setShowProfileModal(false);
      } else if (showFarmDetailsModal) {
        setShowFarmDetailsModal(false);
      }
    };
    window.addEventListener('popstate', handlePop);
    return () => window.removeEventListener('popstate', handlePop);
  }, [showProfileModal, showFarmDetailsModal, showRenameModal]);

  const handleOpenRename = () => {
    if (!activeFarm) return;
    setRenameInput(activeFarm.name);
    setRenameError(null);
    setRenameSuccess(null);
    setShowRenameModal(true);
  };

  const handleSaveRename = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeFarm) return;
    const trimmed = renameInput.trim();
    if (!trimmed) {
      setRenameError('Farm name cannot be blank.');
      return;
    }
    if (trimmed === activeFarm.name) {
      setShowRenameModal(false);
      return;
    }
    setIsRenaming(true);
    setRenameError(null);
    try {
      if (onRenameFarm) {
        await onRenameFarm(activeFarm.id, trimmed);
      } else {
        await cloudApi.updateFarmDetails(activeFarm.id, { name: trimmed });
      }
      setRenameSuccess(`Farm name updated to "${trimmed}"`);
      setTimeout(() => {
        setShowRenameModal(false);
      }, 700);
    } catch (err: any) {
      setRenameError(err?.message || 'Failed to update farm name.');
    } finally {
      setIsRenaming(false);
    }
  };

  // Fallback enter shed handler
  const handleShedClick = (s: ShedData) => {
    if (onEnterShed) {
      onEnterShed(s);
    } else {
      onStartWeighing();
    }
  };

  const activeWeekNum = currentWeek || activeFarm?.ageWeek || 'W19';

  return (
    <div className="flex-1 flex flex-col p-2 sm:p-4 animate-in fade-in duration-150 max-w-7xl mx-auto w-full">
      {/* ==================================================================== */}
      {/* 1. TOP HEADER BAR: Profile Avatar (Top-Left) & Shed Icon (Farm Info) */}
      {/* ==================================================================== */}
      <div className="flex items-center justify-between gap-2 mb-4 bg-white px-3 py-2.5 rounded-2xl border border-slate-200/90 shadow-2xs">
        {/* Left Section: Compact Top-Left Profile Trigger & Farm Details Trigger */}
        <div className="flex items-center gap-2 min-w-0">
          {/* A. Top-Left Profile Trigger (Image 1 Trigger) */}
          <button
            type="button"
            onClick={() => setShowProfileModal(true)}
            className="flex items-center gap-2 p-1 pl-1 pr-2.5 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-xl transition active:scale-95 cursor-pointer shadow-2xs shrink-0 group"
            title="Open Profile & Session Details"
            aria-label="User Profile"
          >
            <div className="w-8 h-8 rounded-lg text-white flex items-center justify-center shadow-xs bg-emerald-600 group-hover:bg-emerald-500 transition shrink-0">
              <User className="w-4 h-4 text-white" />
            </div>
            <div className="text-left hidden xs:block">
              <span className="text-xs font-black text-slate-900 block leading-tight truncate max-w-[85px] sm:max-w-[120px]">
                {userDisplayName}
              </span>
              <span className="text-[9px] font-bold text-emerald-700 block leading-tight">
                {userRole}
              </span>
            </div>
          </button>

          {/* B. Farm Details Shed/Building Icon Trigger (Image 2 Trigger) */}
          {activeFarm && (
            <button
              type="button"
              onClick={() => setShowFarmDetailsModal(true)}
              className="flex items-center gap-2 px-3 py-2 bg-emerald-50 hover:bg-emerald-100/70 border border-emerald-200 rounded-xl transition active:scale-95 cursor-pointer shadow-2xs min-w-0 group"
              title="Farm Info: View Assigned Farm Unit & Active Recording Week"
              aria-label="Farm Info"
            >
              <div className="p-1 bg-white rounded-lg text-emerald-600 shadow-2xs border border-emerald-200/80 shrink-0">
                <Warehouse className="w-4 h-4 text-emerald-600 group-hover:scale-105 transition" />
              </div>
              <div className="text-left min-w-0">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="text-[10px] font-extrabold uppercase tracking-wide text-emerald-800 flex items-center gap-1">
                    Farm Info
                  </span>
                  <span className="text-xs font-black text-emerald-950 truncate max-w-[100px] sm:max-w-[180px]">
                    {activeFarm.name}
                  </span>
                  <span className="text-[9px] font-mono font-extrabold px-1.5 py-0.2 rounded-md bg-emerald-600 text-white shadow-2xs shrink-0">
                    {activeWeekNum}
                  </span>
                </div>
                <span className="text-[10px] text-emerald-800/80 hidden sm:block truncate">
                  {farmStatus === 'COMPLETED' ? '🟢 Completed' : '🟡 Draft in progress'} • Tap for details
                </span>
              </div>
            </button>
          )}
        </div>

        {/* Right Section: Submissions History & Sync Indicator */}
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={onViewSubmissionsUpdate}
            className="flex items-center gap-1.5 text-xs font-bold text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 px-2.5 sm:px-3 py-2 rounded-xl active:scale-95 transition cursor-pointer shadow-2xs"
            title="Submissions History"
          >
            <Radio className="w-3.5 h-3.5 text-emerald-600 animate-pulse shrink-0" />
            <span className="hidden sm:inline">Submissions</span>
          </button>

          {/* Silent Reload Button (replaces orange crossed-out cloud icon) */}
          <button 
            type="button"
            onClick={handleSilentReloadClick}
            disabled={isReloading}
            className="p-2 rounded-xl bg-slate-50 hover:bg-slate-100 border border-slate-200 flex items-center justify-center shrink-0 active:scale-95 transition cursor-pointer text-slate-700 hover:text-emerald-600 disabled:opacity-60 shadow-2xs"
            title="Reload latest weights & sheds"
            aria-label="Reload latest data"
          >
            <RefreshCw className={`w-3.5 h-3.5 transition-colors ${isReloading ? 'animate-spin text-emerald-600' : 'text-slate-600'}`} />
          </button>
        </div>
      </div>

      {/* ==================================================================== */}
      {/* 2. MAIN DASHBOARD WORKSPACE: Immediate Shed Weight-Recording Cards  */}
      {/* ==================================================================== */}
      {assignedFarms.length === 0 || !activeFarm ? (
        <div className="bg-white border border-slate-200 rounded-3xl p-6 sm:p-10 text-center space-y-4 shadow-sm my-4 max-w-xl mx-auto w-full">
          <div className="w-14 h-14 bg-amber-50 rounded-2xl flex items-center justify-center mx-auto border border-amber-200 text-amber-600">
            <AlertCircle className="w-7 h-7" />
          </div>
          <div className="space-y-1">
            <h3 className="text-base font-black text-slate-900">No Assigned Farm</h3>
            <p className="text-xs text-slate-500 max-w-sm mx-auto leading-relaxed">
              You do not have any assigned farm units yet. Weight recording and field operations are locked until your Farm Manager grants you access.
            </p>
          </div>
          <div className="pt-2">
            <button
              onClick={onLogout}
              className="inline-flex items-center gap-1.5 px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl transition cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Logout</span>
            </button>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col space-y-4">
          {/* Workspace Subheading */}
          <div className="flex items-center justify-between px-1">
            <span className="text-xs font-bold text-slate-600 flex items-center gap-1.5">
              <span>Select a shed to view parts and pen lines:</span>
            </span>
            <span className="text-xs font-mono font-bold text-slate-500">
              {sheds.length} {sheds.length === 1 ? 'Shed' : 'Sheds'}
            </span>
          </div>

          {/* Shed Weight-Recording Cards Grid (Immediately visible!) */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5 pb-2">
            {sheds.length === 0 ? (
              <div className="col-span-full bg-white p-8 rounded-3xl border border-slate-200 text-center space-y-3 my-2 shadow-xs">
                <div className="w-14 h-14 bg-emerald-50 rounded-2xl flex items-center justify-center mx-auto text-emerald-600 border border-emerald-200">
                  <Grid className="w-7 h-7" />
                </div>
                <h3 className="font-black text-slate-900 text-base">No sheds created yet</h3>
                <p className="text-xs text-slate-500 max-w-xs mx-auto leading-relaxed">
                  This farm has no sheds configured. Click below to add the first shed.
                </p>
                {onAddShed && (
                  <button
                    type="button"
                    onClick={onAddShed}
                    className="inline-flex items-center gap-1.5 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-black shadow-md shadow-emerald-600/20 active:scale-95 transition cursor-pointer"
                  >
                    <Plus className="w-4 h-4" /> Add First Shed
                  </button>
                )}
              </div>
            ) : (
              sheds.map((s, sIdx) => {
                const sAllWeights = (s.parts || []).flatMap(p => (p.lines || []).flatMap(l => l.weights || []));
                
                // Dynamic Gender calculation for Shed
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

                const totalShedLines = (s.parts || []).reduce((acc, p) => acc + (p.lines || []).length, 0);

                return (
                  <div
                    key={`${s.id || sIdx}-${s.name}-${sIdx}`}
                    onClick={() => handleShedClick(s)}
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

                        {/* Live Presence / Lock / Save Badge */}
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
                        {totalShedLines} Lines • <span className="font-bold text-slate-800">{sStats.count} birds weighed</span>
                      </div>

                      {/* Attribution line if occupied by another operator */}
                      {isLockedByOther && (
                        <div className="text-[11px] text-amber-800 bg-amber-100/60 px-2.5 py-1 rounded-lg border border-amber-200/80 mb-1 flex items-center justify-between gap-1">
                          <span>🔒 In use by <strong>{lock.lockedByUserName}</strong></span>
                          {onForceUnlock && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onForceUnlock(s.id, s.name);
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
                          <span>Locked</span>
                        </div>
                      ) : isLockedByMe ? (
                        <div className="flex items-center gap-1 font-bold text-emerald-800 bg-emerald-100 px-2.5 py-1 rounded-lg border border-emerald-300 text-xs">
                          <span>Resume</span>
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

            {/* Add New Shed Button */}
            {onAddShed && (
              <button
                type="button"
                onClick={onAddShed}
                className="col-span-full py-3.5 bg-white hover:bg-slate-50 text-emerald-700 rounded-2xl text-xs font-bold flex items-center justify-center gap-1.5 border border-dashed border-emerald-300 transition cursor-pointer shadow-xs active:scale-[0.99]"
              >
                <Plus className="w-4 h-4" /> Add New Shed
              </button>
            )}
          </div>

          {/* Quick Shortcuts: Dedicated Submit Screen */}
          <div className="pt-1">
            <button
              onClick={onOpenSubmitPage}
              className={`w-full active:scale-[0.98] transition p-3.5 sm:p-4 rounded-2xl flex items-center justify-between text-left border shadow-xs group cursor-pointer ${
                farmStatus === 'COMPLETED'
                  ? 'bg-emerald-50/80 border-emerald-300 text-emerald-950'
                  : completionStats.isFarm100PercentWeighed
                    ? 'bg-emerald-50 border-emerald-300 hover:bg-emerald-100/60 text-emerald-950'
                    : 'bg-white border-slate-200 hover:bg-slate-50 text-slate-900'
              }`}
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className={`p-2.5 rounded-xl shrink-0 ${
                  farmStatus === 'COMPLETED'
                    ? 'bg-emerald-700 text-white'
                    : completionStats.isFarm100PercentWeighed 
                      ? 'bg-emerald-600 text-white' 
                      : 'bg-amber-100 text-amber-700'
                }`}>
                  <UploadCloud className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 className="font-black text-xs sm:text-sm text-slate-900">
                      {farmStatus === 'COMPLETED' ? 'Submission Summary' : 'Dedicated Submit Screen'}
                    </h2>
                    <span className={`text-[9px] px-2 py-0.5 rounded-full font-bold shrink-0 ${
                      farmStatus === 'COMPLETED'
                        ? 'bg-emerald-200 text-emerald-900'
                        : completionStats.isFarm100PercentWeighed
                          ? 'bg-emerald-200 text-emerald-900'
                          : 'bg-amber-200 text-amber-900'
                    }`}>
                      {farmStatus === 'COMPLETED' ? '✓ Submitted' : completionStats.isFarm100PercentWeighed ? 'Ready to Submit' : `${completionStats.incompleteLines.length} Pending`}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 mt-0.5 truncate">
                    {farmStatus === 'COMPLETED' ? 'Worksheet finalized & verified on cloud' : 'Verify completion & finalize farm batch'}
                  </p>
                </div>
              </div>
              <ArrowRight className="w-4 h-4 text-slate-400 group-hover:translate-x-1 transition shrink-0 ml-2" />
            </button>
          </div>

          {/* ==================================================================== */}
          {/* 3. MASTER SUBMIT OVERALL FARM BUTTON (AT THE VERY BOTTOM)            */}
          {/* ==================================================================== */}
          <div className="bg-gradient-to-r from-slate-900 via-emerald-950 to-slate-900 text-white p-4 rounded-2xl border border-emerald-500/30 shadow-md mt-auto">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[10px] sm:text-xs font-black uppercase tracking-wider text-emerald-400 bg-emerald-950/80 px-2 py-0.5 rounded-md border border-emerald-500/40">
                    Shared Team Workspace
                  </span>
                  <span className="text-xs font-bold text-slate-300">
                    Week: <strong className="text-white">{activeWeekNum}</strong>
                  </span>
                </div>
                <h3 className="text-sm sm:text-base font-black text-white mt-1.5 flex items-center gap-2 flex-wrap">
                  <span>Total Farm Progress:</span>
                  <span className="text-emerald-400 font-mono font-black">
                    {savedShedsCount} of {totalShedsCount} Sheds Saved ({totalShedsCount > 0 ? Math.round((savedShedsCount / totalShedsCount) * 100) : 0}%)
                  </span>
                  <span className="text-slate-400">•</span>
                  <span className="text-amber-300 font-mono font-black">
                    {totalFarmBirdsCount.toLocaleString()} Birds Weighed
                  </span>
                </h3>
              </div>

              {/* Master Overall Submission Button */}
              <div className="shrink-0 flex items-center gap-2">
                {farmStatus === 'COMPLETED' ? (
                  <span className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 rounded-xl text-xs font-black shadow-xs">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    <span>Week Finalized & Submitted</span>
                  </span>
                ) : (savedShedsCount > 0 || totalFarmBirdsCount > 0) && onSubmitOverallFarm ? (
                  <button
                    type="button"
                    onClick={onSubmitOverallFarm}
                    className="px-4 py-2.5 bg-gradient-to-r from-emerald-500 to-teal-400 hover:from-emerald-400 hover:to-teal-300 text-slate-950 font-black rounded-xl text-xs shadow-lg shadow-emerald-500/25 active:scale-95 transition cursor-pointer flex items-center gap-2"
                    title="Submit overall farm to Submission History"
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
                style={{ width: `${totalShedsCount > 0 ? Math.round((savedShedsCount / totalShedsCount) * 100) : 0}%` }}
              />
            </div>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* 4. MODAL: PROFILE SCREEN (Image 1 Layout)                            */}
      {/* ==================================================================== */}
      {showProfileModal && (
        <div 
          className="fixed inset-0 bg-black/60 backdrop-blur-xs z-50 flex items-center justify-center p-4 animate-in fade-in duration-150"
          role="dialog"
          aria-modal="true"
          onClick={() => setShowProfileModal(false)}
        >
          <div 
            className="bg-white border border-slate-200 text-slate-900 rounded-2xl w-full max-w-sm p-5 space-y-4 shadow-2xl animate-in zoom-in-95 duration-150"
            onClick={e => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex justify-between items-center pb-2 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <User className="w-4 h-4 text-emerald-600" />
                <h3 className="font-black text-sm text-slate-900">User Profile & Access</h3>
              </div>
              <button 
                type="button" 
                onClick={() => setShowProfileModal(false)} 
                className="text-slate-400 hover:text-slate-700 p-1 rounded-lg cursor-pointer"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* 1. User Profile Card matching Image 1 */}
            <div className="flex items-center gap-3 p-3.5 bg-slate-50 border border-slate-200 rounded-xl">
              <div className="w-12 h-12 rounded-xl text-white flex items-center justify-center shadow-sm bg-emerald-600 shrink-0">
                <User className="w-6 h-6 text-white" />
              </div>
              <div className="min-w-0 flex-1">
                <h4 className="text-sm font-black text-slate-900 truncate">
                  {userDisplayName}
                </h4>
                <div className="flex items-center gap-1.5 mt-1">
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded border bg-emerald-50 text-emerald-700 border-emerald-200">
                    {currentUser?.role === 'In-Charge' ? 'In-Charge • Profile' : 'Supervisor • Profile'}
                  </span>
                  <span className="text-[10px] text-slate-500 font-mono font-bold">
                    ID: {formatEmployeeId(currentUser)}
                  </span>
                </div>
              </div>
            </div>

            {/* Farm Access Summary */}
            <div className="p-3 bg-slate-50/70 border border-slate-200/80 rounded-xl space-y-1.5 text-xs">
              <div className="flex items-center justify-between text-slate-600">
                <span className="text-slate-500">Assigned Unit:</span>
                <span className="font-black text-slate-900 truncate max-w-[170px]">
                  {activeFarm?.name || 'Assigned Farm'}
                </span>
              </div>
              <div className="flex items-center justify-between text-slate-600">
                <span className="text-slate-500">Flock Recording Week:</span>
                <span className="font-black text-emerald-700 font-mono">
                  {activeWeekNum}
                </span>
              </div>
              <div className="flex items-center justify-between text-slate-600">
                <span className="text-slate-500">Session Status:</span>
                <span className="font-bold text-emerald-600 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                  Active Authenticated
                </span>
              </div>
            </div>

            {/* Modal Actions */}
            <div className="space-y-2 pt-1">
              {/* 3. Submissions History Button */}
              <button
                type="button"
                onClick={() => {
                  setShowProfileModal(false);
                  onViewSubmissionsUpdate();
                }}
                className="w-full flex items-center justify-center gap-2 text-xs font-bold text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 px-4 py-2.5 rounded-xl active:scale-95 transition cursor-pointer shadow-2xs"
              >
                <Radio className="w-3.5 h-3.5 text-emerald-600 animate-pulse shrink-0" />
                <span>Submissions History</span>
              </button>

              {/* 2. Logout Button (Pink/Red Pill matching Image 1) */}
              <button
                type="button"
                onClick={() => {
                  setShowProfileModal(false);
                  onLogout();
                }}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-rose-50 hover:bg-rose-100 text-rose-600 hover:text-rose-700 border border-rose-200 rounded-xl font-black text-xs shadow-2xs transition active:scale-95 cursor-pointer"
                title="Log Out Session"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Logout</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* 5. MODAL: FARM DETAILS & ACTIVE RECORDING WEEK (Image 2 Layout)      */}
      {/* ==================================================================== */}
      {showFarmDetailsModal && activeFarm && (
        <div 
          className="fixed inset-0 bg-black/60 backdrop-blur-xs z-50 flex items-center justify-center p-4 animate-in fade-in duration-150"
          role="dialog"
          aria-modal="true"
          onClick={() => setShowFarmDetailsModal(false)}
        >
          <div 
            className="bg-white border border-slate-200 text-slate-900 rounded-2xl w-full max-w-md p-5 space-y-4 shadow-2xl animate-in zoom-in-95 duration-150 max-h-[90vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex justify-between items-center pb-2 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <Warehouse className="w-4 h-4 text-emerald-600" />
                <h3 className="font-black text-sm text-slate-900">Farm Details & Active Week</h3>
              </div>
              <button 
                type="button" 
                onClick={() => setShowFarmDetailsModal(false)} 
                className="text-slate-400 hover:text-slate-700 p-1 rounded-lg cursor-pointer"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* 1. Assigned Farm Unit Dark Banner (Image 2 Top Card) */}
            <div className="bg-slate-900 p-4 rounded-2xl border border-slate-700 shadow-md">
              <div className="flex items-center justify-between mb-2">
                <label className="text-[10px] uppercase font-bold text-slate-400 block tracking-wider flex items-center gap-1.5">
                  <Lock className="w-3 h-3 text-emerald-400" />
                  <span>Assigned Farm Unit (Locked)</span>
                </label>
                <span className={`text-[10px] px-2.5 py-0.5 rounded-full font-bold flex items-center gap-1 ${
                  farmStatus === 'COMPLETED'
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40' 
                    : farmStatus === 'UPLOADING'
                      ? 'bg-blue-500/20 text-blue-300 border border-blue-500/40'
                      : 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                }`}>
                  {farmStatus === 'COMPLETED' ? (
                    <>
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                      <span>🟢 COMPLETED</span>
                    </>
                  ) : (
                    <>
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse"></span>
                      <span>🟡 DRAFT IN PROGRESS</span>
                    </>
                  )}
                </span>
              </div>

              <div className="flex items-center justify-between bg-slate-950 px-3.5 py-2.5 rounded-xl border border-slate-800">
                <span className="text-sm font-black text-emerald-400 truncate">
                  {activeFarm.name}
                </span>
                <span className="text-xs text-slate-400 font-mono">
                  {activeFarm.activeBatch?.batchName || activeFarm.batchName || 'Batch 1'} • {activeWeekNum} • {activeFarm.season}
                </span>
              </div>
            </div>

            {/* 2. Farm & Active Week Configuration Card (Image 2 Bottom Card) */}
            <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs space-y-3.5">
              {/* Shed icon + Farm Name + Edit Name */}
              <div className="flex items-start justify-between gap-2 flex-wrap">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 className="text-base sm:text-lg font-black text-slate-900 flex items-center gap-2 break-words">
                      <Warehouse className="w-5 h-5 text-emerald-600 shrink-0" />
                      <span className="break-all">{activeFarm.name}</span>
                    </h2>
                    <button
                      type="button"
                      onClick={() => {
                        handleOpenRename();
                      }}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-bold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg transition active:scale-95 cursor-pointer shadow-2xs shrink-0"
                      title="Edit Farm Name"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                      <span>Edit Name</span>
                    </button>
                  </div>

                  {/* Info pills: Week (W19), Season (Summer Brood), Sheds (3 Sheds) */}
                  <div className="flex items-center gap-2 mt-2 text-xs text-slate-500 flex-wrap">
                    <span className="bg-emerald-50 text-emerald-800 px-2.5 py-1 rounded-lg font-bold text-xs border border-emerald-200 flex items-center gap-1">
                      <Calendar className="w-3 h-3 text-emerald-600" />
                      <span>{activeWeekNum}</span>
                    </span>
                    <span className="bg-slate-100 text-slate-700 px-2.5 py-1 rounded-lg text-xs border border-slate-200">
                      {activeFarm.season} Brood
                    </span>
                    <span className="bg-slate-100 text-slate-700 px-2.5 py-1 rounded-lg text-xs border border-slate-200 font-mono">
                      {sheds.length || activeFarm._count?.sheds || 0} Sheds
                    </span>
                  </div>
                </div>
              </div>

              {/* ACTIVE RECORDING WEEK Section with interactive dropdown */}
              <div className="pt-3 border-t border-slate-100">
                <div className="flex items-center justify-between gap-2 mb-1.5 flex-wrap">
                  <label className="text-[11px] font-black uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5 text-emerald-600" />
                    <span>Active Recording Week</span>
                  </label>
                  <span className="text-[10px] font-mono font-bold text-slate-500">
                    Week 1 to 24
                  </span>
                </div>

                <div className="flex items-center justify-between bg-slate-50 border border-slate-300 rounded-xl px-3 py-2.5">
                  {onSwitchWeek ? (
                    <select
                      value={activeWeekNum}
                      onChange={(e) => onSwitchWeek(e.target.value)}
                      className="bg-transparent text-xs font-black text-slate-900 focus:outline-none cursor-pointer flex-1 truncate pr-2"
                      title="Switch Active Recording Week"
                    >
                      {Array.from({ length: 24 }, (_, i) => `W${i + 1}`).map((w) => {
                        const startNum = activeFarm.startWeekNumber || parseInt((activeFarm.initialAgeWeek || activeFarm.startingWeek || activeFarm.ageWeek || '1').replace(/\D/g, ''), 10) || 1;
                        const wStatus = weekStatusMap?.[w];
                        const statusText = wStatus === 'COMPLETED' ? '🟢 Completed' : (w === activeWeekNum ? '🟡 Active' : '⚪ Open');
                        return (
                          <option key={w} value={w} className="text-slate-900 bg-white">
                            {w} — {statusText} ({formatRecordingWeekLabel(w, activeFarm, startNum)})
                          </option>
                        );
                      })}
                    </select>
                  ) : (
                    <span className="text-xs font-black text-slate-900 truncate">
                      {formatRecordingWeekLabel(
                        activeWeekNum,
                        activeFarm,
                        activeFarm.startWeekNumber || activeFarm.initialAgeWeek || activeFarm.startingWeek || activeFarm.ageWeek
                      )}
                    </span>
                  )}
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 ${
                    farmStatus === 'COMPLETED'
                      ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                      : 'bg-amber-100 text-amber-800 border border-amber-300'
                  }`}>
                    {farmStatus === 'COMPLETED' ? '🟢 Completed' : '🟡 In-Progress'}
                  </span>
                </div>

                {/* Status Guidance text */}
                <p className="text-[10px] text-slate-500 mt-1.5 flex items-center justify-between flex-wrap gap-1">
                  {farmStatus === 'COMPLETED' ? (
                    <span>
                      ✓ This week is completed & committed. Next week is now open for recording.
                    </span>
                  ) : (
                    <span>Select any week (Week 1 to 24) to record weights or review flock status.</span>
                  )}
                </p>
              </div>
            </div>

            {/* Modal Bottom Button */}
            <div className="pt-1">
              <button
                type="button"
                onClick={() => setShowFarmDetailsModal(false)}
                className="w-full bg-slate-100 hover:bg-slate-200 py-2.5 rounded-xl text-xs font-bold text-slate-700 active:scale-95 transition cursor-pointer"
              >
                Close Details
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* 6. MODAL: EDIT FARM NAME                                             */}
      {/* ==================================================================== */}
      {showRenameModal && activeFarm && (
        <div 
          className="fixed inset-0 bg-black/60 backdrop-blur-xs z-50 flex items-center justify-center p-4 animate-in fade-in duration-150"
          role="dialog"
          aria-modal="true"
        >
          <div className="bg-white border border-slate-200 text-slate-900 rounded-2xl w-full max-w-sm p-5 space-y-4 shadow-2xl">
            <div className="flex justify-between items-center pb-2 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <Edit2 className="w-4 h-4 text-emerald-600" />
                <h3 className="font-black text-sm text-slate-900">Edit Farm Name</h3>
              </div>
              <button 
                type="button" 
                onClick={() => setShowRenameModal(false)} 
                className="text-slate-400 hover:text-slate-700 p-1 rounded-lg cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveRename} className="space-y-3">
              <div>
                <label className="text-[11px] font-bold text-slate-600 uppercase block mb-1">
                  Farm Name *
                </label>
                <input
                  type="text"
                  value={renameInput}
                  onChange={(e) => {
                    setRenameInput(e.target.value);
                    setRenameError(null);
                  }}
                  placeholder="Enter farm name..."
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold text-slate-900 focus:outline-none focus:border-emerald-600 focus:bg-white transition"
                  autoFocus
                />
              </div>

              {renameError && (
                <div className="p-2 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-xs flex items-center gap-1.5">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  <span>{renameError}</span>
                </div>
              )}

              {renameSuccess && (
                <div className="p-2 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-700 text-xs flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                  <span>{renameSuccess}</span>
                </div>
              )}

              <div className="text-[10px] text-slate-500 bg-slate-50 p-2 rounded-lg border border-slate-100">
                ℹ️ Renaming updates all authorized dashboards, reports, and preserves existing sheds, weights, and batch submissions.
              </div>

              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setShowRenameModal(false)}
                  className="flex-1 bg-slate-100 hover:bg-slate-200 py-2 rounded-xl text-xs font-bold text-slate-700 active:scale-95 transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isRenaming}
                  className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white py-2 rounded-xl text-xs font-black shadow-xs active:scale-95 transition cursor-pointer flex items-center justify-center gap-1.5 disabled:opacity-50"
                >
                  {isRenaming ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Saving...</span>
                    </>
                  ) : (
                    <span>Save Changes</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
