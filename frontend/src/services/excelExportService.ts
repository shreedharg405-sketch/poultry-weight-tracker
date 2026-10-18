import ExcelJS from 'exceljs';
import { downloadExcelFile, sanitizeFileName } from '../utils/fileDownloader';
import { WINTER_BROOD_STANDARDS, SUMMER_BROOD_STANDARDS } from './benchmarks';
import { ShedSummaryData, WeighingRecord } from '../types';

export interface PenLine {
  id: number | string;
  name: string;
  weights: number[];
  clearedAt?: number;
  updatedAt?: number;
}

export interface ShedPart {
  id: string;
  name: string;
  lines: PenLine[];
}

export interface ShedData {
  id: string;
  name: string;
  sheetName?: string;
  type: 'Female' | 'Male';
  parts: ShedPart[];
}

export interface GradingTolerance {
  tolerance: number;
  sMin: number;
  sMax: number;
  bMin: number;
  aMax: number;
}

/**
 * Standard Suguna tolerance steps:
 * - Weeks 1–3: 25 g
 * - Weeks 4–8: 50 g
 * - Weeks 9–14: 75 g
 * - Weeks 15 and above: 100 g
 */
export function getToleranceForWeek(weekNum: number): number {
  if (weekNum <= 3) return 25;
  if (weekNum <= 8) return 50;
  if (weekNum <= 14) return 75;
  return 100;
}

/**
 * Standard Suguna grading tolerance bands:
 * - MB: weight < STD - 2Δ
 * - B:  STD - 2Δ <= weight < STD - Δ
 * - S:  STD - Δ <= weight <= STD + Δ (inclusive, ideal standard band)
 * - A:  STD + Δ < weight <= STD + 2Δ
 * - MA: weight > STD + 2Δ
 */
export function getGradingBands(stdWeight: number, weekNum: number): GradingTolerance {
  const tolerance = getToleranceForWeek(weekNum);
  return {
    tolerance,
    sMin: stdWeight - tolerance,
    sMax: stdWeight + tolerance,
    bMin: stdWeight - 2 * tolerance,
    aMax: stdWeight + 2 * tolerance
  };
}

export type BirdGrade = 'MB' | 'B' | 'S' | 'A' | 'MA';

/**
 * Evaluates a single bird's weight against the verified Suguna grading boundaries.
 * Boundary comparisons ensure each valid bird belongs to exactly one grade.
 */
export function getBirdGrade(weight: number, bands: GradingTolerance): BirdGrade {
  if (weight < bands.bMin) return 'MB';
  if (weight < bands.sMin) return 'B';
  if (weight <= bands.sMax) return 'S';
  if (weight <= bands.aMax) return 'A';
  return 'MA';
}

/**
 * Verified Suguna F-Factor reference lookup table.
 * Source: Official Suguna Foods bodyweight recording charts & standards.
 */
export const F_FACTOR_LOOKUP: Record<number, number> = {
  10: 3.08,
  15: 3.54,
  20: 3.73,
  25: 3.94,
  30: 4.09,
  35: 4.20,
  40: 4.30,
  45: 4.40,
  50: 4.50,
  55: 4.57,
  60: 4.64,
  65: 4.70,
  70: 4.76,
  75: 4.81,
  80: 4.87,
  85: 4.90,
  90: 4.94,
  95: 4.98,
  100: 5.02,
  150: 5.03
};

/**
 * Retrieves the exact verified F-Factor if specified in the reference table.
 * Returns null for unsupported sample sizes rather than inventing an unverified value.
 */
export function getVerifiedFFactor(n: number): number | null {
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) return null;
  if (F_FACTOR_LOOKUP[n] !== undefined) return F_FACTOR_LOOKUP[n];
  return null;
}

/**
 * F-factor lookup with linear interpolation fallback for intermediate counts.
 * Note: getVerifiedFFactor is the primary strictly-verified lookup.
 */
export function getFFactor(n: number): number {
  const verified = getVerifiedFFactor(n);
  if (verified !== null) return verified;
  if (n <= 10) return 3.08;
  if (n >= 150) return 5.03;
  const keys = Object.keys(F_FACTOR_LOOKUP).map(Number).sort((a, b) => a - b);
  for (let i = 0; i < keys.length - 1; i++) {
    const s1 = keys[i];
    const s2 = keys[i + 1];
    if (n >= s1 && n <= s2) {
      const f1 = F_FACTOR_LOOKUP[s1];
      const f2 = F_FACTOR_LOOKUP[s2];
      const ratio = (n - s1) / (s2 - s1);
      return Number((f1 + ratio * (f2 - f1)).toFixed(2));
    }
  }
  return 5.02;
}

export interface StatisticalSummary {
  count: number;
  totalWeight: number;
  avg: number;
  diff: number;
  min: number;
  max: number;
  range: number;
  variance: number;
  fFactor: number | null;
  cv: number | null;
  mbCount: number;
  bCount: number;
  sCount: number;
  aCount: number;
  maCount: number;
  mbPct: number;
  bPct: number;
  sPct: number; // Standard Uniformity % (Grade S%)
  aPct: number;
  maPct: number;
  unif: number; // Alias for Standard Uniformity %
  uniformity10Pct: number; // Actual body-weight uniformity (±10% of line average)
  status: 'EXCELLENT' | 'ACCEPTABLE' | 'POOR' | 'INCOMPLETE';
  isComplete: boolean;
  tolerance: number;
  bands: GradingTolerance;
}

/**
 * Filter and validate raw weight readings.
 * Only positive, finite numbers are valid. Missing, NaN, and zeros are excluded.
 */
export function filterValidWeights(weights: unknown[]): number[] {
  if (!Array.isArray(weights)) return [];
  return weights
    .map(w => (typeof w === 'string' ? parseFloat(w) : Number(w)))
    .filter((w): w is number => typeof w === 'number' && Number.isFinite(w) && w > 0);
}

/**
 * Computes complete Suguna line and flock statistics:
 * - Valid numeric readings only
 * - Sample count N
 * - Total weight & Average weight
 * - Target deviation (Avg - STD target)
 * - Min, Max, Range
 * - F-Factor and Suguna Range CV%
 * - MB, B, S, A, MA distributions
 * - Standard Uniformity (S%)
 * - Actual Body-Weight Uniformity (±10% of Actual Line Average)
 */
export function calculateFlockStats(
  weights: number[],
  stdWeight: number,
  weekNum: number
): StatisticalSummary {
  const validWeights = filterValidWeights(weights);
  const count = validWeights.length;
  const bands = getGradingBands(stdWeight, weekNum);

  if (count === 0) {
    return {
      count: 0,
      totalWeight: 0,
      avg: 0,
      diff: 0,
      min: 0,
      max: 0,
      range: 0,
      variance: 0,
      fFactor: null,
      cv: null,
      mbCount: 0,
      bCount: 0,
      sCount: 0,
      aCount: 0,
      maCount: 0,
      mbPct: 0,
      bPct: 0,
      sPct: 0,
      aPct: 0,
      maPct: 0,
      unif: 0,
      uniformity10Pct: 0,
      status: 'INCOMPLETE',
      isComplete: false,
      tolerance: bands.tolerance,
      bands
    };
  }

  const totalWeight = validWeights.reduce((acc, w) => acc + w, 0);
  const avg = Number((totalWeight / count).toFixed(1));
  const diff = Number((avg - stdWeight).toFixed(1));
  const min = Math.min(...validWeights);
  const max = Math.max(...validWeights);
  const range = max - min;

  const verifiedF = getVerifiedFFactor(count);
  const fFactor = verifiedF !== null ? verifiedF : getFFactor(count);
  const cv = avg > 0 && fFactor > 0 ? Number(((range * 100) / (avg * fFactor)).toFixed(2)) : null;

  let mbCount = 0;
  let bCount = 0;
  let sCount = 0;
  let aCount = 0;
  let maCount = 0;

  for (const w of validWeights) {
    const grade = getBirdGrade(w, bands);
    if (grade === 'MB') mbCount++;
    else if (grade === 'B') bCount++;
    else if (grade === 'S') sCount++;
    else if (grade === 'A') aCount++;
    else if (grade === 'MA') maCount++;
  }

  const sumSqDiff = validWeights.reduce((acc, w) => acc + Math.pow(w - avg, 2), 0);
  const variance = count > 1 ? Number((sumSqDiff / (count - 1)).toFixed(2)) : 0;

  // Standard Uniformity (Grade S% around standard target)
  const sPct = Number(((sCount / count) * 100).toFixed(1));

  // Actual Body-Weight Uniformity (±10% from actual line mean)
  const lower10Pct = avg * 0.90;
  const upper10Pct = avg * 1.10;
  const birdsIn10Pct = validWeights.filter(w => w >= lower10Pct && w <= upper10Pct).length;
  const uniformity10Pct = Number(((birdsIn10Pct / count) * 100).toFixed(1));

  let status: 'EXCELLENT' | 'ACCEPTABLE' | 'POOR' | 'INCOMPLETE' = 'POOR';
  if (count === 0) {
    status = 'INCOMPLETE';
  } else if (sPct >= 80 || uniformity10Pct >= 80) {
    status = 'EXCELLENT';
  } else if (sPct >= 70 || uniformity10Pct >= 70) {
    status = 'ACCEPTABLE';
  } else {
    status = 'POOR';
  }

  return {
    count,
    totalWeight,
    avg,
    diff,
    min,
    max,
    range,
    variance,
    fFactor,
    cv,
    mbCount,
    bCount,
    sCount,
    aCount,
    maCount,
    mbPct: Number(((mbCount / count) * 100).toFixed(1)),
    bPct: Number(((bCount / count) * 100).toFixed(1)),
    sPct,
    aPct: Number(((aCount / count) * 100).toFixed(1)),
    maPct: Number(((maCount / count) * 100).toFixed(1)),
    unif: sPct,
    uniformity10Pct,
    status,
    isComplete: count > 0,
    tolerance: bands.tolerance,
    bands
  };
}

/**
 * Converts a 1-based column index to an Excel column letter (e.g. 1 -> A, 2 -> B, 27 -> AA).
 */
export function getColumnLetter(colIndex: number): string {
  let letter = '';
  let temp = colIndex;
  while (temp > 0) {
    const mod = (temp - 1) % 26;
    letter = String.fromCharCode(65 + mod) + letter;
    temp = Math.floor((temp - mod) / 26);
  }
  return letter;
}

export interface ExportWorkbookParams {
  farmName: string;
  dateStr: string;
  formattedDateTime: string;
  ageWeek: string;
  weekNum: number;
  season: 'Summer' | 'Winter';
  stdWeightFemale: number;
  stdWeightMale: number;
  sheds: ShedData[];
}

/**
 * Generate complete 13-sheet workbook strictly styled with ExcelJS matching "B.wt Excel format-1.xlsx"
 */
export async function exportPoultryWorkbook(
  params: ExportWorkbookParams
): Promise<{ success: boolean; method: string; fileName: string; buffer?: ArrayBuffer }> {
  const {
    farmName,
    dateStr,
    formattedDateTime,
    ageWeek,
    weekNum,
    season,
    stdWeightFemale,
    stdWeightMale,
    sheds
  } = params;

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Poultry Weight Tracker (Suguna Foods System)';
  workbook.created = new Date();
  workbook.modified = new Date();

  // Thin gray border helper
  const thinBorder: Partial<ExcelJS.Borders> = {
    top: { style: 'thin', color: { argb: 'FFD1D5DB' } },
    left: { style: 'thin', color: { argb: 'FFD1D5DB' } },
    bottom: { style: 'thin', color: { argb: 'FFD1D5DB' } },
    right: { style: 'thin', color: { argb: 'FFD1D5DB' } }
  };

  // Heavy border helper
  const headerBorder: Partial<ExcelJS.Borders> = {
    top: { style: 'medium', color: { argb: 'FF4B5563' } },
    left: { style: 'thin', color: { argb: 'FF9CA3AF' } },
    bottom: { style: 'medium', color: { argb: 'FF4B5563' } },
    right: { style: 'thin', color: { argb: 'FF9CA3AF' } }
  };

  // Combined female & male weights (all valid positive readings)
  const femaleWeights = filterValidWeights(
    sheds
      .filter(s => s.type === 'Female')
      .flatMap(s => s.parts.flatMap(p => p.lines.flatMap(l => l.weights)))
  );

  const maleWeights = filterValidWeights(
    sheds
      .filter(s => s.type === 'Male')
      .flatMap(s => s.parts.flatMap(p => p.lines.flatMap(l => l.weights)))
  );

  const fStats = calculateFlockStats(femaleWeights, stdWeightFemale, weekNum);
  const mStats = calculateFlockStats(maleWeights, stdWeightMale, weekNum);

  // Shed-wise summaries from combined valid underlying readings
  const shedSummaries = sheds.map((s, idx) => {
    const allW = filterValidWeights(s.parts.flatMap(p => p.lines.flatMap(l => l.weights)));
    const std = s.type === 'Male' ? stdWeightMale : stdWeightFemale;
    return {
      ...s,
      indexNum: idx + 1,
      stats: calculateFlockStats(allW, std, weekNum)
    };
  });

  // =========================================================================
  // 1. SHEET 'Cons' (Master Conclusion)
  // =========================================================================
  const wsCons = workbook.addWorksheet('Cons', {
    views: [{ showGridLines: true }]
  });

  wsCons.columns = [
    { width: 5 },   // A
    { width: 24 },  // B: Metric / Label
    { width: 18 },  // C: Female
    { width: 18 },  // D: Male
    { width: 6 },   // E: Spacer
    { width: 10 },  // F: Shed No
    { width: 16 },  // G: Shed Name
    { width: 11 },  // H: Sex
    { width: 14 },  // I: Act B.WT
    { width: 11 },  // J: Min
    { width: 11 },  // K: Max
    { width: 11 },  // L: CV%
    { width: 18 },  // M: MB % (< STD-2Δ)
    { width: 18 },  // N: B % (STD-2Δ to -Δ)
    { width: 18 },  // O: S % (Ideal ±Δ)
    { width: 18 },  // P: A % (STD+Δ to +2Δ)
    { width: 18 },  // Q: MA % (> STD+2Δ)
    { width: 12 }   // R: Birds
  ];

  // Header Title Row 1
  wsCons.mergeCells('B1:D1');
  const titleCell = wsCons.getCell('B1');
  titleCell.value = `${farmName} - POULTRY BODY WEIGHT CONSOLIDATED REPORT`;
  titleCell.font = { name: 'Cambria', size: 13, bold: true, color: { argb: 'FF1F2937' } };
  titleCell.alignment = { horizontal: 'center', vertical: 'middle' };

  // Subheader Info Row 2
  wsCons.mergeCells('B2:D2');
  const subCell = wsCons.getCell('B2');
  subCell.value = `Date: ${formattedDateTime}  |  Age: ${ageWeek}  |  Season: ${season} Brooding`;
  subCell.font = { name: 'Cambria', size: 10, italic: true, color: { argb: 'FF4B5563' } };
  subCell.alignment = { horizontal: 'center', vertical: 'middle' };

  // Side-by-side Female (♀) and Male (♂) Header (Row 4)
  wsCons.getCell('B4').value = 'Parameter / Metric';
  wsCons.getCell('B4').font = { name: 'Cambria', size: 13, bold: true, color: { argb: 'FF111827' } };
  wsCons.getCell('B4').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } };
  wsCons.getCell('B4').alignment = { horizontal: 'left', vertical: 'middle' };
  wsCons.getCell('B4').border = headerBorder;

  // Female Header Symbol
  const cellC4 = wsCons.getCell('C4');
  cellC4.value = '♀ Female';
  cellC4.font = { name: 'Cambria', size: 18, bold: true, color: { argb: 'FF00B050' } };
  cellC4.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F5E9' } };
  cellC4.alignment = { horizontal: 'center', vertical: 'middle' };
  cellC4.border = headerBorder;

  // Male Header Symbol
  const cellD4 = wsCons.getCell('D4');
  cellD4.value = '♂ Male';
  cellD4.font = { name: 'Cambria', size: 18, bold: true, color: { argb: 'FFFF0000' } };
  cellD4.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFEBEE' } };
  cellD4.alignment = { horizontal: 'center', vertical: 'middle' };
  cellD4.border = headerBorder;

  // Comparison Rows
  const metricRows: [string, string | number, string | number][] = [
    ['Age', `${ageWeek}F`, `${ageWeek}M`],
    ['STD B.WT', `${stdWeightFemale} g`, `${stdWeightMale} g`],
    ['Act B.WT', fStats.count > 0 ? `${fStats.avg} g` : '—', mStats.count > 0 ? `${mStats.avg} g` : '—'],
    ['Diff (Std +/-)', fStats.count > 0 ? `${fStats.diff > 0 ? '+' : ''}${fStats.diff} g` : '—', mStats.count > 0 ? `${mStats.diff > 0 ? '+' : ''}${mStats.diff} g` : '—'],
    ['CV %', fStats.cv !== null && fStats.cv > 0 ? `${fStats.cv}%` : (fStats.count > 0 ? 'N/A' : '—'), mStats.cv !== null && mStats.cv > 0 ? `${mStats.cv}%` : (mStats.count > 0 ? 'N/A' : '—')],
    ['Min', fStats.count > 0 ? `${fStats.min} g` : '—', mStats.count > 0 ? `${mStats.min} g` : '—'],
    ['Max', fStats.count > 0 ? `${fStats.max} g` : '—', mStats.count > 0 ? `${mStats.max} g` : '—'],
    ['MB % (< STD-2Δ)', fStats.count > 0 ? `${fStats.mbPct}%` : '—', mStats.count > 0 ? `${mStats.mbPct}%` : '—'],
    ['B % (STD-2Δ to -Δ)', fStats.count > 0 ? `${fStats.bPct}%` : '—', mStats.count > 0 ? `${mStats.bPct}%` : '—'],
    ['S % (Ideal ±Δ)', fStats.count > 0 ? `${fStats.sPct}%` : '—', mStats.count > 0 ? `${mStats.sPct}%` : '—'],
    ['A % (STD+Δ to +2Δ)', fStats.count > 0 ? `${fStats.aPct}%` : '—', mStats.count > 0 ? `${mStats.aPct}%` : '—'],
    ['MA % (> STD+2Δ)', fStats.count > 0 ? `${fStats.maPct}%` : '—', mStats.count > 0 ? `${mStats.maPct}%` : '—'],
    ['Sample Count', fStats.count, mStats.count],
    ['Actual Unif (±10%)', fStats.count > 0 ? `${fStats.uniformity10Pct}%` : '—', mStats.count > 0 ? `${mStats.uniformity10Pct}%` : '—']
  ];

  metricRows.forEach((item, idx) => {
    const rowNum = 5 + idx;
    const r = wsCons.getRow(rowNum);
    r.height = 24;

    const bCell = wsCons.getCell(`B${rowNum}`);
    bCell.value = item[0];
    bCell.font = { name: 'Cambria', size: 11, bold: true, color: { argb: 'FF1F2937' } };
    bCell.border = thinBorder;
    bCell.alignment = { horizontal: 'left', vertical: 'middle' };

    const cCell = wsCons.getCell(`C${rowNum}`);
    cCell.value = item[1];
    cCell.font = { name: 'Cambria', size: 12, bold: true, color: { argb: 'FF00B050' } };
    cCell.border = thinBorder;
    cCell.alignment = { horizontal: 'center', vertical: 'middle' };

    const dCell = wsCons.getCell(`D${rowNum}`);
    dCell.value = item[2];
    dCell.font = { name: 'Cambria', size: 12, bold: true, color: { argb: 'FFFF0000' } };
    dCell.border = thinBorder;
    dCell.alignment = { horizontal: 'center', vertical: 'middle' };
  });

  // Shed-wise Summary Table on Right Side (Columns F to R)
  wsCons.mergeCells('F2:R2');
  const shedTableTitle = wsCons.getCell('F2');
  shedTableTitle.value = 'SHED-WISE PERFORMANCE SUMMARY';
  shedTableTitle.font = { name: 'Cambria', size: 12, bold: true, color: { argb: 'FF1E3A8A' } };
  shedTableTitle.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDBEAFE' } };
  shedTableTitle.alignment = { horizontal: 'center', vertical: 'middle' };

  const shedHeaders = [
    'Shed No',
    'Shed Name',
    'Sex',
    'Act B.WT',
    'Min',
    'Max',
    'CV %',
    'MB % (< STD-2Δ)',
    'B % (STD-2Δ to -Δ)',
    'S % (Ideal ±Δ)',
    'A % (STD+Δ to +2Δ)',
    'MA % (> STD+2Δ)',
    'Birds'
  ];
  const shedColLetters = ['F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R'];

  shedHeaders.forEach((h, i) => {
    const cell = wsCons.getCell(`${shedColLetters[i]}4`);
    cell.value = h;
    cell.font = { name: 'Cambria', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2937' } };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.border = headerBorder;
  });

  shedSummaries.forEach((s, idx) => {
    const rowNum = 5 + idx;
    const r = wsCons.getRow(rowNum);
    if (!r.height || r.height < 22) r.height = 22;

    const rowData = [
      s.indexNum,
      s.name,
      s.type,
      s.stats.count > 0 ? `${s.stats.avg} g` : '—',
      s.stats.count > 0 ? `${s.stats.min} g` : '—',
      s.stats.count > 0 ? `${s.stats.max} g` : '—',
      s.stats.cv !== null && s.stats.cv > 0 ? `${s.stats.cv}%` : (s.stats.count > 0 ? 'N/A' : '—'),
      s.stats.count > 0 ? `${s.stats.mbPct}%` : '—',
      s.stats.count > 0 ? `${s.stats.bPct}%` : '—',
      s.stats.count > 0 ? `${s.stats.sPct}%` : '—',
      s.stats.count > 0 ? `${s.stats.aPct}%` : '—',
      s.stats.count > 0 ? `${s.stats.maPct}%` : '—',
      s.stats.count
    ];

    rowData.forEach((val, i) => {
      const cell = wsCons.getCell(`${shedColLetters[i]}${rowNum}`);
      cell.value = val;
      cell.font = { name: 'Cambria', size: 10, bold: i === 0 || i === 3 || i === 9 };
      cell.border = thinBorder;
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      if (s.type === 'Male' && i === 2) {
        cell.font = { name: 'Cambria', size: 10, bold: true, color: { argb: 'FFFF0000' } };
      } else if (s.type === 'Female' && i === 2) {
        cell.font = { name: 'Cambria', size: 10, bold: true, color: { argb: 'FF00B050' } };
      }
    });
  });

  // Part & Line Hierarchical Breakdown Table on Cons Sheet
  const partLineTableTitleRow = 5 + Math.max(metricRows.length, shedSummaries.length) + 2;
  wsCons.mergeCells(`F${partLineTableTitleRow}:R${partLineTableTitleRow}`);
  const plTitleCell = wsCons.getCell(`F${partLineTableTitleRow}`);
  plTitleCell.value = 'PART & LINE HIERARCHICAL IDENTIFIER PERFORMANCE';
  plTitleCell.font = { name: 'Cambria', size: 12, bold: true, color: { argb: 'FF1E3A8A' } };
  plTitleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDBEAFE' } };
  plTitleCell.alignment = { horizontal: 'center', vertical: 'middle' };
  plTitleCell.border = headerBorder;

  const plHeaderRow = partLineTableTitleRow + 1;
  const plHeaders = [
    'Shed',
    'Part',
    'Line',
    'Hierarchical Identifier',
    'Act B.WT',
    'Min',
    'Max',
    'CV %',
    'MB % (< STD-2Δ)',
    'B % (STD-2Δ to -Δ)',
    'S % (Ideal ±Δ)',
    'A % (STD+Δ to +2Δ)',
    'MA % (> STD+2Δ)'
  ];
  plHeaders.forEach((h, i) => {
    const cell = wsCons.getCell(`${shedColLetters[i]}${plHeaderRow}`);
    cell.value = h;
    cell.font = { name: 'Cambria', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2937' } };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.border = headerBorder;
  });

  let currPLRow = plHeaderRow + 1;
  sheds.forEach(s => {
    const std = s.type === 'Male' ? stdWeightMale : stdWeightFemale;
    s.parts.forEach(p => {
      p.lines.forEach(l => {
        const lStats = calculateFlockStats(l.weights, std, weekNum);
        const plData = [
          s.name,
          p.name,
          l.name,
          `${s.name} - ${p.name} - ${l.name}`,
          lStats.count > 0 ? `${lStats.avg} g` : '—',
          lStats.count > 0 ? `${lStats.min} g` : '—',
          lStats.count > 0 ? `${lStats.max} g` : '—',
          lStats.cv !== null && lStats.cv > 0 ? `${lStats.cv}%` : (lStats.count > 0 ? 'N/A' : '—'),
          lStats.count > 0 ? `${lStats.mbPct}%` : '—',
          lStats.count > 0 ? `${lStats.bPct}%` : '—',
          lStats.count > 0 ? `${lStats.sPct}%` : '—',
          lStats.count > 0 ? `${lStats.aPct}%` : '—',
          lStats.count > 0 ? `${lStats.maPct}%` : '—'
        ];
        plData.forEach((val, i) => {
          const cell = wsCons.getCell(`${shedColLetters[i]}${currPLRow}`);
          cell.value = val;
          cell.font = { name: 'Cambria', size: 10, bold: i === 3 || i === 4 || i === 10 };
          cell.border = thinBorder;
          cell.alignment = { horizontal: i === 3 ? 'left' : 'center', vertical: 'middle' };
          if (i === 3) {
            cell.font = { name: 'Cambria', size: 10, bold: true, color: { argb: 'FF0369A1' } };
          }
        });
        currPLRow++;
      });
    });
  });

  // =========================================================================
  // 2. LINE-WISE SHED SHEETS ('Shed 1' through 'Shed 10')
  // =========================================================================
  sheds.forEach(shed => {
    const std = shed.type === 'Male' ? stdWeightMale : stdWeightFemale;
    const bands = getGradingBands(std, weekNum);

    // Flatten all lines across parts
    const flatLines: { colHeader: string; partName: string; lineName: string; weights: number[] }[] = [];
    shed.parts.forEach(p => {
      p.lines.forEach(l => {
        flatLines.push({
          colHeader: `${shed.name} - ${p.name} - ${l.name}`,
          partName: p.name,
          lineName: l.name,
          weights: filterValidWeights(l.weights)
        });
      });
    });

    if (flatLines.length === 0) {
      flatLines.push({
        colHeader: `${shed.name} - Part A - Line 1`,
        partName: 'Part A',
        lineName: 'Line 1',
        weights: []
      });
    }

    const sheetName = (shed.sheetName || shed.name).substring(0, 31);
    const ws = workbook.addWorksheet(sheetName, {
      views: [{ showGridLines: true }]
    });

    const lastCol = Math.max(3, 1 + flatLines.length * 2);

    // Row 1: Farm, Shed, Gender, Age, and Target information
    ws.mergeCells(1, 1, 1, lastCol);
    const r1 = ws.getCell(1, 1);
    r1.value = `Farm: ${farmName}  |  Shed: ${shed.name}  |  Gender: ${shed.type}  |  Age: ${ageWeek}${shed.type === 'Male' ? 'M' : 'F'}  |  STD B.WT: ${std} g (Tolerance: ±${bands.tolerance}g, S Band: ${bands.sMin}g - ${bands.sMax}g)`;
    r1.font = { name: 'Cambria', size: 11, bold: true, color: { argb: 'FF1F2937' } };
    r1.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } };
    r1.alignment = { horizontal: 'left', vertical: 'middle' };
    r1.border = thinBorder;
    ws.getRow(1).height = 24;

    // Row 2: Part Metadata Header
    const a2 = ws.getCell('A2');
    a2.value = 'Part';
    a2.font = { name: 'Cambria', size: 10, bold: true, color: { argb: 'FF1F2937' } };
    a2.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF66' } };
    a2.alignment = { horizontal: 'center', vertical: 'middle' };
    a2.border = headerBorder;
    ws.getRow(2).height = 22;

    // Row 3: Line Metadata Header with Full Hierarchical Identifier
    const a3 = ws.getCell('A3');
    a3.value = 'Line';
    a3.font = { name: 'Cambria', size: 10, bold: true, color: { argb: 'FF0369A1' } };
    a3.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0F2FE' } };
    a3.alignment = { horizontal: 'center', vertical: 'middle' };
    a3.border = headerBorder;
    ws.getRow(3).height = 22;

    // Row 4: Column Headers: Sample #, Weight (g), Grade
    const a4 = ws.getCell('A4');
    a4.value = 'Sample #';
    a4.font = { name: 'Cambria', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    a4.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF374151' } };
    a4.alignment = { horizontal: 'center', vertical: 'middle' };
    a4.border = headerBorder;
    ws.getRow(4).height = 24;

    ws.getColumn(1).width = 12;

    flatLines.forEach((fl, flIdx) => {
      const wtCol = 2 + flIdx * 2;
      const grCol = 3 + flIdx * 2;

      ws.getColumn(wtCol).width = 16;
      ws.getColumn(grCol).width = 14;

      // Row 2: Part metadata
      ws.mergeCells(2, wtCol, 2, grCol);
      const partCell = ws.getCell(2, wtCol);
      partCell.value = `Part: ${fl.partName}`;
      partCell.font = { name: 'Cambria', size: 10, bold: true, color: { argb: 'FF1F2937' } };
      partCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF66' } };
      partCell.alignment = { horizontal: 'center', vertical: 'middle' };
      partCell.border = headerBorder;

      // Row 3: Line metadata with full hierarchical identifier
      ws.mergeCells(3, wtCol, 3, grCol);
      const lineCell = ws.getCell(3, wtCol);
      lineCell.value = `${shed.name} - ${fl.partName} - ${fl.lineName}`;
      lineCell.font = { name: 'Cambria', size: 10, bold: true, color: { argb: 'FF0369A1' } };
      lineCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0F2FE' } };
      lineCell.alignment = { horizontal: 'center', vertical: 'middle' };
      lineCell.border = headerBorder;

      // Row 4: Weight (g) & Grade (MB/B/S/A/MA)
      const wtHeader = ws.getCell(4, wtCol);
      wtHeader.value = 'Weight (g)';
      wtHeader.font = { name: 'Cambria', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
      wtHeader.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2937' } };
      wtHeader.alignment = { horizontal: 'center', vertical: 'middle' };
      wtHeader.border = headerBorder;

      const grHeader = ws.getCell(4, grCol);
      grHeader.value = 'Grade (MB/B/S/A/MA)';
      grHeader.font = { name: 'Cambria', size: 9, bold: true, color: { argb: 'FFFFFFFF' } };
      grHeader.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF374151' } };
      grHeader.alignment = { horizontal: 'center', vertical: 'middle' };
      grHeader.border = headerBorder;
    });

    // Rows 5 to 54 (or more if readings > 50 to prevent silent data loss)
    const maxReadings = Math.max(...flatLines.map(fl => fl.weights.length), 50);
    const sampleEndRow = 4 + maxReadings;

    for (let sampleIdx = 0; sampleIdx < maxReadings; sampleIdx++) {
      const rowNum = 5 + sampleIdx;
      const birdNumCell = ws.getCell(rowNum, 1);
      birdNumCell.value = sampleIdx + 1;
      birdNumCell.font = { name: 'Cambria', size: 10, color: { argb: 'FF6B7280' } };
      birdNumCell.alignment = { horizontal: 'center', vertical: 'middle' };
      birdNumCell.border = thinBorder;

      flatLines.forEach((fl, flIdx) => {
        const wtCol = 2 + flIdx * 2;
        const grCol = 3 + flIdx * 2;
        const w = fl.weights[sampleIdx];

        const wCell = ws.getCell(rowNum, wtCol);
        const gCell = ws.getCell(rowNum, grCol);

        wCell.border = thinBorder;
        gCell.border = thinBorder;
        wCell.alignment = { horizontal: 'center', vertical: 'middle' };
        gCell.alignment = { horizontal: 'center', vertical: 'middle' };

        if (w !== undefined && typeof w === 'number' && Number.isFinite(w) && w > 0) {
          const grade = getBirdGrade(w, bands);
          wCell.value = w;
          wCell.font = { name: 'Cambria', size: 11, bold: true };
          gCell.value = grade;
          gCell.font = { name: 'Cambria', size: 10, bold: true };

          if (grade === 'S') {
            gCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD1FAE5' } };
            gCell.font = { name: 'Cambria', size: 10, bold: true, color: { argb: 'FF065F46' } };
          } else if (grade === 'MB') {
            gCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEE2E2' } };
            gCell.font = { name: 'Cambria', size: 10, bold: true, color: { argb: 'FF991B1B' } };
          } else if (grade === 'B') {
            gCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF3C7' } };
            gCell.font = { name: 'Cambria', size: 10, bold: true, color: { argb: 'FF92400E' } };
          } else if (grade === 'A') {
            gCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0F2FE' } };
            gCell.font = { name: 'Cambria', size: 10, bold: true, color: { argb: 'FF075985' } };
          } else if (grade === 'MA') {
            gCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3E8FF' } };
            gCell.font = { name: 'Cambria', size: 10, bold: true, color: { argb: 'FF6B21A8' } };
          }
        } else {
          wCell.value = '';
          gCell.value = '';
        }
      });
    }

    // Offset for summary rows if readings exceed 50
    const rowOffset = Math.max(0, maxReadings - 50);

    // Summary Rows matching Suguna layout:
    // Row 56: Count
    // Row 58: Average Weight (g)
    // Row 59: Target Deviation (Std +/-)
    // Row 60: Minimum Weight (g)
    // Row 61: Maximum Weight (g)
    // Row 62: CV %
    // Rows 63–67: MB, B, S, A, MA distributions
    // Row 68: Total Grade Count
    // Row 69: Standard Uniformity (Grade S%)
    // Row 76: Actual Body-Weight Uniformity (±10% Act WT)
    interface SummaryRowDef {
      baseRow: number;
      label: string;
      isRedBold?: boolean;
      buildFormulaAndResult: (
        wtColLetter: string,
        lineStats: StatisticalSummary,
        actualRow: number
      ) => { formula: string; result: any };
    }

    const summaryRowDefs: SummaryRowDef[] = [
      {
        baseRow: 56,
        label: 'Bird Count (N)',
        isRedBold: true,
        buildFormulaAndResult: (colLetter, s) => ({
          formula: `COUNT(${colLetter}5:${colLetter}${sampleEndRow})`,
          result: s.count
        })
      },
      {
        baseRow: 58,
        label: 'Average Weight (g)',
        buildFormulaAndResult: (colLetter, s) => ({
          formula: `IF(COUNT(${colLetter}5:${colLetter}${sampleEndRow})>0,ROUND(AVERAGE(${colLetter}5:${colLetter}${sampleEndRow}),1),"")`,
          result: s.count > 0 ? s.avg : ''
        })
      },
      {
        baseRow: 59,
        label: 'Target Deviation (Std +/-)',
        buildFormulaAndResult: (colLetter, s, actualRow) => {
          const avgRow = actualRow - 1;
          return {
            formula: `IF(${colLetter}${avgRow}<>"","ROUND(${colLetter}${avgRow}-${std},1)","")`,
            result: s.count > 0 ? (s.diff > 0 ? `+${s.diff}` : `${s.diff}`) : ''
          };
        }
      },
      {
        baseRow: 60,
        label: 'Minimum Weight (g)',
        buildFormulaAndResult: (colLetter, s) => ({
          formula: `IF(COUNT(${colLetter}5:${colLetter}${sampleEndRow})>0,MIN(${colLetter}5:${colLetter}${sampleEndRow}),"")`,
          result: s.count > 0 ? s.min : ''
        })
      },
      {
        baseRow: 61,
        label: 'Maximum Weight (g)',
        buildFormulaAndResult: (colLetter, s) => ({
          formula: `IF(COUNT(${colLetter}5:${colLetter}${sampleEndRow})>0,MAX(${colLetter}5:${colLetter}${sampleEndRow}),"")`,
          result: s.count > 0 ? s.max : ''
        })
      },
      {
        baseRow: 62,
        label: 'CV % (Range/Avg*F)',
        buildFormulaAndResult: (colLetter, s, actualRow) => {
          const avgRow = actualRow - 4;
          const minRow = actualRow - 2;
          const maxRow = actualRow - 1;
          const fVal = s.fFactor || 4.5;
          return {
            formula: `IF(AND(${colLetter}${avgRow}>0,${fVal}>0),ROUND(((${colLetter}${maxRow}-${colLetter}${minRow})*100)/(${colLetter}${avgRow}*${fVal}),2),"")`,
            result: s.cv !== null && s.cv > 0 ? `${s.cv}%` : (s.count > 0 ? 'N/A' : '')
          };
        }
      },
      {
        baseRow: 63,
        label: `MB Count (< ${bands.bMin}g)`,
        buildFormulaAndResult: (colLetter, s) => ({
          formula: `COUNTIF(${colLetter}5:${colLetter}${sampleEndRow},"<${bands.bMin}")`,
          result: s.count > 0 ? s.mbCount : ''
        })
      },
      {
        baseRow: 64,
        label: `B Count (${bands.bMin}g - ${bands.sMin}g)`,
        buildFormulaAndResult: (colLetter, s) => ({
          formula: `COUNTIFS(${colLetter}5:${colLetter}${sampleEndRow},">=${bands.bMin}",${colLetter}5:${colLetter}${sampleEndRow},"<${bands.sMin}")`,
          result: s.count > 0 ? s.bCount : ''
        })
      },
      {
        baseRow: 65,
        label: `S Count (${bands.sMin}g - ${bands.sMax}g)`,
        buildFormulaAndResult: (colLetter, s) => ({
          formula: `COUNTIFS(${colLetter}5:${colLetter}${sampleEndRow},">=${bands.sMin}",${colLetter}5:${colLetter}${sampleEndRow},"<=${bands.sMax}")`,
          result: s.count > 0 ? s.sCount : ''
        })
      },
      {
        baseRow: 66,
        label: `A Count (${bands.sMax}g - ${bands.aMax}g)`,
        buildFormulaAndResult: (colLetter, s) => ({
          formula: `COUNTIFS(${colLetter}5:${colLetter}${sampleEndRow},">${bands.sMax}",${colLetter}5:${colLetter}${sampleEndRow},"<=${bands.aMax}")`,
          result: s.count > 0 ? s.aCount : ''
        })
      },
      {
        baseRow: 67,
        label: `MA Count (> ${bands.aMax}g)`,
        buildFormulaAndResult: (colLetter, s) => ({
          formula: `COUNTIF(${colLetter}5:${colLetter}${sampleEndRow},">${bands.aMax}")`,
          result: s.count > 0 ? s.maCount : ''
        })
      },
      {
        baseRow: 68,
        label: 'Total Birds Graded',
        buildFormulaAndResult: (colLetter, s, actualRow) => {
          const mbRow = actualRow - 5;
          const maRow = actualRow - 1;
          return {
            formula: `SUM(${colLetter}${mbRow}:${colLetter}${maRow})`,
            result: s.count > 0 ? s.count : ''
          };
        }
      },
      {
        baseRow: 69,
        label: 'Standard Uniformity (Grade S%)',
        buildFormulaAndResult: (colLetter, s, actualRow) => {
          const countRow = actualRow - 13;
          const sRow = actualRow - 4;
          return {
            formula: `IF(${colLetter}${countRow}>0,ROUND((${colLetter}${sRow}/${colLetter}${countRow})*100,1),"")`,
            result: s.count > 0 ? `${s.sPct}%` : ''
          };
        }
      },
      {
        baseRow: 76,
        label: 'Actual Body-Weight Uniformity (±10%)',
        buildFormulaAndResult: (colLetter, s, actualRow) => {
          const countRow = actualRow - 20;
          const avgRow = actualRow - 18;
          return {
            formula: `IF(${colLetter}${countRow}>0,ROUND((COUNTIFS(${colLetter}5:${colLetter}${sampleEndRow},">="&ROUND(${colLetter}${avgRow}*0.9,1),${colLetter}5:${colLetter}${sampleEndRow},"<="&ROUND(${colLetter}${avgRow}*1.1,1))/${colLetter}${countRow})*100,1),"")`,
            result: s.count > 0 ? `${s.uniformity10Pct}%` : ''
          };
        }
      }
    ];

    const totalGradedRow = 68 + rowOffset;

    // Grade styling mapping for percentage column
    const gradeStyleMap: Record<number, { bg: string; font: string; pctKey: 'mbPct' | 'bPct' | 'sPct' | 'aPct' | 'maPct' }> = {
      63: { bg: 'FFFEE2E2', font: 'FF991B1B', pctKey: 'mbPct' },
      64: { bg: 'FFFEF3C7', font: 'FF92400E', pctKey: 'bPct' },
      65: { bg: 'FFD1FAE5', font: 'FF065F46', pctKey: 'sPct' },
      66: { bg: 'FFE0F2FE', font: 'FF075985', pctKey: 'aPct' },
      67: { bg: 'FFF3E8FF', font: 'FF6B21A8', pctKey: 'maPct' }
    };

    summaryRowDefs.forEach(def => {
      const actualRow = def.baseRow + rowOffset;
      const lblCell = ws.getCell(actualRow, 1);
      lblCell.value = def.label;
      lblCell.font = {
        name: 'Cambria',
        size: 10,
        bold: true,
        color: { argb: def.isRedBold ? 'FFFF0000' : 'FF1F2937' }
      };
      lblCell.alignment = { horizontal: 'left', vertical: 'middle' };
      lblCell.border = thinBorder;

      flatLines.forEach((fl, flIdx) => {
        const wtCol = 2 + flIdx * 2;
        const grCol = 3 + flIdx * 2;
        const wtColLetter = getColumnLetter(wtCol);

        const lineStats = calculateFlockStats(fl.weights, std, weekNum);
        const { formula, result } = def.buildFormulaAndResult(wtColLetter, lineStats, actualRow);

        // Beside each weight category count (MB, B, S, A, MA), add an adjacent percentage (%) column
        if (def.baseRow >= 63 && def.baseRow <= 67) {
          const gradeInfo = gradeStyleMap[def.baseRow];

          // 1. Category Count in wtCol
          const countCell = ws.getCell(actualRow, wtCol);
          countCell.value = {
            formula,
            result: lineStats.count > 0 ? result : ''
          };
          countCell.font = { name: 'Cambria', size: 11, bold: true, color: { argb: 'FF111827' } };
          countCell.alignment = { horizontal: 'center', vertical: 'middle' };
          countCell.border = thinBorder;

          // 2. Adjacent Percentage (%) in grCol: [Category Count] / [Total Birds Graded] * 100
          const pctCell = ws.getCell(actualRow, grCol);
          const pctVal = lineStats[gradeInfo.pctKey];
          pctCell.value = {
            formula: `IF(${wtColLetter}${totalGradedRow}>0,ROUND((${wtColLetter}${actualRow}/${wtColLetter}${totalGradedRow})*100,1),"")`,
            result: lineStats.count > 0 ? `${pctVal}%` : ''
          };
          pctCell.font = { name: 'Cambria', size: 10, bold: true, color: { argb: gradeInfo.font } };
          pctCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: gradeInfo.bg } };
          pctCell.alignment = { horizontal: 'center', vertical: 'middle' };
          pctCell.border = thinBorder;
        } else if (def.baseRow === 68) {
          // Total Birds Graded: count in wtCol, 100.0% in grCol
          const countCell = ws.getCell(actualRow, wtCol);
          countCell.value = {
            formula,
            result: lineStats.count > 0 ? result : ''
          };
          countCell.font = { name: 'Cambria', size: 11, bold: true, color: { argb: 'FF111827' } };
          countCell.alignment = { horizontal: 'center', vertical: 'middle' };
          countCell.border = thinBorder;

          const pctCell = ws.getCell(actualRow, grCol);
          pctCell.value = {
            formula: `IF(${wtColLetter}${actualRow}>0,100,"")`,
            result: lineStats.count > 0 ? '100.0%' : ''
          };
          pctCell.font = { name: 'Cambria', size: 10, bold: true, color: { argb: 'FF111827' } };
          pctCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } };
          pctCell.alignment = { horizontal: 'center', vertical: 'middle' };
          pctCell.border = thinBorder;
        } else {
          // Other summary rows merge across wtCol and grCol
          ws.mergeCells(actualRow, wtCol, actualRow, grCol);
          const valCell = ws.getCell(actualRow, wtCol);
          valCell.value = {
            formula,
            result: lineStats.count > 0 ? result : ''
          };
          valCell.font = {
            name: 'Cambria',
            size: 11,
            bold: true,
            color: { argb: def.isRedBold ? 'FFFF0000' : 'FF111827' }
          };
          valCell.alignment = { horizontal: 'center', vertical: 'middle' };
          valCell.border = thinBorder;
        }
      });
    });

    // Row 85: Verified active F-Factor indicator
    const totalShedWeights = filterValidWeights(
      shed.parts.flatMap(p => p.lines.flatMap(l => l.weights))
    );
    const shedTotalStats = calculateFlockStats(totalShedWeights, std, weekNum);
    const fFactorRow = 85 + rowOffset;

    ws.mergeCells(`B${fFactorRow}:F${fFactorRow}`);
    const fCell = ws.getCell(`B${fFactorRow}`);
    const fDisplay = shedTotalStats.fFactor !== null ? shedTotalStats.fFactor : 'N/A (unsupported N)';
    fCell.value = `Verified F-Factor: ${fDisplay}  |  Total Shed Weighed Birds: ${shedTotalStats.count}`;
    fCell.font = { name: 'Cambria', size: 11, bold: true, color: { argb: 'FF065F46' } };
    fCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF00FF99' } };
    fCell.alignment = { horizontal: 'center', vertical: 'middle' };
    fCell.border = headerBorder;
  });

  // =========================================================================
  // 3. REFERENCE BENCHMARK SHEETS ('Summer Brooding' & 'Winter Brooding')
  // =========================================================================
  const addBenchmarkReferenceSheet = (
    sheetTitle: string,
    standards: typeof WINTER_BROOD_STANDARDS,
    accentColor: string
  ) => {
    const ws = workbook.addWorksheet(sheetTitle, {
      views: [{ showGridLines: true }]
    });

    ws.columns = [
      { width: 8 },   // Week
      { width: 14 },  // Female STD
      { width: 13 },  // Female Gain
      { width: 14 },  // Female Feed
      { width: 14 },  // Male STD
      { width: 13 },  // Male Gain
      { width: 14 },  // Male Feed
      { width: 12 },  // Tolerance
      { width: 18 }   // S Uniform Band
    ];

    // Title Row
    ws.mergeCells('A1:I1');
    const titleCell = ws.getCell('A1');
    titleCell.value = `SUGUNA STANDARD BENCHMARKS - ${sheetTitle.toUpperCase()}`;
    titleCell.font = { name: 'Calibri', size: 14, bold: true, color: { argb: 'FF1F2937' } };
    titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: accentColor } };
    titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
    titleCell.border = headerBorder;

    // Headers Row 3
    const headers = [
      'Age (Wk)',
      'Female STD (g)',
      'F. Gain (g)',
      'F. Feed (g/d)',
      'Male STD (g)',
      'M. Gain (g)',
      'M. Feed (g/d)',
      'Tolerance',
      'S (Ideal) Band'
    ];

    headers.forEach((h, i) => {
      const cell = ws.getCell(3, i + 1);
      cell.value = h;
      cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2937' } };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.border = headerBorder;
    });

    // Rows 4 to 27 (Weeks 1 to 24)
    standards.forEach((item, idx) => {
      const rowNum = 4 + idx;
      const tol = getToleranceForWeek(item.week);
      const isSelectedAge = item.week === weekNum;

      const rowVals = [
        `W${item.week}`,
        item.femaleWeight,
        item.femaleGain,
        item.femaleFeed,
        item.maleWeight,
        item.maleGain,
        item.maleFeed,
        `±${tol}g`,
        `${item.femaleWeight - tol}g - ${item.femaleWeight + tol}g`
      ];

      rowVals.forEach((val, colIdx) => {
        const cell = ws.getCell(rowNum, colIdx + 1);
        cell.value = val;
        cell.font = {
          name: 'Calibri',
          size: 10,
          bold: isSelectedAge || colIdx === 0,
          color: { argb: isSelectedAge ? 'FFFF0000' : 'FF1F2937' }
        };
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        cell.border = thinBorder;

        if (isSelectedAge) {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF66' } };
        } else if (idx % 2 === 1) {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: accentColor } };
        }
      });
    });
  };

  // 12. Summer Brooding
  addBenchmarkReferenceSheet('Summer Brooding', SUMMER_BROOD_STANDARDS, 'FFFFFFCC');

  // 13. Winter Brooding
  addBenchmarkReferenceSheet('Winter Brooding', WINTER_BROOD_STANDARDS, 'FFCCFFFF');

  // Export buffer & download
  const buffer = await workbook.xlsx.writeBuffer();
  let safeFarm = (farmName || 'Poultry_Flock').trim();
  if (!safeFarm || /^[0-9a-fA-F-]{16,}$/.test(safeFarm) || /^(shed|farm|flock|user)[-_]/i.test(safeFarm)) {
    safeFarm = 'Poultry_Flock';
  }
  safeFarm = safeFarm.replace(/[^a-zA-Z0-9_-]/g, '_');
  const safeDate = dateStr || new Date().toISOString().split('T')[0];
  const safeAge = ageWeek || 'W18';
  const fileName = sanitizeFileName(`${safeFarm}_Conclusion_${safeAge}_${safeDate}.xlsx`);

  const downloadResult = await downloadExcelFile(buffer, fileName);
  return {
    success: downloadResult.success,
    method: downloadResult.method,
    fileName,
    buffer
  };
}

export interface ExportShedParams {
  farmName?: string;
  shedName: string;
  season?: string;
  week: number;
  dateStr?: string;
  summary: ShedSummaryData;
}

/**
 * Generate a beautifully formatted, standalone .xlsx workbook for a specific shed audit
 */
export async function exportShedWorkbook(
  params: ExportShedParams
): Promise<{ success: boolean; method: string; fileName: string; buffer?: ArrayBuffer }> {
  const { farmName, shedName, season, week, dateStr, summary } = params;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Poultry Weight Tracker (Suguna Foods System)';
  workbook.created = new Date();

  const thinBorder: Partial<ExcelJS.Borders> = {
    top: { style: 'thin', color: { argb: 'FFD1D5DB' } },
    left: { style: 'thin', color: { argb: 'FFD1D5DB' } },
    bottom: { style: 'thin', color: { argb: 'FFD1D5DB' } },
    right: { style: 'thin', color: { argb: 'FFD1D5DB' } }
  };

  const headerBorder: Partial<ExcelJS.Borders> = {
    top: { style: 'medium', color: { argb: 'FF4B5563' } },
    left: { style: 'thin', color: { argb: 'FF9CA3AF' } },
    bottom: { style: 'medium', color: { argb: 'FF4B5563' } },
    right: { style: 'thin', color: { argb: 'FF9CA3AF' } }
  };

  const sheet = workbook.addWorksheet(`${shedName || 'Shed'} - Wk ${week}`.substring(0, 31));
  sheet.views = [{ showGridLines: true }];

  // 1. Title Banner
  sheet.mergeCells('A1:N1');
  const titleCell = sheet.getCell('A1');
  titleCell.value = 'SUGUNA FOODS — SHED-WISE FLOCK BODY WEIGHT & UNIFORMITY AUDIT';
  titleCell.font = { name: 'Cambria', size: 14, bold: true, color: { argb: 'FFFFFFFF' } };
  titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A8A' } };
  titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
  sheet.getRow(1).height = 32;

  // 2. Metadata Header
  sheet.getCell('A2').value = 'Farm Name:';
  sheet.getCell('B2').value = farmName || 'Suguna Complex';
  sheet.getCell('D2').value = 'Shed / House:';
  sheet.getCell('E2').value = shedName;
  sheet.getCell('G2').value = 'Season:';
  sheet.getCell('H2').value = season || 'Standard';
  sheet.getCell('J2').value = 'Audit Age:';
  sheet.getCell('K2').value = `Week ${week}`;
  sheet.getCell('M2').value = 'Date:';
  sheet.getCell('N2').value = dateStr || new Date().toISOString().split('T')[0];

  ['A2', 'D2', 'G2', 'J2', 'M2'].forEach(ref => {
    const c = sheet.getCell(ref);
    c.font = { name: 'Cambria', size: 10, bold: true, color: { argb: 'FF4B5563' } };
  });
  ['B2', 'E2', 'H2', 'K2', 'N2'].forEach(ref => {
    const c = sheet.getCell(ref);
    c.font = { name: 'Cambria', size: 10, bold: true, color: { argb: 'FF1F2937' } };
  });

  // 3. KPI Aggregate Metrics
  sheet.mergeCells('A4:N4');
  const kpiHeader = sheet.getCell('A4');
  kpiHeader.value = 'SHED AGGREGATE PERFORMANCE METRICS';
  kpiHeader.font = { name: 'Cambria', size: 11, bold: true, color: { argb: 'FF1E3A8A' } };
  kpiHeader.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDBEAFE' } };
  kpiHeader.alignment = { horizontal: 'left', vertical: 'middle' };
  sheet.getRow(4).height = 24;

  const kpis = [
    ['Shed Overall Avg Weight', `${summary.shedAverageWeight} g`, 'Total Live Birds', summary.totalLiveBirds.toLocaleString()],
    ['Shed Uniformity (±10%)', `${summary.shedUniformityPercent}%`, 'Sample Birds Weighed', summary.totalSampleBirdsWeighed],
    ['Shed Uniformity Grade', summary.shedStatus, 'Daily Feed Requirement', `${summary.totalDailyFeedKg} kg`],
    ['Deviating Pens Count', summary.deviatingPensCount, '50kg Bags Required', `${summary.totalFeedBags50kg} bags`],
  ];

  kpis.forEach((row, idx) => {
    const rNum = 5 + idx;
    sheet.getCell(`A${rNum}`).value = row[0];
    sheet.getCell(`B${rNum}`).value = row[1];
    sheet.getCell(`D${rNum}`).value = row[2];
    sheet.getCell(`E${rNum}`).value = row[3];
    sheet.getRow(rNum).height = 20;
    sheet.getCell(`A${rNum}`).font = { name: 'Cambria', size: 10, bold: true, color: { argb: 'FF4B5563' } };
    sheet.getCell(`D${rNum}`).font = { name: 'Cambria', size: 10, bold: true, color: { argb: 'FF4B5563' } };
    sheet.getCell(`B${rNum}`).font = { name: 'Cambria', size: 10, bold: true, color: { argb: 'FF1F2937' } };
    sheet.getCell(`E${rNum}`).font = { name: 'Cambria', size: 10, bold: true, color: { argb: 'FF1F2937' } };
  });

  // 4. Pen Breakdown Table
  const tableHeaderRow = 10;
  sheet.mergeCells(`A${tableHeaderRow - 1}:N${tableHeaderRow - 1}`);
  const penSecHeader = sheet.getCell(`A${tableHeaderRow - 1}`);
  penSecHeader.value = 'PEN-BY-PEN AUDIT BREAKDOWN';
  penSecHeader.font = { name: 'Cambria', size: 11, bold: true, color: { argb: 'FF1E3A8A' } };
  penSecHeader.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDBEAFE' } };
  sheet.getRow(tableHeaderRow - 1).height = 24;

  const headers = [
    'Pen', 'Sex', 'Breed', 'Live Birds', 'Sample (N)', 'Avg Wt (g)',
    'Uniformity %', 'CV %', 'Feed/Bird (g)', 'Daily Feed (kg)', '50kg Bags',
    'Dev Mean (g)', 'Dev %', 'Status'
  ];
  const colLetters = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N'];
  headers.forEach((h, i) => {
    const cell = sheet.getCell(`${colLetters[i]}${tableHeaderRow}`);
    cell.value = h;
    cell.font = { name: 'Cambria', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2937' } };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.border = headerBorder;
  });
  sheet.getRow(tableHeaderRow).height = 26;

  (summary.pens || []).forEach((p, idx) => {
    const rNum = tableHeaderRow + 1 + idx;
    const r = sheet.getRow(rNum);
    r.height = 22;

    const rowData = [
      p.penNumber,
      p.sex,
      p.breed,
      p.liveBirdCount,
      p.sampleSize,
      p.averageWeight,
      `${p.uniformityPercent}%`,
      `${p.cvPercent}%`,
      `${p.suggestedFeedGrams}g`,
      `${p.dailyFeedKg} kg`,
      p.feedBags50kg,
      `${p.deviationFromShedMeanGrams > 0 ? '+' : ''}${p.deviationFromShedMeanGrams}g`,
      `${p.deviationFromShedMeanPercent > 0 ? '+' : ''}${p.deviationFromShedMeanPercent}%`,
      p.status
    ];

    rowData.forEach((val, i) => {
      const cell = sheet.getCell(`${colLetters[i]}${rNum}`);
      cell.value = val;
      cell.font = { name: 'Cambria', size: 10, bold: i === 0 || i === 5 || i === 6 || i === 13 };
      cell.border = thinBorder;
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      if (idx % 2 === 1) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF9FAFB' } };
      }
      if (i === 13) {
        if (p.status === 'EXCELLENT') {
          cell.font = { name: 'Cambria', size: 10, bold: true, color: { argb: 'FF059669' } };
        } else if (p.status === 'ACCEPTABLE') {
          cell.font = { name: 'Cambria', size: 10, bold: true, color: { argb: 'FFD97706' } };
        } else {
          cell.font = { name: 'Cambria', size: 10, bold: true, color: { argb: 'FFE11D48' } };
        }
      }
    });
  });

  // 5. Deviation Alerts
  if (summary.alerts && summary.alerts.length > 0) {
    const alertStartRow = tableHeaderRow + (summary.pens || []).length + 2;
    sheet.mergeCells(`A${alertStartRow}:N${alertStartRow}`);
    const alertHeader = sheet.getCell(`A${alertStartRow}`);
    alertHeader.value = 'PEN DEVIATION ALERTS & RECOMMENDATIONS';
    alertHeader.font = { name: 'Cambria', size: 11, bold: true, color: { argb: 'FF991B1B' } };
    alertHeader.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEE2E2' } };
    alertHeader.alignment = { horizontal: 'left', vertical: 'middle' };
    sheet.getRow(alertStartRow).height = 24;

    summary.alerts.forEach((alertText, aIdx) => {
      const aRow = alertStartRow + 1 + aIdx;
      sheet.mergeCells(`A${aRow}:N${aRow}`);
      const aCell = sheet.getCell(`A${aRow}`);
      aCell.value = `• ${alertText}`;
      aCell.font = { name: 'Cambria', size: 10, italic: true, color: { argb: 'FFB91C1C' } };
      aCell.alignment = { horizontal: 'left', vertical: 'middle' };
      sheet.getRow(aRow).height = 20;
    });
  }

  // Adjust column widths
  sheet.columns = [
    { width: 10 },
    { width: 10 },
    { width: 12 },
    { width: 14 },
    { width: 13 },
    { width: 14 },
    { width: 14 },
    { width: 10 },
    { width: 14 },
    { width: 15 },
    { width: 12 },
    { width: 15 },
    { width: 12 },
    { width: 15 }
  ];

  const buffer = await workbook.xlsx.writeBuffer();
  let safeFarm = (farmName || 'Poultry_Farm').trim();
  if (!safeFarm || /^[0-9a-fA-F-]{16,}$/.test(safeFarm) || /^(shed|farm)[-_]/i.test(safeFarm)) {
    safeFarm = 'Poultry_Farm';
  }
  safeFarm = safeFarm.replace(/[^a-zA-Z0-9_-]/g, '_');
  const safeShed = (shedName || 'Shed').trim().replace(/[^a-zA-Z0-9_-]/g, '_');
  const safeDate = dateStr || new Date().toISOString().split('T')[0];
  const fileName = sanitizeFileName(`${safeFarm}_${safeShed}_Week${week}_${safeDate}.xlsx`);

  const downloadResult = await downloadExcelFile(buffer, fileName);
  return {
    success: downloadResult.success,
    method: downloadResult.method,
    fileName,
    buffer
  };
}

export interface ExportPenParams {
  farmName?: string;
  shedName?: string;
  penNo: string | number;
  breed?: string;
  sex?: string;
  week: number;
  dateStr: string;
  weighedBy?: string;
  record: WeighingRecord;
}

/**
 * Generate a beautifully formatted .xlsx workbook for a single pen weighing recording
 */
export async function exportPenWeighingWorkbook(
  params: ExportPenParams
): Promise<{ success: boolean; method: string; fileName: string; buffer?: ArrayBuffer }> {
  const { farmName, shedName, penNo, breed, sex, week, dateStr, weighedBy, record } = params;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Poultry Weight Tracker (Suguna Foods System)';
  workbook.created = new Date();

  const thinBorder: Partial<ExcelJS.Borders> = {
    top: { style: 'thin', color: { argb: 'FFD1D5DB' } },
    left: { style: 'thin', color: { argb: 'FFD1D5DB' } },
    bottom: { style: 'thin', color: { argb: 'FFD1D5DB' } },
    right: { style: 'thin', color: { argb: 'FFD1D5DB' } }
  };

  const sheet = workbook.addWorksheet(`Pen ${penNo} - Wk ${week}`.substring(0, 31));
  sheet.views = [{ showGridLines: true }];

  // 1. Title Banner
  sheet.mergeCells('A1:D1');
  const titleCell = sheet.getCell('A1');
  titleCell.value = 'SUGUNA FOODS — POULTRY BODY WEIGHT & UNIFORMITY RECORDING SHEET';
  titleCell.font = { name: 'Cambria', size: 13, bold: true, color: { argb: 'FFFFFFFF' } };
  titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A8A' } };
  titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
  sheet.getRow(1).height = 32;

  // 2. Pen Metadata
  const meta = [
    ['Farm Name:', farmName || 'Poultry Farm', 'House / Shed:', shedName || 'House 1'],
    ['Pen Number:', `Pen ${penNo}`, 'Breed / Sex:', `${breed || 'Standard'} / ${sex || 'Female'}`],
    ['Audit Age:', `Week ${week}`, 'Date:', dateStr || record.weighDate],
    ['Target Weight:', `${record.targetWeight} g`, 'Recorded By:', weighedBy || record.weighedBy || 'Supervisor'],
  ];

  meta.forEach((row, i) => {
    const rNum = 2 + i;
    sheet.getCell(`A${rNum}`).value = row[0];
    sheet.getCell(`B${rNum}`).value = row[1];
    sheet.getCell(`C${rNum}`).value = row[2];
    sheet.getCell(`D${rNum}`).value = row[3];
    sheet.getCell(`A${rNum}`).font = { name: 'Cambria', size: 10, bold: true, color: { argb: 'FF4B5563' } };
    sheet.getCell(`C${rNum}`).font = { name: 'Cambria', size: 10, bold: true, color: { argb: 'FF4B5563' } };
    sheet.getCell(`B${rNum}`).font = { name: 'Cambria', size: 10, bold: true, color: { argb: 'FF1F2937' } };
    sheet.getCell(`D${rNum}`).font = { name: 'Cambria', size: 10, bold: true, color: { argb: 'FF1F2937' } };
    sheet.getRow(rNum).height = 20;
  });

  // 3. Summary Metrics
  sheet.mergeCells('A7:D7');
  const summaryHeader = sheet.getCell('A7');
  summaryHeader.value = 'AUDIT SUMMARY & UNIFORMITY METRICS';
  summaryHeader.font = { name: 'Cambria', size: 11, bold: true, color: { argb: 'FF1E3A8A' } };
  summaryHeader.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDBEAFE' } };
  sheet.getRow(7).height = 24;

  const stats = [
    ['Actual Avg Weight', `${record.actualAvgWeight} g`, 'Total Sample (N)', record.sampleSize],
    ['Uniformity (±10%)', `${record.uniformityPercent}%`, 'Uniform Birds', record.uniformCount],
    ['CV % (F-Factor)', `${record.cvPercent}%`, 'Underweight Birds', record.underCount],
    ['Standard Deviation', `${record.stdDev} g`, 'Overweight Birds', record.overCount],
    ['Weight Range', `${record.weightRange} g (${record.lightestWeight}g - ${record.heaviestWeight}g)`, 'Uniformity Status', record.status],
    ['Suggested Feed', `${record.suggestedFeedGrams} g/bird/day`, 'F-Factor Value', record.fValue],
  ];

  stats.forEach((row, i) => {
    const rNum = 8 + i;
    sheet.getCell(`A${rNum}`).value = row[0];
    sheet.getCell(`B${rNum}`).value = row[1];
    sheet.getCell(`C${rNum}`).value = row[2];
    sheet.getCell(`D${rNum}`).value = row[3];
    sheet.getCell(`A${rNum}`).font = { name: 'Cambria', size: 10, bold: true, color: { argb: 'FF4B5563' } };
    sheet.getCell(`C${rNum}`).font = { name: 'Cambria', size: 10, bold: true, color: { argb: 'FF4B5563' } };
    sheet.getCell(`B${rNum}`).font = { name: 'Cambria', size: 10, bold: true, color: { argb: 'FF1F2937' } };
    sheet.getCell(`D${rNum}`).font = { name: 'Cambria', size: 10, bold: true, color: { argb: 'FF1F2937' } };
    sheet.getRow(rNum).height = 20;
  });

  // 4. Tally Matrix
  const tallyHeaderRow = 15;
  sheet.mergeCells(`A${tallyHeaderRow - 1}:D${tallyHeaderRow - 1}`);
  const tallySecHeader = sheet.getCell(`A${tallyHeaderRow - 1}`);
  tallySecHeader.value = 'PEN WEIGHING TALLY RECORDINGS';
  tallySecHeader.font = { name: 'Cambria', size: 11, bold: true, color: { argb: 'FF1E3A8A' } };
  tallySecHeader.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDBEAFE' } };
  sheet.getRow(tallyHeaderRow - 1).height = 24;

  const tHeaders = ['Weight (g)', 'Count (Birds)', 'Weight × Count', 'Category'];
  tHeaders.forEach((h, i) => {
    const colRef = String.fromCharCode(65 + i);
    const cell = sheet.getCell(`${colRef}${tallyHeaderRow}`);
    cell.value = h;
    cell.font = { name: 'Cambria', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2937' } };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
  });
  sheet.getRow(tallyHeaderRow).height = 24;

  (record.tallies || []).forEach((t, idx) => {
    const rNum = tallyHeaderRow + 1 + idx;
    sheet.getRow(rNum).height = 20;

    const isUnder = t.weightGrams < record.actualAvgWeight * 0.9;
    const isOver = t.weightGrams > record.actualAvgWeight * 1.1;
    const cat = isUnder ? 'Underweight (<90%)' : isOver ? 'Overweight (>110%)' : 'Uniform (±10%)';

    const vals = [t.weightGrams, t.birdCount, t.weightGrams * t.birdCount, cat];
    vals.forEach((v, i) => {
      const colRef = String.fromCharCode(65 + i);
      const cell = sheet.getCell(`${colRef}${rNum}`);
      cell.value = v;
      cell.font = { name: 'Cambria', size: 10, bold: i === 0 || i === 1 };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.border = thinBorder;
      if (idx % 2 === 1) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF9FAFB' } };
      }
    });
  });

  sheet.columns = [
    { width: 22 },
    { width: 20 },
    { width: 22 },
    { width: 24 }
  ];

  const buffer = await workbook.xlsx.writeBuffer();
  let safeFarm = (farmName || 'Poultry_Farm').trim();
  if (!safeFarm || /^[0-9a-fA-F-]{16,}$/.test(safeFarm) || /^(shed|farm)[-_]/i.test(safeFarm)) {
    safeFarm = 'Poultry_Farm';
  }
  safeFarm = safeFarm.replace(/[^a-zA-Z0-9_-]/g, '_');
  const safeShed = (shedName || 'Shed').trim().replace(/[^a-zA-Z0-9_-]/g, '_');
  const fileName = sanitizeFileName(`${safeFarm}_${safeShed}_Pen${penNo}_Week${week}_${dateStr || record.weighDate}.xlsx`);

  const downloadResult = await downloadExcelFile(buffer, fileName);
  return {
    success: downloadResult.success,
    method: downloadResult.method,
    fileName,
    buffer
  };
}

