import React, { useState } from 'react';
import { 
  Building2, 
  Users, 
  FileSpreadsheet, 
  CheckCircle2, 
  Clock, 
  Plus, 
  Settings, 
  Radio, 
  LogOut, 
  ChevronRight, 
  ShieldCheck, 
  ShieldAlert,
  Edit2,
  X,
  UserPlus,
  Trash2,
  Check,
  Calendar,
  Cloud
} from 'lucide-react';
import { FarmSummary, AppUser, UserRole } from '../services/cloudSyncService';

export interface ManagerAdminDashboardProps {
  currentUser: AppUser | null;
  farms: FarmSummary[];
  activeFarmId: string;
  onSelectFarm: (farmId: string) => void;
  onOpenConclusion: (farmId: string) => void;
  onAssignUser: (farmId: string, assignedUsers: string[]) => void;
  onViewSubmissionsUpdate: () => void;
  onOpenSetup: () => void;
  onOpenAuth: () => void;
  onLogout: () => void;
  onNewFarm: () => void;
}

export const ManagerAdminDashboard: React.FC<ManagerAdminDashboardProps> = ({
  currentUser,
  farms,
  activeFarmId,
  onSelectFarm,
  onOpenConclusion,
  onAssignUser,
  onViewSubmissionsUpdate,
  onOpenSetup,
  onOpenAuth,
  onLogout,
  onNewFarm,
}) => {
  const userRole = currentUser?.role || 'Manager';
  const isAdmin = userRole === 'Admin';
  const userDisplayName = currentUser?.userName || currentUser?.name || 'Executive User';

  // Assignment Modal State
  const [assigningFarmId, setAssigningFarmId] = useState<string | null>(null);
  const [tempAssignedUsers, setTempAssignedUsers] = useState<string[]>([]);
  const [newUserInput, setNewUserInput] = useState('');

  const targetFarmForAssign = farms.find(f => f.id === assigningFarmId);

  const handleOpenAssignModal = (farm: FarmSummary) => {
    setAssigningFarmId(farm.id);
    setTempAssignedUsers(farm.assignedUserNames || []);
    setNewUserInput('');
  };

  const handleAddUserToAssign = () => {
    const trimmed = newUserInput.trim();
    if (!trimmed) return;
    if (!tempAssignedUsers.includes(trimmed)) {
      setTempAssignedUsers([...tempAssignedUsers, trimmed]);
    }
    setNewUserInput('');
  };

  const handleRemoveUserFromAssign = (userName: string) => {
    setTempAssignedUsers(tempAssignedUsers.filter(u => u !== userName));
  };

  const handleSaveAssignments = () => {
    if (assigningFarmId) {
      onAssignUser(assigningFarmId, tempAssignedUsers);
      setAssigningFarmId(null);
    }
  };

  // Quick Suggested Operator Presets
  const suggestedOperators = [
    'Ramesh (Supervisor)',
    'John (Incharge)',
    'Suresh Kumar (Supervisor)',
    'Anil (Incharge)',
    'Vijay (Supervisor)'
  ];

  return (
    <div className="flex-1 flex flex-col p-4 animate-in fade-in duration-150">
      {/* Top Header: Session & Role Bar */}
      <div className="flex items-center justify-between mb-3 px-1">
        <div 
          onClick={onOpenAuth}
          className="flex items-center gap-2 cursor-pointer hover:opacity-90 transition bg-white px-2.5 py-1.5 rounded-xl border border-slate-200/90 shadow-2xs"
          title="View Session Details"
        >
          <div className={`w-7 h-7 rounded-lg text-white flex items-center justify-center font-bold text-xs shadow-xs ${
            isAdmin ? 'bg-purple-600' : 'bg-sky-600'
          }`}>
            {userDisplayName.charAt(0).toUpperCase()}
          </div>
          <div>
            <span className="text-xs font-bold text-slate-900 block leading-tight truncate max-w-[120px]">
              {userDisplayName}
            </span>
            <span className={`text-[9px] font-bold px-1.5 py-0.2 rounded leading-tight inline-block border ${
              isAdmin ? 'bg-purple-50 text-purple-700 border-purple-200' : 'bg-sky-50 text-sky-700 border-sky-200'
            }`}>
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

          {isAdmin ? (
            <button
              onClick={onOpenSetup}
              className="p-1.5 text-slate-500 hover:text-purple-600 rounded-xl hover:bg-slate-200 transition cursor-pointer"
              title="Cloud Integration Settings (Admin)"
            >
              <Settings className="w-4 h-4" />
            </button>
          ) : (
            <button
              onClick={onOpenSetup}
              className="p-1.5 text-slate-400 hover:text-slate-600 rounded-xl hover:bg-slate-200 transition cursor-pointer"
              title="Cloud Connection (Read-Only Manager)"
            >
              <Cloud className="w-4 h-4" />
            </button>
          )}

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
      <div className={`text-white p-3.5 rounded-2xl border mb-3.5 shadow-md ${
        isAdmin 
          ? 'bg-gradient-to-r from-purple-900 to-slate-900 border-purple-700/60' 
          : 'bg-gradient-to-r from-sky-900 to-slate-900 border-sky-700/60'
      }`}>
        <div className="flex items-center justify-between">
          <div>
            <span className="text-[10px] font-black uppercase tracking-wider text-purple-200 block">
              {isAdmin ? 'System Administrator Suite' : 'Supervisory Management Suite'}
            </span>
            <h2 className="text-sm font-black text-white mt-0.5">
              Manager & Admin Master Dashboard
            </h2>
          </div>
          <button
            onClick={onNewFarm}
            className="bg-white text-slate-950 font-black text-[11px] px-3 py-1.5 rounded-xl flex items-center gap-1 active:scale-95 transition cursor-pointer shadow-xs"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New Farm</span>
          </button>
        </div>
      </div>

      {/* Overview Stats Strip */}
      <div className="grid grid-cols-3 gap-2 mb-3.5">
        <div className="bg-white p-2.5 rounded-xl border border-slate-200 text-center shadow-xs">
          <span className="text-[9px] uppercase font-bold text-slate-400 block">Total Units</span>
          <span className="text-base font-black text-slate-900 font-mono">{farms.length}</span>
        </div>
        <div className="bg-white p-2.5 rounded-xl border border-slate-200 text-center shadow-xs">
          <span className="text-[9px] uppercase font-bold text-slate-400 block">In Draft</span>
          <span className="text-base font-black text-amber-600 font-mono">
            {farms.filter(f => f.status === 'DRAFT').length}
          </span>
        </div>
        <div className="bg-white p-2.5 rounded-xl border border-slate-200 text-center shadow-xs">
          <span className="text-[9px] uppercase font-bold text-slate-400 block">Submitted</span>
          <span className="text-base font-black text-emerald-600 font-mono">
            {farms.filter(f => f.status === 'COMPLETED').length}
          </span>
        </div>
      </div>

      {/* Master Farm Roster Header */}
      <div className="flex items-center justify-between px-1 mb-2">
        <h3 className="text-xs font-black uppercase tracking-wider text-slate-500">
          Master Farm Roster ({farms.length})
        </h3>
        <span className="text-[10px] text-slate-400 font-medium">
          Select unit for One-Tap Conclusion
        </span>
      </div>

      {/* Master Farm Roster List */}
      <div className="space-y-3 overflow-y-auto flex-1 pb-4">
        {farms.map((farm) => {
          const isCompleted = farm.status === 'COMPLETED';
          const assignedCount = farm.assignedUserNames?.length || 0;

          return (
            <div 
              key={farm.id}
              className={`p-4 rounded-2xl border transition-all bg-white shadow-xs ${
                activeFarmId === farm.id 
                  ? 'border-slate-400 ring-2 ring-slate-400/20' 
                  : 'border-slate-200 hover:border-slate-300'
              }`}
            >
              {/* Unit Title and Status Pill */}
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <Building2 className="w-4 h-4 text-emerald-600 shrink-0" />
                    <h4 className="font-black text-sm text-slate-900 truncate">{farm.name}</h4>
                  </div>
                  <div className="flex items-center gap-2 mt-1 text-[11px] text-slate-500">
                    <span className="bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded font-bold text-[10px] border border-slate-200">
                      {farm.ageWeek}
                    </span>
                    <span>{farm.season} Brood</span>
                    <span>•</span>
                    <span className="font-mono">{farm._count?.sheds || 10} Sheds</span>
                  </div>
                </div>

                <span className={`text-[10px] px-2.5 py-0.5 rounded-full font-bold shrink-0 flex items-center gap-1 ${
                  isCompleted 
                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' 
                    : 'bg-amber-50 text-amber-700 border border-amber-200'
                }`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${isCompleted ? 'bg-emerald-500' : 'bg-amber-400 animate-pulse'}`} />
                  {isCompleted ? '🟢 Submitted' : '🟡 Draft in Progress'}
                </span>
              </div>

              {/* Assigned Operators Strip */}
              <div className="mt-3 p-2.5 bg-slate-50 rounded-xl border border-slate-100 text-xs">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[10px] uppercase font-bold text-slate-500 flex items-center gap-1">
                    <Users className="w-3 h-3 text-slate-400" />
                    Assigned Field Operators ({assignedCount}):
                  </span>
                  <button
                    type="button"
                    onClick={() => handleOpenAssignModal(farm)}
                    className="text-[10px] font-bold text-sky-700 hover:text-sky-800 flex items-center gap-1 cursor-pointer"
                  >
                    <Edit2 className="w-3 h-3" />
                    <span>Assign Operators</span>
                  </button>
                </div>

                {assignedCount > 0 ? (
                  <div className="flex flex-wrap gap-1">
                    {farm.assignedUserNames!.map((userName, idx) => (
                      <span 
                        key={idx} 
                        className="bg-white text-slate-700 text-[10px] font-bold px-2 py-0.5 rounded-md border border-slate-200 shadow-2xs"
                      >
                        {userName}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-[11px] text-amber-700 italic">
                    No operators bound. Tap "Assign Operators" to grant field access.
                  </p>
                )}
              </div>

              {/* Audit Summary Details */}
              {farm.audit && (
                <div className="mt-2 text-[10px] text-slate-500 flex items-center justify-between">
                  <span>
                    Last Submission: <strong className="text-slate-800">{farm.audit.lastSubmittedBy || 'Supervisor'}</strong>
                  </span>
                  <span className="font-mono text-slate-700">
                    {farm.audit.lastSubmittedAt ? farm.audit.lastSubmittedAt.replace(/Date\(|\)/g, '').replace(/:(\d{2}):\d{2}\s*(AM|PM)/i, ':$1 $2') : 'Draft'}
                  </span>
                </div>
              )}

              {/* Action Buttons: One-Tap Conclusion & Set Active */}
              <div className="mt-3 pt-2.5 border-t border-slate-100 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => onOpenConclusion(farm.id)}
                  className="flex-1 bg-amber-50 hover:bg-amber-100 border border-amber-200 text-amber-800 font-bold py-2 rounded-xl text-xs flex items-center justify-center gap-1.5 active:scale-95 transition cursor-pointer"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5 text-amber-600" />
                  <span>One-Tap Conclusion (Cons)</span>
                </button>
                <button
                  type="button"
                  onClick={() => onSelectFarm(farm.id)}
                  className={`px-3 py-2 rounded-xl text-xs font-bold transition active:scale-95 cursor-pointer ${
                    activeFarmId === farm.id
                      ? 'bg-slate-200 text-slate-800'
                      : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                  }`}
                >
                  {activeFarmId === farm.id ? 'Active Unit' : 'Select'}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* ========================================================= */}
      {/* MODAL: FARM ACCESS ASSIGNMENT HUB                         */}
      {/* ========================================================= */}
      {assigningFarmId && targetFarmForAssign && (
        <div 
          className="fixed inset-0 bg-black/60 backdrop-blur-xs z-50 flex items-center justify-center p-4 animate-in fade-in duration-150"
          role="dialog"
          aria-modal="true"
        >
          <div className="bg-slate-900 border border-slate-700 text-slate-100 rounded-2xl w-full max-w-md p-5 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between pb-2 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <div className="p-2 bg-sky-500/20 text-sky-400 rounded-xl border border-sky-500/30">
                  <Users className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-black text-sm text-white">
                    Farm Assignment Hub
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    Bind field operators to {targetFarmForAssign.name}
                  </p>
                </div>
              </div>
              <button 
                onClick={() => setAssigningFarmId(null)}
                className="text-slate-400 hover:text-white p-1 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Currently Assigned List */}
            <div>
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5">
                Bound Supervisors & Incharges ({tempAssignedUsers.length})
              </label>
              {tempAssignedUsers.length === 0 ? (
                <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 text-center text-xs text-slate-500">
                  No operators currently assigned. Add one below.
                </div>
              ) : (
                <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
                  {tempAssignedUsers.map((userName) => (
                    <div 
                      key={userName}
                      className="flex items-center justify-between bg-slate-950 px-3 py-1.5 rounded-xl border border-slate-800 text-xs"
                    >
                      <span className="font-bold text-slate-200">{userName}</span>
                      <button
                        type="button"
                        onClick={() => handleRemoveUserFromAssign(userName)}
                        className="text-slate-400 hover:text-rose-400 p-1"
                        title="Remove assignment"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Add Custom User Input */}
            <div>
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                Add Field Operator by Name
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newUserInput}
                  onChange={(e) => setNewUserInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddUserToAssign(); } }}
                  placeholder="e.g. Ramesh (Supervisor)"
                  className="flex-1 bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-sky-500"
                />
                <button
                  type="button"
                  onClick={handleAddUserToAssign}
                  className="bg-sky-600 hover:bg-sky-500 text-white font-black px-3 py-2 rounded-xl text-xs active:scale-95 transition cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Suggested Presets */}
            <div>
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5">
                Quick Presets:
              </span>
              <div className="flex flex-wrap gap-1.5">
                {suggestedOperators.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => {
                      if (!tempAssignedUsers.includes(preset)) {
                        setTempAssignedUsers([...tempAssignedUsers, preset]);
                      }
                    }}
                    disabled={tempAssignedUsers.includes(preset)}
                    className={`text-[10px] px-2 py-1 rounded-lg border transition ${
                      tempAssignedUsers.includes(preset)
                        ? 'bg-slate-800 text-slate-500 border-slate-700 cursor-default'
                        : 'bg-slate-950 text-slate-300 border-slate-800 hover:border-sky-500/60 cursor-pointer'
                    }`}
                  >
                    + {preset}
                  </button>
                ))}
              </div>
            </div>

            {/* Save / Cancel Buttons */}
            <div className="flex gap-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setAssigningFarmId(null)}
                className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold py-2.5 rounded-xl text-xs transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveAssignments}
                className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-black py-2.5 rounded-xl text-xs shadow-md transition cursor-pointer"
              >
                Save Assignments
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
