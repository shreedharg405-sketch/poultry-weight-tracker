import { ShedData } from '../services/excelExportService';

/**
 * Pure state transformation to add a bird weight to a specific line.
 * Guaranteed to produce a new object reference only for the modified path.
 * Guarantees type-safe comparison of lineId (string vs number).
 */
export function applyLineWeightAddition(
  sheds: ShedData[],
  shedId: string,
  partId: string,
  lineId: string | number,
  val: number
): ShedData[] {
  const now = Date.now();
  return sheds.map(s => {
    if (s.id !== shedId) return s;
    return {
      ...s,
      parts: s.parts.map(p => {
        if (p.id !== partId) return p;
        return {
          ...p,
          lines: p.lines.map(l => {
            if (String(l.id) !== String(lineId)) return l;
            return {
              ...l,
              weights: [...l.weights, val],
              clearedAt: undefined,
              updatedAt: now,
            };
          })
        };
      })
    };
  });
}

/**
 * Pure state transformation to delete a bird weight at a specific index in a line.
 */
export function applyLineWeightDeletion(
  sheds: ShedData[],
  shedId: string,
  partId: string,
  lineId: string | number,
  idx: number
): ShedData[] {
  const now = Date.now();
  return sheds.map(s => {
    if (s.id !== shedId) return s;
    return {
      ...s,
      parts: s.parts.map(p => {
        if (p.id !== partId) return p;
        return {
          ...p,
          lines: p.lines.map(l => {
            if (String(l.id) !== String(lineId)) return l;
            const copy = [...l.weights];
            copy.splice(idx, 1);
            return {
              ...l,
              weights: copy,
              clearedAt: copy.length === 0 ? now : undefined,
              updatedAt: now,
            };
          })
        };
      })
    };
  });
}

/**
 * Pure state transformation to clear all bird weights in a specific line.
 */
export function applyLineWeightClear(
  sheds: ShedData[],
  shedId: string,
  partId: string,
  lineId: string | number
): ShedData[] {
  const now = Date.now();
  return sheds.map(s => {
    if (s.id !== shedId) return s;
    return {
      ...s,
      parts: s.parts.map(p => {
        if (p.id !== partId) return p;
        return {
          ...p,
          lines: p.lines.map(l => {
            if (String(l.id) !== String(lineId)) return l;
            return {
              ...l,
              weights: [],
              clearedAt: now,
              updatedAt: now,
            };
          })
        };
      })
    };
  });
}

/**
 * Clones the structural sheds of a farm, resetting all line weights to empty [].
 * Preserves all shed, part, and line IDs, names, types, and ordering.
 */
export function createEmptyWeeklySheds(baseSheds: ShedData[]): ShedData[] {
  if (!Array.isArray(baseSheds)) return [];
  return baseSheds.map(s => ({
    ...s,
    parts: (s.parts || []).map(p => ({
      ...p,
      lines: (p.lines || []).map(l => ({
        ...l,
        weights: [],
        clearedAt: undefined,
        updatedAt: undefined,
      }))
    }))
  }));
}

/**
 * Formats a Date object to DD-MM-YYYY format.
 */
export function formatDMYDate(d: Date): string {
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}-${month}-${year}`;
}

/**
 * Calculates start and end dates for a recording week given a flock base date and week number.
 * Standard poultry business convention:
 * Day 1 of flock is Week 1 Day 1.
 * Week N starts at (N - 1) * 7 days after placement and ends at (N * 7 - 1) days after placement.
 */
export function getRecordingWeekDateRange(
  flockDateStr?: string,
  weekNum?: number
): { startDate: string; endDate: string; startDateStr: string; endDateStr: string; year: number } {
  const safeWeek = Math.max(1, weekNum || 1);
  const now = new Date();
  const base = flockDateStr ? new Date(flockDateStr) : now;
  const validBase = isNaN(base.getTime()) ? now : base;

  const startDayOffset = (safeWeek - 1) * 7;
  const endDayOffset = safeWeek * 7 - 1;

  const start = new Date(validBase.getTime() + startDayOffset * 86400000);
  const end = new Date(validBase.getTime() + endDayOffset * 86400000);

  const sStr = formatDMYDate(start);
  const eStr = formatDMYDate(end);
  return {
    startDate: sStr,
    endDate: eStr,
    startDateStr: sStr,
    endDateStr: eStr,
    year: start.getFullYear(),
  };
}

/**
 * Returns an unambiguous label for a recording week including week number, year, and dates.
 */
export function formatRecordingWeekLabel(
  ageWeek: string,
  flockDateStr?: string
): string {
  const weekNum = parseInt(ageWeek.replace(/\D/g, ''), 10) || 18;
  const { startDateStr, endDateStr, year } = getRecordingWeekDateRange(flockDateStr, weekNum);
  return `Week ${weekNum} (${ageWeek}) • ${startDateStr} to ${endDateStr} (${year})`;
}

/**
 * Helper to safely merge cloud response sheds with local unsaved draft weights and gender.
 * Priority: local in-memory weights > stored draft weights > server weights.
 * Protects intentional local deletions and line clears from being resurrected by stale server snapshots.
 * NEVER overwrite non-empty bird weights with an empty array.
 * Supports week-specific draft keys: poultry_draft_${farmId}_${week} falling back to poultry_draft_${farmId}.
 */
export function mergeServerShedsWithLocalDraft(
  serverSheds: ShedData[],
  localSheds: ShedData[],
  farmId?: string,
  week?: string
): ShedData[] {
  if (!Array.isArray(serverSheds)) return localSheds || [];

  let draftSheds: ShedData[] = [];
  if (farmId && typeof localStorage !== 'undefined') {
    // 1. Try week-specific draft key first
    if (week) {
      try {
        const weekDraftStr = localStorage.getItem(`poultry_draft_${farmId}_${week}`);
        if (weekDraftStr) {
          const parsed = JSON.parse(weekDraftStr);
          if (Array.isArray(parsed?.sheds)) draftSheds = parsed.sheds;
        }
      } catch {}
      if (draftSheds.length === 0) {
        try {
          const weekFarmStr = localStorage.getItem(`poultry_farm_${farmId}_${week}`);
          if (weekFarmStr) {
            const parsed = JSON.parse(weekFarmStr);
            if (Array.isArray(parsed?.sheds)) draftSheds = parsed.sheds;
          }
        } catch {}
      }
    }

    // 2. Fall back to farm-level draft key if week key was not found
    if (draftSheds.length === 0) {
      try {
        const draftStr = localStorage.getItem(`poultry_draft_${farmId}`);
        if (draftStr) {
          const parsed = JSON.parse(draftStr);
          if (Array.isArray(parsed?.sheds)) draftSheds = parsed.sheds;
        }
      } catch {}
    }
    if (draftSheds.length === 0) {
      try {
        const farmStr = localStorage.getItem(`poultry_farm_${farmId}`);
        if (farmStr) {
          const parsed = JSON.parse(farmStr);
          if (Array.isArray(parsed?.sheds)) draftSheds = parsed.sheds;
        }
      } catch {}
    }
  }

  // Combine localSheds and draftSheds into a comprehensive candidate set
  const localList = Array.isArray(localSheds) ? localSheds : [];
  const allLocalCandidateSheds = [...localList];
  for (const ds of draftSheds) {
    const existing = allLocalCandidateSheds.find(
      s => s.id === ds.id || (s.name && ds.name && s.name.trim().toLowerCase() === ds.name.trim().toLowerCase())
    );
    if (!existing) {
      allLocalCandidateSheds.push(ds);
    }
  }

  if (serverSheds.length === 0 && allLocalCandidateSheds.length > 0) {
    return allLocalCandidateSheds;
  }

  const merged = serverSheds.map(serverShed => {
    const localShed = allLocalCandidateSheds.find(
      ls => ls.id === serverShed.id || (ls.name && serverShed.name && ls.name.trim().toLowerCase() === serverShed.name.trim().toLowerCase())
    );

    if (!localShed) return serverShed;

    // Preserve local user-selected gender
    const type = localShed.type || serverShed.type || 'Female';

    const serverParts = Array.isArray(serverShed.parts) ? serverShed.parts : [];
    const localParts = Array.isArray(localShed.parts) ? localShed.parts : [];

    if (serverParts.length === 0 && localParts.length > 0) {
      return { ...localShed, type };
    }

    const mergedParts = serverParts.map(serverPart => {
      const localPart = localParts.find(
        lp => lp.id === serverPart.id || (lp.name && serverPart.name && lp.name.trim().toLowerCase() === serverPart.name.trim().toLowerCase())
      );

      if (!localPart) return serverPart;

      const serverLines = Array.isArray(serverPart.lines) ? serverPart.lines : [];
      const localLines = Array.isArray(localPart.lines) ? localPart.lines : [];

      if (serverLines.length === 0 && localLines.length > 0) {
        return localPart;
      }

      const mergedLines = serverLines.map(serverLine => {
        const localLine = localLines.find(
          ll => String(ll.id) === String(serverLine.id) || (ll.name && serverLine.name && ll.name.trim().toLowerCase() === serverLine.name.trim().toLowerCase())
        );

        // Also check if draftShed has weights or was cleared for this line
        let draftLineWeights: number[] = [];
        let isDraftCleared = false;
        if (farmId) {
          const matchedDraftShed = draftSheds.find(
            ds => ds.id === serverShed.id || (ds.name && serverShed.name && ds.name.trim().toLowerCase() === serverShed.name.trim().toLowerCase())
          );
          const matchedDraftPart = matchedDraftShed?.parts?.find(
            dp => dp.id === serverPart.id || (dp.name && serverPart.name && dp.name.trim().toLowerCase() === serverPart.name.trim().toLowerCase())
          );
          const matchedDraftLine = matchedDraftPart?.lines?.find(
            dl => String(dl.id) === String(serverLine.id) || (dl.name && serverLine.name && dl.name.trim().toLowerCase() === serverLine.name.trim().toLowerCase())
          );
          if (matchedDraftLine) {
            if (Array.isArray(matchedDraftLine.weights) && matchedDraftLine.weights.length > 0) {
              draftLineWeights = matchedDraftLine.weights;
            }
            if (matchedDraftLine.clearedAt) {
              isDraftCleared = true;
            }
          }
        }

        const localWeights = Array.isArray(localLine?.weights) ? localLine.weights : [];
        const serverWeights = Array.isArray(serverLine.weights) ? serverLine.weights : [];
        const isLocallyCleared = Boolean(localLine?.clearedAt);

        // Priority 1: local in-memory weights if non-empty
        // Priority 2: intentional local deletion/clear (weights = []) -> MUST NOT be resurrected by stale server weights!
        // Priority 3: stored local draft weights
        // Priority 4: server weights for unweighed/untouched lines
        let weights = serverWeights;
        let clearedAt = localLine?.clearedAt || (isDraftCleared ? Date.now() : undefined);
        let updatedAt = localLine?.updatedAt;

        if (localWeights.length > 0) {
          weights = localWeights;
          clearedAt = undefined;
        } else if (isLocallyCleared || isDraftCleared) {
          weights = [];
        } else if (draftLineWeights.length > 0) {
          weights = draftLineWeights;
          clearedAt = undefined;
        } else if (serverWeights.length > 0) {
          weights = serverWeights;
          clearedAt = undefined;
        } else {
          weights = [];
        }

        return {
          ...serverLine,
          weights,
          clearedAt,
          updatedAt: updatedAt || (serverLine as any).updatedAt,
        };
      });

      const extraLocalLines = localLines.filter(
        ll => !serverLines.some(sl => String(sl.id) === String(ll.id) || (sl.name && ll.name && sl.name.trim().toLowerCase() === ll.name.trim().toLowerCase()))
      );

      return {
        ...serverPart,
        lines: [...mergedLines, ...extraLocalLines]
      };
    });

    const extraLocalParts = localParts.filter(
      lp => !serverParts.some(sp => sp.id === lp.id || (sp.name && lp.name && sp.name.trim().toLowerCase() === lp.name.trim().toLowerCase()))
    );

    return {
      ...serverShed,
      type,
      parts: [...mergedParts, ...extraLocalParts]
    };
  });

  const extraLocalSheds = allLocalCandidateSheds.filter(
    ls => !serverSheds.some(ss => ss.id === ls.id || (ss.name && ls.name && ss.name.trim().toLowerCase() === ls.name.trim().toLowerCase()))
  );

  return [...merged, ...extraLocalSheds];
}
