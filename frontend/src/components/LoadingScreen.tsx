import React, { useState, useEffect } from 'react';
import roosterLogo from '../assets/rooster-logo.jpg';

interface LoadingScreenProps {
  message?: string;
  duration?: number;
}

export const LoadingScreen: React.FC<LoadingScreenProps> = ({ 
  message = "Calibrating Shed & Line Uniformity...",
  duration = 2000
}) => {
  const [progress, setProgress] = useState(8);

  useEffect(() => {
    const startTime = Date.now();
    const timer = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const pct = Math.min(100, Math.round((elapsed / duration) * 100));
      setProgress(pct);
      if (elapsed >= duration) {
        clearInterval(timer);
      }
    }, 30);

    return () => clearInterval(timer);
  }, [duration]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-slate-50 px-6 select-none animate-in fade-in duration-200">
      {/* Background Ambient Radial Glow */}
      <div className="absolute w-96 h-96 rounded-full bg-emerald-500/10 blur-3xl pointer-events-none" />

      {/* Emblem Container with Glowing Rings */}
      <div className="relative flex items-center justify-center w-56 h-56 mb-2">
        {/* Outer Orbiting Pulsing Ring */}
        <div className="absolute inset-0 rounded-full border-2 border-emerald-400/40 animate-pulse" />
        
        {/* Subtle Orbiting Dashed Ring */}
        <div className="absolute -inset-1 rounded-full border border-dashed border-emerald-500/50 animate-spin [animation-duration:14s]" />
        
        {/* Inner Glowing Badge with Rooster Emblem */}
        <div className="relative z-10 w-44 h-44 rounded-full bg-white border-2 border-emerald-300 shadow-2xl shadow-emerald-600/20 flex items-center justify-center overflow-hidden p-3.5">
          <img 
            src={roosterLogo} 
            alt="Poultry Flock Pro Rooster Emblem" 
            className="w-36 h-36 object-contain select-none pointer-events-none drop-shadow-xs transition-transform duration-700 hover:scale-105"
          />
        </div>
      </div>

      {/* Primary Brand Title */}
      <h1 className="text-xl sm:text-2xl font-black tracking-widest text-slate-900 uppercase mt-4 text-center font-sans">
        POULTRY FLOCK PRO
      </h1>

      {/* Vibrant Subtitle */}
      <p className="text-[11px] sm:text-xs font-black tracking-widest text-emerald-600 uppercase mt-1 text-center font-sans">
        BODYWEIGHT & UNIFORMITY SUITE
      </p>

      {/* Subtle Divider Line */}
      <div className="w-20 h-0.5 bg-gradient-to-r from-transparent via-emerald-400 to-transparent my-3.5" />

      {/* Progress Track with Smooth Progress Fill */}
      <div className="w-64 sm:w-72 h-1.5 bg-slate-200 rounded-full overflow-hidden shadow-inner relative">
        <div 
          className="h-full bg-gradient-to-r from-emerald-500 via-teal-400 to-emerald-400 rounded-full transition-all duration-75 ease-out shadow-xs"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Italic Dynamic Micro-Status Indicator */}
      <p className="text-xs font-medium text-slate-500 italic mt-3 text-center tracking-wide font-sans animate-pulse">
        {message}
      </p>

      {/* Cloudflare Edge Version Footnote */}
      <div className="absolute bottom-6 text-[10px] font-mono tracking-widest text-slate-400 uppercase">
        CLOUDFLARE EDGE ACTIVE • v2.4
      </div>
    </div>
  );
};
