import React, { useState } from 'react';
import { User, Lock, Eye, EyeOff, Loader2, AlertCircle, ShieldCheck, KeyRound, CheckCircle2, ArrowLeft, RotateCw } from 'lucide-react';
import { cloudApi, AppUser } from '../services/cloudSyncService';
import roosterLogo from '../assets/rooster-logo.jpg';

export interface LoginScreenProps {
  onLoginSuccess: (user: AppUser, token: string) => void;
  onCancel?: () => void;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({ onLoginSuccess, onCancel }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isShaking, setIsShaking] = useState(false);

  // First Login Password Change State
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [pendingAuth, setPendingAuth] = useState<{ user: AppUser; token: string; initialPassword?: string } | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [changePwError, setChangePwError] = useState<string | null>(null);
  const [isSubmittingNewPw, setIsSubmittingNewPw] = useState(false);

  const triggerShake = () => {
    setIsShaking(true);
    setTimeout(() => setIsShaking(false), 450);
  };

  const executeLogin = async (targetUsername: string, targetPassword: string) => {
    setError(null);
    setIsLoading(true);
    try {
      const response = await cloudApi.login({ username: targetUsername.trim(), password: targetPassword });
      
      // If backend flags that this account requires first-login password change:
      if (response.requiresPasswordChange) {
        setPendingAuth({ user: response.user, token: response.token, initialPassword: targetPassword });
        setIsChangingPassword(true);
        setNewPassword('');
        setConfirmPassword('');
        setChangePwError(null);
        return;
      }

      onLoginSuccess(response.user, response.token);
    } catch (err: any) {
      setError(err.message || 'Invalid employee code/username or password.');
      triggerShake();
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedUsername = username.trim();
    if (!trimmedUsername) {
      setError('Please enter your Employee Code or username.');
      triggerShake();
      return;
    }
    if (!password) {
      setError('Please enter your password.');
      triggerShake();
      return;
    }
    await executeLogin(trimmedUsername, password);
  };

  const handleChangePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setChangePwError(null);

    const cleanNew = newPassword.trim();
    const cleanConfirm = confirmPassword.trim();

    if (!cleanNew) {
      setChangePwError('Please enter your new password.');
      return;
    }
    if (cleanNew.length < 6) {
      setChangePwError('New password must be at least 6 characters long.');
      return;
    }
    if (cleanNew !== cleanConfirm) {
      setChangePwError('Passwords do not match. Please re-enter to confirm.');
      return;
    }
    if (pendingAuth?.initialPassword && cleanNew === pendingAuth.initialPassword.trim()) {
      setChangePwError('New password cannot be the same as your temporary initial password.');
      return;
    }

    if (!pendingAuth?.token) {
      setChangePwError('Session expired. Please log in again.');
      return;
    }

    setIsSubmittingNewPw(true);
    try {
      const updated = await cloudApi.changePassword(cleanNew, pendingAuth.token);
      onLoginSuccess(updated.user, updated.token);
    } catch (err: any) {
      setChangePwError(err.message || 'Failed to update password. Please try again.');
    } finally {
      setIsSubmittingNewPw(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col justify-center items-center py-6 sm:py-10 select-none min-h-[85vh] w-full relative">
      {/* Header Icon Button: Top-Right Application Reload */}
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="absolute top-2.5 right-2.5 sm:top-4 sm:right-4 p-2 sm:p-2.5 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100/80 active:bg-slate-200 transition-all cursor-pointer focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
        title="Reload Application"
        aria-label="Reload Application"
      >
        <RotateCw className="w-4 h-4 sm:w-5 sm:h-5" />
      </button>

      <div className="w-full max-w-md mx-auto">
        {/* Brand Header */}
        <div className="text-center mb-6">
          <div className="flex justify-center mb-3">
            <img 
              src={roosterLogo} 
              alt="Poultry Flock Pro" 
              className="w-16 h-16 sm:w-20 sm:h-20 object-contain mix-blend-multiply pointer-events-none select-none transition-transform duration-300 hover:scale-105"
            />
          </div>
          <h1 className="text-xl sm:text-2xl font-black text-slate-900 tracking-wider uppercase font-sans">
            POULTRY FLOCK PRO
          </h1>
          <p className="text-[11px] sm:text-xs font-bold text-emerald-700 uppercase tracking-wider sm:tracking-widest mt-1">
            Authorized Field & Executive Portal
          </p>
        </div>

        {/* ========================================================================= */}
        {/* VIEW A: Standard Sign In Card (Light Themed)                             */}
        {/* ========================================================================= */}
        {!isChangingPassword ? (
          <form
            onSubmit={handleLogin}
            className={`p-5 sm:p-7 bg-white rounded-3xl border shadow-xl shadow-slate-200/60 transition-all duration-200 w-full ${
              isShaking 
                ? 'animate-shake border-rose-400 ring-2 ring-rose-200 shadow-rose-100' 
                : 'border-slate-200/90'
            }`}
          >
            <div className="flex items-center gap-3 pb-3.5 mb-5 border-b border-slate-100 min-w-0">
              <div className="w-10 h-10 rounded-2xl bg-emerald-50 border border-emerald-100 text-emerald-600 flex items-center justify-center shrink-0">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="text-sm font-bold text-slate-900 truncate">Sign In to Workspace</h2>
                <p className="text-xs text-slate-500 leading-tight">Enter your credentials to open your dashboard</p>
              </div>
            </div>

            {/* Error Alert Banner */}
            {error && (
              <div 
                role="alert"
                className="mb-4 bg-rose-50 border border-rose-200 text-rose-700 text-xs p-3 rounded-2xl flex items-center gap-2.5 animate-in fade-in duration-150"
              >
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
                <span className="font-semibold text-xs leading-tight">{error}</span>
              </div>
            )}

            {/* Field 1: Username / Employee Code */}
            <div className="mb-4">
              <label 
                htmlFor="login-username"
                className="text-xs font-bold text-slate-700 uppercase tracking-wider block mb-1.5 flex items-center gap-1.5"
              >
                <User className="w-3.5 h-3.5 text-slate-500" />
                <span>Employee Code / Username</span>
              </label>
              <div className="relative">
                <input
                  id="login-username"
                  type="text"
                  value={username}
                  onChange={(e) => { setUsername(e.target.value); setError(null); }}
                  placeholder="e.g. EMP0001 or username..."
                  required
                  autoFocus
                  autoCapitalize="characters"
                  autoCorrect="off"
                  className="w-full bg-slate-50/80 hover:bg-slate-50 focus:bg-white border border-slate-200/90 rounded-2xl px-3.5 py-3 text-xs sm:text-sm text-slate-900 font-semibold focus:outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-500/20 transition-all duration-150 placeholder:text-slate-400"
                />
              </div>
              <span className="text-[10px] text-slate-400 mt-1 block font-medium">
                Supervisors and In-Charges can sign in with their EMP code (e.g. EMP0001)
              </span>
            </div>

            {/* Field 2: Password with Show/Hide toggle */}
            <div className="mb-5">
              <label 
                htmlFor="login-password"
                className="text-xs font-bold text-slate-700 uppercase tracking-wider block mb-1.5 flex items-center gap-1.5"
              >
                <Lock className="w-3.5 h-3.5 text-slate-500" />
                <span>Password</span>
              </label>
              <div className="relative">
                <input
                  id="login-password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); setError(null); }}
                  placeholder="••••••••••••"
                  required
                  autoComplete="current-password"
                  className="w-full bg-slate-50/80 hover:bg-slate-50 focus:bg-white border border-slate-200/90 rounded-2xl pl-3.5 pr-11 py-3 text-xs sm:text-sm text-slate-900 font-mono focus:outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-500/20 transition-all duration-150 placeholder:text-slate-400"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1.5 rounded-lg text-slate-400 hover:text-emerald-700 hover:bg-slate-100 transition cursor-pointer"
                  title={showPassword ? "Hide password" : "Show password"}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? (
                    <EyeOff className="w-4 h-4" />
                  ) : (
                    <Eye className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>

            {/* Login Button */}
            <button
              type="submit"
              disabled={isLoading}
              className="w-full bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 active:scale-[0.99] disabled:opacity-60 text-white font-bold py-3.5 rounded-2xl text-xs sm:text-sm flex items-center justify-center gap-2 shadow-md shadow-emerald-700/20 transition-all duration-200 cursor-pointer"
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin text-white" />
                  <span>Verifying Credentials...</span>
                </>
              ) : (
                <span>Sign In to Dashboard</span>
              )}
            </button>

            {onCancel && (
              <button
                type="button"
                onClick={onCancel}
                disabled={isLoading}
                className="w-full mt-2.5 bg-slate-100 hover:bg-slate-200 active:scale-[0.99] text-slate-700 font-bold py-2.5 rounded-2xl text-xs flex items-center justify-center transition cursor-pointer"
              >
                Cancel
              </button>
            )}

            {/* Operational Security Note */}
            <p className="mt-4 text-[11px] text-slate-400 text-center font-medium">
              Secure Role-Based Authentication
            </p>
          </form>
        ) : (
          /* ========================================================================= */
          /* VIEW B: First-Login Password Change Screen (Mandatory)                    */
          /* ========================================================================= */
          <form
            onSubmit={handleChangePasswordSubmit}
            className="p-5 sm:p-7 bg-white rounded-3xl border border-slate-200/90 shadow-xl shadow-slate-200/60 w-full animate-in fade-in zoom-in-95 duration-200"
          >
            <div className="flex items-center gap-3 pb-3.5 mb-5 border-b border-slate-100 min-w-0">
              <div className="w-10 h-10 rounded-2xl bg-amber-50 border border-amber-200 text-amber-600 flex items-center justify-center shrink-0">
                <KeyRound className="w-5 h-5" />
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="text-sm font-bold text-slate-900 truncate">First Login — Set New Password</h2>
                <p className="text-xs text-slate-500 leading-tight">
                  Welcome, <strong className="text-slate-800">{pendingAuth?.user?.name}</strong> ({pendingAuth?.user?.employeeCode || pendingAuth?.user?.username})
                </p>
              </div>
            </div>

            {/* Explanatory Banner */}
            <div className="mb-4 bg-amber-50/80 border border-amber-200 rounded-2xl p-3 text-xs text-amber-900 flex items-start gap-2">
              <ShieldCheck className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <div className="leading-relaxed">
                <p className="font-bold">Temporary Initial Password Detected</p>
                <p className="text-[11px] text-amber-800 mt-0.5">
                  Your account was activated with a temporary phone-derived password. For security, you must set a permanent private password (min 6 characters) before accessing your assigned farms.
                </p>
              </div>
            </div>

            {/* Change Password Error Alert */}
            {changePwError && (
              <div 
                role="alert"
                className="mb-4 bg-rose-50 border border-rose-200 text-rose-700 text-xs p-3 rounded-2xl flex items-center gap-2.5 animate-in fade-in duration-150"
              >
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
                <span className="font-semibold text-xs leading-tight">{changePwError}</span>
              </div>
            )}

            {/* New Password Field */}
            <div className="mb-4">
              <label 
                htmlFor="new-password"
                className="text-xs font-bold text-slate-700 uppercase tracking-wider block mb-1.5 flex items-center gap-1.5"
              >
                <Lock className="w-3.5 h-3.5 text-slate-500" />
                <span>New Password (min 6 characters)</span>
              </label>
              <div className="relative">
                <input
                  id="new-password"
                  type={showNewPassword ? 'text' : 'password'}
                  value={newPassword}
                  onChange={(e) => { setNewPassword(e.target.value); setChangePwError(null); }}
                  placeholder="Enter your new private password..."
                  required
                  autoFocus
                  autoComplete="new-password"
                  className="w-full bg-slate-50/80 hover:bg-slate-50 focus:bg-white border border-slate-200/90 rounded-2xl pl-3.5 pr-11 py-3 text-xs sm:text-sm text-slate-900 font-mono focus:outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-500/20 transition-all duration-150 placeholder:text-slate-400"
                />
                <button
                  type="button"
                  onClick={() => setShowNewPassword(!showNewPassword)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1.5 rounded-lg text-slate-400 hover:text-emerald-700 hover:bg-slate-100 transition cursor-pointer"
                  title={showNewPassword ? "Hide password" : "Show password"}
                >
                  {showNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Confirm Password Field */}
            <div className="mb-5">
              <label 
                htmlFor="confirm-password"
                className="text-xs font-bold text-slate-700 uppercase tracking-wider block mb-1.5 flex items-center gap-1.5"
              >
                <Lock className="w-3.5 h-3.5 text-slate-500" />
                <span>Confirm New Password</span>
              </label>
              <div className="relative">
                <input
                  id="confirm-password"
                  type={showConfirmPassword ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => { setConfirmPassword(e.target.value); setChangePwError(null); }}
                  placeholder="Re-enter your new password..."
                  required
                  autoComplete="new-password"
                  className="w-full bg-slate-50/80 hover:bg-slate-50 focus:bg-white border border-slate-200/90 rounded-2xl pl-3.5 pr-11 py-3 text-xs sm:text-sm text-slate-900 font-mono focus:outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-500/20 transition-all duration-150 placeholder:text-slate-400"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1.5 rounded-lg text-slate-400 hover:text-emerald-700 hover:bg-slate-100 transition cursor-pointer"
                  title={showConfirmPassword ? "Hide password" : "Show password"}
                >
                  {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Submit New Password Button */}
            <button
              type="submit"
              disabled={isSubmittingNewPw}
              className="w-full bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 active:scale-[0.99] disabled:opacity-60 text-white font-bold py-3.5 rounded-2xl text-xs sm:text-sm flex items-center justify-center gap-2 shadow-md shadow-emerald-700/20 transition-all duration-200 cursor-pointer"
            >
              {isSubmittingNewPw ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin text-white" />
                  <span>Activating Account...</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Save Password & Open Dashboard</span>
                </>
              )}
            </button>

            {/* Back to sign in */}
            <button
              type="button"
              onClick={() => {
                setIsChangingPassword(false);
                setPendingAuth(null);
                setPassword('');
              }}
              disabled={isSubmittingNewPw}
              className="w-full mt-2.5 bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold py-2.5 rounded-2xl text-xs flex items-center justify-center gap-1.5 transition cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5" /> Back to Sign In
            </button>
          </form>
        )}
      </div>
    </div>
  );
};
