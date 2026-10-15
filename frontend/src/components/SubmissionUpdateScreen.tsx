import React, { useState, useEffect, useMemo } from 'react';
import {
  ArrowLeft,
  Building2,
  Calendar,
  Clock,
  Save,
  X,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Plus,
  Trash2,
  Layers,
  ShieldAlert,
  Scale
} from 'lucide-react';
import { cloudApi, AppUser, UserRole } from '../services/cloudSyncService';
import { formatDateTimeIST } from '../utils/dateFormatter';

export interface SubmissionUpdateScreenProps {
  submissionId: string | null;
  currentUser: AppUser | null;
  currentUserRole: UserRole;
  onBack: () => void;
  onUpdateSuccess?: (updatedSubmission: any) => void;
}

interface EditableLine {
  id?: string;
  name: string;
  weights: number[];
}

interface EditablePart {
  id?: string;
  name: string;
  order: number;
  lines: EditableLine[];
}

interface EditableShed {
  id?: string;
  name: string;
  type: 'Female' | 'Male';
  order: number;
  parts: EditablePart[];
}

export const SubmissionUpdateScreen: React.FC<SubmissionUpdateScreenProps> = ({
  submissionId,
  currentUser,
  currentUserRole,
  onBack,
  onUpdateSuccess,
}) => {
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [submission, setSubmission] = useState<any | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Editable form state
  const [flockAge, setFlockAge] = useState<string>('W18');
  const [season, setSeason] = useState<string>('Summer');
  const [status, setStatus] = useState<string>('COMPLETED');
  const [sheds, setSheds] = useState<EditableShed[]>([]);
  const [activeShedIndex, setActiveShedIndex] = useState<number>(0);
  const [activePartIndex, setActivePartIndex] = useState<number>(0);
  const [activeLineIndex, setActiveLineIndex] = useState<number>(0);
  const [newWeightInput, setNewWeightInput] = useState<string>('');

  // Validation state
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // Check authorization
  const isAuthorizedRole = useMemo(() => {
    return (
      currentUserRole === 'Admin' ||
      currentUserRole === 'Manager' ||
      currentUserRole === 'Supervisor' ||
      currentUserRole === 'In-Charge'
    );
  }, [currentUserRole]);

  // Load existing submission data
  useEffect(() => {
    let isMounted = true;

    async function loadData() {
      if (!submissionId) {
        setErrorMessage('No submission ID provided for update.');
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      setErrorMessage(null);

      try {
        let data: any = null;
        try {
          data = await cloudApi.getSubmissionDetails(submissionId);
        } catch {
          // If direct fetch fails, search in submissions list
          const list = await cloudApi.getSubmissions();
          data = list.find((s: any) => s.id === submissionId);
        }

        if (!data) {
          // Check local storage submissions backup
          const cached = localStorage.getItem('poultry_submissions_cache');
          if (cached) {
            try {
              const parsed = JSON.parse(cached);
              data = parsed.find((s: any) => s.id === submissionId);
            } catch {}
          }
        }

        if (!data) {
          throw new Error('Submission record not found. Please verify the submission ID.');
        }

        // Verify farm-level permissions for Supervisor / In-Charge
        if (currentUser && currentUserRole !== 'Admin' && currentUserRole !== 'Manager') {
          const userFarms = currentUser.assignedFarms || [];
          const hasAccess =
            userFarms.includes('*') ||
            userFarms.includes(data.farmId) ||
            userFarms.includes(data.farm?.name) ||
            userFarms.includes(data.farmName);

          if (!hasAccess) {
            throw new Error('Access denied: You are not authorized to update submissions for this farm.');
          }
        }

        if (isMounted) {
          setSubmission(data);
          setFlockAge(data.flockAge || 'W18');
          setSeason(data.season || 'Summer');
          setStatus(data.status || 'COMPLETED');

          // Initialize editable sheds hierarchy
          if (Array.isArray(data.sheds) && data.sheds.length > 0) {
            const mappedSheds: EditableShed[] = data.sheds.map((s: any, sIdx: number) => ({
              id: s.id,
              name: s.name || `Shed ${sIdx + 1}`,
              type: s.type === 'Male' ? 'Male' : 'Female',
              order: s.order ?? sIdx + 1,
              parts: (s.parts || []).map((p: any, pIdx: number) => ({
                id: p.id,
                name: p.name || `Part ${String.fromCharCode(65 + pIdx)}`,
                order: p.order ?? pIdx + 1,
                lines: (p.lines || []).map((l: any, lIdx: number) => ({
                  id: l.id,
                  name: l.name || `Line ${lIdx + 1}`,
                  weights: Array.isArray(l.weights)
                    ? l.weights.map(Number).filter((w: number) => !isNaN(w) && w > 0)
                    : [],
                })),
              })),
            }));
            setSheds(mappedSheds);
          } else {
            // Default baseline hierarchy if sheds structure is flattened
            setSheds([
              {
                name: 'Shed 1',
                type: 'Female',
                order: 1,
                parts: [
                  {
                    name: 'Part A',
                    order: 1,
                    lines: [{ name: 'Line 1', weights: [] }],
                  },
                ],
              },
            ]);
          }
        }
      } catch (err: any) {
        if (isMounted) {
          setErrorMessage(err.message || 'Failed to load submission record.');
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    loadData();

    return () => {
      isMounted = false;
    };
  }, [submissionId, currentUser, currentUserRole]);

  // Compute live updated summary stats across editable sheds
  const liveStats = useMemo(() => {
    const allWeights: number[] = [];
    const femaleWeights: number[] = [];
    const maleWeights: number[] = [];

    sheds.forEach((shed) => {
      const isMale = shed.type === 'Male';
      shed.parts.forEach((part) => {
        part.lines.forEach((line) => {
          allWeights.push(...line.weights);
          if (isMale) maleWeights.push(...line.weights);
          else femaleWeights.push(...line.weights);
        });
      });
    });

    const count = allWeights.length;
    const avg = count ? Math.round(allWeights.reduce((a, b) => a + b, 0) / count) : 0;
    const femaleAvg = femaleWeights.length ? Math.round(femaleWeights.reduce((a, b) => a + b, 0) / femaleWeights.length) : 0;
    const maleAvg = maleWeights.length ? Math.round(maleWeights.reduce((a, b) => a + b, 0) / maleWeights.length) : 0;

    let uniformity = 0;
    if (count > 0 && avg > 0) {
      const lower = avg * 0.9;
      const upper = avg * 1.1;
      const inRange = allWeights.filter((w) => w >= lower && w <= upper).length;
      uniformity = Math.round((inRange / count) * 1000) / 10;
    }

    return {
      count,
      avg,
      femaleAvg,
      maleAvg,
      uniformity,
    };
  }, [sheds]);

  // Handle active line selections
  const currentShed = sheds[activeShedIndex] || sheds[0];
  const currentPart = currentShed?.parts[activePartIndex] || currentShed?.parts[0];
  const currentLine = currentPart?.lines[activeLineIndex] || currentPart?.lines[0];

  // Add individual weight
  const handleAddWeightToCurrentLine = () => {
    const val = parseFloat(newWeightInput.trim());
    if (isNaN(val) || val <= 0) {
      setFieldErrors((prev) => ({ ...prev, weight: 'Please enter a valid positive weight in grams.' }));
      return;
    }
    if (val < 100 || val > 8000) {
      setFieldErrors((prev) => ({ ...prev, weight: 'Weight must be between 100g and 8000g.' }));
      return;
    }

    setFieldErrors((prev) => {
      const next = { ...prev };
      delete next.weight;
      return next;
    });

    setSheds((prev) =>
      prev.map((s, sIdx) => {
        if (sIdx !== activeShedIndex) return s;
        return {
          ...s,
          parts: s.parts.map((p, pIdx) => {
            if (pIdx !== activePartIndex) return p;
            return {
              ...p,
              lines: p.lines.map((l, lIdx) => {
                if (lIdx !== activeLineIndex) return l;
                return {
                  ...l,
                  weights: [...l.weights, val],
                };
              }),
            };
          }),
        };
      })
    );

    setNewWeightInput('');
  };

  // Remove individual weight
  const handleRemoveWeightFromCurrentLine = (weightIdx: number) => {
    setSheds((prev) =>
      prev.map((s, sIdx) => {
        if (sIdx !== activeShedIndex) return s;
        return {
          ...s,
          parts: s.parts.map((p, pIdx) => {
            if (pIdx !== activePartIndex) return p;
            return {
              ...p,
              lines: p.lines.map((l, lIdx) => {
                if (lIdx !== activeLineIndex) return l;
                const nextWeights = [...l.weights];
                nextWeights.splice(weightIdx, 1);
                return {
                  ...l,
                  weights: nextWeights,
                };
              }),
            };
          }),
        };
      })
    );
  };

  // Validate form
  const validateForm = (): boolean => {
    const errors: Record<string, string> = {};

    if (!flockAge.trim()) {
      errors.flockAge = 'Flock age is required.';
    } else if (!/^W\d+$/i.test(flockAge.trim())) {
      errors.flockAge = 'Flock age must be formatted as W followed by week number (e.g. W18).';
    }

    if (!season.trim()) {
      errors.season = 'Season selection is required.';
    }

    if (liveStats.count <= 0) {
      errors.weights = 'Submission must contain at least one recorded bird weight.';
    }

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  // Save changes
  const handleSaveChanges = async () => {
    if (!validateForm()) return;

    setIsSaving(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    const updatePayload = {
      flockAge: flockAge.trim().toUpperCase(),
      season,
      status,
      sheds,
      metadata: {
        ...(submission?.metadata || {}),
        lastEditedBy: currentUser?.name || currentUser?.userName || 'Field Operator',
        lastEditedRole: currentUserRole,
        lastEditedAt: new Date().toISOString(),
      },
    };

    try {
      const result = await cloudApi.updateSubmission(submissionId!, updatePayload);
      setSuccessMessage('✓ Submission updated successfully! Saved changes have been committed.');
      if (onUpdateSuccess) {
        onUpdateSuccess(result.submission || result);
      }
      setTimeout(() => {
        onBack();
      }, 1200);
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to save submission update. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  // Render unauthorized guard
  if (!isAuthorizedRole) {
    return (
      <div className="flex-1 flex flex-col p-4 animate-in fade-in duration-150">
        <div className="bg-white border border-rose-200 rounded-3xl p-6 sm:p-8 text-center space-y-4 shadow-sm my-6">
          <div className="w-14 h-14 bg-rose-50 rounded-2xl flex items-center justify-center mx-auto border border-rose-200 text-rose-600">
            <ShieldAlert className="w-7 h-7" />
          </div>
          <div className="space-y-1">
            <h2 className="text-base font-black text-slate-900">Access Restricted</h2>
            <p className="text-xs text-slate-500 max-w-sm mx-auto leading-relaxed">
              Your account role ({currentUserRole}) is not authorized to edit or update finalized flock submissions.
            </p>
          </div>
          <div className="pt-2">
            <button
              onClick={onBack}
              className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl transition cursor-pointer"
            >
              Back to Submissions
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Render loading state
  if (isLoading) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 space-y-3 min-h-[400px]">
        <Loader2 className="w-8 h-8 animate-spin text-emerald-600" />
        <h3 className="text-sm font-bold text-slate-700">Loading Submission Details...</h3>
        <p className="text-xs text-slate-400">Fetching recorded bird weights and flock metrics</p>
      </div>
    );
  }

  const farmDisplayName = submission?.farm?.name || submission?.farmName || 'Assigned Farm';
  const originalSubmitter = submission?.submitterName || 'Supervisor';
  const originalRole = submission?.submitterRole || 'Supervisor';
  const submittedAtFormatted = formatDateTimeIST(submission?.submittedAt || submission?.createdAt);

  return (
    <div className="flex-1 flex flex-col p-3 sm:p-4 max-w-full animate-in slide-in-from-right duration-150">
      {/* Top Header */}
      <div className="flex items-center justify-between mb-3.5">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-xs font-bold text-slate-700 bg-white hover:bg-slate-100 px-3 py-1.5 rounded-xl border border-slate-200 shadow-xs active:scale-95 cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" /> Cancel
        </button>

        <span className="text-[10px] font-black uppercase tracking-wider text-emerald-800 bg-emerald-50 border border-emerald-200 px-3 py-1 rounded-full">
          Submission Management
        </span>
      </div>

      {/* Page Title */}
      <div className="mb-3 px-1">
        <h1 className="text-lg font-black text-slate-900 flex items-center gap-2">
          <Scale className="w-5 h-5 text-emerald-600 shrink-0" />
          <span>Update Submission</span>
        </h1>
        <p className="text-xs text-slate-500 mt-0.5">
          Modify recorded bird weights, flock metadata, and re-commit verified flock data
        </p>
      </div>

      {/* Success Banner */}
      {successMessage && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-900 p-3 rounded-2xl mb-3 flex items-start gap-2.5 shadow-2xs animate-in fade-in">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
          <div className="text-xs font-bold leading-tight">{successMessage}</div>
        </div>
      )}

      {/* Error Banner */}
      {errorMessage && (
        <div className="bg-rose-50 border border-rose-200 text-rose-900 p-3 rounded-2xl mb-3 flex items-start gap-2.5 shadow-2xs animate-in fade-in">
          <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
          <div className="text-xs font-bold leading-tight">{errorMessage}</div>
        </div>
      )}

      {/* Read-Only Existing Submission Metadata Card */}
      <div className="bg-white p-3.5 rounded-2xl border border-slate-200 mb-3 shadow-xs">
        <div className="flex items-start justify-between gap-2 pb-2.5 border-b border-slate-100">
          <div className="min-w-0">
            <span className="text-[10px] uppercase font-bold text-slate-400 block">Farm Unit</span>
            <h2 className="font-black text-sm text-slate-900 flex items-center gap-1.5 truncate">
              <Building2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span className="truncate">{farmDisplayName}</span>
            </h2>
          </div>
          <span className="text-[10px] font-mono font-bold text-slate-500 bg-slate-50 px-2 py-0.5 rounded-lg border border-slate-200 shrink-0">
            ID: {submissionId?.slice(0, 8)}...
          </span>
        </div>

        <div className="grid grid-cols-2 gap-2 mt-2.5 text-xs">
          <div className="min-w-0">
            <span className="text-[10px] text-slate-400 font-bold uppercase block truncate">Original Submitter</span>
            <span className="font-bold text-slate-800 text-xs truncate block">
              {originalSubmitter} ({originalRole})
            </span>
          </div>
          <div className="min-w-0">
            <span className="text-[10px] text-slate-400 font-bold uppercase block truncate">Submission Date & Time</span>
            <span className="font-bold text-slate-800 text-xs truncate block font-mono">
              {submittedAtFormatted}
            </span>
          </div>
        </div>
      </div>

      {/* Live Calculated Stats Summary Card */}
      <div className="grid grid-cols-3 gap-1.5 bg-gradient-to-r from-slate-900 to-emerald-950 text-white p-3 rounded-2xl mb-3.5 shadow-md">
        <div className="text-center min-w-0">
          <span className="text-[9px] uppercase font-bold text-emerald-300 block truncate">Total Sampled</span>
          <span className="text-base font-black font-mono block truncate">{liveStats.count} Birds</span>
        </div>
        <div className="text-center min-w-0">
          <span className="text-[9px] uppercase font-bold text-emerald-300 block truncate">Overall Avg Wt</span>
          <span className="text-base font-black font-mono text-emerald-400 block truncate">{liveStats.avg}g</span>
        </div>
        <div className="text-center min-w-0">
          <span className="text-[9px] uppercase font-bold text-emerald-300 block truncate">Uniformity (S%)</span>
          <span className="text-base font-black font-mono text-amber-300 block truncate">{liveStats.uniformity}%</span>
        </div>
      </div>

      {/* Editable Fields Section */}
      <div className="bg-white p-3.5 rounded-2xl border border-slate-200 mb-3 shadow-xs space-y-3">
        <h3 className="text-xs font-black uppercase tracking-wider text-slate-800 flex items-center gap-1.5">
          <Layers className="w-3.5 h-3.5 text-emerald-600" />
          <span>Editable Submission Attributes</span>
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
          {/* Flock Age Field */}
          <div>
            <label className="text-[11px] font-bold text-slate-700 block mb-1">
              Flock Age <span className="text-rose-500">*</span>
            </label>
            <input
              type="text"
              value={flockAge}
              onChange={(e) => setFlockAge(e.target.value)}
              placeholder="e.g. W18"
              className={`w-full bg-slate-50 border rounded-xl px-3 py-2 text-xs font-bold text-slate-900 focus:outline-none focus:bg-white ${
                fieldErrors.flockAge ? 'border-rose-400 focus:border-rose-500' : 'border-slate-300 focus:border-emerald-500'
              }`}
            />
            {fieldErrors.flockAge && (
              <span className="text-[10px] text-rose-600 font-bold block mt-0.5">{fieldErrors.flockAge}</span>
            )}
          </div>

          {/* Season Field */}
          <div>
            <label className="text-[11px] font-bold text-slate-700 block mb-1">
              Season <span className="text-rose-500">*</span>
            </label>
            <select
              value={season}
              onChange={(e) => setSeason(e.target.value)}
              className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold text-slate-900 focus:outline-none focus:border-emerald-500 focus:bg-white cursor-pointer"
            >
              <option value="Summer">Summer</option>
              <option value="Winter">Winter</option>
            </select>
            {fieldErrors.season && (
              <span className="text-[10px] text-rose-600 font-bold block mt-0.5">{fieldErrors.season}</span>
            )}
          </div>

          {/* Status Field */}
          <div>
            <label className="text-[11px] font-bold text-slate-700 block mb-1">
              Submission Status
            </label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold text-slate-900 focus:outline-none focus:border-emerald-500 focus:bg-white cursor-pointer"
            >
              <option value="COMPLETED">🟢 COMPLETED (Official)</option>
              <option value="DRAFT">🟡 DRAFT (In Progress)</option>
            </select>
          </div>
        </div>
      </div>

      {/* Shed / Part / Line Weight Editor */}
      <div className="bg-white p-3.5 rounded-2xl border border-slate-200 mb-4 shadow-xs space-y-3">
        <div className="flex items-center justify-between pb-2 border-b border-slate-100">
          <div>
            <h3 className="text-xs font-black uppercase tracking-wider text-slate-800">
              Recorded Bird Weights Editor
            </h3>
            <p className="text-[11px] text-slate-500">
              Select shed, part, and pen line to modify individual bird weights
            </p>
          </div>
        </div>

        {/* Shed Select Chips */}
        <div className="space-y-1">
          <span className="text-[10px] font-bold uppercase text-slate-400">1. Select Shed:</span>
          <div className="flex flex-wrap gap-1.5 overflow-x-auto pb-1">
            {sheds.map((s, sIdx) => (
              <button
                key={sIdx}
                type="button"
                onClick={() => {
                  setActiveShedIndex(sIdx);
                  setActivePartIndex(0);
                  setActiveLineIndex(0);
                }}
                className={`text-xs px-3 py-1.5 rounded-xl font-bold border transition cursor-pointer shrink-0 ${
                  activeShedIndex === sIdx
                    ? 'bg-slate-900 text-white border-slate-900 shadow-xs'
                    : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                }`}
              >
                {s.name} ({s.type === 'Male' ? '♂ M' : '♀ F'})
              </button>
            ))}
          </div>
        </div>

        {/* Part Select Chips */}
        {currentShed && currentShed.parts.length > 0 && (
          <div className="space-y-1">
            <span className="text-[10px] font-bold uppercase text-slate-400">2. Select Part in {currentShed.name}:</span>
            <div className="flex flex-wrap gap-1.5 overflow-x-auto pb-1">
              {currentShed.parts.map((p, pIdx) => (
                <button
                  key={pIdx}
                  type="button"
                  onClick={() => {
                    setActivePartIndex(pIdx);
                    setActiveLineIndex(0);
                  }}
                  className={`text-xs px-3 py-1.5 rounded-xl font-bold border transition cursor-pointer shrink-0 ${
                    activePartIndex === pIdx
                      ? 'bg-amber-500 text-slate-950 border-amber-500 shadow-xs'
                      : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                  }`}
                >
                  {p.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Line Select Chips */}
        {currentPart && currentPart.lines.length > 0 && (
          <div className="space-y-1">
            <span className="text-[10px] font-bold uppercase text-slate-400">3. Select Pen Line in {currentPart.name}:</span>
            <div className="flex flex-wrap gap-1.5 overflow-x-auto pb-1">
              {currentPart.lines.map((l, lIdx) => (
                <button
                  key={lIdx}
                  type="button"
                  onClick={() => setActiveLineIndex(lIdx)}
                  className={`text-xs px-3 py-1.5 rounded-xl font-bold border transition cursor-pointer shrink-0 ${
                    activeLineIndex === lIdx
                      ? 'bg-sky-600 text-white border-sky-600 shadow-xs'
                      : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                  }`}
                >
                  {l.name} ({l.weights.length} birds)
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Weights List and Add Weight for Current Line */}
        {currentLine && (
          <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-black text-slate-900">
                {currentShed.name} › {currentPart.name} › {currentLine.name}
              </span>
              <span className="text-[11px] font-mono font-bold text-slate-600 bg-white px-2 py-0.5 rounded-md border border-slate-200">
                {currentLine.weights.length} birds recorded
              </span>
            </div>

            {/* Quick Add Weight Form */}
            <div className="flex gap-1.5">
              <input
                type="number"
                placeholder="Weight in grams (e.g. 1450)..."
                value={newWeightInput}
                onChange={(e) => setNewWeightInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddWeightToCurrentLine();
                  }
                }}
                className={`flex-1 min-w-0 bg-white border rounded-xl px-3 py-1.5 text-xs font-mono font-bold text-slate-900 focus:outline-none ${
                  fieldErrors.weight ? 'border-rose-400 focus:border-rose-500' : 'border-slate-300 focus:border-sky-500'
                }`}
              />
              <button
                type="button"
                onClick={handleAddWeightToCurrentLine}
                className="bg-sky-600 hover:bg-sky-500 active:scale-95 text-white px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1 cursor-pointer shrink-0"
              >
                <Plus className="w-3.5 h-3.5" /> Add
              </button>
            </div>
            {fieldErrors.weight && (
              <span className="text-[10px] text-rose-600 font-bold block">{fieldErrors.weight}</span>
            )}

            {/* Recorded Weights Chips List */}
            <div className="max-h-48 overflow-y-auto space-y-1 pr-1">
              {currentLine.weights.length === 0 ? (
                <p className="text-xs text-slate-400 italic py-2 text-center">
                  No bird weights recorded for {currentLine.name}. Add bird weights using the input above.
                </p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {currentLine.weights.map((w, wIdx) => (
                    <span
                      key={wIdx}
                      className="inline-flex items-center gap-1 bg-white border border-slate-200 px-2 py-1 rounded-lg text-xs font-mono font-bold text-slate-800 shadow-2xs"
                    >
                      <span>#{wIdx + 1}: {w}g</span>
                      <button
                        type="button"
                        onClick={() => handleRemoveWeightFromCurrentLine(wIdx)}
                        className="text-slate-400 hover:text-rose-600 p-0.5 rounded cursor-pointer transition"
                        title="Delete weight"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {fieldErrors.weights && (
        <div className="bg-rose-50 border border-rose-200 text-rose-800 p-2.5 rounded-xl mb-3 text-xs font-bold flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
          <span>{fieldErrors.weights}</span>
        </div>
      )}

      {/* Actions: Save Changes and Cancel */}
      <div className="flex flex-col sm:flex-row gap-2 mt-auto pt-2">
        <button
          type="button"
          onClick={onBack}
          disabled={isSaving}
          className="flex-1 bg-slate-100 hover:bg-slate-200 active:scale-95 text-slate-700 py-3 rounded-xl font-bold text-xs flex items-center justify-center gap-2 transition cursor-pointer"
        >
          <X className="w-4 h-4" />
          <span>Cancel</span>
        </button>

        <button
          type="button"
          onClick={handleSaveChanges}
          disabled={isSaving}
          className="flex-2 bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white py-3 rounded-xl font-black text-xs flex items-center justify-center gap-2 shadow-md shadow-emerald-600/20 transition cursor-pointer disabled:opacity-50"
        >
          {isSaving ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Saving Changes...</span>
            </>
          ) : (
            <>
              <Save className="w-4 h-4" />
              <span>Save Changes</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
};

export default SubmissionUpdateScreen;
