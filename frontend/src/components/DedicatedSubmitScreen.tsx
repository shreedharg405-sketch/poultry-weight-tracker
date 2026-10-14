import React, { useState } from 'react';
import { 
  ArrowLeft, 
  Building2, 
  CheckCircle2, 
  AlertCircle, 
  Lock, 
  Loader2, 
  FileSpreadsheet, 
  Scale, 
  Cloud, 
  CloudOff, 
  RefreshCw,
  UploadCloud,
  Check,
  AlertTriangle,
  Layers,
  Calendar,
  Clock
} from 'lucide-react';
import { FarmSummary, FarmAudit, FarmStatus } from '../services/cloudSyncService';

export interface IncompleteLineItem {
  shedId: string;
  shedName: string;
  partId: string;
  partName: string;
  lineId: number | string;
  lineName: string;
  path: string;
}

export interface CompletionStats {
  totalLinesCount: number;
  completedLinesCount: number;
  incompleteLines: IncompleteLineItem[];
  progressPercent: number;
  isFarm100PercentWeighed: boolean;
}

export interface DedicatedSubmitScreenProps {
  farm: FarmSummary | null;
  completionStats: CompletionStats;
  farmStatus: FarmStatus;
  farmAudit: FarmAudit | null;
  syncStatus: 'synced' | 'saving' | 'offline' | 'refreshing';
  pendingSyncCount: number;
  isSubmittingBatch: boolean;
  totalBirdsWeighed: number;
  totalShedsCount: number;
  totalPartsCount: number;
  uploadErrorMessage?: string | null;
  onBack: () => void;
  onSubmitUpload: () => Promise<void>;
  onRetryUpload: () => Promise<void>;
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
  totalBirdsWeighed,
  totalShedsCount,
  totalPartsCount,
  uploadErrorMessage,
  onBack,
  onSubmitUpload,
  onRetryUpload,
  onDownloadExcel,
  onJumpToLine,
}) => {
  const isCloudConnected = syncStatus === 'synced' || syncStatus === 'saving';

  const handleSubmit = async () => {
    if (isSubmittingBatch) return;

    if (!completionStats.isFarm100PercentWeighed) {
      alert(
        `Cannot submit yet! All lines must be completely weighed.\nPending lines: [${completionStats.incompleteLines.map(l => l.path).join(', ')}]. Complete all lines to submit.`
      );
      return;
    }
    await onSubmitUpload();
  };

  const handleRetry = async () => {
    if (isSubmittingBatch) return;
    await onRetryUpload();
  };

  // Helper for status badge styling
  const getStatusBadge = () => {
    switch (farmStatus) {
      case 'UPLOADING':
        return (
          <span className="text-[10px] px-2.5 py-1 rounded-full font-bold flex items-center gap-1.5 bg-blue-50 text-blue-700 border border-blue-200">
            <Loader2 className="w-3 h-3 animate-spin text-blue-600" />
            <span>🔵 Uploading to Cloud...</span>
          </span>
        );
      case 'COMPLETED':
        return (
          <span className="text-[10px] px-2.5 py-1 rounded-full font-bold flex items-center gap-1.5 bg-emerald-50 text-emerald-700 border border-emerald-200">
            <CheckCircle2 className="w-3 h-3 text-emerald-600" />
            <span>🟢 Cloud Synced • Completed</span>
          </span>
        );
      case 'UPLOAD_FAILED':
        return (
          <span className="text-[10px] px-2.5 py-1 rounded-full font-bold flex items-center gap-1.5 bg-rose-50 text-rose-700 border border-rose-200">
            <AlertTriangle className="w-3 h-3 text-rose-600" />
            <span>🔴 Upload Failed • Draft Preserved</span>
          </span>
        );
      case 'DRAFT':
      default:
        return (
          <span className="text-[10px] px-2.5 py-1 rounded-full font-bold flex items-center gap-1.5 bg-amber-50 text-amber-700 border border-amber-200">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
            <span>🟡 Draft • Unsubmitted</span>
          </span>
        );
    }
  };

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

        <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">
          Submit Farm Batch
        </span>
      </div>

      {/* Farm Profile Header */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 mb-3.5 shadow-xs">
        <div className="flex items-start justify-between">
          <div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
              Active Farm Unit
            </span>
            <h1 className="text-base font-black text-slate-900 flex items-center gap-1.5 mt-0.5">
              <Building2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>{farm?.name || 'Farm Unit'}</span>
            </h1>
            <div className="flex flex-wrap items-center gap-2 mt-2 text-xs text-slate-600">
              <span className="bg-slate-100 text-slate-700 px-2 py-0.5 rounded-md font-bold text-[10px] border border-slate-200">
                {farm?.ageWeek || 'W18'}
              </span>
              <span>{farm?.season || 'Summer'} Brood</span>
              <span>•</span>
              <span className="font-semibold text-slate-700">
                {totalShedsCount || farm?._count?.sheds || 10} Sheds
              </span>
              <span>•</span>
              <span className="font-semibold text-slate-700">
                {totalPartsCount} Parts
              </span>
              <span>•</span>
              <span className="font-semibold text-slate-700">
                {completionStats.totalLinesCount} Lines
              </span>
            </div>
          </div>

          <div>
            {getStatusBadge()}
          </div>
        </div>

        {/* Birds Weighed Total Summary */}
        <div className="grid grid-cols-2 gap-2 mt-3 pt-3 border-t border-slate-100">
          <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-200/60">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
              Total Birds Weighed
            </span>
            <span className="text-sm font-black font-mono text-slate-900 mt-0.5 block">
              {totalBirdsWeighed} Birds
            </span>
          </div>
          <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-200/60">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
              Lines Completed
            </span>
            <span className="text-sm font-black font-mono text-emerald-600 mt-0.5 block">
              {completionStats.completedLinesCount} / {completionStats.totalLinesCount} ({completionStats.progressPercent}%)
            </span>
          </div>
        </div>
      </div>

      {/* Success Notification Alert (Only displayed when confirmed COMPLETED) */}
      {farmStatus === 'COMPLETED' && (
        <div className="mb-3.5 bg-emerald-50 border border-emerald-200 text-emerald-900 p-3.5 rounded-2xl animate-in zoom-in-95">
          <div className="flex items-start gap-2.5">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
            <div>
              <h4 className="text-xs font-black text-emerald-950">
                Batch Submitted & Uploaded Successfully!
              </h4>
              <p className="text-[11px] text-emerald-800 mt-0.5">
                Every individual bird weight and flock measurement has been saved and verified.
                {farmAudit?.lastSubmittedAt && ` Submitted at: ${farmAudit.lastSubmittedAt}`}
              </p>
              <div className="mt-2 text-[10px] font-bold text-emerald-700 bg-emerald-100/60 px-2 py-1 rounded-md inline-block">
                ✓ Submission Confirmed • Official Worksheet Ready
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Upload Failed Notification Alert (Clear English, draft preserved) */}
      {farmStatus === 'UPLOAD_FAILED' && (
        <div className="mb-3.5 bg-rose-50 border border-rose-200 text-rose-900 p-3.5 rounded-2xl animate-in zoom-in-95">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
            <div>
              <h4 className="text-xs font-black text-rose-950">
                Upload failed. Your draft is preserved locally.
              </h4>
              <p className="text-[11px] text-rose-800 mt-0.5">
                Please retry when the connection returns. All {totalBirdsWeighed} recorded bird weights remain safely saved on this device.
              </p>
              {uploadErrorMessage && (
                <p className="text-[10px] text-rose-700 font-mono mt-1 bg-rose-100/50 p-1.5 rounded">
                  {uploadErrorMessage}
                </p>
              )}
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
              ? '🟢 100% Ready for Cloud Upload' 
              : `🟡 Incomplete (${completionStats.incompleteLines.length} Pending)`}
          </span>
        </div>

        {/* Pending Lines Warning List (Blocks submission until resolved) */}
        {!completionStats.isFarm100PercentWeighed && (
          <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 space-y-2 mt-2">
            <div className="flex items-center justify-between text-[11px] font-bold text-amber-400 pb-1 border-b border-slate-800/80">
              <span className="flex items-center gap-1.5">
                <AlertCircle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                <span>Pending Lines ({completionStats.incompleteLines.length})</span>
              </span>
              <span className="text-slate-400 font-normal">Must weigh at least 1 bird to submit</span>
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

      {/* 2. SYNCHRONIZATION STATUS BADGE */}
      <div className="bg-white p-3.5 rounded-2xl border border-slate-200 mb-4 shadow-xs">
        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1">
          Synchronization Status
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
                {isCloudConnected ? '🟢 Live Server Connected' : '⏳ Offline • Saved Locally'}
              </span>
              <span className="text-[10px] text-slate-400">
                {pendingSyncCount > 0 
                  ? `${pendingSyncCount} record(s) queued for sync` 
                  : 'All measurements synchronized'}
              </span>
            </div>
          </div>

          <span className="text-[10px] font-bold text-slate-600 bg-slate-100 px-2 py-1 rounded-lg border border-slate-200">
            {farmStatus === 'COMPLETED' ? '🟢 SUBMITTED' : farmStatus === 'DRAFT' ? '🟡 DRAFT' : farmStatus}
          </span>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="space-y-2.5 mt-auto">
        {/* RETRY UPLOAD BUTTON (Shown prominently when upload failed) */}
        {farmStatus === 'UPLOAD_FAILED' && (
          <button
            type="button"
            onClick={handleRetry}
            disabled={isSubmittingBatch}
            className="w-full bg-rose-600 hover:bg-rose-500 active:scale-95 text-white font-black py-3.5 rounded-xl text-xs flex items-center justify-center gap-2 shadow-lg shadow-rose-600/25 transition cursor-pointer disabled:opacity-50"
          >
            {isSubmittingBatch ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Retrying Cloud Upload...</span>
              </>
            ) : (
              <>
                <RefreshCw className="w-4 h-4" />
                <span>Retry Upload</span>
              </>
            )}
          </button>
        )}

        {/* SUBMIT & UPLOAD BUTTON */}
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!completionStats.isFarm100PercentWeighed || isSubmittingBatch}
          className={`w-full font-black py-3.5 rounded-xl text-xs flex items-center justify-center gap-2 shadow-lg transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
            !completionStats.isFarm100PercentWeighed
              ? 'bg-amber-600/90 text-white shadow-amber-600/20'
              : farmStatus === 'COMPLETED'
                ? 'bg-emerald-700 hover:bg-emerald-600 text-white shadow-emerald-700/20'
                : 'bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white shadow-emerald-600/25'
          }`}
        >
          {isSubmittingBatch ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Uploading Batch to Cloud Database...</span>
            </>
          ) : !completionStats.isFarm100PercentWeighed ? (
            <>
              <Lock className="w-4 h-4 text-amber-200" />
              <span>
                Submit & Upload (Locked - {completionStats.incompleteLines.length} Pending Lines)
              </span>
            </>
          ) : farmStatus === 'COMPLETED' ? (
            <>
              <Check className="w-4 h-4" />
              <span>Submit & Upload Again (Update Batch)</span>
            </>
          ) : (
            <>
              <UploadCloud className="w-4 h-4" />
              <span>Submit & Upload</span>
            </>
          )}
        </button>

        {/* DOWNLOAD OFFICIAL WORKSHEET BUTTON (Available for submitted batches) */}
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
