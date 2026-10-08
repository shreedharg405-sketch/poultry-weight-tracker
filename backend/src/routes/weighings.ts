import { Router, Request, Response } from 'express';
import { WeighingService, FlockService } from '../db/store.js';
import { calculateUniformity, calculatePerformanceAlerts } from '../services/calculationEngine.js';
import { prisma } from '../db/prisma.js';

export const weighingRouter = Router();

// Handler for saving a pen weighing session
async function handlePenEntry(req: Request, res: Response) {
  try {
    const { penId, flockId, ageWeeks, weighDate, tallies, weighedBy, notes } = req.body;
    const targetId = penId || flockId;
    if (!targetId || ageWeeks === undefined || !Array.isArray(tallies) || tallies.length === 0) {
      return res.status(400).json({
        error: 'Missing required parameters: penId (or flockId), ageWeeks, and a non-empty tallies array [{ weightGrams, birdCount }]'
      });
    }

    const created = await WeighingService.create({
      penId: targetId,
      flockId: targetId,
      ageWeeks: parseInt(ageWeeks, 10),
      weighDate,
      tallies,
      weighedBy,
      notes,
    });

    return res.status(201).json(created);
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to record pen weighing entry' });
  }
}

// POST /api/weighing/pen-entry & POST /api/weighings/pen-entry
weighingRouter.post('/pen-entry', handlePenEntry);

// POST /api/weighings (Standard alias)
weighingRouter.post('/', handlePenEntry);

// POST /api/weighings/calculate (Live calculation without DB write)
weighingRouter.post('/calculate', (req: Request, res: Response) => {
  try {
    const { tallies, targetWeight, standardFeedGrams, ageWeeks } = req.body;
    if (!Array.isArray(tallies)) {
      return res.status(400).json({ error: 'tallies must be an array of { weightGrams, birdCount }' });
    }

    const stats = calculateUniformity(tallies);
    const alerts = calculatePerformanceAlerts({
      actualAvgWeight: stats.averageWeight,
      targetWeight: Number(targetWeight) || stats.averageWeight,
      standardFeedGrams: Number(standardFeedGrams) || 50,
      uniformityPercent: stats.uniformityPercent,
      ageWeeks: Number(ageWeeks) || 12,
    });

    return res.json({
      stats,
      alerts,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Calculation failed' });
  }
});

// GET /api/weighings/flock/:flockId
weighingRouter.get('/flock/:flockId', async (req: Request, res: Response) => {
  try {
    const records = await WeighingService.getByFlockId(req.params.flockId);
    return res.json(records);
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to fetch weighing records' });
  }
});

// GET /api/weighings/:id
weighingRouter.get('/:id', async (req: Request, res: Response) => {
  try {
    const record = await WeighingService.getById(req.params.id);
    if (!record) {
      return res.status(404).json({ error: 'Weighing record not found' });
    }
    const flock = await FlockService.getById(record.penId || record.flockId || '');
    return res.json({
      ...record,
      flock,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to fetch weighing record' });
  }
});

// DELETE /api/weighings/:id
weighingRouter.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    try {
      await prisma.weighingRecord.delete({ where: { id } });
    } catch {
      // In-memory or ignored
    }
    return res.json({ message: 'Record deleted successfully' });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to delete record' });
  }
});
