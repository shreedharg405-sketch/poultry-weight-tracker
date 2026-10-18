import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { healthRouter } from './routes/healthz.js';
import { farmRouter } from './routes/farms.js';
import { submissionRouter } from './routes/submissions.js';
import { benchmarkRouter } from './routes/benchmarks.js';
import { exportRouter } from './routes/export.js';
import { syncDatabaseSchema } from './db/init.js';

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT) || 10000;
const HOST = '0.0.0.0';
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';

const allowedOrigins = [
  'https://poultry-weight-tracker.shreedharg405.workers.dev',
  'https://poultry-weight-tracker.pages.dev',
  'http://localhost:5173',
  'http://localhost:3000',
  'http://localhost:5000',
];
if (process.env.CORS_ORIGIN && process.env.CORS_ORIGIN !== '*') {
  process.env.CORS_ORIGIN.split(',').forEach(o => {
    const trimmed = o.trim();
    if (trimmed && !allowedOrigins.includes(trimmed)) {
      allowedOrigins.push(trimmed);
    }
  });
}

// Middlewares
app.disable('x-powered-by');

// Defensive Security Headers Middleware
app.use((_req, res, next) => {
  res.removeHeader('X-Powered-By');
  res.removeHeader('Server');
  res.removeHeader('X-AspNet-Version');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (
      CORS_ORIGIN === '*' || 
      allowedOrigins.includes(origin) || 
      origin.endsWith('.workers.dev') || 
      origin.endsWith('.pages.dev')
    ) {
      return callback(null, true);
    }
    return callback(null, true);
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'x-user-username'],
  exposedHeaders: ['Content-Disposition'],
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));

// Request logger
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    if (req.path !== '/healthz' && req.path !== '/health') {
      console.log(`[${new Date().toISOString()}] ${req.method} ${req.path} - ${res.statusCode} (${duration}ms)`);
    }
  });
  next();
});

// 1. Health check & Diagnostics Routers (Handles /healthz, /health, /api/healthz, /api/health)
app.use(healthRouter);

// 2. Multi-Farm Cloud Routes & Submissions (Mounted on /api and aliased on root)
app.use('/api', farmRouter);
app.use('/', farmRouter);
app.use('/api', submissionRouter);
app.use('/', submissionRouter);

// 3. Benchmarks & Export Routers
app.use('/api/benchmarks', benchmarkRouter);
app.use('/benchmarks', benchmarkRouter);
app.use('/api/export', exportRouter);
app.use('/export', exportRouter);

// 4. Root information endpoint (Neutral status without schema or endpoint disclosure)
const rootHandler = (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
  });
};

app.get('/', rootHandler);
app.get('/api', rootHandler);

// 5. Centralized generic error handling middleware (Zero information leak)
app.use((err: any, _req: Request, res: Response, _next: express.NextFunction) => {
  console.error('[Internal Server Error]:', err?.message || err);
  if (res.headersSent) return;
  return res.status(500).json({
    status: 500,
    message: 'An unexpected error occurred. Please try again later.',
  });
});

// Server startup with automatic schema verification
let server: any = null;

async function startServer() {
  if (process.env.NODE_ENV !== 'test') {
    try {
      console.log('🔄 [STARTUP] Synchronizing PostgreSQL database schema...');
      await syncDatabaseSchema();
    } catch (initErr) {
      console.error('⚠️ [STARTUP] Schema synchronization warning (continuing boot):', initErr);
    }

    server = app.listen(PORT, HOST, () => {
      console.log(`🚀 Poultry Sync Server running on http://${HOST}:${PORT}`);
    });

    process.on('SIGTERM', () => {
      console.log('SIGTERM signal received: closing HTTP server');
      if (server) {
        server.close(() => {
          console.log('HTTP server closed');
        });
      }
    });
  }
}

startServer();

export default app;
