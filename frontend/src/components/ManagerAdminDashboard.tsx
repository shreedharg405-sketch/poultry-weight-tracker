import React, { useState, useEffect } from 'react';
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
  Cloud,
  Key,
  Lock,
  AlertCircle,
  Loader2,
  UserCheck,
  UserX
} from 'lucide-react';
import { FarmSummary, AppUser, UserRole, cloudApi } from '../services/cloudSyncService';

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

  // User Account Management State (Admin Only - Req 5)
  const [showUserMgmtModal, setShowUserMgmtModal] = useState(false);
  const [systemUsers, setSystemUsers] = useState<AppUser[]>([]);
  const [isLoadingUsers, setIsLoadingUsers] = useState(false);
  const [userMgmtFeedback, setUserMgmtFeedback] = useState<string | null>(null);

  // Create User Form State
  const [showCreateUser, setShowCreateUser] = useState(false);
  const [createUsername, setCreateUsername] = useState('');
  const [createName, setCreateName] = useState('');
  const [createPassword, setCreatePassword] = useState('');
  const [createRole, setCreateRole] = useState<UserRole>('Supervisor');
  const [createAssignedFarms, setCreateAssignedFarms] = useState<string[]>([]);
  const [isSubmittingUser, setIsSubmittingUser] = useState(false);

  // Reset Password State
  const [resetTargetUser, setResetTargetUser] = useState<AppUser | null>(null);
  const [resetPasswordInput, setResetPasswordInput] = useState('');

  const loadSystemUsers = async () => {
    setIsLoadingUsers(true);
    try {
      const users = await cloudApi.getUsers();
      setSystemUsers(users);
    } catch (err: any) {
      console.warn('Failed to load system users:', err);
    } finally {
      setIsLoadingUsers(false);
    }
  };

  const handleOpenUserManagement = () => {
    setShowUserMgmtModal(true);
    setUserMgmtFeedback(null);
    loadSystemUsers();
  };

  const handleCreateUserSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!createUsername.trim() || !createName.trim() || !createPassword.trim()) {
      alert('Please fill out all required fields.');
      return;
    }
    setIsSubmittingUser(true);
    try {
      await cloudApi.createUser({
        username: createUsername.trim().toLowerCase(),
        name: createName.trim(),
        password: createPassword.trim(),
        role: createRole,
        assignedFarms: createAssignedFarms,
      });
      setUserMgmtFeedback(`User @${createUsername} created successfully!`);
      setShowCreateUser(false);
      setCreateUsername('');
      setCreateName('');
      setCreatePassword('');
      setCreateRole('Supervisor');
      setCreateAssignedFarms([]);
      await loadSystemUsers();
    } catch (err: any) {
      alert(err.message || 'Failed to create user account');
    } finally {
      setIsSubmittingUser(false);
    }
  };

  const handleToggleUserStatus = async (user: AppUser) => {
    const newStatus = user.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
    try {
      await cloudApi.updateUser(user.id, { status: newStatus });
      setUserMgmtFeedback(`Updated status for @${user.username} to ${newStatus}`);
      await loadSystemUsers();
    } catch (err: any) {
      alert(err.message || 'Failed to update user status');
    }
  };

  const handleResetPasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetTargetUser || !resetPasswordInput.trim()) return;
    try {
      await cloudApi.resetUserPassword(resetTargetUser.id, resetPasswordInput.trim());
      setUserMgmtFeedback(`Password reset for @${resetTargetUser.username}`);
      setResetTargetUser(null);
      setResetPasswordInput('');
    } catch (err: any) {
      alert(err.message || 'Failed to reset password');
    }
  };

  const handleDeleteUser = async (user: AppUser) => {
    if (user.role === 'Admin' && systemUsers.filter(u => u.role === 'Admin').length <= 1) {
      alert('Cannot delete the sole Administrator account.');
      return;
    }
    if (!confirm(`Are you sure you want to permanently delete user @${user.username} (${user.name})?`)) {
      return;
    }
    try {
      await cloudApi.deleteUser(user.id);
      setUserMgmtFeedback(`Deleted user @${user.username}`);
      await loadSystemUsers();
    } catch (err: any) {
      alert(err.message || 'Failed to delete user');
    }
  };

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
    <div className="flex-1 flex flex-col p-3 sm:p-4 md:p-6 lg:p-8 animate-in fade-in duration-150">
      {/* Top Header: Session & Role Bar */}
      <div className="flex items-center justify-between mb-4 px-1">
        <div 
          onClick={onOpenAuth}
          className="flex items-center gap-2.5 cursor-pointer hover:opacity-90 transition bg-white px-3 py-2 rounded-xl border border-slate-200/90 shadow-2xs"
          title="View Session Details"
        >
          <div className={`w-8 h-8 rounded-lg text-white flex items-center justify-center font-black text-xs shadow-xs ${
            isAdmin ? 'bg-purple-600' : 'bg-sky-600'
          }`}>
            {userDisplayName.charAt(0).toUpperCase()}
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-black text-slate-900 block leading-tight truncate max-w-[130px] sm:max-w-[200px]">
                {userDisplayName}
              </span>
              {currentUser?.username && (
                <span className="text-[10px] text-slate-400 font-mono hidden sm:inline">
                  @{currentUser.username}
                </span>
              )}
            </div>
            <span className={`text-[9px] font-bold px-1.5 py-0.2 rounded leading-tight inline-block border mt-0.5 ${
              isAdmin ? 'bg-purple-50 text-purple-700 border-purple-200' : 'bg-sky-50 text-sky-700 border-sky-200'
            }`}>
              {userRole}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={onViewSubmissionsUpdate}
            className="flex items-center gap-1.5 text-xs font-bold text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 px-3 py-2 rounded-xl active:scale-95 transition cursor-pointer shadow-2xs"
          >
            <Radio className="w-3.5 h-3.5 text-emerald-600 animate-pulse" />
            <span>Submissions Update</span>
          </button>

          {isAdmin ? (
            <button
              onClick={onOpenSetup}
              className="flex items-center gap-1.5 p-2 md:px-3 text-slate-600 hover:text-purple-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-xl transition cursor-pointer shadow-2xs"
              title="Cloud Integration Settings (Admin)"
            >
              <Settings className="w-4 h-4 text-purple-600" />
              <span className="hidden md:inline text-xs font-bold">Cloud Settings</span>
            </button>
          ) : (
            <button
              onClick={onOpenSetup}
              className="flex items-center gap-1.5 p-2 md:px-3 text-slate-500 hover:text-sky-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-xl transition cursor-pointer shadow-2xs"
              title="Cloud Connection (Read-Only Manager)"
            >
              <Cloud className="w-4 h-4 text-sky-600" />
              <span className="hidden md:inline text-xs font-bold">Cloud Link</span>
            </button>
          )}

          <button
            onClick={onLogout}
            className="flex items-center gap-1.5 p-2 md:px-3 text-rose-600 hover:text-rose-700 bg-white hover:bg-rose-50 border border-rose-200 rounded-xl transition cursor-pointer shadow-2xs"
            title="Log Out Session"
          >
            <LogOut className="w-4 h-4" />
            <span className="hidden md:inline text-xs font-bold">Log Out</span>
          </button>
        </div>
      </div>

      {/* Role Banner */}
      <div className={`text-white p-4 md:p-6 rounded-2xl md:rounded-3xl border mb-4 md:mb-6 shadow-md ${
        isAdmin 
          ? 'bg-gradient-to-r from-purple-950 via-slate-900 to-indigo-950 border-purple-700/60' 
          : 'bg-gradient-to-r from-sky-950 via-slate-900 to-indigo-950 border-sky-700/60'
      }`}>
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] md:text-xs font-black uppercase tracking-wider text-purple-300 block">
                {isAdmin ? 'System Administrator Suite' : 'Supervisory Management Suite'}
              </span>
              <span className="hidden md:inline-block w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
              <span className="hidden md:inline-block text-[10px] text-slate-300 font-medium">
                Live PostgreSQL Multi-Device Sync
              </span>
            </div>
            <h2 className="text-base sm:text-lg md:text-2xl font-black text-white mt-1">
              {isAdmin ? 'Admin Master Control Center' : 'Manager Operations Portal'}
            </h2>
            <p className="text-xs text-slate-300 mt-0.5 hidden sm:block">
              {isAdmin 
                ? 'Manage enterprise farm units, provision user credentials, enforce field operator assignments, and review flock metrics.'
                : 'Monitor real-time flock drafts, inspect weighing conclusions, and manage field operator assignments across farm units.'}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {isAdmin && (
              <button
                type="button"
                onClick={handleOpenUserManagement}
                className="bg-purple-600 hover:bg-purple-500 text-white font-black text-xs px-3.5 py-2.5 rounded-xl flex items-center gap-1.5 active:scale-95 transition cursor-pointer shadow-lg shadow-purple-950/40 border border-purple-400/40"
              >
                <Users className="w-4 h-4" />
                <span>User Accounts ({systemUsers.length > 0 ? systemUsers.length : 'Manage'})</span>
              </button>
            )}
            <button
              onClick={onNewFarm}
              className="bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs px-3.5 py-2.5 rounded-xl flex items-center gap-1.5 active:scale-95 transition cursor-pointer shadow-lg shadow-emerald-950/40 border border-emerald-400/40"
            >
              <Plus className="w-4 h-4" />
              <span>Create New Farm</span>
            </button>
          </div>
        </div>
      </div>

      {/* Overview Stats Strip (Responsive 2 to 6 columns for PC widescreen) */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2.5 sm:gap-3 md:gap-4 mb-4 md:mb-6">
        <div className="bg-white p-3 md:p-4 rounded-2xl border border-slate-200 text-center shadow-xs hover:border-slate-300 transition">
          <span className="text-[10px] uppercase font-bold text-slate-400 block">Total Units</span>
          <span className="text-lg md:text-2xl font-black text-slate-900 font-mono mt-0.5">{farms.length}</span>
        </div>
        <div className="bg-white p-3 md:p-4 rounded-2xl border border-slate-200 text-center shadow-xs hover:border-slate-300 transition">
          <span className="text-[10px] uppercase font-bold text-slate-400 block">In Draft</span>
          <span className="text-lg md:text-2xl font-black text-amber-600 font-mono mt-0.5">
            {farms.filter(f => f.status === 'DRAFT').length}
          </span>
        </div>
        <div className="bg-white p-3 md:p-4 rounded-2xl border border-slate-200 text-center shadow-xs hover:border-slate-300 transition">
          <span className="text-[10px] uppercase font-bold text-slate-400 block">Submitted</span>
          <span className="text-lg md:text-2xl font-black text-emerald-600 font-mono mt-0.5">
            {farms.filter(f => f.status === 'COMPLETED').length}
          </span>
        </div>
        <div className="bg-white p-3 md:p-4 rounded-2xl border border-slate-200 text-center shadow-xs hover:border-slate-300 transition">
          <span className="text-[10px] uppercase font-bold text-slate-400 block">Total Sheds</span>
          <span className="text-lg md:text-2xl font-black text-sky-600 font-mono mt-0.5">
            {farms.reduce((acc, f) => acc + (f._count?.sheds || 10), 0)}
          </span>
        </div>
        <div className="bg-white p-3 md:p-4 rounded-2xl border border-slate-200 text-center shadow-xs hover:border-slate-300 transition">
          <span className="text-[10px] uppercase font-bold text-slate-400 block">Active Unit</span>
          <span className="text-xs md:text-sm font-black text-purple-700 truncate block mt-1">
            {farms.find(f => f.id === activeFarmId)?.name || 'None'}
          </span>
        </div>
        <div className="bg-white p-3 md:p-4 rounded-2xl border border-slate-200 text-center shadow-xs hover:border-slate-300 transition">
          <span className="text-[10px] uppercase font-bold text-slate-400 block">Sync Health</span>
          <span className="text-xs md:text-sm font-black text-emerald-600 block mt-1 flex items-center justify-center gap-1">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
            Online
          </span>
        </div>
      </div>

      {/* Master Farm Roster Header */}
      <div className="flex items-center justify-between px-1 mb-3">
        <div className="flex items-center gap-2">
          <h3 className="text-xs sm:text-sm font-black uppercase tracking-wider text-slate-700">
            Master Farm Roster ({farms.length} Units)
          </h3>
          <span className="hidden sm:inline-block text-[11px] text-slate-400 font-medium">
            • Multi-unit grid view adapted for desktop screens
          </span>
        </div>
        <span className="text-xs text-slate-500 font-medium">
          Select unit for One-Tap Conclusion
        </span>
      </div>

      {/* Master Farm Roster List (Responsive grid: 1 col on mobile, 2 on tablet, 3 on PC desktop) */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5 sm:gap-4 md:gap-5 overflow-y-auto flex-1 pb-6">
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
      {/* ========================================================= */}
      {/* MODAL: USER ACCOUNT MANAGEMENT HUB (Admin Only - Req 5)   */}
      {/* ========================================================= */}
      {showUserMgmtModal && (
        <div 
          className="fixed inset-0 bg-black/70 backdrop-blur-xs z-50 flex items-center justify-center p-3 animate-in fade-in duration-150"
          role="dialog"
          aria-modal="true"
        >
          <div className="bg-slate-900 border border-slate-700 text-slate-100 rounded-2xl w-full max-w-lg md:max-w-4xl p-5 md:p-6 space-y-4 shadow-2xl max-h-[90vh] flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between pb-3 border-b border-slate-800 shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="p-2.5 bg-purple-500/20 text-purple-400 rounded-xl border border-purple-500/30">
                  <Users className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-black text-sm md:text-base text-white">
                    User Account Management Hub
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    Create, activate, reset credentials & assign farms across the system
                  </p>
                </div>
              </div>
              <button 
                onClick={() => setShowUserMgmtModal(false)}
                className="text-slate-400 hover:text-white p-1 rounded-lg transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Feedback notification banner */}
            {userMgmtFeedback && (
              <div className="bg-emerald-500/10 border border-emerald-500/40 text-emerald-300 text-xs p-2.5 rounded-xl flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>{userMgmtFeedback}</span>
              </div>
            )}

            {/* Actions Bar */}
            <div className="flex items-center justify-between shrink-0">
              <span className="text-xs text-slate-400 font-bold">
                Total System Accounts: <strong className="text-white font-mono">{systemUsers.length}</strong>
              </span>
              <button
                type="button"
                onClick={() => {
                  setShowCreateUser(true);
                  setUserMgmtFeedback(null);
                }}
                className="bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs px-3.5 py-2 rounded-xl flex items-center gap-1.5 shadow-md active:scale-95 transition cursor-pointer"
              >
                <UserPlus className="w-4 h-4" />
                <span>Create New User</span>
              </button>
            </div>

            {/* User List in Responsive Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 overflow-y-auto flex-1 pr-1">
              {isLoadingUsers ? (
                <div className="col-span-full py-12 text-center text-xs text-slate-400 flex items-center justify-center gap-2">
                  <Loader2 className="w-5 h-5 animate-spin text-purple-400" />
                  <span>Loading user accounts...</span>
                </div>
              ) : systemUsers.length === 0 ? (
                <div className="col-span-full py-8 text-center text-xs text-slate-400 bg-slate-950 rounded-xl border border-slate-800">
                  No accounts found. Tap "Create New User" to provision one.
                </div>
              ) : (
                systemUsers.map((user) => {
                  const isUserActive = user.status !== 'INACTIVE';
                  const roleColor = 
                    user.role === 'Admin' ? 'bg-purple-500/20 text-purple-300 border-purple-500/40' :
                    user.role === 'Manager' ? 'bg-sky-500/20 text-sky-300 border-sky-500/40' :
                    user.role === 'In-Charge' ? 'bg-teal-500/20 text-teal-300 border-teal-500/40' :
                    'bg-emerald-500/20 text-emerald-300 border-emerald-500/40';

                  return (
                    <div
                      key={user.id}
                      className={`p-3 rounded-xl border transition ${
                        isUserActive 
                          ? 'bg-slate-950 border-slate-800 hover:border-slate-700' 
                          : 'bg-slate-950/60 border-rose-900/40 opacity-75'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-black text-xs text-white truncate">
                              {user.name}
                            </span>
                            <span className="text-[10px] text-slate-400 font-mono">
                              @{user.username}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 mt-1.5">
                            <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full border ${roleColor}`}>
                              {user.role}
                            </span>
                            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${
                              isUserActive 
                                ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30' 
                                : 'bg-rose-500/10 text-rose-400 border border-rose-500/30'
                            }`}>
                              {isUserActive ? '🟢 Active' : '🔴 Inactive'}
                            </span>
                          </div>
                        </div>

                        {/* Actions for User */}
                        <div className="flex items-center gap-1 shrink-0">
                          {/* Toggle Active Status */}
                          <button
                            type="button"
                            onClick={() => handleToggleUserStatus(user)}
                            className={`p-1.5 rounded-lg border transition cursor-pointer ${
                              isUserActive 
                                ? 'bg-slate-800 text-slate-300 hover:text-rose-400 border-slate-700' 
                                : 'bg-emerald-950 text-emerald-400 border-emerald-800'
                            }`}
                            title={isUserActive ? "Deactivate account" : "Activate account"}
                          >
                            {isUserActive ? <UserX className="w-3.5 h-3.5" /> : <UserCheck className="w-3.5 h-3.5" />}
                          </button>

                          {/* Reset Password */}
                          <button
                            type="button"
                            onClick={() => {
                              setResetTargetUser(user);
                              setResetPasswordInput('');
                            }}
                            className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-amber-400 rounded-lg border border-slate-700 transition cursor-pointer"
                            title="Reset password"
                          >
                            <Key className="w-3.5 h-3.5" />
                          </button>

                          {/* Delete User */}
                          <button
                            type="button"
                            onClick={() => handleDeleteUser(user)}
                            className="p-1.5 bg-slate-800 hover:bg-rose-950 text-slate-400 hover:text-rose-400 rounded-lg border border-slate-700 transition cursor-pointer"
                            title="Delete user"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      {/* Bound Farms info */}
                      <div className="mt-2 pt-2 border-t border-slate-900 text-[10px] text-slate-400 flex items-center justify-between">
                        <span>Assigned Units:</span>
                        <span className="font-mono text-slate-300">
                          {user.assignedFarms && user.assignedFarms.includes('*') 
                            ? 'All Farms Authorized' 
                            : user.assignedFarms && user.assignedFarms.length > 0 
                              ? `${user.assignedFarms.length} Farms Bound` 
                              : 'None Bound'}
                        </span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Footer */}
            <div className="pt-2 border-t border-slate-800 shrink-0">
              <button
                type="button"
                onClick={() => setShowUserMgmtModal(false)}
                className="w-full bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold py-2.5 rounded-xl text-xs transition cursor-pointer"
              >
                Close Hub
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* MODAL: CREATE NEW USER ACCOUNT (Admin Only - Req 5)       */}
      {/* ========================================================= */}
      {showCreateUser && (
        <div 
          className="fixed inset-0 bg-black/80 backdrop-blur-xs z-55 flex items-center justify-center p-3 animate-in zoom-in-95 duration-150"
          role="dialog"
          aria-modal="true"
        >
          <form 
            onSubmit={handleCreateUserSubmit}
            className="bg-slate-900 border border-slate-700 text-slate-100 rounded-2xl w-full max-w-md p-5 space-y-3.5 shadow-2xl"
          >
            <div className="flex items-center justify-between pb-2 border-b border-slate-800">
              <h3 className="font-black text-sm text-white flex items-center gap-1.5">
                <UserPlus className="w-4 h-4 text-emerald-400" />
                <span>Create New User Account</span>
              </h3>
              <button 
                type="button"
                onClick={() => setShowCreateUser(false)}
                className="text-slate-400 hover:text-white p-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div>
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                Username (for sign in)
              </label>
              <input
                type="text"
                value={createUsername}
                onChange={(e) => setCreateUsername(e.target.value)}
                placeholder="e.g. suresh.kumar"
                required
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500 font-mono"
              />
            </div>

            <div>
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                Full Name
              </label>
              <input
                type="text"
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                placeholder="e.g. Suresh Kumar"
                required
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500 font-bold"
              />
            </div>

            <div>
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                Assigned Role
              </label>
              <select
                value={createRole}
                onChange={(e) => setCreateRole(e.target.value as UserRole)}
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white font-bold focus:outline-none focus:border-emerald-500 cursor-pointer"
              >
                <option value="Admin">Admin (Executive Master Dashboard & All Privileges)</option>
                <option value="Manager">Manager (Executive Master Dashboard & Farm Assignments)</option>
                <option value="Supervisor">Supervisor (Field Weighing & Draft Submissions)</option>
                <option value="In-Charge">In-Charge (Field Weighing & Draft Submissions)</option>
              </select>
            </div>

            <div>
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                Initial Password
              </label>
              <input
                type="password"
                value={createPassword}
                onChange={(e) => setCreatePassword(e.target.value)}
                placeholder="••••••••••••"
                required
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500 font-mono"
              />
            </div>

            {/* Farm Access Assignment checkboxes */}
            <div>
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                Assign Farm Units ({createAssignedFarms.length} Selected)
              </label>
              <div className="bg-slate-950 border border-slate-800 rounded-xl p-2 max-h-28 overflow-y-auto space-y-1">
                {farms.map((farm) => {
                  const isChecked = createAssignedFarms.includes(farm.name) || createAssignedFarms.includes(farm.id);
                  return (
                    <label key={farm.id} className="flex items-center gap-2 text-xs text-slate-300 hover:text-white cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setCreateAssignedFarms([...createAssignedFarms, farm.name, farm.id]);
                          } else {
                            setCreateAssignedFarms(createAssignedFarms.filter(f => f !== farm.name && f !== farm.id));
                          }
                        }}
                        className="rounded border-slate-700 text-emerald-600 focus:ring-emerald-500"
                      />
                      <span>{farm.name}</span>
                    </label>
                  );
                })}
              </div>
            </div>

            <div className="flex gap-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setShowCreateUser(false)}
                className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold py-2 rounded-xl text-xs transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmittingUser}
                className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-black py-2 rounded-xl text-xs transition cursor-pointer shadow-md"
              >
                {isSubmittingUser ? 'Creating...' : 'Save User'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ========================================================= */}
      {/* MODAL: RESET PASSWORD DIALOG (Admin Only - Req 5)         */}
      {/* ========================================================= */}
      {resetTargetUser && (
        <div 
          className="fixed inset-0 bg-black/80 backdrop-blur-xs z-60 flex items-center justify-center p-4 animate-in zoom-in-95 duration-150"
          role="dialog"
          aria-modal="true"
        >
          <form 
            onSubmit={handleResetPasswordSubmit}
            className="bg-slate-900 border border-slate-700 text-slate-100 rounded-2xl w-full max-w-sm p-5 space-y-3 shadow-2xl"
          >
            <div className="flex items-center gap-2 pb-2 border-b border-slate-800">
              <Key className="w-5 h-5 text-amber-400" />
              <div>
                <h3 className="font-black text-sm text-white">Reset User Password</h3>
                <p className="text-[11px] text-slate-400">Account: @{resetTargetUser.username} ({resetTargetUser.name})</p>
              </div>
            </div>

            <div>
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                Enter New Password
              </label>
              <input
                type="password"
                value={resetPasswordInput}
                onChange={(e) => setResetPasswordInput(e.target.value)}
                placeholder="Minimum 4 characters..."
                required
                autoFocus
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-500 font-mono"
              />
            </div>

            <div className="flex gap-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setResetTargetUser(null)}
                className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold py-2 rounded-xl text-xs cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="flex-1 bg-amber-600 hover:bg-amber-500 text-white font-black py-2 rounded-xl text-xs shadow-md cursor-pointer"
              >
                Reset Password
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

