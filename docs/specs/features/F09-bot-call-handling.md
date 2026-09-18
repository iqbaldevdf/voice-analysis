# F09 — Bot call handling (Freshcaller status 19)

**Status:** Implemented  
**Owner:** Backend + Frontend  
**Related:** [F06 — Voicemail & connect rules](./F06-voicemail-filtering.md), [03-data-model.md](../03-data-model.md)

## User story

As a reviewer, I want VoiceIQ to detect when a Freshcaller call was handled by a **bot** (including bot → human transfer) so agent KPIs and analysis focus on real agent conversations, and bot involvement is visible on the call.

## Freshcaller source

Official participant `call_status` **19**: *The call is handled by a bot.*  
([Freshcaller Participants API](https://developers.freshcaller.com/api/))

Additional signals (when present):

- `participant_type` containing `bot` (case-insensitive)
- `life_cycle[].type` containing `bot` (case-insensitive)

## Cases

| Case | Signals | `botHandling` | Connect for agent KPIs? | Analyze? |
| --- | --- | --- | --- | --- |
| No bot | No status 19 / bot type / bot lifecycle | `none` | Per F06 | Per F06 |
| **Bot only** | Bot signal, **no** human answered/connected (`call_status` 1/15 or lifecycle `answered`) | `bot_only` | No | No (422) |
| **Bot → agent** | Bot signal **and** human answered/connected | `bot_transferred` | Yes (human agent) | Yes (full recording for now) |

## Rules

1. Classification runs in `classifyFreshcallerCall()` at sync (same place as voicemail).
2. `isBotInvolved = botHandling !== "none"`.
3. `bot_only` is **not** a connect: `isConnected = false`; excluded from agent connect KPIs; excluded from default call list with other non-conversation noise; analyze rejected.
4. `bot_transferred` **is** a connect when F06 duration/voicemail rules pass; store flag and show UI badge **Bot → Agent**. Agent dashboard (F03) includes these rows when “Hide voicemails” is on.
5. Stored `callStatus` prefers human connected status (1/15) when present; otherwise 19 if bot; otherwise first known status.
6. Bot→agent is also inferred when a **human Agent participant** is present with a bot signal, even if `call_status` stays **19** (common after transfer).
7. Out of scope (v1 sync): trimming bot intro from audio/transcript.
8. **Phase 3:** When Freshcaller has no bot signal, analyze may still tag IVR/AI turns as `role=bot` from transcript script cues (`bot_segment.method=script_inferred`). This does **not** rewrite sync `botHandling` / connect KPIs.

## Acceptance criteria (Phase 1 — call classification)

- [x] AC1: Participant `call_status` **19** sets `botHandling` to `bot_only` or `bot_transferred` correctly.
- [x] AC2: Bot participant type / bot lifecycle also counts as bot signal.
- [x] AC3: `bot_only` → `isConnected: false`; not counted in agent connects; analyze returns 422.
- [x] AC4: `bot_transferred` → connect allowed; `isBotInvolved: true`; list/details/agent dashboard show badge.
- [x] AC4b: Agent dashboard with hide-voicemail includes `bot_transferred` connects; excludes `bot_only`.
- [x] AC5: Default recordings list hides `bot_only` (same default exclusion path as non-conversation noise).
- [x] AC6: Spec + data model document the new fields.

## Acceptance criteria (Phase 2 — transcript tags + banner)

- [x] AC7: Call details show **Bot** fact + callout when `botHandling` is `bot_transferred` / `bot_only` (or analysis `bot_segment.involved`).
- [x] AC8: Analyze passes `botHandling` / `isBotInvolved` in `participant_context`.
- [x] AC9: On bot-involved calls, opening IVR/script turns (or a 3rd diarization speaker) are tagged `role=bot` in `transcript_display` with label **Bot** / “Bot asked this”.
- [x] AC10: `analysisResult.bot_segment` records handling, handoff_sec (when found), method, and tagged count.
- [x] AC11: Introduction script scoring excludes bot-tagged turns.
- [x] AC12: Timeline legend includes Bot color when bot involvement is present.

## Acceptance criteria (Phase 3 — script-inferred Bot tags)

- [x] AC13: When Freshcaller `botHandling=none` but the transcript matches IVR/AI script cues (menus, “press 1”, “leave a message”, “record your name”, “virtual assistant”, monitored/recorded legalese, etc.), those turns are tagged `role=bot` with label **Bot** (not the live agent name).
- [x] AC14: Full single-speaker IVR monologues set `bot_segment.handling=bot_only`, `method=script_inferred`, and update the speaker role map to `bot`.
- [x] AC15: Opening IVR then human agent handoff without Freshcaller flag → `handling=bot_transferred`, handoff_sec set when possible.
- [x] AC16: Normal human agent/customer calls without IVR cues are **not** tagged bot.
- [x] AC17: Sync fields `botHandling` / `isBotInvolved` remain Freshcaller-only; script inference is analysis/`transcript_display` only.

## API touchpoints

| Method | Path | Change |
| --- | --- | --- |
| GET | `/recordings/db` | List items include `botHandling`, `isBotInvolved` |
| GET | `/recordings/db/:callId` | Detail includes same fields |

## UI touchpoints

| Route | Change |
| --- | --- |
| Calls list | Badge when `bot_transferred` (and optionally muted note if `bot_only` ever shown) |
| Call details | Status pill / fact for bot involvement |

## Data model

| Collection | Field | Change |
| --- | --- | --- |
| `recordings` / `recording_listings` | `botHandling` | `none` \| `bot_only` \| `bot_transferred` |
| | `isBotInvolved` | boolean |

## Implementation notes

| File | Role |
| --- | --- |
| `backend/src/freshcaller/connection.ts` | Classify bot signals |
| `backend/src/freshcaller/dailySyncPipeline.ts` | Persist flags |
| `backend/src/voicemail.ts` | Connect + list exclusion for `bot_only` |
| `backend/src/services/analyzeRecording.ts` | Reject `bot_only`; pass bot flags to AI |
| `ai-service/app/pipeline/bot_tagging.py` | Tag bot turns + `bot_segment` |
| `frontend` list/details | Badge, Bot fact, transcript “Bot asked this” |

## Open follow-ups

### Phase 2 — Transcript bot tags + clearer “bot handled” UX (strategy)

**Goal:** On calls where a bot spoke (especially bot → agent), reviewers must see:
1. **Call-level:** whether a bot handled / was involved in the call.
2. **Line-level:** which transcript turns are bot speech (not the real agent), e.g. tag **Bot** / “Bot asked this”.

Today F09 only classifies the **call**. STT still maps speakers to `agent` | `customer`, so early IVR/bot lines are often mislabeled as Agent.

#### Layer A — Call banner (product UX)

| `botHandling` | Show |
| --- | --- |
| `none` | No bot badge |
| `bot_transferred` | Badge **Bot → Agent** + short note: “A bot spoke before the agent joined.” |
| `bot_only` | Hidden from default list; if opened: **Bot handled** (no human agent) |

Wire from existing Mongo fields (`botHandling`, `isBotInvolved`) into call details header (list badge already for transfer).

#### Layer B — Who spoke “bot” in the transcript

Run **only when** `isBotInvolved` / `botHandling === bot_transferred` (or force flag for eval).

**Signals (combine; prefer uncertain over wrong):**

1. **Diarization 3rd speaker** — If AssemblyAI returns A/B/C and Freshcaller has a Bot participant, map the non-agent/non-customer cluster to role `bot`.
2. **Opening script patterns** — Early turns matching IVR/bot phrases (menu, “press 1”, “please hold”, “connecting you”, company auto-greet) → tag as `bot` even if diarization merged bot+agent into one speaker.
3. **Handoff boundary** — First strong human-agent cue after bot block (agent name intro, “how can I help”, longer natural turns) → `bot_handoff_sec`; turns before = bot/customer IVR; after = agent/customer.
4. **Optional ECAPA** — If 3 voices separable, confirm bot cluster ≠ agent centroid (reuse Stage 3b embeddings; do not enable for all calls).

**Output model (analysisResult):**

```json
{
  "bot_segment": {
    "involved": true,
    "handling": "bot_transferred",
    "handoff_sec": 42.5,
    "confidence": 0.7,
    "method": "script_plus_handoff"
  },
  "transcript_display": [
    {
      "speaker": "A",
      "role": "bot",
      "display_name": "Bot",
      "start": 0.0,
      "end": 5.2,
      "text": "Please hold while we connect you…"
    }
  ]
}
```

Allow `role`: `agent` | `customer` | `bot` | `unknown` in `transcript_display` / mapping.

**UI:** Bot rows use a distinct color + label **Bot** (tooltip: “Automated / IVR — not the live agent”). Timeline third color for bot.

#### Layer C — Scoring (later)

- Default: score **agent performance / intro script** only on turns after `handoff_sec` (or excluding `role=bot`).
- Keep full transcript visible for audit.

#### Delivery order

| Step | Work | Depends |
| --- | --- | --- |
| 2a | Call details always show bot handled / Bot → Agent from sync fields | F09 v1 (done) |
| 2b | Pass `botHandling` into AI analyze context | Backend → AI |
| 2c | `role=bot` in mapping + transcript_display + UI tags | 2b |
| 2d | Handoff time + exclude bot turns from agent scores | 2c + gold samples |
| 2e | Eval on 10–15 bot-transfer calls | Gold labels |

**Do not:** Treat every first speaker as bot; replace AssemblyAI transcription; rewrite sync `botHandling` from script alone.

**Phase 3 (implemented):** IVR/AI script cues may set `role=bot` + `bot_segment.method=script_inferred` even when Freshcaller is `none` (see AC13–AC17).

---

- Phase 2e: detect bot→agent handoff time in transcript and score only post-transfer turns (see strategy above).
- Backfill: re-classify existing Mongo docs on next sync or one-shot script.
