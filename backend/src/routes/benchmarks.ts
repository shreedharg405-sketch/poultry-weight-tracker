import { Router, Request, Response } from 'express';
import { getBenchmarkCurve, getBenchmarkForWeek, normalizeSeason, normalizeSex } from '../data/benchmarks.js';

export const benchmarkRouter = Router();

/**
 * GET /api/benchmarks
 * Query parameters:
 *  - season: 'WINTER_BROOD_SUMMER_LAY' | 'SUMMER_BROOD_WINTER_LAY' | 'winter' | 'summer'
 *  - gender or sex: 'FEMALE' | 'MALE' | 'female' | 'male' | 'F' | 'M'
 *  - week (optional): 1 to 23
 *
 * Example: GET /api/benchmarks?season=WINTER_BROOD_SUMMER_LAY&gender=FEMALE&week=12
 * Returns: benchmark weight, gain, and feed standard.
 */
benchmarkRouter.get('/', (req: Request, res: Response) => {
  try {
    const rawSeason = (req.query.season as string) || 'WINTER_BROOD_SUMMER_LAY';
    const rawSex = (req.query.gender as string) || (req.query.sex as string) || 'FEMALE';
    const weekParam = req.query.week ? parseInt(req.query.week as string, 10) : undefined;

    const season = normalizeSeason(rawSeason);
    const gender = normalizeSex(rawSex);

    if (weekParam !== undefined) {
      if (isNaN(weekParam) || weekParam < 1 || weekParam > 23) {
        return res.status(400).json({ error: 'Week must be an integer between 1 and 23' });
      }
      const bm = getBenchmarkForWeek(season, gender, weekParam);
      return res.json({
        season,
        gender,
        week: bm.week,
        targetWeight: bm.targetWeight,
        weightGain: bm.weightGain,
        feedGramsPerBirdDay: bm.feedGramsPerBirdDay,
        minTargetWeight: bm.minTargetWeight,
        maxTargetWeight: bm.maxTargetWeight,
      });
    }

    const curve = getBenchmarkCurve(season, gender);
    return res.json({
      season,
      gender,
      weeksCount: curve.length,
      benchmarks: curve,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to fetch benchmarks' });
  }
});

// GET /api/benchmarks/week/:week?season=...&gender=...
benchmarkRouter.get('/week/:week', (req: Request, res: Response) => {
  try {
    const week = parseInt(req.params.week, 10);
    const rawSeason = (req.query.season as string) || 'WINTER_BROOD_SUMMER_LAY';
    const rawSex = (req.query.gender as string) || (req.query.sex as string) || 'FEMALE';

    if (isNaN(week) || week < 1 || week > 23) {
      return res.status(400).json({ error: 'Week must be between 1 and 23' });
    }

    const season = normalizeSeason(rawSeason);
    const gender = normalizeSex(rawSex);
    const benchmark = getBenchmarkForWeek(season, gender, week);

    return res.json({
      season,
      gender,
      benchmark,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to fetch benchmark for week' });
  }
});
