import { Router, Request, Response } from 'express';
import { FlockService, WeighingService } from '../db/store.js';

export const flockRouter = Router();

// GET /api/flocks
flockRouter.get('/', async (req: Request, res: Response) => {
  try {
    const flocks = await FlockService.getAll();
    // Attach latest weighing stats to each flock
    const flocksWithLatest = await Promise.all(
      flocks.map(async (flock) => {
        const weighings = await WeighingService.getByFlockId(flock.id);
        const latest = weighings.length > 0 ? weighings[weighings.length - 1] : null;
        return {
          ...flock,
          latestWeighing: latest,
          totalWeighingsCount: weighings.length,
        };
      })
    );
    res.json(flocksWithLatest);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to fetch flocks' });
  }
});

// GET /api/flocks/:id
flockRouter.get('/:id', async (req: Request, res: Response) => {
  try {
    const flock = await FlockService.getById(req.params.id);
    if (!flock) {
      return res.status(404).json({ error: 'Flock not found' });
    }
    const weighings = await WeighingService.getByFlockId(flock.id);
    res.json({
      ...flock,
      weighings,
      latestWeighing: weighings.length > 0 ? weighings[weighings.length - 1] : null,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to fetch flock' });
  }
});

// POST /api/flocks
flockRouter.post('/', async (req: Request, res: Response) => {
  try {
    const { farmName, houseNo, penNo, breed, sex, hatchDate, season, initialBirdCount } = req.body;
    if (!farmName || !houseNo || !penNo || !sex || !season) {
      return res.status(400).json({ error: 'Missing required flock details' });
    }

    const created = await FlockService.create({
      farmName,
      houseNo,
      penNo,
      breed: breed || 'Cobb 500',
      sex: sex === 'MALE' ? 'MALE' : 'FEMALE',
      hatchDate: hatchDate || undefined,
      season: season === 'SUMMER_BROOD_WINTER_LAY' ? 'SUMMER_BROOD_WINTER_LAY' : 'WINTER_BROOD_SUMMER_LAY',
      initialBirdCount: parseInt(initialBirdCount, 10) || 5000,
    });

    res.status(201).json(created);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to create flock' });
  }
});
