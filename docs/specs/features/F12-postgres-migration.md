# F12 — MongoDB → PostgreSQL migration

**Status:** Partial  
**Owner:** Backend  
**Related:** [03-data-model.md](../03-data-model.md), [02-architecture.md](../02-architecture.md), [04-api-contract.md](../04-api-contract.md), [F11 dual audio](./F11-dual-audio-storage.md)

## User story

As the VoiceIQ team, I want the backend to run on **PostgreSQL** (local first, then hosted) so we can use relational constraints, SQL tooling, and simpler ops — while **MongoDB Atlas remains available** until cutover is proven.

## Decisions (locked)

| Decision | Choice |
| --- | --- |
| Local first | Docker Postgres 16 beside existing Mongo |
| ORM | **TypeORM** + `pg` |
| Schema migrations | TypeORM migrations (`synchronize: false`) |
| `recording_listings` | **Keep** dual table (same as Mongo projection) |
| Production Mongo | **Keep Atlas** until later cutover; do not remove Mongo code yet |
| Analysis payload | `JSONB` column `analysis_result` |
| App data path | **Dual-write** to Postgres (Phase 2); **reads prefer Postgres** when connected, with Mongo fallback (Phase 3) |

## Rules

1. When `DATABASE_URL` is set and `POSTGRES_READS` is not `false`, list/detail/agent/sync **reads prefer Postgres**. If PG has no rows yet (or errors), routes fall back to Mongo.
2. When `DATABASE_URL` is set, backend **dual-writes** on successful Mongo writes (best-effort: PG errors are logged, Mongo path still succeeds).
3. When `DATABASE_URL` is unset (e.g. Atlas-only deploy), Postgres is skipped; Mongo-only boot continues to work.
4. Do not use TypeORM `synchronize: true` in any environment — schema changes only via migrations.
5. Listing dual-write pattern stays: `recordings` + `recording_listings` (mirrored in Postgres).
6. Cron log TTL is **not** a Postgres TTL index; a cleanup job will replace Mongo TTL later (Phase 4+).
7. Analyze / mutate paths still load the write document from Mongo (or PG detail with Mongo fallback) then persist to Mongo + dual-write.

## Phases

| Phase | Goal | Status |
| --- | --- | --- |
| **1** | Spec, Docker Postgres, TypeORM entities + initial migration, connect/ping/health | Done |
| **2** | Dual-write repositories (sync, analyze/listings, agents, export jobs, cron logs) | Done |
| **3** | Read paths on Postgres; parity / backfill scripts; Mongo fallback | Done |
| **4** | ETL Atlas → Postgres; staging rehearsal | Not started |
| **5** | Cutover; Atlas read-only rollback window; then remove Mongo | Not started |

## Acceptance criteria

### Phase 1

- [x] AC1: Feature spec F12 exists and is linked from the spec index.
- [x] AC2: `docker compose` runs Postgres 16 with DB `voice_analysis` (Mongo container remains).
- [x] AC3: TypeORM DataSource + entities for `recordings`, `recording_listings`, `agents`, `export_jobs`, `cron_job_logs`.
- [x] AC4: Initial migration creates tables + indexes; `npm run migration:run` applies it.
- [x] AC5: With `DATABASE_URL` set, backend connects and `/health` includes `postgres.connected`.
- [x] AC6: Without `DATABASE_URL`, backend still boots on Mongo only.
- [x] AC7: `npm run check:postgres` pings Postgres when configured.
- [x] AC8: No API behaviour change vs Mongo-only (reads still Mongo).

### Phase 2

- [x] AC2.1: `upsertRecordingListing` dual-writes `recordings` + `recording_listings` to Postgres.
- [x] AC2.2: Agent upsert / refresh dual-writes `agents`.
- [x] AC2.3: Export job create/patch dual-writes `export_jobs`.
- [x] AC2.4: Cron log append dual-writes `cron_job_logs`.
- [x] AC2.5: Performance / introduction backfill patches dual-write `analysis_result`.
- [x] AC2.6: `npm run smoke:postgres-dual-write` copies one Mongo recording into Postgres.
- [x] AC2.7: Dual-write failures are logged and do not fail the Mongo request path.

### Phase 3

- [x] AC3.1: Recordings list + listings prefer Postgres when PG has data; else Mongo.
- [x] AC3.2: Recording detail (`findByCallId`) prefers Postgres, falls back to Mongo.
- [x] AC3.3: Agents list + detail prefer Postgres with Mongo fallback.
- [x] AC3.4: Sync status / jobs / cron logs prefer Postgres with Mongo fallback.
- [x] AC3.5: `POSTGRES_READS=false` forces Mongo reads even when Postgres is connected.
- [x] AC3.6: `npm run backfill:postgres` copies Mongo → Postgres; `npm run parity:postgres` compares counts.
- [x] AC3.7: Responses include `source: "postgres" | "mongo"` for observability.

### Later phases

- [ ] AC10: ETL from Atlas completes with row-count and spot-check parity (production).
- [ ] AC11: Docs/deploy switch to Postgres; Mongo dependency removed after rollback window.

## API touchpoints

| Method | Path | Change |
| --- | --- | --- |
| GET | `/health` | Adds `postgres: { configured, connected, … }` when `DATABASE_URL` set |

## Data model

Postgres tables mirror Mongo collections (see Phase 1 migration). Canonical field meanings unchanged from [03-data-model.md](../03-data-model.md).

| Postgres table | Mongo collection |
| --- | --- |
| `recordings` | `recordings` |
| `recording_listings` | `recording_listings` |
| `agents` | `agents` |
| `export_jobs` | `export_jobs` |
| `cron_job_logs` | `cron_job_logs` |

## Implementation notes

| Path | Role |
| --- | --- |
| `backend/src/db/postgres/data-source.ts` | TypeORM DataSource |
| `backend/src/db/postgres/entities/` | Entity classes |
| `backend/src/db/postgres/migrations/` | SQL migrations |
| `backend/src/db/postgres/index.ts` | `connectPostgres` / `pingPostgres` / `closePostgres` |
| `backend/src/db/postgres/dualWrite.ts` | Best-effort Mongo → Postgres writers |
| `backend/src/db/postgres/mappers.ts` | Mongo docs → entity rows |
| `backend/src/db/postgres/reads.ts` | Postgres list/detail queries (Phase 3) |
| `backend/src/db/postgres/readMappers.ts` | Entity → Mongo-shaped docs for API |
| `docker-compose.yml` | `postgres` service + volume |
| `backend/.env.example` | `DATABASE_URL`, `POSTGRES_READS` |

## Open items

- Hosted Postgres target (RDS / Neon / Cloud SQL) — decide before Phase 5.
- Cron log cleanup job schedule and `CRON_LOG_TTL_DAYS` on Postgres.
- Production ETL rehearsal (Phase 4).

## Changelog

| Date | Change |
| --- | --- |
| 2026-09-21 | Initial spec; Phase 1 scaffolding (TypeORM, keep listings, keep Atlas) |
| 2026-09-21 | Phase 2 dual-write for recordings, listings, agents, export jobs, cron logs |
| 2026-09-21 | Phase 3 Postgres reads + Mongo fallback + backfill/parity scripts |
