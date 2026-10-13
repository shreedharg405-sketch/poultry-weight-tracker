import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { healthRouter } from './routes/healthz.js';
import { farmRouter } from './routes/farms.js';
import { benchmarkRouter } from './routes/benchmarks.js';
import { exportRouter } from './routes/export.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 10000;
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';

// Middlewares
app.use(cors({
  origin: CORS_ORIGIN === '*' ? '*' : CORS_ORIGIN.split(',').map(s => s.trim()),
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(express.json({ limit: '10mb' }));

// Request logger
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    if (req.path !== '/healthz') {
      console.log(`[${new Date().toISOString()}] ${req.method} ${req.path} - ${res.statusCode} (${duration}ms)`);
    }
  });
  next();
});

// Health check
app.get('/healthz', (_req, res) => res.send('OK'));
app.use(healthRouter);

// Multi-Farm Cloud Routes
app.use('/api', farmRouter);

// Benchmarks & Export Routers
app.use('/api/benchmarks', benchmarkRouter);
app.use('/api/export', exportRouter);

// Root route
app.get('/', (_req, res) => {
  res.json({
    name: 'Poultry Body Weight Tracker - Multi-Farm Real-Time Cloud API',
    version: '3.0.0',
    documentation: '/healthz',
    endpoints: [
      'GET    /healthz',
      'GET    /api/farms',
      'POST   /api/farms',
      'GET    /api/farms/:id',
      'PUT    /api/farms/:id/details',
      'DELETE /api/farms/:id',
      'POST   /api/sheds',
      'DELETE /api/sheds/:shedId',
      'PUT    /api/sheds/:shedId',
      'POST   /api/parts',
      'DELETE /api/parts/:partId',
      'PUT    /api/parts/:partId',
      'POST   /api/lines',
      'DELETE /api/lines/:lineId',
      'POST   /api/lines/:lineId/weight',
      'DELETE /api/lines/:lineId/weight/:index',
      'POST   /api/lines/:lineId/clear',
      'PUT    /api/farms/:id/sync',
      'GET    /api/benchmarks'
    ]
  });
});

const server = app.listen(PORT, () => {
  console.log(`🚀 Poultry Sync Server running on port ${PORT}`);
  console.log(`📡 Health check available at http://localhost:${PORT}/healthz`);
});

process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing HTTP server');
  server.close(() => {
    console.log('HTTP server closed');
  });
});

export default app;
