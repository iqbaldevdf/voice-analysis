# Voice Analysis

Call recording intelligence powered by **AssemblyAI**, with optional **Freshcaller** sync.

## What Analyze call does

1. Sync calls from Freshcaller (export → poll job → download ZIP → index recordings)
2. Normalize audio (Node worker threads + ffmpeg → 16 kHz mono)
3. AssemblyAI speech-to-text + speaker diarization + LLM sentiment
4. Call metrics: quality, fluency, energy, response time, silence, interruptions, overtalk
5. AI extraction (topics, tags, key moments, outcome) via AssemblyAI LLM Gateway
6. Call Details dashboard: KPIs, charts, transcript

## Setup

```bash
npm run install:all
copy backend\.env.example backend\.env
copy ai-service\.env.example ai-service\.env
```

Set in `ai-service/.env`:

- `ASSEMBLYAI_API_KEY`

Set in `backend/.env`:

- `FRESHCALLER_BASE_URL` (e.g. `https://datafortunecallcenter.freshcaller.com`)
- `FRESHCALLER_API_AUTH`
- `MONGODB_URI=mongodb://127.0.0.1:27017/voice_analysis`

### MongoDB (Docker)

```bash
docker compose up -d
```

Starts MongoDB on port `27017` (database `voice_analysis`).

Python venv (short path recommended on Windows):

```bash
py -3.12 -m venv C:\va-ai
C:\va-ai\Scripts\python.exe -m pip install -r ai-service\requirements.txt
```

## Run

From the project root:

```bash
npm run dev:ai
npm run dev:backend
npm run dev:frontend
```

Open http://127.0.0.1:5173

## Freshcaller flow

1. On **Calls**, pick a date range → **Start sync**
2. Backend creates an export, polls `/api/v1/jobs/:id`, downloads the ZIP, indexes `calls_*.json` in memory
3. Click **Analyze** on a call with a recording → download audio → normalize → AI analyze → **Call Details**

## Call export JSON sources

Both project-root export files will be used in Step 2 import:

- `calls_2026-08-15T00_00_00Z-2026-08-28T23_59_59Z_9025323.json`
- `calls_2026-09-01T01_03_00+00_00-2026-09-04T23_59_59+00_00_9041556.json`

Only calls with a non-null `recording.url` are stored.

### Mongo recordings API (Step 3–4)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/recordings/db` | List imported recordings (`?status=&hasAudio=&q=&limit=&skip=`) |
| GET | `/recordings/db/:callId` | One recording (+ `analysisResult` if present) |
| GET | `/recordings/db/:callId/audio` | Stream local audio file |
| POST | `/recordings/db/:callId/analyze` | Download audio if needed, run AI **once**, store result in Mongo |

### Import recordings into MongoDB (Step 2)

```bash
cd backend
# metadata + download audio (requires FRESHCALLER_API_AUTH)
npm run import:recordings

# metadata only (no downloads)
npm run import:recordings -- --metadata-only

# test with first 5 recordings
npm run import:recordings -- --limit 5
```
