import React from 'react';
import { Volume2, VolumeX, ShieldCheck, Wifi, WifiOff, FileText, Home, PlusCircle, Scale, Layers } from 'lucide-react';
import { soundEffects } from '../services/audioFeedback';

interface NavbarProps {
  activeTab: 'shed' | 'tally' | 'paper' | 'history';
  setActiveTab: (tab: 'shed' | 'tally' | 'paper' | 'history') => void;
  onOpenShedSetup: () => void;
  isBackendConnected: boolean;
  soundEnabled: boolean;
  setSoundEnabled: (val: boolean) => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  activeTab,
  setActiveTab,
  onOpenShedSetup,
  isBackendConnected,
  soundEnabled,
  setSoundEnabled,
}) => {
  const toggleSound = () => {
    soundEffects.enabled = !soundEnabled;
    setSoundEnabled(!soundEnabled);
  };

  return (
    <header className="sticky top-0 z-40 bg-slate-900/90 backdrop-blur-md border-b border-slate-800 text-white shadow-xl no-print">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo & Branding */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-emerald-600 to-teal-400 flex items-center justify-center shadow-lg shadow-emerald-500/20 font-black text-xl text-white">
              🐔
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-extrabold text-lg tracking-tight bg-gradient-to-r from-emerald-400 via-teal-200 to-amber-300 bg-clip-text text-transparent">
                  AVISYNC
                </span>
                <span className="text-[11px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 font-bold border border-emerald-500/20">
                  Shed Edition
                </span>
              </div>
              <p className="text-xs text-slate-400 hidden sm:block">
                Shed-Wise Poultry Uniformity & Multi-Pen Feed Allocation System
              </p>
            </div>
          </div>

          {/* Navigation Tabs */}
          <nav className="flex items-center gap-1 sm:gap-2">
            <button
              onClick={() => setActiveTab('shed')}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                activeTab === 'shed'
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
              }`}
            >
              <Home className="w-4 h-4" />
              <span>Shed Dashboard</span>
            </button>

            <button
              onClick={() => setActiveTab('tally')}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                activeTab === 'tally'
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
              }`}
            >
              <Scale className="w-4 h-4" />
              <span>Pen Tally</span>
            </button>

            <button
              onClick={() => setActiveTab('paper')}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                activeTab === 'paper'
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
              }`}
            >
              <FileText className="w-4 h-4" />
              <span className="hidden md:inline">Paper Sheet</span>
            </button>

            <button
              onClick={() => setActiveTab('history')}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                activeTab === 'history'
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
              }`}
            >
              <ShieldCheck className="w-4 h-4" />
              <span className="hidden md:inline">History</span>
            </button>
          </nav>

          {/* Action Tools */}
          <div className="flex items-center gap-2 sm:gap-3">
            <button
              onClick={onOpenShedSetup}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white transition-all shadow-md shadow-emerald-700/20"
            >
              <PlusCircle className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Shed & Pen Setup</span>
            </button>

            <button
              onClick={toggleSound}
              title={soundEnabled ? 'Tally audio enabled' : 'Tally audio muted'}
              className="p-2 rounded-lg text-slate-400 hover:text-slate-200 bg-slate-800 hover:bg-slate-700 transition"
            >
              {soundEnabled ? <Volume2 className="w-4 h-4 text-emerald-400" /> : <VolumeX className="w-4 h-4" />}
            </button>

            <div
              title={isBackendConnected ? 'Connected to Render / Express API' : 'Operating in offline local cache mode'}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${
                isBackendConnected
                  ? 'bg-emerald-950/60 text-emerald-300 border-emerald-500/30'
                  : 'bg-amber-950/60 text-amber-300 border-amber-500/30'
              }`}
            >
              {isBackendConnected ? (
                <>
                  <Wifi className="w-3 h-3 text-emerald-400" />
                  <span className="hidden xl:inline">Online API</span>
                </>
              ) : (
                <>
                  <WifiOff className="w-3 h-3 text-amber-400" />
                  <span className="hidden xl:inline">Offline Mode</span>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </header>
  );
};
