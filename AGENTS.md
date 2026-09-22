# AGENTS.md — VoiceIQ

Instructions for AI coding agents working in this repository.

## First steps

1. Read **[docs/specs/README.md](docs/specs/README.md)** for the spec index and SDD workflow.
2. For behaviour changes, open the relevant **`docs/specs/features/F*.md`** before editing code.
3. For scoring math, read **[docs/Call-and-Agent-Performance.md](docs/Call-and-Agent-Performance.md)**.

## Spec-driven rules

- **Do not** change product behaviour without updating the spec (same PR).
- **Do not** invent scoring formulas; use the scoring doc or ask.
- **Disposition** and **call outcome** are different fields (F04).
- **Connect** and **voicemail** rules live in F06 and `backend/src/voicemail.ts`.
- Quarters use **Asia/Kolkata** (F03).

## Project layout

| Path | Service |
| --- | --- |
| `frontend/src/` | React UI |
| `backend/src/` | Express API, sync, Mongo (+ Postgres/TypeORM scaffolding, F12) |
| `ai-service/app/` | Python analyze service |
| `docs/specs/` | Specifications (source of truth) |

## Run locally

```bash
npm run dev:ai
npm run dev:backend
npm run dev:frontend
```

Mongo + local Postgres: `docker compose up -d`

## Key specs by task

| Task | Read |
| --- | --- |
| Sync / cron | F01 |
| Analyze pipeline | F02 |
| Agent KPIs | F03 + Call-and-Agent-Performance.md |
| Disposition | F04 |
| List filters | F05, F06 |
| Bot handling | F09 |
| API shapes | 04-api-contract.md |
| Mongo / Postgres fields | 03-data-model.md, F12 |

## When adding a feature

1. Copy `docs/specs/_template-feature.md` → `features/Fxx-name.md`.
2. Set status **Approved** and list acceptance criteria.
3. Implement backend → AI → frontend as needed.
4. Mark criteria checked; set status **Implemented**.
5. Add row to `docs/specs/README.md` feature table.

## Out of scope unless spec says otherwise

- Committing `.env` or secrets
- Force-pushing main
- Changing scoring weights without spec + scoring doc update
