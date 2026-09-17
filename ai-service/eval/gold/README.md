# Gold diarization evaluation dataset (developer / offline only)

This folder holds **manually labeled** physical speaker ground truth for evaluating
AssemblyAI vs Phase 2 (island) vs Phase 3 (ECAPA + boundary) diarization.

## Rules

- Label **physical speakers** `A` / `B` only — **not** Agent / Customer.
- Do **not** copy AssemblyAI, ECAPA, or `map_speakers` as gold.
- Listen to the audio and mark who actually spoke each segment.
- Keep `AUDIO_SPEAKER_VALIDATION=false` in production while evaluating.
- `OVERLAP` / `UNCLEAR` / `SKIP` are allowed during labeling but are **excluded** from accuracy metrics (written to `excluded.jsonl`, never coerced to A/B).

## File layout

```text
eval/gold/
  README.md                 # this file
  calls.jsonl               # A/B rows only (for evaluate_audio_diarization.py)
  excluded.jsonl            # OVERLAP / UNCLEAR / SKIP (not scored)
  progress/progress.json    # autosaved labeling progress (resume)
  templates/                # unlabeled scaffolding (goldSpeaker=null)
```

## Segment record schema (JSONL)

```json
{
  "callId": "9002261",
  "recordingId": "5348624",
  "audioPath": "backend/data/fc-recordings/fc_9002261_5348624.wav",
  "startMs": 6800,
  "endMs": 8520,
  "text": "I was trying to connect with",
  "assemblyAiSpeaker": "B",
  "goldSpeaker": "A",
  "segmentType": "speaker_island",
  "notes": "Suspected diarization island; listen carefully",
  "labelerId": "default"
}
```

| Field | Required | Notes |
| --- | --- | --- |
| `callId` | yes | Freshcaller call id |
| `recordingId` | yes | Freshcaller recording id |
| `audioPath` | yes | Path relative to repo root or absolute |
| `startMs` / `endMs` | yes | Segment bounds in milliseconds |
| `text` | no | Transcript snippet (labeling aid only) |
| `assemblyAiSpeaker` | yes | Original AAI label (hidden in UI until after save) |
| `goldSpeaker` | yes for metrics | `A` or `B` in `calls.jsonl`. Templates use `null` |
| `segmentType` | recommended | see below |
| `labelerId` | optional | Who labeled |
| `secondLabel` | optional | Second independent label for disagreement checks |

### segmentType values

`stable_turn` | `short_response` | `speaker_island` | `interruption` | `overlap` | `rapid_switch` | `low_quality`

---

## How to start the labeling tool

From `ai-service/` (use the project AI venv):

```powershell
cd ai-service
C:\va-ai\Scripts\python.exe scripts/gold_label_server.py
# Open http://127.0.0.1:8765
```

Optional: `--labeler-id alice` `--port 8765`

This is a **local developer tool only** — not product UI.

### Workflow

1. **Select a call** from the dropdown (or All calls).
2. **Establish references** on long clear turns: play the segment, then **Set current → A ref** / **B ref**.  
   References are human listening aids only — they never auto-write gold labels.  
   Keep the same voice as A and the same voice as B for the whole call.
3. For each segment: **Play segment**, and for short words use **±2s** / **±5s** context.
4. Choose **A / B / Overlap / Unclear / Skip** (keys: `A` `B` `O` `U` `S`). Space = play segment.
5. Label saves immediately to `progress/progress.json` and exports JSONL.
6. After save, AssemblyAI speaker may appear for debug only — do not change gold to match it.
7. **Resume unlabeled** jumps to the next unlabeled segment. Progress survives restarts.

### Handling special labels

| Label | When | Scoring |
| --- | --- | --- |
| A / B | Clear single physical speaker | Written to `calls.jsonl`, used by eval harness |
| OVERLAP | Both talk at once / inseparable | `excluded.jsonl` only |
| UNCLEAR | Cannot decide after listening with context | `excluded.jsonl` only |
| SKIP | Out of scope / junk / not worth labeling | `excluded.jsonl` only |

Never invent A/B when unsure.

### Export / validate / status

```powershell
C:\va-ai\Scripts\python.exe scripts/gold_label_export.py
C:\va-ai\Scripts\python.exe scripts/gold_label_validate.py
C:\va-ai\Scripts\python.exe scripts/gold_label_status.py
```

**Ready for evaluation: YES** when:

- ≥ 50 valid A/B labels, and
- ≥ 5 calls each have ≥ 3 A/B labels

(100% completion is not required — leftover OVERLAP/UNCLEAR/SKIP is fine.)

### After labeling — evaluation (do not tune thresholds early)

```powershell
C:\va-ai\Scripts\python.exe scripts/gold_label_validate.py
C:\va-ai\Scripts\python.exe scripts/evaluate_audio_diarization.py --gold eval/gold/calls.jsonl --report eval/DIARIZATION_EVAL_REPORT.md
# Optional later, only with enough gold:
#   ... --threshold-sweep
```

Pipeline: human labels → `calls.jsonl` → evaluate AAI vs Phase2 vs Phase3 → false-correction analysis → threshold sweep → go/no-go.  
Do **not** enable `AUDIO_SPEAKER_VALIDATION` until that go/no-go says so.

## Reuse

- Templates: `templates/*.jsonl` (from `scripts/poc_data/*.utterances.json`)
- Eval harness: `scripts/evaluate_audio_diarization.py`
- Labeling library: `scripts/gold_labeling/`
