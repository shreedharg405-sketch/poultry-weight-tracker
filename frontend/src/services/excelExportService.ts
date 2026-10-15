import ExcelJS from 'exceljs';
import { downloadExcelFile } from '../utils/fileDownloader';
import { WINTER_BROOD_STANDARDS, SUMMER_BROOD_STANDARDS } from './benchmarks';

export interface PenLine {
  id: number | string;
  name: string;
  weights: number[];
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

export function getToleranceForWeek(weekNum: number): number {
  if (weekNum <= 3) return 25;
  if (weekNum <= 8) return 50;
  if (weekNum <= 12) return 75;
  return 100;
}

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

export function getBirdGrade(weight: number, bands: GradingTolerance): BirdGrade {
  if (weight < bands.bMin) return 'MB';
  if (weight < bands.sMin) return 'B';
  if (weight <= bands.sMax) return 'S';
  if (weight <= bands.aMax) return 'A';
  return 'MA';
}

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

export function getFFactor(n: number): number {
  if (n <= 10) return 3.08;
  if (n >= 150) return 5.03;
  if (F_FACTOR_LOOKUP[n]) return F_FACTOR_LOOKUP[n];
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
  avg: number;
  diff: number;
  min: number;
  max: number;
  range: number;
  variance: number;
  fFactor: number;
  cv: number;
  mbCount: number;
  bCount: number;
  sCount: number;
  aCount: number;
  maCount: number;
  mbPct: number;
  bPct: number;
  sPct: number; // Uniformity %
  aPct: number;
  maPct: number;
  unif: number;
  uniformity10Pct: number;
  status: 'EXCELLENT' | 'ACCEPTABLE' | 'POOR' | 'INCOMPLETE';
  isComplete: boolean;
  tolerance: number;
  bands: GradingTolerance;
}

export function calculateFlockStats(weights: number[], stdWeight: number, weekNum: number): StatisticalSummary {
  const count = weights.length;
  const bands = getGradingBands(stdWeight, weekNum);

  if (count === 0) {
    return {
      count: 0,
      avg: 0,
      diff: 0,
      min: 0,
      max: 0,
      range: 0,
      variance: 0,
      fFactor: 3.08,
      cv: 0,
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

  const sum = weights.reduce((acc, w) => acc + w, 0);
  const avg = Number((sum / count).toFixed(1));
  const diff = Number((avg - stdWeight).toFixed(1));
  const min = Math.min(...weights);
  const max = Math.max(...weights);
  const range = max - min;
  const fFactor = getFFactor(count);
  const cv = avg > 0 && fFactor > 0 ? Number(((range * 100) / (avg * fFactor)).toFixed(2)) : 0;

  let mbCount = 0;
  let bCount = 0;
  let sCount = 0;
  let aCount = 0;
  let maCount = 0;

  for (const w of weights) {
    const grade = getBirdGrade(w, bands);
    if (grade === 'MB') mbCount++;
    else if (grade === 'B') bCount++;
    else if (grade === 'S') sCount++;
    else if (grade === 'A') aCount++;
    else if (grade === 'MA') maCount++;
  }

  const sumSqDiff = weights.reduce((acc, w) => acc + Math.pow(w - avg, 2), 0);
  const variance = count > 1 ? Number((sumSqDiff / (count - 1)).toFixed(2)) : 0;

  const sPct = Number(((sCount / count) * 100).toFixed(1));

  // Official +/- 10% from mean uniformity calculation
  const lower10Pct = avg * 0.90;
  const upper10Pct = avg * 1.10;
  const birdsIn10Pct = weights.filter(w => w >= lower10Pct && w <= upper10Pct).length;
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
export async function exportPoultryWorkbook(params: ExportWorkbookParams): Promise<{ success: boolean; method: string }> {
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
  workbook.creator = 'Poultry Weight Tracker';
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

  // Grand stats
  const femaleWeights = sheds
    .filter(s => s.type === 'Female')
    .flatMap(s => s.parts.flatMap(p => p.lines.flatMap(l => l.weights)));
  const maleWeights = sheds
    .filter(s => s.type === 'Male')
    .flatMap(s => s.parts.flatMap(p => p.lines.flatMap(l => l.weights)));

  const fStats = calculateFlockStats(femaleWeights, stdWeightFemale, weekNum);
  const mStats = calculateFlockStats(maleWeights, stdWeightMale, weekNum);

  const shedSummaries = sheds.map((s, idx) => {
    const allW = s.parts.flatMap(p => p.lines.flatMap(l => l.weights));
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
    { width: 22 },  // B: Metric / Label
    { width: 18 },  // C: Female
    { width: 18 },  // D: Male
    { width: 6 },   // E: Spacer
    { width: 10 },  // F: Shed No
    { width: 16 },  // G: Shed Name
    { width: 12 },  // H: Sex
    { width: 15 },  // I: Act B.WT
    { width: 12 },  // J: Min
    { width: 12 },  // K: Max
    { width: 12 },  // L: CV%
    { width: 18 },  // M: Uniformity (S%)
    { width: 12 }   // N: Bird Count
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

  // Female Header Symbol (22pt Bold, #00B050)
  const cellC4 = wsCons.getCell('C4');
  cellC4.value = '♀ Female';
  cellC4.font = { name: 'Cambria', size: 18, bold: true, color: { argb: 'FF00B050' } };
  cellC4.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F5E9' } };
  cellC4.alignment = { horizontal: 'center', vertical: 'middle' };
  cellC4.border = headerBorder;

  // Male Header Symbol (22pt Bold, #FF0000)
  const cellD4 = wsCons.getCell('D4');
  cellD4.value = '♂ Male';
  cellD4.font = { name: 'Cambria', size: 18, bold: true, color: { argb: 'FFFF0000' } };
  cellD4.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFEBEE' } };
  cellD4.alignment = { horizontal: 'center', vertical: 'middle' };
  cellD4.border = headerBorder;

  // Comparison Rows with Cambria 14pt Bold
  const metricRows: [string, string | number, string | number][] = [
    ['Age', `${ageWeek}F`, `${ageWeek}M`],
    ['STD B.WT', `${stdWeightFemale} g`, `${stdWeightMale} g`],
    ['Act B.WT', `${fStats.avg} g`, `${mStats.avg} g`],
    ['Diff', `${fStats.diff > 0 ? '+' : ''}${fStats.diff} g`, `${mStats.diff > 0 ? '+' : ''}${mStats.diff} g`],
    ['CV %', `${fStats.cv}%`, `${mStats.cv}%`],
    ['Min', `${fStats.min} g`, `${mStats.min} g`],
    ['Max', `${fStats.max} g`, `${mStats.max} g`],
    ['MB %', `${fStats.mbPct}%`, `${mStats.mbPct}%`],
    ['B %', `${fStats.bPct}%`, `${mStats.bPct}%`],
    ['S %', `${fStats.sPct}%`, `${mStats.sPct}%`],
    ['AB %', `${fStats.aPct}%`, `${mStats.aPct}%`],
    ['MAB %', `${fStats.maPct}%`, `${mStats.maPct}%`],
    ['Sample Count', fStats.count, mStats.count]
  ];

  metricRows.forEach((item, idx) => {
    const rowNum = 5 + idx;
    const r = wsCons.getRow(rowNum);
    r.height = 24;

    const bCell = wsCons.getCell(`B${rowNum}`);
    bCell.value = item[0];
    bCell.font = { name: 'Cambria', size: 12, bold: true, color: { argb: 'FF1F2937' } };
    bCell.border = thinBorder;
    bCell.alignment = { horizontal: 'left', vertical: 'middle' };

    const cCell = wsCons.getCell(`C${rowNum}`);
    cCell.value = item[1];
    cCell.font = { name: 'Cambria', size: 13, bold: true, color: { argb: 'FF00B050' } };
    cCell.border = thinBorder;
    cCell.alignment = { horizontal: 'center', vertical: 'middle' };

    const dCell = wsCons.getCell(`D${rowNum}`);
    dCell.value = item[2];
    dCell.font = { name: 'Cambria', size: 13, bold: true, color: { argb: 'FFFF0000' } };
    dCell.border = thinBorder;
    dCell.alignment = { horizontal: 'center', vertical: 'middle' };
  });

  // Shed-wise Summary Table on Right Side (Columns F to N)
  wsCons.mergeCells('F2:N2');
  const shedTableTitle = wsCons.getCell('F2');
  shedTableTitle.value = 'SHED-WISE PERFORMANCE SUMMARY';
  shedTableTitle.font = { name: 'Cambria', size: 12, bold: true, color: { argb: 'FF1E3A8A' } };
  shedTableTitle.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDBEAFE' } };
  shedTableTitle.alignment = { horizontal: 'center', vertical: 'middle' };

  const shedHeaders = ['Shed No', 'Shed Name', 'Sex', 'Act B.WT', 'Min', 'Max', 'CV %', 'Uniformity (S%)', 'Birds'];
  const shedColLetters = ['F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N'];

  shedHeaders.forEach((h, i) => {
    const cell = wsCons.getCell(`${shedColLetters[i]}4`);
    cell.value = h;
    cell.font = { name: 'Cambria', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
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
      `${s.stats.avg} g`,
      `${s.stats.min} g`,
      `${s.stats.max} g`,
      `${s.stats.cv}%`,
      `${s.stats.unif}%`,
      s.stats.count
    ];

    rowData.forEach((val, i) => {
      const cell = wsCons.getCell(`${shedColLetters[i]}${rowNum}`);
      cell.value = val;
      cell.font = { name: 'Cambria', size: 11, bold: i === 0 || i === 3 || i === 7 };
      cell.border = thinBorder;
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      if (s.type === 'Male' && i === 2) {
        cell.font = { name: 'Cambria', size: 11, bold: true, color: { argb: 'FFFF0000' } };
      } else if (s.type === 'Female' && i === 2) {
        cell.font = { name: 'Cambria', size: 11, bold: true, color: { argb: 'FF00B050' } };
      }
    });
  });

  // Part & Line Hierarchical Breakdown Table on Cons Sheet
  const partLineTableTitleRow = 5 + shedSummaries.length + 2;
  wsCons.mergeCells(`F${partLineTableTitleRow}:N${partLineTableTitleRow}`);
  const plTitleCell = wsCons.getCell(`F${partLineTableTitleRow}`);
  plTitleCell.value = 'PART & LINE HIERARCHICAL IDENTIFIER PERFORMANCE';
  plTitleCell.font = { name: 'Cambria', size: 12, bold: true, color: { argb: 'FF1E3A8A' } };
  plTitleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDBEAFE' } };
  plTitleCell.alignment = { horizontal: 'center', vertical: 'middle' };
  plTitleCell.border = headerBorder;

  const plHeaderRow = partLineTableTitleRow + 1;
  const plHeaders = ['Shed', 'Part', 'Line', 'Hierarchical Identifier', 'Act B.WT', 'Min', 'Max', 'CV %', 'Uniformity (S%)'];
  plHeaders.forEach((h, i) => {
    const cell = wsCons.getCell(`${shedColLetters[i]}${plHeaderRow}`);
    cell.value = h;
    cell.font = { name: 'Cambria', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2937' } };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.border = headerBorder;
  });

  let currPLRow = plHeaderRow + 1;
  sheds.forEach((s) => {
    const std = s.type === 'Male' ? stdWeightMale : stdWeightFemale;
    s.parts.forEach((p) => {
      p.lines.forEach((l) => {
        const lStats = calculateFlockStats(l.weights, std, weekNum);
        const plData = [
          s.name,
          p.name,
          l.name,
          `${s.name} - ${p.name} - ${l.name}`,
          `${lStats.avg} g`,
          `${lStats.min} g`,
          `${lStats.max} g`,
          `${lStats.cv}%`,
          `${lStats.sPct}%`
        ];
        plData.forEach((val, i) => {
          const cell = wsCons.getCell(`${shedColLetters[i]}${currPLRow}`);
          cell.value = val;
          cell.font = { name: 'Cambria', size: 10, bold: i === 3 || i === 4 || i === 8 };
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
  // 2. SHED SHEETS ('Shed 1' to 'Shed 7', ' Shed 8 Male', 'Shed 9', 'Shed 10')
  // =========================================================================
  sheds.forEach((shed) => {
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
          weights: l.weights
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

    // Row 1: Farm: [farmName] | Shed: [shed.name] | Gender: [shed.type] | STD B.WT
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
    a2.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF66' } }; // Yellow #FFFF66
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

    // Row 4: Column Headers: Sample #, Weight (g), Grade (MB/B/S/A/MA)
    const a4 = ws.getCell('A4');
    a4.value = 'Sample #';
    a4.font = { name: 'Cambria', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    a4.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF374151' } };
    a4.alignment = { horizontal: 'center', vertical: 'middle' };
    a4.border = headerBorder;
    ws.getRow(4).height = 24;

    // Column A width
    ws.getColumn(1).width = 10;

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
      partCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF66' } }; // Yellow #FFFF66
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

    // Rows 5 to 54 (Up to 50 bird samples per line)
    for (let sampleIdx = 0; sampleIdx < 50; sampleIdx++) {
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

        if (w !== undefined && w > 0) {
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

    // Summary Rows 56–69: Count (Red Bold), Average, Variance, Min, Max, CV%, Uniformity S%
    const summaryMetrics: [number, string, (s: StatisticalSummary) => string | number, boolean][] = [
      [56, 'Count', s => s.count, true], // Red Bold
      [58, 'Average (g)', s => s.avg, false],
      [60, 'Variance', s => s.variance, false],
      [62, 'Min (g)', s => s.min, false],
      [64, 'Max (g)', s => s.max, false],
      [66, 'CV %', s => `${s.cv}%`, false],
      [68, 'Uniformity (S%)', s => `${s.sPct}%`, false]
    ];

    summaryMetrics.forEach(([rowNum, label, valGetter, isRedBold]) => {
      const lblCell = ws.getCell(rowNum, 1);
      lblCell.value = label;
      lblCell.font = { name: 'Cambria', size: 10, bold: true, color: { argb: isRedBold ? 'FFFF0000' : 'FF1F2937' } };
      lblCell.alignment = { horizontal: 'left', vertical: 'middle' };
      lblCell.border = thinBorder;

      flatLines.forEach((fl, flIdx) => {
        const wtCol = 2 + flIdx * 2;
        const grCol = 3 + flIdx * 2;
        const lineStats = calculateFlockStats(fl.weights, std, weekNum);
        const val = valGetter(lineStats);

        ws.mergeCells(rowNum, wtCol, rowNum, grCol);
        const valCell = ws.getCell(rowNum, wtCol);
        valCell.value = val;
        valCell.font = {
          name: 'Cambria',
          size: 11,
          bold: true,
          color: { argb: isRedBold ? 'FFFF0000' : 'FF111827' }
        };
        valCell.alignment = { horizontal: 'center', vertical: 'middle' };
        valCell.border = thinBorder;
      });
    });

    // Row 85: F-Factor cell with light green #00FF99 fill
    const totalShedWeights = shed.parts.flatMap(p => p.lines.flatMap(l => l.weights));
    const shedTotalStats = calculateFlockStats(totalShedWeights, std, weekNum);

    ws.mergeCells('B85:F85');
    const fCell = ws.getCell('B85');
    fCell.value = `F-Factor Lookup: ${shedTotalStats.fFactor}  (Total Shed Weighed Birds: ${shedTotalStats.count})`;
    fCell.font = { name: 'Cambria', size: 11, bold: true, color: { argb: 'FF065F46' } };
    fCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF00FF99' } };
    fCell.alignment = { horizontal: 'center', vertical: 'middle' };
    fCell.border = headerBorder;
  });

  // =========================================================================
  // 3. REFERENCE SHEETS ('summer brooding' & 'winter Brooding')
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

    // Rows 4 to 26 (Weeks 1 to 23)
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

  // 12. Summer Brooding (#FFFFCC fill highlights)
  addBenchmarkReferenceSheet('Summer Brooding', SUMMER_BROOD_STANDARDS, 'FFFFFFCC');

  // 13. Winter Brooding (#CCFFFF fill highlights)
  addBenchmarkReferenceSheet('Winter Brooding', WINTER_BROOD_STANDARDS, 'FFCCFFFF');

  // Export buffer & download
  const buffer = await workbook.xlsx.writeBuffer();
  const fileName = `${farmName.replace(/\s+/g, '_')}_${ageWeek}_${dateStr}.xlsx`;

  return await downloadExcelFile(buffer, fileName);
}
