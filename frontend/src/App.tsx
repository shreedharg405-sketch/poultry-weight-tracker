import React, { useState, useEffect } from 'react';
import { Navbar } from './components/Navbar';
import { ShedDashboard } from './components/ShedDashboard';
import { DigitalTallyMatrix } from './components/DigitalTallyMatrix';
import { PaperSheetReplica } from './components/PaperSheetReplica';
import { HistoryLog } from './components/HistoryLog';
import { ShedPenSetupModal } from './components/ShedPenSetupModal';
import { Shed, Flock, WeighingRecord, ShedSummaryData } from './types';
import { api } from './services/api';

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'shed' | 'tally' | 'paper' | 'history'>('shed');

  // Hierarchy States
  const [sheds, setSheds] = useState<Shed[]>([]);
  const [activeShed, setActiveShed] = useState<Shed | null>(null);
  const [flocks, setFlocks] = useState<Flock[]>([]);
  const [activeFlock, setActiveFlock] = useState<Flock | null>(null);
  const [weighings, setWeighings] = useState<WeighingRecord[]>([]);
  const [activeShedSummary, setActiveShedSummary] = useState<ShedSummaryData | null>(null);

  // Selected paper record
  const [selectedPaperRecord, setSelectedPaperRecord] = useState<WeighingRecord | null>(null);

  // Modals & Controls
  const [isShedSetupOpen, setIsShedSetupOpen] = useState<boolean>(false);
  const [isBackendConnected, setIsBackendConnected] = useState<boolean>(false);
  const [soundEnabled, setSoundEnabled] = useState<boolean>(true);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // Load all initial hierarchy data
  const loadInitialHierarchy = async () => {
    setIsLoading(true);
    try {
      // 1. Check backend health
      const healthRes = await fetch('http://localhost:5000/healthz').catch(() => null);
      setIsBackendConnected(healthRes?.ok || false);

      // 2. Load sheds
      const loadedSheds = await api.getSheds();
      setSheds(loadedSheds);

      const loadedFlocks = await api.getFlocks();
      setFlocks(loadedFlocks);

      if (loadedSheds.length > 0) {
        const defaultShed = loadedSheds[0];
        setActiveShed(defaultShed);

        // Fetch default shed summary
        const sum = await api.getShedSummary(defaultShed.id, 12);
        setActiveShedSummary(sum.summary);
      }

      if (loadedFlocks.length > 0) {
        const initialFlock = loadedFlocks[0];
        setActiveFlock(initialFlock);
        const records = await api.getWeighingsForFlock(initialFlock.id);
        setWeighings(records);
        if (records.length > 0) {
          setSelectedPaperRecord(records[records.length - 1]);
        }
      }
    } catch (err) {
      console.warn('Hierarchy load error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadInitialHierarchy();
  }, []);

  // When active shed changes, refresh its summary and sync default pen
  const handleSelectShed = async (shed: Shed) => {
    setActiveShed(shed);
    try {
      const sum = await api.getShedSummary(shed.id, 12);
      setActiveShedSummary(sum.summary);

      // Find first pen belonging to this shed
      const penForShed = flocks.find(f => f.houseNo.toLowerCase().includes(shed.shedName.toLowerCase()) || f.id.includes(shed.id));
      if (penForShed) {
        setActiveFlock(penForShed);
        const recs = await api.getWeighingsForFlock(penForShed.id);
        setWeighings(recs);
      }
    } catch (err) {
      console.warn('Error switching shed:', err);
    }
  };

  // Callback to weigh a specific pen directly from the Shed Dashboard table
  const handleOpenWeighPen = async (penId: string) => {
    const targetFlock = flocks.find(f => f.id === penId);
    if (targetFlock) {
      setActiveFlock(targetFlock);
      const recs = await api.getWeighingsForFlock(targetFlock.id);
      setWeighings(recs);
    }
    setActiveTab('tally');
  };

  // Callback when a weighing is completed & saved
  const handleSavedWeighing = async () => {
    if (activeFlock) {
      const recs = await api.getWeighingsForFlock(activeFlock.id);
      setWeighings(recs);
      if (recs.length > 0) setSelectedPaperRecord(recs[recs.length - 1]);
    }
    if (activeShed) {
      const sum = await api.getShedSummary(activeShed.id, 12);
      setActiveShedSummary(sum.summary);
    }
  };

  // Open Paper sheet for specific record or shed
  const handleOpenPaperSheet = (record: WeighingRecord) => {
    setSelectedPaperRecord(record);
    setActiveTab('paper');
  };

  const handlePrintShedReport = (shed: Shed, summary: ShedSummaryData, week: number) => {
    setActiveTab('paper');
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      {/* Top Navigation */}
      <Navbar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        onOpenShedSetup={() => setIsShedSetupOpen(true)}
        isBackendConnected={isBackendConnected}
        soundEnabled={soundEnabled}
        setSoundEnabled={setSoundEnabled}
      />

      {/* Main Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-24 text-slate-400">
            <div className="w-10 h-10 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin"></div>
            <p className="text-sm font-semibold mt-4">Loading Shed & Pen Hierarchy...</p>
          </div>
        ) : (
          <>
            {activeTab === 'shed' && (
              <ShedDashboard
                sheds={sheds}
                activeShed={activeShed}
                onSelectShed={handleSelectShed}
                onOpenWeighPen={handleOpenWeighPen}
                onOpenShedSetup={() => setIsShedSetupOpen(true)}
                onPrintShedReport={handlePrintShedReport}
              />
            )}

            {activeTab === 'tally' && (
              <DigitalTallyMatrix
                flocks={flocks}
                activeFlock={activeFlock}
                onFlockChange={(flock) => {
                  setActiveFlock(flock);
                  api.getWeighingsForFlock(flock.id).then(setWeighings);
                }}
                onSavedRecord={handleSavedWeighing}
              />
            )}

            {activeTab === 'paper' && (
              <PaperSheetReplica
                flock={activeFlock}
                record={selectedPaperRecord || (weighings.length > 0 ? weighings[weighings.length - 1] : null)}
                shed={activeShed}
                shedSummary={activeShedSummary}
                onSelectAnotherRecord={() => setActiveTab('history')}
              />
            )}

            {activeTab === 'history' && (
              <HistoryLog
                flock={activeFlock}
                weighings={weighings}
                onSelectRecordForPaper={handleOpenPaperSheet}
              />
            )}
          </>
        )}
      </main>

      {/* Shed & Pen Configuration Modal */}
      <ShedPenSetupModal
        isOpen={isShedSetupOpen}
        onClose={() => setIsShedSetupOpen(false)}
        sheds={sheds}
        activeShed={activeShed}
        onShedCreated={(newShed) => {
          setSheds((prev) => [...prev, newShed]);
          setActiveShed(newShed);
        }}
        onPenCreated={loadInitialHierarchy}
      />

      {/* Footer */}
      <footer className="border-t border-slate-900 bg-slate-950 py-6 text-center text-xs text-slate-500 no-print">
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-2">
          <p>© {new Date().getFullYear()} AVISYNC (Shed Edition) • Suguna Foods Standard Bodyweight & Seasonal Uniformity Matrix</p>
          <p className="font-mono text-[11px] text-slate-600">
            Shed Mean (X̄shed) • Pen CV% via F-Factor • Shed Uniformity ±10% • Multi-Pen Feed Allocation
          </p>
        </div>
      </footer>
    </div>
  );
};

export default App;
