import 'dotenv/config';
import Fastify from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { pool } from './db.js';

const app = Fastify({ logger: true });
const eventSchema = z.object({
  type: z.string().min(1).max(120),
  payload: z.record(z.string(), z.unknown())
});

app.get('/health', async () => ({ status: 'ok' }));

app.post('/v1/events', async (request, reply) => {
  const parsed = eventSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: 'invalid_request', details: parsed.error.flatten() });
  }

  const idempotencyKey = request.headers['idempotency-key'];
  if (typeof idempotencyKey !== 'string' || idempotencyKey.length < 1 || idempotencyKey.length > 200) {
    return reply.code(400).send({ error: 'idempotency_key_required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const eventId = randomUUID();
    const inserted = await client.query(
      `INSERT INTO events (id, idempotency_key, event_type, payload)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING id, status`,
      [eventId, idempotencyKey, parsed.data.type, JSON.stringify(parsed.data.payload)]
    );

    if (inserted.rowCount === 0) {
      const existing = await client.query(
        'SELECT id, status FROM events WHERE idempotency_key = $1',
        [idempotencyKey]
      );
      await client.query('COMMIT');
      return reply.code(200).send({ ...existing.rows[0], duplicate: true });
    }

    await client.query('INSERT INTO outbox (event_id) VALUES ($1)', [eventId]);
    await client.query('COMMIT');
    return reply.code(202).send({ id: eventId, status: 'accepted' });
  } catch (error) {
    await client.query('ROLLBACK');
    request.log.error({ error }, 'Failed to accept event');
    return reply.code(500).send({ error: 'event_acceptance_failed' });
  } finally {
    client.release();
  }
});

const port = Number(process.env.PORT ?? 3000);
try {
  await app.listen({ port, host: '0.0.0.0' });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}

const shutdown = async () => {
  await app.close();
  await pool.end();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
