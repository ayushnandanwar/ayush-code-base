# Reliability model and known limitations

## Current delivery model

1. The API writes the event and outbox row in one PostgreSQL transaction.
2. The dispatcher claims unpublished outbox rows using `FOR UPDATE SKIP LOCKED`.
3. It enqueues a BullMQ job using the event UUID as the job ID.
4. The worker updates event state in PostgreSQL.

This is an **at-least-once** delivery design. The outbox prevents losing an accepted event when the API process fails between database persistence and queue publication. The dispatcher can still publish a job and crash before marking the outbox row as published, so duplicate delivery remains possible.

## Important caveat

The current worker demonstrates duplicate-safe status transition for this simple example only. Real business side effects must be made idempotent in the same transaction as their database writes, or protected with a durable idempotency record. Do not assume a queue job ID alone guarantees exactly-once processing.

## Next reliability work

- Add explicit `processing` claims with leases and recovery for abandoned work.
- Persist attempts and terminal failure state in PostgreSQL.
- Add a dead-letter workflow and operator replay command.
- Add request payload size limits and authentication/rate limiting before exposing publicly.
- Add integration tests for crash windows, concurrent dispatchers, duplicate delivery, and retry exhaustion.
- Add metrics for outbox age, queue depth, processing duration, retry count, and failure rate.

## Benchmark policy

No throughput or latency claim is made yet. Benchmarks should record hardware/runtime versions, dataset shape, concurrency, warm-up period, duration, and p50/p95/p99 latency.
