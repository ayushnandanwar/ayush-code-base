import 'dotenv/config';
import { pool } from './db.js';
import { eventQueue, redis } from './queue.js';

const pollIntervalMs = 1_000;
let stopping = false;

async function dispatchBatch() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `SELECT o.id AS outbox_id, e.id AS event_id
       FROM outbox o
       JOIN events e ON e.id = o.event_id
       WHERE o.published_at IS NULL
       ORDER BY o.id
       FOR UPDATE OF o SKIP LOCKED
       LIMIT 100`
    );

    for (const row of result.rows) {
      await eventQueue.add('process-event', { eventId: row.event_id }, {
        jobId: row.event_id
      });
      await client.query('UPDATE outbox SET published_at = NOW() WHERE id = $1', [row.outbox_id]);
    }
    await client.query('COMMIT');
    return result.rowCount ?? 0;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function run() {
  while (!stopping) {
    try {
      const dispatched = await dispatchBatch();
      if (dispatched === 0) await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    } catch (error) {
      console.error({ error }, 'Outbox dispatch failed');
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }
  }
}

const shutdown = async () => {
  stopping = true;
  await eventQueue.close();
  await redis.quit();
  await pool.end();
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

void run();
