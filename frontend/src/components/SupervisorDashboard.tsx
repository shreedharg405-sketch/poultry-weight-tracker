import React, { useState } from 'react';
import { 
  Building2, 
  Scale, 
  ChevronRight, 
  Radio, 
  LogOut, 
  CheckCircle2, 
  AlertCircle,
  FileSpreadsheet,
  UploadCloud,
  Layers,
  Calendar,
  Lock,
  ArrowRight,
  Edit2,
  X,
  Loader2
} from 'lucide-react';
import { FarmSummary, AppUser, FarmStatus, cloudApi } from '../services/cloudSyncService';

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
}) => {
  const userDisplayName = currentUser?.userName || currentUser?.name || 'Field Operator';
  const userRole = currentUser?.role || 'Supervisor';

  // Rename Farm Modal State
  const [showRenameModal, setShowRenameModal] = useState(false);
  const [renameInput, setRenameInput] = useState('');
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [renameSuccess, setRenameSuccess] = useState<string | null>(null);

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

  return (
    <div className="flex-1 flex flex-col p-4 animate-in fade-in duration-150">
      {/* Top Header: Session & Role Bar with Integrated Logout (Req 1) */}
      <div className="flex items-center justify-between mb-3 px-1 gap-2">
        <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
          <div 
            onClick={onOpenAuth}
            className="flex items-center gap-2 cursor-pointer hover:opacity-90 transition bg-white px-2.5 py-1.5 rounded-xl border border-slate-200/90 shadow-2xs min-w-0"
            title="View Session Details"
          >
            <div className="w-7 h-7 rounded-lg text-white flex items-center justify-center font-bold text-xs shadow-xs bg-emerald-600 shrink-0">
              {userDisplayName.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0">
              <span className="text-xs font-bold text-slate-900 block leading-tight truncate max-w-[110px]">
                {userDisplayName}
              </span>
              <span className="text-[9px] font-bold px-1.5 py-0.2 rounded leading-tight inline-block border bg-emerald-50 text-emerald-700 border-emerald-200">
                {userRole}
              </span>
            </div>
          </div>

          {/* Integrated Logout in User Area */}
          <button
            type="button"
            onClick={onLogout}
            className="flex items-center gap-1 px-2.5 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-600 hover:text-rose-700 border border-rose-200/90 rounded-xl font-bold text-xs shadow-2xs transition active:scale-95 cursor-pointer shrink-0"
            title="Log Out Session"
            aria-label="Log Out"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span className="text-[11px]">Logout</span>
          </button>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={onViewSubmissionsUpdate}
            className="flex items-center gap-1.5 text-xs font-bold text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 px-2.5 sm:px-3 py-1.5 rounded-xl active:scale-95 transition cursor-pointer shadow-2xs shrink-0"
          >
            <Radio className="w-3.5 h-3.5 text-emerald-600 animate-pulse shrink-0" />
            <span className="hidden sm:inline">Submissions Update</span>
            <span className="sm:hidden">Submissions</span>
          </button>
        </div>
      </div>

      {/* Role Banner */}
      <div className="bg-gradient-to-r from-emerald-900 to-slate-900 text-white p-3.5 rounded-2xl border border-emerald-700/60 mb-3.5 shadow-md">
        <div className="flex items-center justify-between">
          <div>
            <span className="text-[10px] font-black uppercase tracking-wider text-emerald-300 block">
              Field Operations Workspace
            </span>
            <h2 className="text-sm font-black text-white mt-0.5">
              {(userRole === 'In-Charge' || userRole === 'Incharge') ? 'In-Charge Dashboard' : 'Supervisor Dashboard'}
            </h2>
          </div>
          <span className="text-[10px] font-mono font-bold text-emerald-200 bg-emerald-950/60 px-2 py-0.5 rounded-lg border border-emerald-600/40">
            {formattedDateTime}
          </span>
        </div>
      </div>

      {/* Farm Access Isolation (Enforce Assigned Farm Only - Req 8) */}
      {assignedFarms.length === 0 || !activeFarm ? (
        <div className="bg-white border border-slate-200 rounded-3xl p-6 sm:p-8 text-center space-y-4 shadow-sm my-4">
          <div className="w-14 h-14 bg-amber-50 rounded-2xl flex items-center justify-center mx-auto border border-amber-200 text-amber-600">
            <AlertCircle className="w-7 h-7" />
          </div>
          <div className="space-y-1">
            <h3 className="text-base font-black text-slate-900">No Assigned Farm</h3>
            <p className="text-xs text-slate-500 max-w-sm mx-auto leading-relaxed">
              You do not have any assigned farm units yet. Weight recording and field operations are locked until your Farm Manager or Admin grants you access.
            </p>
          </div>
          <div className="pt-2">
            <button
              onClick={onLogout}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl transition cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Switch Account / Logout</span>
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* Farm Access Selector */}
          <div className="bg-slate-900 p-3.5 rounded-2xl border border-slate-700 mb-3.5 shadow-md">
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-[9px] uppercase font-bold text-slate-400 block">
                Assigned Farm Unit {assignedFarms.length > 1 && `(${assignedFarms.length} Available)`}
              </label>
              <span className={`text-[9px] px-2 py-0.5 rounded-full font-bold flex items-center gap-1 ${
                farmStatus === 'COMPLETED'
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40' 
                  : farmStatus === 'UPLOADING'
                    ? 'bg-blue-500/20 text-blue-300 border border-blue-500/40'
                    : farmStatus === 'UPLOAD_FAILED'
                      ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                      : 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
              }`}>
                {farmStatus === 'COMPLETED' ? (
                  <>
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                    <span>🟢 COMPLETED</span>
                  </>
                ) : farmStatus === 'UPLOADING' ? (
                  <>
                    <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse"></span>
                    <span>🔵 UPLOADING</span>
                  </>
                ) : farmStatus === 'UPLOAD_FAILED' ? (
                  <>
                    <span className="w-1.5 h-1.5 rounded-full bg-rose-400"></span>
                    <span>🔴 UPLOAD FAILED</span>
                  </>
                ) : (
                  <>
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse"></span>
                    <span>🟡 DRAFT IN PROGRESS</span>
                  </>
                )}
              </span>
            </div>

            {assignedFarms.length > 1 ? (
              <select
                value={activeFarm.id}
                onChange={(e) => onSelectFarm(e.target.value)}
                className="w-full bg-slate-950 text-emerald-400 font-bold text-xs rounded-xl px-3 py-2 border border-slate-700 focus:outline-none focus:border-emerald-500 cursor-pointer"
              >
                {assignedFarms.map((farm) => (
                  <option key={farm.id} value={farm.id}>
                    {farm.name} ({farm.ageWeek}) — {farm.status === 'COMPLETED' ? '🟢 COMPLETED' : '🟡 DRAFT'}
                  </option>
                ))}
              </select>
            ) : (
              <div className="flex items-center justify-between bg-slate-950 px-3 py-2 rounded-xl border border-slate-800">
                <span className="text-xs font-black text-emerald-400 truncate">
                  {activeFarm.name}
                </span>
                <span className="text-[10px] text-slate-400 font-mono">
                  {activeFarm.ageWeek} • {activeFarm.season}
                </span>
              </div>
            )}
          </div>

          {/* Active Farm Quick Detail Card */}
          <div className="bg-white p-4 rounded-2xl border border-slate-200 mb-3.5 shadow-xs">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="text-base font-black text-slate-900 flex items-center gap-1.5 break-words">
                    <Building2 className="w-4 h-4 text-emerald-600 shrink-0" />
                    <span>{activeFarm.name}</span>
                  </h1>
                  <button
                    type="button"
                    onClick={handleOpenRename}
                    className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-bold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg transition active:scale-95 cursor-pointer shadow-2xs"
                    title="Edit Farm Name"
                  >
                    <Edit2 className="w-3 h-3" />
                    <span>Edit Name</span>
                  </button>
                </div>
                <div className="flex items-center gap-2 mt-1.5 text-xs text-slate-500">
                  <span className="bg-slate-100 text-slate-700 px-2 py-0.5 rounded-md font-bold text-[10px] border border-slate-200">
                    {activeFarm.ageWeek}
                  </span>
                  <span className="bg-slate-100 text-slate-700 px-2 py-0.5 rounded-md text-[10px] border border-slate-200">
                    {activeFarm.season} Brood
                  </span>
                  <span className="bg-slate-100 text-slate-700 px-2 py-0.5 rounded-md text-[10px] border border-slate-200 font-mono">
                    {activeFarm._count?.sheds ?? 0} Sheds
                  </span>
                </div>
              </div>
            </div>

            {/* Progress Strip */}
            <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
              <span className="font-bold text-slate-600">
                {farmStatus === 'DRAFT' ? (
                  <span className="text-amber-600">
                    🟡 DRAFT IN PROGRESS ({completionStats.completedLinesCount} of {completionStats.totalLinesCount} lines completed)
                  </span>
                ) : (
                  <span className="text-emerald-600">🟢 COMPLETED & SUBMITTED</span>
                )}
              </span>
              <span className="font-mono font-bold text-slate-800">
                {completionStats.progressPercent}% Weighed
              </span>
            </div>
          </div>

          {/* Primary Action Menu */}
          <div className="space-y-3 flex-1">
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 px-1">
              Field Tasks
            </p>

            {/* 1. Enter Weights (Field Operator Weighing Pad) */}
            <button
              onClick={onStartWeighing}
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

            {/* 2. Dedicated Submit Farm Weighing Screen */}
            <button
              onClick={onOpenSubmitPage}
              className={`w-full active:scale-[0.98] transition p-4 rounded-2xl flex items-center justify-between text-left border shadow-xs group cursor-pointer ${
                completionStats.isFarm100PercentWeighed
                  ? 'bg-emerald-50 border-emerald-300 hover:bg-emerald-100/60 text-emerald-950'
                  : 'bg-white border-slate-200 hover:bg-slate-50 text-slate-900'
              }`}
            >
              <div className="flex items-center gap-3.5">
                <div className={`p-3 rounded-xl ${
                  completionStats.isFarm100PercentWeighed 
                    ? 'bg-emerald-600 text-white' 
                    : 'bg-amber-100 text-amber-700'
                }`}>
                  <UploadCloud className="w-6 h-6" />
                </div>
                <div>
                  <div className="flex items-center gap-1.5">
                    <h2 className="font-black text-sm">Dedicated Submit Screen</h2>
                    <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold ${
                      completionStats.isFarm100PercentWeighed
                        ? 'bg-emerald-200 text-emerald-900'
                        : 'bg-amber-200 text-amber-900'
                    }`}>
                      {completionStats.isFarm100PercentWeighed ? 'Ready to Submit' : `${completionStats.incompleteLines.length} Pending`}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500">
                    Verify 100% completion & finalize farm batch
                  </p>
                </div>
              </div>
              <ArrowRight className="w-5 h-5 text-slate-400 group-hover:translate-x-1 transition" />
            </button>

            {/* 3. Submissions Update Feed */}
            <button
              onClick={onViewSubmissionsUpdate}
              className="w-full bg-white hover:bg-slate-50 active:scale-[0.98] transition p-4 rounded-2xl flex items-center justify-between text-left shadow-xs border border-slate-200 group cursor-pointer"
            >
              <div className="flex items-center gap-3.5">
                <div className="p-3 bg-slate-100 rounded-xl text-slate-700 border border-slate-200">
                  <Radio className="w-6 h-6 text-emerald-600" />
                </div>
                <div>
                  <h2 className="font-black text-sm text-slate-900">Submissions Update</h2>
                  <p className="text-xs text-slate-500">View finalized batch history and timestamps</p>
                </div>
              </div>
              <ChevronRight className="w-5 h-5 text-slate-400 group-hover:translate-x-1 transition" />
            </button>
          </div>
        </>
      )}

      {/* MODAL: EDIT FARM NAME */}
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
                className="text-slate-400 hover:text-slate-700 p-1 rounded-lg"
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
