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
export function createEmptyWeeklySheds(baseSheds: ShedData[], week?: string): ShedData[] {
  if (!Array.isArray(baseSheds)) return [];
  return baseSheds.map(s => ({
    ...s,
    _week: week,
    savedStatus: 'PENDING' as any,
    savedByUserName: undefined,
    savedByUserId: undefined,
    savedAt: undefined,
    totalBirdCount: 0,
    recordedByUserId: null,
    recordedByUserName: null,
    lockedByUserId: null,
    lockedByUserName: null,
    lockedAt: null,
    lastHeartbeatAt: null,
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

export interface FarmDateAnchorInfo {
  startDate?: string;
  flockDate?: string;
  createdAt?: string | Date;
  startWeekNumber?: number;
  startingWeek?: string | number;
  initialAgeWeek?: string | number;
  ageWeek?: string | number;
  [key: string]: any;
}

/**
 * Safely parses any date string, timestamp, or Date instance into a local calendar Date object.
 * Properly parses YYYY-MM-DD and DD-MM-YYYY strings without UTC midnight shift bugs.
 */
export function parseDateInput(input?: string | number | Date | null): Date {
  if (!input) return new Date();
  if (input instanceof Date) {
    return isNaN(input.getTime()) ? new Date() : input;
  }
  const str = String(input).trim();
  if (!str) return new Date();

  // Handle YYYY-MM-DD
  const ymdMatch = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (ymdMatch) {
    const year = parseInt(ymdMatch[1], 10);
    const month = parseInt(ymdMatch[2], 10) - 1;
    const day = parseInt(ymdMatch[3], 10);
    const d = new Date(year, month, day, 0, 0, 0);
    if (!isNaN(d.getTime())) return d;
  }

  // Handle DD-MM-YYYY
  const dmyMatch = str.match(/^(\d{1,2})-(\d{1,2})-(\d{4})/);
  if (dmyMatch) {
    const day = parseInt(dmyMatch[1], 10);
    const month = parseInt(dmyMatch[2], 10) - 1;
    const year = parseInt(dmyMatch[3], 10);
    const d = new Date(year, month, day, 0, 0, 0);
    if (!isNaN(d.getTime())) return d;
  }

  const standard = new Date(str);
  return isNaN(standard.getTime()) ? new Date() : standard;
}

/**
 * Returns Monday (start of the week, 00:00:00) for any given Date according to Monday-Sunday week convention.
 */
export function getStartOfWeek(d: Date): Date {
  const date = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0);
  const day = date.getDay(); // 0 is Sun, 1 is Mon, ..., 6 is Sat
  const diff = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diff);
  date.setHours(0, 0, 0, 0);
  return date;
}

/**
 * Adds an integer number of days to a Date.
 */
export function addDays(date: Date, days: number): Date {
  const result = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0);
  result.setDate(result.getDate() + days);
  return result;
}

/**
 * Safely parses a week number from any string or number representation (e.g. 'W4', 'Week 4', 4).
 */
export function parseWeekNumber(val: any): number {
  if (typeof val === 'number' && !isNaN(val) && val > 0) return Math.floor(val);
  if (typeof val === 'string') {
    const num = parseInt(val.replace(/\D/g, ''), 10);
    if (!isNaN(num) && num > 0) return num;
  }
  return 1;
}

/**
 * Calculates start and end dates (Monday to Sunday) for a recording week.
 *
 * Anchor Calculation Logic:
 * - Anchors the farm's initial/current week to the base date's Monday–Sunday dates.
 * - Back-calculates past weeks (e.g. W1 to W3) by subtracting 7 days per week.
 * - Projects future weeks (e.g. W5+) by adding 7 days per week.
 *
 * Example:
 * Base date: 19-10-2026 (Monday), Start week: W4
 * W4: 19-10-2026 to 25-10-2026
 * W3: 12-10-2026 to 18-10-2026
 * W2: 05-10-2026 to 11-10-2026
 * W1: 28-09-2026 to 04-10-2026
 * W5: 26-10-2026 to 01-11-2026
 * W6: 02-11-2026 to 08-11-2026
 */
export function getRecordingWeekDateRange(
  flockDateOrFarm?: string | Date | FarmDateAnchorInfo | null,
  weekNum?: number | string,
  initialWeek?: number | string
): { startDate: string; endDate: string; startDateStr: string; endDateStr: string; year: number } {
  let dateInput: string | Date | undefined;
  let startWeekNum: number = 1;

  if (flockDateOrFarm && typeof flockDateOrFarm === 'object' && !(flockDateOrFarm instanceof Date)) {
    const farm = flockDateOrFarm as FarmDateAnchorInfo;
    dateInput = farm.startDate || farm.flockDate || (typeof farm.createdAt === 'string' ? farm.createdAt : undefined);
    if (!dateInput && farm.createdAt instanceof Date) {
      dateInput = farm.createdAt;
    }
    const resolvedInitial =
      initialWeek ??
      farm.startWeekNumber ??
      farm.startingWeek ??
      farm.initialAgeWeek ??
      farm.ageWeek;
    startWeekNum = parseWeekNumber(resolvedInitial);
  } else {
    dateInput = flockDateOrFarm as string | Date | undefined;
    startWeekNum = parseWeekNumber(initialWeek);
  }

  const targetWeekNum = parseWeekNumber(weekNum);
  const parsedDate = parseDateInput(dateInput);
  const currentWeekMonday = getStartOfWeek(parsedDate);

  const weekDiff = targetWeekNum - startWeekNum;
  const start = addDays(currentWeekMonday, weekDiff * 7);
  const end = addDays(start, 6);

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
 * Re-export alias for getRecordingWeekDateRange
 */
export const getWeekDateRange = getRecordingWeekDateRange;

/**
 * Returns an unambiguous label for a recording week including week number, year, and dates.
 */
export function formatRecordingWeekLabel(
  ageWeek: string | number,
  flockDateOrFarm?: string | Date | FarmDateAnchorInfo | null,
  initialAgeWeek?: string | number
): string {
  const weekNum = parseWeekNumber(ageWeek);
  const weekLabel =
    typeof ageWeek === 'string' && ageWeek.trim().toUpperCase().startsWith('W')
      ? ageWeek.trim().toUpperCase()
      : `W${weekNum}`;

  const { startDateStr, endDateStr, year } = getRecordingWeekDateRange(
    flockDateOrFarm,
    weekNum,
    initialAgeWeek
  );

  return `Week ${weekNum} (${weekLabel}) • ${startDateStr} to ${endDateStr} (${year})`;
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
    // 1. Strictly load week-scoped draft key when week is provided
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
    } else {
      // Only when week is not specified, fall back to farm-level draft key
      try {
        const draftStr = localStorage.getItem(`poultry_draft_${farmId}`);
        if (draftStr) {
          const parsed = JSON.parse(draftStr);
          if (Array.isArray(parsed?.sheds)) draftSheds = parsed.sheds;
        }
      } catch {}
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
  }

  // Combine localSheds and draftSheds into candidate set strictly scoped to farmId and current week
  const localList = Array.isArray(localSheds) ? localSheds : [];

  // Strictly filter localSheds: only keep sheds whose id matches a serverShed or draftShed belonging to this farm
  const scopedLocalSheds = localList.filter(ls => {
    if (!farmId) return true;
    if ((ls as any).farmId) return (ls as any).farmId === farmId;
    return serverSheds.some(ss => ss.id === ls.id) || draftSheds.some(ds => ds.id === ls.id);
  });

  const allLocalCandidateSheds = [...draftSheds];
  for (const ls of scopedLocalSheds) {
    const existing = allLocalCandidateSheds.find(s => s.id === ls.id);
    if (!existing) {
      allLocalCandidateSheds.push(ls);
    }
  }

  if (serverSheds.length === 0 && allLocalCandidateSheds.length > 0) {
    return allLocalCandidateSheds;
  }

  const merged = serverSheds.map(serverShed => {
    // Strictly match shed by ID, never by generic name like "Shed 1"
    const localShed = allLocalCandidateSheds.find(ls => ls.id === serverShed.id);

    if (!localShed) return serverShed;

    // Preserve local user-selected gender
    const type = localShed.type || serverShed.type || 'Female';

    const serverParts = Array.isArray(serverShed.parts) ? serverShed.parts : [];
    const localParts = Array.isArray(localShed.parts) ? localShed.parts : [];

    if (serverParts.length === 0 && localParts.length > 0) {
      return { ...localShed, type };
    }

    const mergedParts = serverParts.map(serverPart => {
      // Strictly match part by ID
      const localPart = localParts.find(lp => lp.id === serverPart.id);

      if (!localPart) return serverPart;

      const serverLines = Array.isArray(serverPart.lines) ? serverPart.lines : [];
      const localLines = Array.isArray(localPart.lines) ? localPart.lines : [];

      if (serverLines.length === 0 && localLines.length > 0) {
        return localPart;
      }

      const mergedLines = serverLines.map(serverLine => {
        // Strictly match line by ID
        const localLine = localLines.find(ll => String(ll.id) === String(serverLine.id));

        // Check if draftShed has weights or was cleared for this line
        let draftLineWeights: number[] = [];
        let isDraftCleared = false;
        if (farmId) {
          const matchedDraftShed = draftSheds.find(ds => ds.id === serverShed.id);
          const matchedDraftPart = matchedDraftShed?.parts?.find(dp => dp.id === serverPart.id);
          const matchedDraftLine = matchedDraftPart?.lines?.find(dl => String(dl.id) === String(serverLine.id));
          if (matchedDraftLine) {
            if (Array.isArray(matchedDraftLine.weights) && matchedDraftLine.weights.length > 0) {
              draftLineWeights = matchedDraftLine.weights;
            }
            if (matchedDraftLine.clearedAt) {
              isDraftCleared = true;
            }
          }
        }

        // Check composite-scoped draft key: flock_draft_${farmId}_${week}_${shedId}_${partId}_${lineId}
        let lineScopedDraftWeights: number[] = [];
        if (farmId && typeof localStorage !== 'undefined') {
          try {
            const lineKey = week
              ? `flock_draft_${farmId}_${week}_${serverShed.id}_${serverPart.id}_${serverLine.id}`
              : `flock_draft_${farmId}_${serverShed.id}_${serverPart.id}_${serverLine.id}`;
            const lineVal = localStorage.getItem(lineKey);
            if (lineVal) {
              const parsedLineVal = JSON.parse(lineVal);
              if (Array.isArray(parsedLineVal?.weights)) {
                lineScopedDraftWeights = parsedLineVal.weights;
              } else if (Array.isArray(parsedLineVal)) {
                lineScopedDraftWeights = parsedLineVal;
              }
            }
          } catch {}
        }

        const localWeights = Array.isArray(localLine?.weights) ? localLine.weights : [];
        const serverWeights = Array.isArray(serverLine.weights) ? serverLine.weights : [];
        const isLocallyCleared = Boolean(localLine?.clearedAt);

        // Priority 1: line-scoped draft weights (flock_draft_${farmId}_${week}_${shedId}_${partId}_${lineId})
        // Priority 2: stored week draft weights (draftLineWeights strictly from poultry_draft_${farmId}_${week})
        // Priority 3: intentional local deletion/clear (weights = []) -> MUST NOT be resurrected by stale server weights!
        // Priority 4: local in-memory weights if non-empty (strictly for same week)
        // Priority 5: server weights for unweighed/untouched lines in this week
        let weights = serverWeights;
        let clearedAt = localLine?.clearedAt || (isDraftCleared ? Date.now() : undefined);
        let updatedAt = localLine?.updatedAt;

        if (lineScopedDraftWeights.length > 0) {
          weights = lineScopedDraftWeights;
          clearedAt = undefined;
        } else if (draftLineWeights.length > 0) {
          weights = draftLineWeights;
          clearedAt = undefined;
        } else if (isLocallyCleared || isDraftCleared) {
          weights = [];
        } else if (localWeights.length > 0 && (!week || (localShed as any)?._week === week)) {
          weights = localWeights;
          clearedAt = undefined;
        } else if (serverWeights.length > 0) {
          weights = serverWeights;
          clearedAt = undefined;
        } else {
          weights = [];
        }

        const preservedGender = localLine?.gender || (serverLine as any).gender || undefined;

        return {
          ...serverLine,
          gender: preservedGender,
          weights,
          clearedAt,
          updatedAt: updatedAt || (serverLine as any).updatedAt,
        };
      });

      const extraLocalLines = localLines.filter(
        ll => !serverLines.some(sl => String(sl.id) === String(ll.id))
      );

      return {
        ...serverPart,
        lines: [...mergedLines, ...extraLocalLines]
      };
    });

    const extraLocalParts = localParts.filter(
      lp => !serverParts.some(sp => sp.id === lp.id)
    );

    const matchedDraftShed = draftSheds.find(ds => ds.id === serverShed.id);
    const isWeekSaved = (matchedDraftShed as any)?.savedStatus === 'SAVED' || (serverShed as any).savedStatus === 'SAVED';

    return {
      ...serverShed,
      _week: week || (localShed as any)?._week,
      savedStatus: isWeekSaved ? 'SAVED' : 'PENDING',
      savedByUserName: isWeekSaved ? ((matchedDraftShed as any)?.savedByUserName || (serverShed as any).savedByUserName) : undefined,
      totalBirdCount: isWeekSaved ? ((matchedDraftShed as any)?.totalBirdCount || (serverShed as any).totalBirdCount || 0) : 0,
      recordedByUserName: isWeekSaved ? ((matchedDraftShed as any)?.recordedByUserName || (serverShed as any).recordedByUserName) : null,
      recordedByUserId: isWeekSaved ? ((matchedDraftShed as any)?.recordedByUserId || (serverShed as any).recordedByUserId) : null,
      type,
      parts: [...mergedParts, ...extraLocalParts]
    };
  });

  const extraLocalSheds = allLocalCandidateSheds.filter(
    ls => !serverSheds.some(ss => ss.id === ls.id)
  );

  return [...merged, ...extraLocalSheds];
}
