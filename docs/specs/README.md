# VoiceIQ — Spec-Driven Development (SDD)

This folder is the **source of truth** for what VoiceIQ should do. Code implements specs; specs do not describe code after the fact.

## How SDD works here

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐     ┌──────────┐
│  Spec doc   │ ──► │  Implement   │ ──► │  Verify     │ ──► │  Ship    │
│  (this dir) │     │  (code)      │     │  (manual/   │     │          │
└─────────────┘     └──────────────┘     │   script)   │     └──────────┘
                                         └─────────────┘
```

1. **Read the spec** before changing behavior.
2. **Change the spec first** if requirements change (or in the same PR as code).
3. **Implement** backend, AI service, and frontend to match acceptance criteria.
4. **Verify** using the spec’s checklist; update spec status when done.

## Document map

| Doc | Purpose |
| --- | --- |
| [00-glossary.md](./00-glossary.md) | Shared terms (connect, disposition, AG, etc.) |
| [01-product-overview.md](./01-product-overview.md) | Users, goals, main flows |
| [02-architecture.md](./02-architecture.md) | Services, ports, data flow |
| [03-data-model.md](./03-data-model.md) | MongoDB collections and fields |
| [04-api-contract.md](./04-api-contract.md) | REST endpoints and query params |
| [05-ui-routes.md](./05-ui-routes.md) | Frontend pages and navigation |

### Feature specs (`features/`)

| ID | Spec | Status |
| --- | --- | --- |
| F01 | [Freshcaller sync](./features/F01-freshcaller-sync.md) | Implemented |
| F02 | [Call analysis pipeline](./features/F02-call-analysis.md) | Implemented |
| F03 | [Agent performance & scoring](./features/F03-agent-performance.md) | Implemented |
| F04 | [Disposition & call outcome](./features/F04-disposition.md) | Partial (manual disposition; AI auto-set planned) |
| F05 | [Recordings list & filters](./features/F05-recordings-list.md) | Implemented |
| F06 | [Voicemail & connect rules](./features/F06-voicemail-filtering.md) | Implemented |
| F07 | [Introduction script compliance](./features/F07-introduction-script.md) | Implemented |
| F07 | [AssemblyAI transcript pipeline](./features/F07-assemblyai-transcript-pipeline.md) | Partial |
| F08 | [Dual STT + transcript review](./features/F08-dual-stt-transcript-review.md) | Implemented |
| F09 | [Bot call handling](./features/F09-bot-call-handling.md) | Implemented |
| F10 | [Audio clarity flags](./features/F10-audio-clarity-flags.md) | Implemented |
| F11 | [Dual audio storage (local vs S3)](./features/F11-dual-audio-storage.md) | Implemented |
| F12 | [MongoDB → PostgreSQL migration](./features/F12-postgres-migration.md) | Partial (Phase 3 reads) |

### Scoring detail (canonical)

- [../Call-and-Agent-Performance.md](../Call-and-Agent-Performance.md) — formulas for call quality, agent performance, quarter cards.

### Decisions (`decisions/`)

| ADR | Topic |
| --- | --- |
| [001-spec-driven-workflow.md](./decisions/001-spec-driven-workflow.md) | Why and how we use SDD |
| [002-nvidia-ecapa-spike-plan.md](./decisions/002-nvidia-ecapa-spike-plan.md) | NVIDIA NeMo ECAPA embedding spike (planned) |

### Templates

- [_template-feature.md](./_template-feature.md) — copy when adding a new feature spec.

## Spec status labels

Use these in feature specs:

| Status | Meaning |
| --- | --- |
| **Draft** | Idea or requirements not finalized |
| **Approved** | Ready to implement |
| **Implemented** | Code matches acceptance criteria |
| **Partial** | Some criteria met; gaps listed in spec |
| **Deprecated** | Replaced by another spec |

## Who reads what

| Role | Start here |
| --- | --- |
| Product / QA | `01-product-overview.md` + relevant `features/F*.md` |
| Backend dev | `03-data-model.md`, `04-api-contract.md`, feature spec |
| Frontend dev | `05-ui-routes.md`, feature spec, scoring doc |
| AI / ML dev | `F02`, `F04`, `Call-and-Agent-Performance.md` |
| AI coding agent | Root [AGENTS.md](../../AGENTS.md) + this README |

## Adding a new feature

1. Copy `_template-feature.md` → `features/Fxx-short-name.md`.
2. Fill in user story, rules, acceptance criteria, API/UI touchpoints.
3. Set status to **Approved**.
4. Implement; mark **Implemented** when criteria pass.
5. Link the spec from this README table.

## Out of scope for specs

- One-off scripts under `backend/scripts/` (unless they become product behavior).
- `.env` secrets and local paths.
- Generated `node_modules`, build output.
