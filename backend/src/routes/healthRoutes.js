import { Router } from 'express';
import { checkS3Health } from '../services/s3Service.js';

const router = Router();

router.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'digital-output-backend',
    timestamp: new Date().toISOString(),
  });
});

router.get('/health/s3', async (_req, res, next) => {
  try {
    const health = await checkS3Health();
    res.json({
      status: 'ok',
      s3: health,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    next(error);
  }
});

export default router;
