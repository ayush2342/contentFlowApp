import express from 'express';
import cors from 'cors';
import { env } from './config/env.js';
import outputRoutes from './routes/outputRoutes.js';
import healthRoutes from './routes/healthRoutes.js';

const app = express();

app.use(cors());
app.use(express.json({ limit: '5mb' }));

app.use('/api', outputRoutes);
app.use('/api', healthRoutes);

app.use((error, _req, res, _next) => {
  const statusCode = error.statusCode || 500;
  const message = error.message || 'Internal Server Error';
  res.status(statusCode).json({ message });
});

app.listen(env.port, () => {
  console.log(`Digital output backend listening on port ${env.port}`);
});
