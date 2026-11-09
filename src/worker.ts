import 'dotenv/config';
import { Worker } from 'bullmq';
import { pool } from './db.js';
import { redis } from './queue.js';

const worker = new Worker(
  'relay-events',
  async (job) => {
    const eventId = String(job.data.eventId);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(
        `UPDATE events
         SET status = 'processed', attempts = attempts + 1, processed_at = NOW()
         WHERE id = $1 AND status <> 'processed'
         RETURNING id`,
        [eventId]
      );
      await client.query('COMMIT');
      return { eventId, alreadyProcessed: result.rowCount === 0 };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  },
  { connection: redis, concurrency: 10 }
);

worker.on('completed', (job) => console.info({ jobId: job.id }, 'Event processed'));
worker.on('failed', (job, error) => console.error({ jobId: job?.id, error }, 'Event processing failed'));

const shutdown = async () => {
  await worker.close();
  await redis.quit();
  await pool.end();
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
