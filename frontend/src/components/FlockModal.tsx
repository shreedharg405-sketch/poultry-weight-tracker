import React, { useState } from 'react';
import { X, PlusCircle, Feather } from 'lucide-react';
import { SeasonType, SexType, Flock } from '../types';
import { api } from '../services/api';

interface FlockModalProps {
  isOpen: boolean;
  onClose: () => void;
  onFlockCreated: (flock: Flock) => void;
}

export const FlockModal: React.FC<FlockModalProps> = ({ isOpen, onClose, onFlockCreated }) => {
  const [farmName, setFarmName] = useState<string>('Suguna Breeder Farm Unit 5');
  const [houseNo, setHouseNo] = useState<string>('House 03');
  const [penNo, setPenNo] = useState<string>('Pen A');
  const [breed, setBreed] = useState<string>('Cobb 500');
  const [sex, setSex] = useState<SexType>('FEMALE');
  const [season, setSeason] = useState<SeasonType>('WINTER_BROOD_SUMMER_LAY');
  const [initialBirdCount, setInitialBirdCount] = useState<number>(5000);
  const [hatchDate, setHatchDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      const created = await api.createFlock({
        farmName,
        houseNo,
        penNo,
        breed,
        sex,
        season,
        initialBirdCount,
        hatchDate,
      });
      onFlockCreated(created);
      onClose();
    } catch (err: any) {
      alert('Failed to register flock: ' + (err.message || 'Error'));
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

        <div className="flex items-center gap-3 mb-5 border-b border-slate-800 pb-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center border border-emerald-500/30 font-bold">
            🐔
          </div>
          <div>
            <h3 className="text-lg font-bold text-white">Register New Poultry Flock</h3>
            <p className="text-xs text-slate-400">Add house, pen and seasonal growth curve parameters</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          <div>
            <label className="text-slate-400 block mb-1 font-medium">Farm Name / Unit</label>
            <input
              type="text"
              required
              value={farmName}
              onChange={(e) => setFarmName(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-white focus:outline-none focus:border-emerald-500"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-slate-400 block mb-1 font-medium">House Number</label>
              <input
                type="text"
                required
                value={houseNo}
                onChange={(e) => setHouseNo(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-white focus:outline-none focus:border-emerald-500"
              />
            </div>
            <div>
              <label className="text-slate-400 block mb-1 font-medium">Pen Identification</label>
              <input
                type="text"
                required
                value={penNo}
                onChange={(e) => setPenNo(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-white focus:outline-none focus:border-emerald-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-slate-400 block mb-1 font-medium">Breed Specification</label>
              <select
                value={breed}
                onChange={(e) => setBreed(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-white focus:outline-none focus:border-emerald-500"
              >
                <option value="Cobb 500">Cobb 500</option>
                <option value="Ross 308">Ross 308</option>
                <option value="Hubbard">Hubbard Classic</option>
              </select>
            </div>
            <div>
              <label className="text-slate-400 block mb-1 font-medium">Bird Sex</label>
              <div className="grid grid-cols-2 gap-2 mt-0.5">
                <button
                  type="button"
                  onClick={() => setSex('FEMALE')}
                  className={`py-2 rounded-lg font-bold transition text-center ${
                    sex === 'FEMALE'
                      ? 'bg-emerald-600 text-white shadow'
                      : 'bg-slate-950 border border-slate-700 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Female (F)
                </button>
                <button
                  type="button"
                  onClick={() => setSex('MALE')}
                  className={`py-2 rounded-lg font-bold transition text-center ${
                    sex === 'MALE'
                      ? 'bg-emerald-600 text-white shadow'
                      : 'bg-slate-950 border border-slate-700 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Male (M)
                </button>
              </div>
            </div>
          </div>

          <div>
            <label className="text-slate-400 block mb-1 font-medium">Seasonal Benchmark Curve Standard</label>
            <select
              value={season}
              onChange={(e) => setSeason(e.target.value as SeasonType)}
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

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-slate-400 block mb-1 font-medium">Bird Population Count</label>
              <input
                type="number"
                min="100"
                value={initialBirdCount}
                onChange={(e) => setInitialBirdCount(parseInt(e.target.value, 10) || 5000)}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-white font-mono focus:outline-none focus:border-emerald-500"
              />
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
              <PlusCircle className="w-4 h-4" />
              <span>{isSubmitting ? 'Registering...' : 'Register Flock'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
