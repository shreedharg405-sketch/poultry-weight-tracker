import { Router, Request, Response } from 'express';
import { WeighingService, FlockService, ShedService } from '../db/store.js';

export const exportRouter = Router();

// GET /api/export/shed/:id/week/:week/csv
exportRouter.get('/shed/:id/week/:week/csv', async (req: Request, res: Response) => {
  try {
    const week = parseInt(req.params.week, 10) || 12;
    const { shed, farm, summary } = await ShedService.getShedSummary(req.params.id, week);

    let csv = `SUGUNA FOODS - SHED-WISE FLOCK BODY WEIGHT & UNIFORMITY AUDIT\n`;
    csv += `Farm Name,${farm?.name || 'Suguna Complex'},Location,${farm?.location || ''}\n`;
    csv += `Shed / House,${shed.shedName},Season Standard,${shed.season}\n`;
    csv += `Audit Age,Week ${week},Generated At,${new Date().toISOString()}\n\n`;

    csv += `SHED AGGREGATED METRICS\n`;
    csv += `Shed Overall Average Weight (g),${summary.shedAverageWeight}\n`;
    csv += `Shed Overall Uniformity (±10%),${summary.shedUniformityPercent}%\n`;
    csv += `Shed Uniformity Grade,${summary.shedStatus}\n`;
    csv += `Total Sample Birds Weighed,${summary.totalSampleBirdsWeighed}\n`;
    csv += `Total Live Bird Population,${summary.totalLiveBirds.toLocaleString()}\n`;
    csv += `Total Shed Daily Feed (kg),${summary.totalDailyFeedKg} kg\n`;
    csv += `Total 50kg Feed Bags Required,${summary.totalFeedBags50kg} bags\n`;
    csv += `Deviating Pens Count (>5% deviation),${summary.deviatingPensCount}\n\n`;

    csv += `PEN BREAKDOWN TABLE\n`;
    csv += `Pen,Sex,Breed,Live Population,Sample (N),Avg Weight (g),Uniformity %,CV %,Feed/Bird (g),Daily Feed (kg),50kg Bags,Dev from Shed Mean (g),Dev (%),Status\n`;

    for (const pen of summary.pens) {
      csv += `${pen.penNumber},${pen.sex},${pen.breed},${pen.liveBirdCount},${pen.sampleSize},${pen.averageWeight},${pen.uniformityPercent}%,${pen.cvPercent}%,${pen.suggestedFeedGrams}g,${pen.dailyFeedKg} kg,${pen.feedBags50kg},${pen.deviationFromShedMeanGrams > 0 ? '+' : ''}${pen.deviationFromShedMeanGrams}g,${pen.deviationFromShedMeanPercent > 0 ? '+' : ''}${pen.deviationFromShedMeanPercent}%,${pen.status}\n`;
    }

    if (summary.alerts.length > 0) {
      csv += `\nPEN DEVIATION ALERTS & GRADING RECOMMENDATIONS\n`;
      summary.alerts.forEach((alert, i) => {
        csv += `Alert ${i + 1},"${alert.replace(/"/g, '""')}"\n`;
      });
    }

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="shed_summary_${shed.shedName.replace(/\s+/g, '_')}_wk${week}.csv"`);
    res.send(csv);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Shed export failed' });
  }
});

// GET /api/export/weighing/:id/csv (Individual pen sheet)
exportRouter.get('/weighing/:id/csv', async (req: Request, res: Response) => {
  try {
    const record = await WeighingService.getById(req.params.id);
    if (!record) {
      return res.status(404).json({ error: 'Weighing record not found' });
    }
    const flock = await FlockService.getById(record.penId);

    let csv = `POULTRY FLOCK BODY WEIGHT & UNIFORMITY RECORDING SHEET\n`;
    csv += `Farm Name,${flock?.farmName || ''},House No,${flock?.houseNo || ''},Pen No,${flock?.penNo || ''}\n`;
    csv += `Breed,${flock?.breed || ''},Sex,${flock?.sex || ''},Age (Weeks),${record.ageWeeks}\n`;
    csv += `Date of Weighing,${record.weighDate},Weighed By,${record.weighedBy || ''}\n`;
    csv += `Target Weight (g),${record.targetWeight},Actual Avg Weight (g),${record.actualAvgWeight}\n\n`;

    csv += `Weight (g),Count (Birds),Weight x Count,Category\n`;
    for (const t of record.tallies) {
      const isUnder = t.weightGrams < record.actualAvgWeight * 0.9;
      const isOver = t.weightGrams > record.actualAvgWeight * 1.1;
      const cat = isUnder ? 'Underweight (<90%)' : isOver ? 'Overweight (>110%)' : 'Uniform (±10%)';
      csv += `${t.weightGrams},${t.birdCount},${t.weightGrams * t.birdCount},${cat}\n`;
    }

    csv += `\nSUMMARY STATISTICS\n`;
    csv += `Total Sample Birds (N),${record.sampleSize}\n`;
    csv += `Average Weight (g),${record.actualAvgWeight}\n`;
    csv += `Lightest Bird (g),${record.lightestWeight}\n`;
    csv += `Heaviest Bird (g),${record.heaviestWeight}\n`;
    csv += `Weight Range (g),${record.weightRange}\n`;
    csv += `F-Factor Value,${record.fValue}\n`;
    csv += `CV % (F-Formula),${record.cvPercent}%\n`;
    csv += `Standard Deviation,${record.stdDev} g\n`;
    csv += `Acceptable ±10% Range,${(record.actualAvgWeight * 0.9).toFixed(1)}g - ${(record.actualAvgWeight * 1.1).toFixed(1)}g\n`;
    csv += `Uniform Birds Count,${record.uniformCount}\n`;
    csv += `Uniformity %,${record.uniformityPercent}%\n`;
    csv += `Underweight Birds Count,${record.underCount}\n`;
    csv += `Overweight Birds Count,${record.overCount}\n`;
    csv += `Uniformity Grade,${record.status}\n`;
    csv += `Suggested Feed (g/bird/day),${record.suggestedFeedGrams} g\n`;

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="uniformity_sheet_wk${record.ageWeeks}_${record.weighDate}.csv"`);
    res.send(csv);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Export failed' });
  }
});
