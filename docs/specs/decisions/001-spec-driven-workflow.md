# ADR 001 — Spec-driven development workflow

**Status:** Accepted  
**Date:** 2026-09-09

## Context

VoiceIQ spans three services (frontend, backend, AI), MongoDB, and Freshcaller. Requirements were spread across README snippets, one scoring doc, and tribal knowledge. Changes (e.g. voicemail filter, disposition, quarterly KPIs) were hard to trace.

## Decision

Adopt **spec-driven development (SDD)**:

1. **`docs/specs/`** holds product and technical specs as the source of truth.
2. **Feature specs** (`F01`–`Fnn`) include acceptance criteria checkboxes.
3. **Scoring formulas** stay canonical in `Call-and-Agent-Performance.md`; feature specs link to it.
4. **Code changes** that alter behaviour must update the relevant spec in the same change set.
5. **`AGENTS.md`** and `.cursor/rules/spec-driven.mdc` instruct AI assistants to read specs first.

## Consequences

**Positive**

- Onboarding: read `docs/specs/README.md` then one feature spec.
- QA can verify against acceptance criteria.
- AI agents implement consistently with documented rules.

**Negative**

- Specs can drift if not updated with code — mitigated by PR checklist.

## Alternatives considered

- **README only** — already overloaded; not structured for features.
- **OpenAPI-only** — covers API, not scoring/UI rules.
- **Tests as specs** — useful later; prose specs needed for product rules first.
