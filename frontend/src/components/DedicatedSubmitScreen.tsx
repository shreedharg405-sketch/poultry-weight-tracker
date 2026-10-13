import React, { useState } from 'react';
import { 
  ArrowLeft, 
  Building2, 
  CheckCircle2, 
  AlertCircle, 
  Lock, 
  Loader2, 
  Download, 
  FileSpreadsheet, 
  Scale, 
  Cloud, 
  CloudOff, 
  RefreshCw,
  Clock,
  Sparkles
} from 'lucide-react';
import { FarmSummary, FarmAudit } from '../services/cloudSyncService';

interface IncompleteLineItem {
  shedId: string;
  shedName: string;
  partId: string;
  partName: string;
  lineId: number | string;
  lineName: string;
  path: string;
}

interface CompletionStats {
  totalLinesCount: number;
  completedLinesCount: number;
  incompleteLines: IncompleteLineItem[];
  progressPercent: number;
  isFarm100PercentWeighed: boolean;
}

export interface DedicatedSubmitScreenProps {
  farm: FarmSummary | null;
  completionStats: CompletionStats;
  farmStatus: 'DRAFT' | 'COMPLETED';
  farmAudit: FarmAudit | null;
  syncStatus: 'synced' | 'saving' | 'offline' | 'refreshing';
  pendingSyncCount: number;
  isSubmittingBatch: boolean;
  onBack: () => void;
  onSubmitSuccess: () => Promise<void>;
  onDownloadExcel: () => void;
  onJumpToLine: (shedId: string, partId: string, lineId: number | string) => void;
}

export const DedicatedSubmitScreen: React.FC<DedicatedSubmitScreenProps> = ({
  farm,
  completionStats,
  farmStatus,
  farmAudit,
  syncStatus,
  pendingSyncCount,
  isSubmittingBatch,
  onBack,
  onSubmitSuccess,
  onDownloadExcel,
  onJumpToLine,
}) => {
  const [successBanner, setSuccessBanner] = useState(farmStatus === 'COMPLETED');

  const handleSubmit = async () => {
    if (!completionStats.isFarm100PercentWeighed) {
      alert(
        `Cannot submit yet! All lines must be completely weighed.\nPending lines: [${completionStats.incompleteLines.map(l => l.path).join(', ')}]. Complete all lines to submit.`
      );
      return;
    }
    await onSubmitSuccess();
    setSuccessBanner(true);
    alert("Farm submitted successfully! You may now download the official worksheet.");
  };

  const isCloudConnected = syncStatus === 'synced' || syncStatus === 'saving';

  return (
    <div className="flex-1 flex flex-col p-4 animate-in slide-in-from-right duration-150">
      {/* Top Header */}
      <div className="flex items-center justify-between mb-4">
        <button 
          onClick={onBack} 
          className="flex items-center gap-1.5 text-xs font-bold text-slate-700 bg-white hover:bg-slate-100 px-3 py-1.5 rounded-xl border border-slate-200 shadow-xs active:scale-95 cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" /> Back to Dashboard
        </button>

        <h2 className="text-xs font-black text-emerald-800 uppercase tracking-wide bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-200">
          Batch Submission
        </h2>
      </div>

      {/* Farm Profile Header */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 mb-3.5 shadow-xs">
        <div className="flex items-start justify-between">
          <div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
              Active Unit
            </span>
            <h1 className="text-base font-black text-slate-900 flex items-center gap-1.5 mt-0.5">
              <Building2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>{farm?.name || 'Farm Unit'}</span>
            </h1>
            <div className="flex items-center gap-2 mt-1.5 text-xs text-slate-500">
              <span className="bg-slate-100 text-slate-700 px-2 py-0.5 rounded-md font-bold text-[10px] border border-slate-200">
                {farm?.ageWeek || 'W18'}
              </span>
              <span>{farm?.season || 'Summer'} Brood</span>
              <span>•</span>
              <span className="font-mono">{farm?._count?.sheds || 10} Sheds</span>
            </div>
          </div>

          <span className={`text-[10px] px-2.5 py-1 rounded-full font-bold flex items-center gap-1 ${
            farmStatus === 'DRAFT' 
              ? 'bg-amber-50 text-amber-700 border border-amber-200' 
              : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
          }`}>
            <span className={`w-1.5 h-1.5 rounded-full ${farmStatus === 'DRAFT' ? 'bg-amber-400 animate-pulse' : 'bg-emerald-500'}`} />
            {farmStatus === 'DRAFT' ? '🟡 Pending as Draft' : '🟢 100% Ready for Submission'}
          </span>
        </div>
      </div>

      {/* Success Notification Alert */}
      {successBanner && (
        <div className="mb-3.5 bg-emerald-500/10 border border-emerald-500/40 text-emerald-900 p-3.5 rounded-2xl animate-in zoom-in-95">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
            <div>
              <h4 className="text-xs font-black text-emerald-950">
                Farm submitted successfully!
              </h4>
              <p className="text-[11px] text-emerald-800 mt-0.5">
                You may now download the official worksheet or return to the dashboard.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* 1. DRAFT COMPLETION AUDIT CARD */}
      <div className="bg-slate-900 border border-slate-700 text-white p-4 rounded-2xl mb-3.5 shadow-md space-y-3">
        <div className="flex items-center justify-between pb-2 border-b border-slate-800">
          <div>
            <h3 className="text-xs font-black text-slate-100 uppercase tracking-wider">
              Draft Completion Audit
            </h3>
            <span className="text-[11px] text-slate-400">
              {completionStats.completedLinesCount} of {completionStats.totalLinesCount} lines weighed
            </span>
          </div>

          <span className="text-base font-black font-mono text-emerald-400">
            {completionStats.progressPercent}% Weighed
          </span>
        </div>

        {/* Visual Progress Bar */}
        <div className="w-full bg-slate-800 h-2.5 rounded-full overflow-hidden p-0.5 border border-slate-700">
          <div 
            className={`h-full rounded-full transition-all duration-300 ${
              completionStats.isFarm100PercentWeighed
                ? 'bg-emerald-500 shadow-xs shadow-emerald-500/50'
                : 'bg-amber-400'
            }`}
            style={{ width: `${completionStats.progressPercent}%` }}
          />
        </div>

        {/* Status Pill */}
        <div className="flex items-center justify-between text-xs pt-1">
          <span className="text-slate-400">Status Verification:</span>
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md ${
            completionStats.isFarm100PercentWeighed
              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
              : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
          }`}>
            {completionStats.isFarm100PercentWeighed 
              ? '🟢 100% Ready for Submission' 
              : '🟡 Pending as Draft'}
          </span>
        </div>

        {/* Pending Lines Warning List */}
        {!completionStats.isFarm100PercentWeighed && (
          <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 space-y-2 mt-2">
            <div className="flex items-center justify-between text-[11px] font-bold text-amber-400 pb-1 border-b border-slate-800/80">
              <span className="flex items-center gap-1.5">
                <AlertCircle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                <span>Pending Lines ({completionStats.incompleteLines.length})</span>
              </span>
              <span className="text-slate-400 font-normal">Must weigh to submit</span>
            </div>

            <div className="max-h-36 overflow-y-auto space-y-1.5 pr-1">
              {completionStats.incompleteLines.map((line, idx) => (
                <div 
                  key={idx}
                  className="flex items-center justify-between bg-slate-900 px-2.5 py-1.5 rounded-lg border border-slate-800 text-xs hover:border-slate-700 transition"
                >
                  <span className="font-medium text-slate-300 truncate pr-2 text-[11px]">
                    {line.path}
                  </span>
                  <button
                    type="button"
                    onClick={() => onJumpToLine(line.shedId, line.partId, line.lineId)}
                    className="bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-black px-2 py-0.5 rounded text-[10px] shrink-0 transition cursor-pointer flex items-center gap-1"
                  >
                    <Scale className="w-2.5 h-2.5" />
                    Weigh Now
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 2. CLOUD SYNCHRONIZATION STATUS BADGE (Strictly no endpoints/API links) */}
      <div className="bg-white p-3.5 rounded-2xl border border-slate-200 mb-4 shadow-xs">
        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1">
          Cloud Synchronization Status
        </span>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className={`p-2 rounded-xl ${
              isCloudConnected ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
            }`}>
              {isCloudConnected ? <Cloud className="w-4 h-4" /> : <CloudOff className="w-4 h-4" />}
            </div>
            <div>
              <span className={`text-xs font-bold block ${
                isCloudConnected ? 'text-emerald-700' : 'text-amber-700'
              }`}>
                {isCloudConnected ? '🟢 Cloud Connected' : '⏳ Waiting for Sync'}
              </span>
              <span className="text-[10px] text-slate-400">
                {pendingSyncCount > 0 
                  ? `${pendingSyncCount} record(s) queued for sync` 
                  : 'Real-time multi-device cloud replica active'}
              </span>
            </div>
          </div>

          <span className="text-[10px] font-bold text-slate-500 bg-slate-100 px-2 py-1 rounded-lg border border-slate-200">
            {syncStatus.toUpperCase()}
          </span>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="space-y-2.5 mt-auto">
        {/* Submit Farm Weighing Button */}
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!completionStats.isFarm100PercentWeighed || isSubmittingBatch}
          className={`w-full font-black py-3.5 rounded-xl text-xs flex items-center justify-center gap-2 shadow-lg transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
            !completionStats.isFarm100PercentWeighed
              ? 'bg-amber-600/90 text-white shadow-amber-600/20'
              : 'bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white shadow-emerald-600/25'
          }`}
        >
          {isSubmittingBatch ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Submitting Farm Batch to Cloud...</span>
            </>
          ) : !completionStats.isFarm100PercentWeighed ? (
            <>
              <Lock className="w-4 h-4 text-amber-200" />
              <span>
                Submit Farm Weighing (Locked - {completionStats.incompleteLines.length} Pending Lines)
              </span>
            </>
          ) : (
            <>
              <CheckCircle2 className="w-4 h-4" />
              <span>Submit Farm Weighing Batch</span>
            </>
          )}
        </button>

        {/* Download Official Worksheet Button */}
        <button
          type="button"
          onClick={onDownloadExcel}
          className="w-full bg-white hover:bg-slate-50 active:scale-95 text-slate-800 border border-slate-300 py-3 rounded-xl font-bold text-xs flex items-center justify-center gap-2 shadow-xs transition cursor-pointer"
        >
          <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
          <span>Download Worksheet (13-Sheet Excel Workbook)</span>
        </button>
      </div>
    </div>
  );
};
