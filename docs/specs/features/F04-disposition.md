# F04 — Disposition & call outcome

**Status:** Partial  
**Owner:** Backend + AI service + Frontend

## User story

As a reviewer, I see a **sales disposition** on each call (colour-coded) and filter agents by **Appointment generated (AG)**.

## Two separate fields

| Field | Values | Source today | UI |
| --- | --- | --- | --- |
| **Call outcome** | Successful / Unsuccessful / Unclear | AI extraction | Call details badge |
| **Disposition** | Hung up, Not Interested, Appointment, Follow up, DNC | **Manual** dropdown | Agent table, call details |

Disposition is stored on `recording.disposition`. AG filter uses `disposition === appointment`.

## Colour coding (required)

| Disposition | Colour |
| --- | --- |
| Hung up, Not Interested | Yellow |
| Appointment | Dark green |
| Follow up | Light green |
| DNC | Blue |
| Not set | No badge |

## Manual disposition (implemented)

- PATCH `/recordings/db/:callId` with `{ disposition }`.
- Call details dropdown saves immediately.
- Reviewer override is authoritative.

## AI auto-disposition (planned)

**Status:** Not implemented — spec approved when rules provided.

1. Extend LLM extraction JSON with `sales_disposition`.
2. On analyze complete, set `disposition` if currently null.
3. Do not overwrite manual disposition unless spec updated.

### Proposed mapping (pending product approval)

| Disposition | AI signals (draft) |
| --- | --- |
| Appointment | Demo/meeting booked, confirmed time |
| DNC | Do not call, remove from list |
| Not Interested | Clear rejection |
| Hung up | Abrupt end, hang-up language |
| Follow up | Callback, send info, think about it |
| null | Unclear |

## Acceptance criteria

- [x] AC1: Five disposition values + colours in UI.
- [x] AC2: AG filter on agent page works.
- [x] AC3: Call outcome remains separate from disposition.
- [ ] AC4: AI sets disposition on analyze when rules approved.
- [ ] AC5: Optional backfill script for existing analyzed calls.

## Implementation

| File | Role |
| --- | --- |
| `backend/src/routes/dbRecordings.ts` | PATCH disposition |
| `frontend/src/lib/disposition.ts` | Labels + CSS classes |
| `frontend/src/views/CallDetailsView.tsx` | Dropdown |
| `ai-service/app/providers/assemblyai.py` | Extraction (extend for F04) |

## Open items

- Product to approve disposition rules (see conversation) before AC4.
