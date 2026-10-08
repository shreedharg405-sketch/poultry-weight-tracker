import React, { useState } from 'react';
import { X, Plus, Home, Layers, Check } from 'lucide-react';
import { Shed, Pen, SeasonType, SexType } from '../types';
import { api } from '../services/api';

interface ShedPenSetupModalProps {
  isOpen: boolean;
  onClose: () => void;
  sheds: Shed[];
  activeShed: Shed | null;
  onShedCreated: (newShed: Shed) => void;
  onPenCreated: () => void;
}

export const ShedPenSetupModal: React.FC<ShedPenSetupModalProps> = ({
  isOpen,
  onClose,
  sheds,
  activeShed,
  onShedCreated,
  onPenCreated,
}) => {
  const [activeTab, setActiveTab] = useState<'addShed' | 'addPen'>('addPen');

  // Add Shed fields
  const [newShedName, setNewShedName] = useState<string>('Shed 4 (Grower House)');
  const [shedSeason, setShedSeason] = useState<SeasonType>('WINTER_BROOD_SUMMER_LAY');
  const [hatchDate, setHatchDate] = useState<string>(new Date().toISOString().split('T')[0]);

  // Add Pen fields
  const [targetShedId, setTargetShedId] = useState<string>(activeShed?.id || sheds[0]?.id || '');
  const [penNumber, setPenNumber] = useState<string>('Pen D');
  const [penSex, setPenSex] = useState<SexType>('FEMALE');
  const [penBreed, setPenBreed] = useState<string>('Cobb 500');
  const [liveBirdCount, setLiveBirdCount] = useState<number>(4800);

  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  if (!isOpen) return null;

  const handleCreateShed = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      const created = await api.createShed({
        shedName: newShedName,
        season: shedSeason,
        hatchDate,
      });
      onShedCreated(created);
      setActiveTab('addPen');
      setTargetShedId(created.id);
    } catch (err: any) {
      alert('Error creating shed: ' + (err.message || 'Error'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCreatePen = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      await api.createPen(targetShedId, {
        penNumber,
        sex: penSex,
        breed: penBreed,
        liveBirdCount,
      });
      onPenCreated();
      onClose();
    } catch (err: any) {
      alert('Error creating pen: ' + (err.message || 'Error'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fade-in">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-lg p-6 shadow-2xl relative text-slate-100">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-slate-400 hover:text-slate-200 transition"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-3 mb-4 pb-3 border-b border-slate-800">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center border border-emerald-500/30 font-bold">
            🏡
          </div>
          <div>
            <h3 className="text-lg font-bold text-white">Shed & Multi-Pen Setup</h3>
            <p className="text-xs text-slate-400">Configure Farm houses and individual pens</p>
          </div>
        </div>

        {/* Tab switch */}
        <div className="grid grid-cols-2 gap-2 p-1 bg-slate-950 rounded-xl border border-slate-800 text-xs font-semibold mb-4">
          <button
            onClick={() => setActiveTab('addPen')}
            className={`py-2 rounded-lg transition ${
              activeTab === 'addPen'
                ? 'bg-emerald-600 text-white shadow'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            + Add Pen to Shed
          </button>
          <button
            onClick={() => setActiveTab('addShed')}
            className={`py-2 rounded-lg transition ${
              activeTab === 'addShed'
                ? 'bg-emerald-600 text-white shadow'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            + Register New Shed
          </button>
        </div>

        {activeTab === 'addPen' && (
          <form onSubmit={handleCreatePen} className="space-y-3.5 text-xs">
            <div>
              <label className="text-slate-400 block mb-1 font-medium">Select Target Shed</label>
              <select
                value={targetShedId}
                onChange={(e) => setTargetShedId(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-white focus:outline-none focus:border-emerald-500"
              >
                {sheds.map((sh) => (
                  <option key={sh.id} value={sh.id}>
                    {sh.shedName}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-slate-400 block mb-1 font-medium">Pen Name / Number</label>
                <input
                  type="text"
                  required
                  value={penNumber}
                  onChange={(e) => setPenNumber(e.target.value)}
                  placeholder="e.g. Pen A, Pen 1"
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-white focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="text-slate-400 block mb-1 font-medium">Bird Sex</label>
                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    type="button"
                    onClick={() => setPenSex('FEMALE')}
                    className={`py-2 rounded-lg font-bold transition text-center ${
                      penSex === 'FEMALE'
                        ? 'bg-emerald-600 text-white shadow'
                        : 'bg-slate-950 border border-slate-700 text-slate-400'
                    }`}
                  >
                    Female (F)
                  </button>
                  <button
                    type="button"
                    onClick={() => setPenSex('MALE')}
                    className={`py-2 rounded-lg font-bold transition text-center ${
                      penSex === 'MALE'
                        ? 'bg-emerald-600 text-white shadow'
                        : 'bg-slate-950 border border-slate-700 text-slate-400'
                    }`}
                  >
                    Male (M)
                  </button>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-slate-400 block mb-1 font-medium">Breed Standard</label>
                <select
                  value={penBreed}
                  onChange={(e) => setPenBreed(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-white focus:outline-none focus:border-emerald-500"
                >
                  <option value="Cobb 500">Cobb 500</option>
                  <option value="Ross 308">Ross 308</option>
                  <option value="Hubbard">Hubbard Classic</option>
                </select>
              </div>

              <div>
                <label className="text-slate-400 block mb-1 font-medium">Live Bird Count</label>
                <input
                  type="number"
                  min="50"
                  value={liveBirdCount}
                  onChange={(e) => setLiveBirdCount(parseInt(e.target.value, 10) || 4800)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-white font-mono focus:outline-none focus:border-emerald-500"
                />
              </div>
            </div>

            <div className="pt-3 border-t border-slate-800 flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 font-semibold hover:bg-slate-700 transition"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold transition shadow-lg shadow-emerald-700/20 flex items-center gap-2"
              >
                <Plus className="w-4 h-4" />
                <span>{isSubmitting ? 'Adding...' : 'Add Pen to Shed'}</span>
              </button>
            </div>
          </form>
        )}

        {activeTab === 'addShed' && (
          <form onSubmit={handleCreateShed} className="space-y-3.5 text-xs">
            <div>
              <label className="text-slate-400 block mb-1 font-medium">Shed / House Name</label>
              <input
                type="text"
                required
                value={newShedName}
                onChange={(e) => setNewShedName(e.target.value)}
                placeholder="e.g. Shed 3 (Grower House)"
                className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-white focus:outline-none focus:border-emerald-500"
              />
            </div>

            <div>
              <label className="text-slate-400 block mb-1 font-medium">Seasonal Growth Standard</label>
              <select
                value={shedSeason}
                onChange={(e) => setShedSeason(e.target.value as SeasonType)}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-white focus:outline-none focus:border-emerald-500"
              >
                <option value="WINTER_BROOD_SUMMER_LAY">
                  Winter Brood / Grow (Aug - Jan) & Summer Laying (Feb - Jul)
                </option>
                <option value="SUMMER_BROOD_WINTER_LAY">
                  Summer Brood / Grow (Feb - Jul) & Winter Laying (Aug - Jan)
                </option>
              </select>
            </div>

            <div>
              <label className="text-slate-400 block mb-1 font-medium">Hatch Date</label>
              <input
                type="date"
                value={hatchDate}
                onChange={(e) => setHatchDate(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-white focus:outline-none focus:border-emerald-500"
              />
            </div>

            <div className="pt-3 border-t border-slate-800 flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 font-semibold hover:bg-slate-700 transition"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold transition shadow-lg shadow-emerald-700/20 flex items-center gap-2"
              >
                <Plus className="w-4 h-4" />
                <span>{isSubmitting ? 'Registering...' : 'Register Shed'}</span>
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
