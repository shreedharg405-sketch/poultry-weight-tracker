import React from 'react';
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
  ArrowRight
} from 'lucide-react';
import { FarmSummary, AppUser, FarmStatus } from '../services/cloudSyncService';

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
}) => {
  const userDisplayName = currentUser?.userName || currentUser?.name || 'Field Operator';
  const userRole = currentUser?.role || 'Supervisor';

  return (
    <div className="flex-1 flex flex-col p-4 animate-in fade-in duration-150">
      {/* Top Header: Session & Role Bar */}
      <div className="flex items-center justify-between mb-3 px-1">
        <div 
          onClick={onOpenAuth}
          className="flex items-center gap-2 cursor-pointer hover:opacity-90 transition bg-white px-2.5 py-1.5 rounded-xl border border-slate-200/90 shadow-2xs"
          title="View Session Details"
        >
          <div className="w-7 h-7 rounded-lg text-white flex items-center justify-center font-bold text-xs shadow-xs bg-emerald-600">
            {userDisplayName.charAt(0).toUpperCase()}
          </div>
          <div>
            <span className="text-xs font-bold text-slate-900 block leading-tight truncate max-w-[120px]">
              {userDisplayName}
            </span>
            <span className="text-[9px] font-bold px-1.5 py-0.2 rounded leading-tight inline-block border bg-emerald-50 text-emerald-700 border-emerald-200">
              {userRole}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={onViewSubmissionsUpdate}
            className="flex items-center gap-1.5 text-xs font-bold text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 px-3 py-1.5 rounded-xl active:scale-95 transition cursor-pointer shadow-2xs"
          >
            <Radio className="w-3.5 h-3.5 text-emerald-600 animate-pulse" />
            <span>Submissions Update</span>
          </button>
          <button
            onClick={onLogout}
            className="p-1.5 text-slate-400 hover:text-rose-600 rounded-xl hover:bg-slate-200 transition cursor-pointer"
            title="Log Out Session"
          >
            <LogOut className="w-4 h-4" />
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

      {/* Farm Access Selector (Filtered strictly to assigned farms) */}
      {assignedFarms.length === 0 ? (
        <div className="bg-amber-500/10 border border-amber-500/40 p-4 rounded-2xl mb-4 text-center">
          <AlertCircle className="w-6 h-6 text-amber-500 mx-auto mb-1.5" />
          <h3 className="text-xs font-black text-amber-900">No Farms Currently Assigned</h3>
          <p className="text-[11px] text-amber-800 mt-1 max-w-xs mx-auto">
            You do not have any assigned farm units yet. Please ask your Farm Manager or Admin to assign you to a farm.
          </p>
        </div>
      ) : (
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
              value={activeFarm?.id || ''}
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
                {activeFarm?.name || assignedFarms[0]?.name}
              </span>
              <span className="text-[10px] text-slate-400 font-mono">
                {activeFarm?.ageWeek || assignedFarms[0]?.ageWeek} • {activeFarm?.season || assignedFarms[0]?.season}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Active Farm Quick Detail Card */}
      {activeFarm && (
        <div className="bg-white p-4 rounded-2xl border border-slate-200 mb-3.5 shadow-xs">
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-base font-black text-slate-900 flex items-center gap-1.5">
                <Building2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span className="break-words">{activeFarm.name}</span>
              </h1>
              <div className="flex items-center gap-2 mt-1.5 text-xs text-slate-500">
                <span className="bg-slate-100 text-slate-700 px-2 py-0.5 rounded-md font-bold text-[10px] border border-slate-200">
                  {activeFarm.ageWeek}
                </span>
                <span className="bg-slate-100 text-slate-700 px-2 py-0.5 rounded-md text-[10px] border border-slate-200">
                  {activeFarm.season} Brood
                </span>
                <span className="bg-slate-100 text-slate-700 px-2 py-0.5 rounded-md text-[10px] border border-slate-200 font-mono">
                  {activeFarm._count?.sheds || 10} Sheds
                </span>
              </div>
            </div>
            <span className="text-[10px] font-mono font-bold text-slate-400 bg-slate-50 px-2 py-1 rounded-lg border border-slate-200">
              Unit ID: {activeFarm.id}
            </span>
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
      )}

      {/* Primary Action Menu */}
      <div className="space-y-3 flex-1">
        <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 px-1">
          Field Tasks
        </p>

        {/* 1. Enter Weights (Field Operator Weighing Pad) */}
        <button
          onClick={onStartWeighing}
          disabled={!activeFarm}
          className="w-full bg-emerald-600 hover:bg-emerald-500 active:scale-[0.98] transition p-4 rounded-2xl flex items-center justify-between text-left shadow-md shadow-emerald-600/20 text-white group cursor-pointer disabled:opacity-50"
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
          disabled={!activeFarm}
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
    </div>
  );
};
