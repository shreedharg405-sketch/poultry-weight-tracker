import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { healthRouter } from './routes/healthz.js';
import { flockRouter } from './routes/flocks.js';
import { shedRouter } from './routes/sheds.js';
import { weighingRouter } from './routes/weighings.js';
import { benchmarkRouter } from './routes/benchmarks.js';
import { exportRouter } from './routes/export.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;
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

// Routes
app.use(healthRouter); // /healthz
app.use('/api/sheds', shedRouter);
app.use('/api/flocks', flockRouter);
app.use('/api/weighings', weighingRouter);
app.use('/api/weighing', weighingRouter);
app.use('/api/benchmarks', benchmarkRouter);
app.use('/api/export', exportRouter);

// Root route
app.get('/', (req, res) => {
  res.json({
    name: 'Poultry Body Weight & Uniformity Management API (Shed-Wise Edition)',
    version: '2.0.0',
    documentation: '/healthz',
    endpoints: [
      '/healthz',
      '/api/sheds',
      '/api/sheds/:id/summary?week=12',
      '/api/sheds/compare?week=12',
      '/api/flocks',
      '/api/weighings',
      '/api/benchmarks',
      '/api/export/shed/:id/week/:week/csv',
      '/api/export/weighing/:id/csv'
    ]
  });
});

const server = app.listen(PORT, () => {
  console.log(`🚀 Poultry Shed-Wise API server running on port ${PORT}`);
  console.log(`📡 Health check available at http://localhost:${PORT}/healthz`);
});

process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing HTTP server');
  server.close(() => {
    console.log('HTTP server closed');
  });
});

export default app;
