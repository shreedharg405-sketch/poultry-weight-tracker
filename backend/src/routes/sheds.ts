import { Router, Request, Response } from 'express';
import { ShedService, PenService, FarmService } from '../db/store.js';

export const shedRouter = Router();

// GET /api/sheds
shedRouter.get('/', async (req: Request, res: Response) => {
  try {
    const sheds = await ShedService.getAll();
    const farms = await FarmService.getAll();
    const result = await Promise.all(
      sheds.map(async (shed) => {
        const pens = await ShedService.getPensByShedId(shed.id);
        const farm = farms.find(f => f.id === shed.farmId);
        return {
          ...shed,
          farmName: farm?.name || 'Suguna Breeder Farm',
          farmLocation: farm?.location,
          pensCount: pens.length,
          totalLiveBirds: pens.reduce((acc, p) => acc + p.liveBirdCount, 0),
          pens,
        };
      })
    );
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to fetch sheds' });
  }
});

// GET /api/sheds/compare?week=12
shedRouter.get('/compare', async (req: Request, res: Response) => {
  try {
    const week = parseInt(req.query.week as string, 10) || 12;
    const comparisons = await ShedService.compareAllSheds(week);
    res.json({
      week,
      comparisons,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to compare sheds' });
  }
});

// GET /api/sheds/:id
shedRouter.get('/:id', async (req: Request, res: Response) => {
  try {
    const shed = await ShedService.getById(req.params.id);
    if (!shed) return res.status(404).json({ error: 'Shed not found' });
    const pens = await ShedService.getPensByShedId(shed.id);
    const farm = await FarmService.getById(shed.farmId);
    res.json({
      ...shed,
      farm,
      pens,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to fetch shed' });
  }
});

// GET /api/sheds/:id/summary?week=12
shedRouter.get('/:id/summary', async (req: Request, res: Response) => {
  try {
    const week = parseInt(req.query.week as string, 10) || 12;
    const data = await ShedService.getShedSummary(req.params.id, week);
    res.json({
      week,
      ...data,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to calculate shed summary' });
  }
});

// POST /api/sheds
shedRouter.post('/', async (req: Request, res: Response) => {
  try {
    const { farmId, shedName, season, hatchDate } = req.body;
    if (!shedName) return res.status(400).json({ error: 'shedName is required' });
    const created = await ShedService.create({
      farmId: farmId || 'farm-1',
      shedName,
      season: season || 'WINTER_BROOD_SUMMER_LAY',
      hatchDate,
    });
    res.status(201).json(created);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to create shed' });
  }
});

// POST /api/sheds/:id/pens
shedRouter.post('/:id/pens', async (req: Request, res: Response) => {
  try {
    const { penNumber, sex, breed, liveBirdCount } = req.body;
    if (!penNumber || !sex) return res.status(400).json({ error: 'penNumber and sex are required' });
    const created = await PenService.create({
      shedId: req.params.id,
      penNumber,
      sex: sex === 'MALE' ? 'MALE' : 'FEMALE',
      breed: breed || 'Cobb 500',
      liveBirdCount: parseInt(liveBirdCount, 10) || 4800,
    });
    res.status(201).json(created);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to add pen' });
  }
});
