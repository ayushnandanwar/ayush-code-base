import 'dotenv/config';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';

export const redis = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
  enableReadyCheck: true
});

export const eventQueue = new Queue('relay-events', {
  connection: redis,
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: 'exponential', delay: 1_000 },
    removeOnComplete: { age: 86_400, count: 10_000 },
    removeOnFail: false
  }
});
