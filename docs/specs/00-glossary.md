# Glossary

Terms used consistently across all VoiceIQ specs.

| Term | Definition |
| --- | --- |
| **VoiceIQ** | Product name for this call intelligence app. |
| **Connect** | A call that counts as a live conversation (not voicemail, not missed, not bot-only). Used for agent KPIs and “Calls processed”. |
| **Voicemail** | Freshcaller voicemail status, or a call ≤ 40 seconds (see F06). |
| **Bot handling** | Freshcaller `call_status` 19 / bot participant: `bot_only` or `bot_transferred` (see F09). |
| **Analyze** | Run STT + sentiment + performance scoring once; store `analysisResult` in MongoDB. |
| **Call quality** | 0–100 score from clarity (50%) + speech-rate score (50%). Not the same as agent performance. |
| **Agent performance** | 0–100 weighted score across seven behaviour categories after transcript exists. |
| **Call score** | Call quality shown on a recording row. |
| **Sentiment** | POSITIVE / NEUTRAL / NEGATIVE view from LLM. Does **not** drive quality or performance scores. |
| **Call outcome** | AI label: Successful / Unsuccessful / Unclear. Separate from disposition. |
| **Disposition** | Sales result on a call: Hung up, Not Interested, Appointment, Follow up, DNC. |
| **AG** | Appointment Generated — filter showing only calls with disposition = Appointment. |
| **Quarter** | Calendar quarter in **Asia/Kolkata**: Q1 Jan–Mar, Q2 Apr–Jun, Q3 Jul–Sep, Q4 Oct–Dec. |
| **IST call date** | `YYYY-MM-DD` derived from call `createdTime` in Asia/Kolkata. |
| **Freshcaller sync** | Daily (or manual) export → ZIP → index recordings → download audio. |
| **Recording** | One Freshcaller call with a downloadable `recording.url`. |
| **Listing** | Lightweight Mongo projection (`recording_listings`) for fast tables without full analysis blob. |
| **Speaker mapping** | Assigning diarization labels (`A`, `B`) to roles (`agent`, `customer`). See F07. |
| **Speaker-aware transcript** | Transcript text labeled by role (and optionally name), built after mapping. See F07. |
| **Audio clarity flag** | Recording reliability: `ok` / `caution` / `poor` from ASR word confidence and WAV clipping/quietness (F10). Not agent performance. |
| **Dual audio storage** | Local disk in dev (`S3_ENABLED=false`); private S3 originals in prod with local cache for ffmpeg/AI (F11). |

## Disposition colour coding (UI)

| Disposition | Colour |
| --- | --- |
| Hung up, Not Interested | Yellow |
| Appointment | Dark green |
| Follow up | Light green |
| DNC | Blue |
| Not set | No badge |
