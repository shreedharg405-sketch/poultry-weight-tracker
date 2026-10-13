import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { farmRouter } from './routes/farms.js';
import { benchmarkRouter } from './routes/benchmarks.js';

dotenv.config();

const app = express();
const port = process.env.PORT || 10000;

app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '10mb' }));

app.get('/healthz', (_req, res) => res.send('OK'));

app.use('/api', farmRouter);
app.use('/api/benchmarks', benchmarkRouter);

if (process.env.NODE_ENV !== 'test') {
  app.listen(port, () => console.log(`Poultry Sync Server running on port ${port}`));
}

export default app;
