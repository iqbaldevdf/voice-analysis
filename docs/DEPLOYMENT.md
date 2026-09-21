# VoiceIQ — Application Deployment Requirements

Hand this document to DevOps. It describes **what the current codebase needs to run in production**, not a future Dockerized design.

**Product:** VoiceIQ (Voice Analysis)  
**Architecture:** 3 application services + MongoDB Atlas + Amazon S3 (audio) + reverse proxy  
**Repo layout:** `frontend/`, `backend/`, `ai-service/`, `docker-compose.yml` (Mongo only)  
**Current state:** No production Dockerfiles, no CI/CD, no in-app login. Local run is `npm run dev:*`. S3 audio is **wired** behind `S3_ENABLED` (F11); default remains local disk. DevOps still creates private buckets (section 21).

Related local-dev setup lives in the root [README.md](../README.md).

---

## 1. What you are deploying

Five runtime pieces plus a public edge:

| Component | Stack | Default port | Public? |
| --- | --- | --- | --- |
| **Frontend** | React 18 + Vite 5 (static SPA) | 5173 (dev only) | **Yes** — served as static files |
| **Backend** | Node.js + Express + TypeScript | **5050** | **No** — only via reverse proxy |
| **AI service** | Python 3.12 + FastAPI + Uvicorn | **8001** | **No** — internal only |
| **MongoDB** | **MongoDB Atlas** (cluster, MongoDB 7) | `27017` via `mongodb+srv` | **No** — Atlas only; not public to browsers |
| **Amazon S3** | Private buckets (`ap-south-1`) | HTTPS | **No** — backend only; never public |
| **Reverse proxy** | nginx / Caddy / ALB | 443 | **Yes** — HTTPS terminator |

```
Browser  --HTTPS-->  Reverse proxy
                         |-- static files (frontend/dist)
                         |-- /api/*  --> Backend :5050  (strip /api prefix)
Backend  --TLS-------->  MongoDB Atlas (mongodb+srv)
Backend  --HTTPS------>  Amazon S3 (recordings + exports)
Backend  --------------->  AI service :8001
Backend  --HTTPS------->  Freshcaller API + recording/export downloads
AI       --HTTPS------->  AssemblyAI STT + LLM Gateway
```

**Hard constraint (still true after S3):** The AI service reads a **local filesystem path** (`audio_path`), not S3 URIs. Backend must **download from S3 to a local working cache** (same VM / shared volume at the same absolute path) before `/analyze`. S3 is the durable store; local disk is a scratch cache.

---

## 2. Recommended topology (production)

**Preferred for first production: one Linux VM + MongoDB Atlas cluster.**

| Process | Replicas |
| --- | --- |
| Reverse proxy | 1 |
| Frontend static | served by proxy |
| Backend | **exactly 1** (in-process cron; do not scale out) |
| AI service | **exactly 1** (CPU-heavy; shares disk with backend) |
| MongoDB | **Atlas cluster** (do not run local `docker compose` Mongo in production) |
| Amazon S3 | **1 bucket per environment** (see [section 21](#21-amazon-s3-audio-storage-planned)) |

Do **not** run multiple backend replicas until cron is moved out of the process. Duplicate backends will double-run daily Freshcaller sync.

GPU is **not required**. Default speaker-embedding path is CPU (PyTorch CPU + SpeechBrain ECAPA).

---

## 3. Runtime versions

| Runtime | Required | Notes |
| --- | --- | --- |
| **OS** | Linux x86_64 (Ubuntu 22.04/24.04 LTS recommended) | Dev is Windows; production should be Linux |
| **Node.js** | **20 LTS** (18+ works) | Backend `@types/node` is 18; use 20 LTS |
| **npm** | 10.x (bundled with Node 20) | |
| **Python** | **3.12** | README uses `py -3.12`; pin 3.12, not 3.13 |
| **MongoDB** | **7.x on Atlas** | App uses `MONGODB_URI` only; no local Mongo in production |
| **ffmpeg + ffprobe** | Latest stable, **on PATH** | Required on the **backend host** and **AI host** |
| **libsndfile** | System package | Required by SpeechBrain / `soundfile` |
| **Build tools** | `build-essential`, Python headers | For some pip wheels if CPU wheels miss |

There are **no Dockerfiles** for frontend/backend/AI today. DevOps can containerize, but must keep the **shared volume + same path** rule.

---

## 4. System packages (Linux)

```bash
sudo apt-get update
sudo apt-get install -y \
  ffmpeg \
  libsndfile1 \
  python3.12 python3.12-venv python3.12-dev \
  build-essential \
  curl ca-certificates
```

Verify:

```bash
ffmpeg -version
ffprobe -version
node -v    # v20.x
python3.12 --version
```

---

## 5. Process start commands

Install from repo root:

```bash
npm run install:all
```

### Frontend build

```bash
cd frontend
npm run build
# output: frontend/dist
```

Serve `frontend/dist` with the reverse proxy. Do **not** run `vite` in production.

### Backend

```bash
cd backend
# env file at backend/.env
npm start
# equivalent: npx tsx src/index.ts
```

Listens on `PORT` (default 5050). `app.listen(PORT)` binds all interfaces (`0.0.0.0`). Restrict with firewall / bind to private IP.

### AI service

```bash
python3.12 -m venv /opt/voiceiq/ai-venv
source /opt/voiceiq/ai-venv/bin/activate
pip install -U pip
pip install -r ai-service/requirements.txt
# then speaker-validation stack (see section 7)
cd ai-service
# env file at ai-service/.env
# Production: bind 0.0.0.0 only on private network, never public
HOST=0.0.0.0 PORT=8001 python -m uvicorn app.main:app --host 0.0.0.0 --port 8001
```

`.env.example` has `HOST=127.0.0.1`. That is correct **only** if backend and AI share the same host. In containers, set `HOST=0.0.0.0`.

### MongoDB (Atlas — production)

Do **not** run `docker compose` Mongo for production. Create an Atlas cluster (see [section 12](#12-mongodb--atlas)) and set `MONGODB_URI` on the backend to the `mongodb+srv://` connection string.

Local `docker compose up -d` is only for developer machines.

---

## 6. Reverse proxy (required)

Frontend API client is hardcoded to `API_BASE = "/api"`. Vite rewrites `/api` → backend. Production **must** do the same.

### nginx sketch

```nginx
server {
  listen 443 ssl http2;
  server_name voiceiq.example.com;

  # SPA
  root /var/www/voiceiq/frontend/dist;
  index index.html;
  location / {
    try_files $uri $uri/ /index.html;
  }

  # Browser → backend (strip /api)
  location /api/ {
    proxy_pass http://127.0.0.1:5050/;   # trailing slash strips /api
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;

    # Analyze can take many minutes (STT poll + LLM + ECAPA)
    proxy_read_timeout 1200s;
    proxy_send_timeout 1200s;
    client_max_body_size 100M;   # manual audio upload limit in backend
  }
}
```

SPA routes that must fall back to `index.html`:

- `/recordings`, `/recordings/:callId/:recordingId`
- `/meetings`, `/meetings/:callId/:recordingId`
- `/agents`, `/agents/:agentId`
- `/sync`, `/logs`

**Do not** expose `:5050`, `:8001`, or `:27017` on the public internet.

**Timeouts:** Analyze is a **synchronous** HTTP call. Vite already uses **1,200,000 ms (20 min)**. Match that on every hop (nginx, load balancer, WAF, Cloudflare). Default 60s proxies will fail production analyze.

---

## 7. Python / ML dependencies (AI service)

### Always install

From `ai-service/requirements.txt`:

- FastAPI 0.115.12, Uvicorn, pydantic, httpx, python-dotenv, jiwer
- `faster-whisper` is listed even if Dual STT is off (harmless if unused)

### Required for default analyze (Stage 3b speaker validation)

From `ai-service/requirements-speaker-validation.txt`. **Analyze fails** if this is missing and `AUDIO_SPEAKER_VALIDATION=true` (the default).

```bash
pip install torch==2.5.1+cpu torchaudio==2.5.1+cpu \
  --index-url https://download.pytorch.org/whl/cpu
pip install speechbrain==1.0.2 soundfile requests
```

**Model file (must be on disk before first analyze):**

- HuggingFace: `speechbrain/spkrec-ecapa-voxceleb` → `embedding_model.ckpt`
- Default path: `ai-service/.cache/speechbrain-ecapa/embedding_model.ckpt`
- Override: `SPEAKER_EMBEDDING_MODEL_DIR`

Host must allow **outbound HTTPS to HuggingFace** at least once to download the checkpoint (or bake the file into the image/volume). License: SpeechBrain Apache-2.0.

### Optional (leave off unless product asks)

| Feature | Env | Extra cost |
| --- | --- | --- |
| Dual STT (Whisper compare) | `DUAL_STT_ENABLED=true` on **both** backend and AI | Downloads `small.en` (~500 MB); more RAM/CPU |
| NVIDIA NeMo ECAPA | `SPEAKER_EMBEDDING_BACKEND=nemo` | Heavy `nemo_toolkit[asr]`; NGC model download |

**Production default:** Dual STT **off**, embedding backend **speechbrain**, device **cpu**.

Emergency only: `AUDIO_SPEAKER_VALIDATION=false` skips Stage 3b. Do not use as the normal deploy.

---

## 8. Environment variables

Create two files. **Never commit `.env`.** Copy from `backend/.env.example` and `ai-service/.env.example`.

### 8.1 `backend/.env`

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `PORT` | no | `5050` | Backend listen port |
| `AI_SERVICE_URL` | **yes** | `http://127.0.0.1:8001` | Internal AI base URL |
| `MONGODB_URI` | **yes** | Atlas `mongodb+srv://...` | Must include database name **`voice_analysis`**. See [section 12](#12-mongodb--atlas). |
| `FRESHCALLER_BASE_URL` | **yes** | — | e.g. `https://<account>.freshcaller.com` |
| `FRESHCALLER_API_AUTH` | **yes** | — | Freshcaller API token (`X-Api-Auth`). Must not be `changeme`. |
| `FRESHCALLER_POLL_INTERVAL_MS` | no | `4000` | Export job poll |
| `FRESHCALLER_MAX_POLL_ATTEMPTS` | no | `90` | ~6 minutes of polling |
| `FRESHCALLER_CRON_ENABLED` | no | `true` | Daily sync |
| `FRESHCALLER_CRON_EXPR` | no | `0 1 * * *` | 01:00 |
| `FRESHCALLER_CRON_TZ` | no | `Asia/Kolkata` | **Must stay IST** |
| `CRON_LOG_TTL_DAYS` | no | `90` | Mongo TTL on `cron_job_logs` |
| `FC_RECORDINGS_DIR` | **yes** | `./data/fc-recordings` | Downloaded call audio |
| `NORMALIZED_DIR` | **yes** | `./data/normalized` | 16 kHz mono WAV for AI |
| `UPLOADS_DIR` | no | `./data/uploads` | Manual uploads |
| `EXPORTS_DIR` | **yes** | `./data/exports` | Freshcaller ZIP exports |
| `RECORDINGS_DIR` | no | `../recordings` | Legacy local files |
| `JOBS_FILE` | no | `./data/jobs.json` | Legacy job store |
| `FFMPEG_CONCURRENCY` | no | `2` | Parallel ffmpeg workers |
| `DUAL_STT_ENABLED` | no | `false` | Keep `false` unless Dual STT is enabled on AI too |

**Timezone:** Business calendar is **Asia/Kolkata**. Set OS `TZ=Asia/Kolkata` or keep `FRESHCALLER_CRON_TZ=Asia/Kolkata`. Quarters and `callDate` are IST.

### 8.2 `ai-service/.env`

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `HOST` | yes | `127.0.0.1` | Use `0.0.0.0` only on private network |
| `PORT` | yes | `8001` | |
| `ASSEMBLYAI_API_KEY` | **yes** | — | Paid AssemblyAI key |
| `ASSEMBLYAI_SPEECH_MODEL` | no | `universal-2` | |
| `ASSEMBLYAI_ENABLE_LLM` | no | `true` | Sentiment + extraction |
| `ASSEMBLYAI_LLM_MODEL` | no | `qwen3.5-4b-32k-fast` | LLM Gateway model |
| `ASSEMBLYAI_LLM_GATEWAY_URL` | no | `https://llm-gateway.assemblyai.com/v1/chat/completions` | |
| `ASSEMBLYAI_POLL_INTERVAL_SEC` | no | `3` | STT job poll |
| `ASSEMBLYAI_SPEAKERS_EXPECTED` | no | `2` | Diarization hint |
| `DUAL_STT_ENABLED` | no | `false` | Keep false unless product wants Whisper |
| `AUDIO_SPEAKER_VALIDATION` | no | `true` | Required for production quality |
| `SPEAKER_EMBEDDING_BACKEND` | no | `speechbrain` | |
| `SPEAKER_EMBEDDING_MODEL_DIR` | recommended | `ai-service/.cache/speechbrain-ecapa` | Must contain `embedding_model.ckpt` |

Leave the `AUDIO_SV_*` knobs at defaults unless ML owners change them.

### 8.3 Secrets DevOps must obtain from the product owner

1. **AssemblyAI API key** (STT + LLM Gateway; usage-based billing)
2. **Freshcaller API token** + account base URL
3. **MongoDB Atlas** connection string (database user + password + cluster hostname)
4. **AWS account** + IAM role (or access keys) for the S3 audio bucket (see [section 21](#21-amazon-s3-audio-storage-planned))

---

## 9. Disk / volumes (working cache)

Durable audio lives in **S3** (section 21). Local directories are a **working cache** so ffmpeg and the AI service can read files. Backend and AI must still see the **same local paths**.

| Path (relative to `backend/`) | Contents | Persist? |
| --- | --- | --- |
| `data/fc-recordings/` | Cache of original audio pulled from S3 / Freshcaller | Cache — can be pruned |
| `data/normalized/` | 16 kHz mono PCM WAV for `/analyze` | Cache — regenerate from original |
| `data/exports/` | Freshcaller ZIP while indexing | Cache — optional S3 copy |
| `data/uploads/` | Manual uploads before S3 put | Cache |
| `data/jobs.json` | Legacy jobs | Optional |
| `ai-service/.cache/speechbrain-ecapa/` | ECAPA checkpoint | **Yes** (not S3) |
| MongoDB Atlas | DB `voice_analysis` | Atlas |
| Amazon S3 | Original recordings + export ZIPs | **Yes** — source of truth |

**Size guidance:**

| Store | Where | Estimate |
| --- | --- | --- |
| Original recording | **S3** | ~1–5 MB per call (mp3) |
| Normalized WAV | **Local cache only** (do not keep forever in S3) | ~2 MB per minute. 10 min call ≈ 19 MB |
| Export ZIP | S3 (short retention) + local while processing | tens–hundreds of MB per day |
| Mongo `analysisResult` | Atlas | hundreds of KB to a few MB per analyzed call |
| ECAPA checkpoint | Local disk | ~80 MB |

**App VM disk after S3:** **80–150 GB** SSD is enough for cache + models (down from 200–500 GB if all audio stayed on the VM). Still monitor cache growth.

---

## 10. Compute sizing (first production)

| Resource | Minimum | Comfortable |
| --- | --- | --- |
| **vCPU** | 4 | 8 |
| **RAM** | 8 GB | 16 GB |
| **Disk** | 80 GB SSD | 150 GB SSD (working cache; originals in S3) |
| **GPU** | none | none |

Breakdown:

- Backend: light Node + ffmpeg workers (`FFMPEG_CONCURRENCY=2`)
- AI: PyTorch CPU + SpeechBrain is the heavy process — budget **4–8 GB RAM** for AI alone
- Mongo lives on **Atlas**, not on this VM — do not reserve extra RAM for a local `mongod`
- Dual STT / NeMo: add RAM/CPU; not in default deploy

Analyze is CPU-bound and **one call at a time per user click**. There is no analysis job queue. Do not expect high parallel throughput on a small VM.

---

## 11. Network / firewall / egress

### Inbound (public)

| Port | Source | Dest |
| --- | --- | --- |
| **443** | Users (office / VPN — see security) | Reverse proxy |

### Internal only

| Port | From | To |
| --- | --- | --- |
| 5050 | Proxy | Backend |
| 8001 | Backend | AI |

MongoDB Atlas is **outbound from the backend** (not a port you open inbound on the VM).

### Required outbound HTTPS

| Destination | Who | Why |
| --- | --- | --- |
| `https://<account>.freshcaller.com` | Backend | Export, jobs, calls list, recording download |
| Freshcaller signed/CDN audio URLs (follow redirects) | Backend | Actual recording bytes (often S3-like) |
| `https://api.assemblyai.com` | AI | Upload audio, create/poll transcript |
| `https://llm-gateway.assemblyai.com` | AI | Sentiment + extraction |
| `https://huggingface.co` (and HF CDN) | AI, first-time | ECAPA checkpoint (or pre-stage the file) |
| `*.mongodb.net` (SRV + `27017` TLS) | Backend | Atlas cluster |
| `*.amazonaws.com` / `s3.ap-south-1.amazonaws.com` | Backend | S3 put/get for audio and exports |
| Ubuntu/npm/PyPI/PyTorch CPU index | Build | Package install |

If the environment has no internet on the app node, pre-bake wheels, Node `node_modules`, ECAPA ckpt, and allow **only** Freshcaller + AssemblyAI + Atlas + S3 egress.

Allow **long-lived HTTPS** and reasonably large uploads to AssemblyAI (normalized WAV of full calls).

---

## 12. MongoDB — Atlas

Production database is **MongoDB Atlas**. The Node driver already reads `MONGODB_URI`; no code change is required.

### Cluster settings to create

| Setting | Value | Why |
| --- | --- | --- |
| Provider | AWS (or same cloud as the app VM) | Lower latency |
| Region | **Mumbai `ap-south-1`** (or closest to the app VM) | App calendar is Asia/Kolkata |
| MongoDB version | **7.0** | Matches current stack |
| Cluster tier | **M10 dedicated** (minimum for production) | `analysisResult` documents are large; M0 Free (512 MB) will fill quickly |
| Cluster name | e.g. `voiceiq-prod` | Any name |
| Database name | **`voice_analysis`** | Hard requirement — backend uses the DB name in the URI |

Use **M0 / Flex only** for a short connectivity smoke test, not for real call analysis.

### Database user

1. Atlas → **Database Access** → Add user.
2. Auth: **Password** (SCRAM).
3. Role: **`readWrite`** on database `voice_analysis` (or Atlas `readWriteAnyDatabase` if you prefer one app user).
4. Save the password. If it contains `@ : / ? # %` you **must URL-encode** it in the URI.

### Network access (IP allowlist)

Atlas → **Network Access**:

1. Add the **public IP of the backend / app VM**.
2. Add developer IPs if they use MongoDB Compass.
3. Do **not** use `0.0.0.0/0` unless there is no static IP and you accept the risk.

Optional later: VPC peering / Private Endpoint if the VM is in the same cloud. Not required for first go-live.

DNS: the VM must resolve SRV records (`_mongodb._tcp.<cluster>.mongodb.net`). Standard public DNS is enough.

### Connection string (`MONGODB_URI`)

In Atlas: **Connect** → **Drivers** → Node.js → copy the SRV string. Put the **database name** `voice_analysis` in the path (Atlas UI often shows `/?` with no DB name).

```
mongodb+srv://VOICEIQ_USER:URL_ENCODED_PASSWORD@cluster0.xxxxx.mongodb.net/voice_analysis?retryWrites=true&w=majority
```

Put this in `backend/.env` as `MONGODB_URI`. Never commit it.

The backend calls `client.db()` with no extra name, so the URI path **`/voice_analysis` is required**.

### How the app uses Atlas

- Indexes are created **automatically on backend startup**. No Atlas “migration” step.
- Backend **exits if Mongo is unreachable** (wrong URI, IP not allowlisted, bad password).
- Collections:

| Collection | Role |
| --- | --- |
| `recordings` | Canonical call + large `analysisResult` |
| `recording_listings` | List-view projection (no analysis blob) |
| `agents` | Agent roster / stats |
| `export_jobs` | One row per IST `callDate` |
| `cron_job_logs` | Sync logs, TTL ~90 days (`CRON_LOG_TTL_DAYS`) |

### Storage and backups

- Plan for **large documents** (transcript + word timings + scores can be hundreds of KB to a few MB per analyzed call). MongoDB’s hard limit is **16 MB per document**.
- Enable **Atlas continuous backup / cloud snapshots**. `analysisResult` is expensive to rebuild (re-analyze pays AssemblyAI again).
- Monitor Atlas **storage** and **data size**; grow the cluster before the disk fills.

### Verify from the app VM

```bash
# After backend is configured
curl -s http://127.0.0.1:5050/health
# Expect: "mongo": { "connected": true }
```

If `connected` is false: check IP allowlist, password encoding, and that `/voice_analysis` is in the URI.

---

## 13. Health checks

| Service | Method | Expect |
| --- | --- | --- |
| Backend | `GET http://backend:5050/health` | `{ ok: true, mongo.connected: true, freshcallerConfigured: true }` |
| AI | `GET http://ai:8001/health` | `{ ok: true, api_key_configured: true, audio_speaker_validation: true }` |
| Mongo / Atlas | Backend `/health` → `mongo.connected` | `true` |

**Do not** put `/health` on a 1-second liveness probe that hits Mongo under load if you can avoid it; 10–30s interval is fine.

Note: backend `/health` currently returns internal paths and a masked Mongo URI. Keep it **internal**.

---

## 14. Security (must-know before go-live)

The product spec lists **no multi-tenant RBAC**. The app has:

- **No login / JWT / SSO**
- **CORS wide open** (`app.use(cors())`)
- **No auth** on analyze, audio streaming, disposition, or sync

Anyone who can reach the UI can:

- List calls, stream recordings, run paid AssemblyAI jobs
- Trigger Freshcaller sync
- Change dispositions

**DevOps must put an access layer in front:**

- VPN / private network, **or**
- SSO (oauth2-proxy / Entra / Cloudflare Access), **or**
- IP allowlist for office

Also:

- AI service must **not** be internet-facing
- Mongo must **not** be reachable except via Atlas IP allowlist (no public Compass from the world)
- TLS on the public hostname
- Secrets in a vault / env, not in git
- Restrict `HOST` for AI to private interface

---

## 15. Cron / operations

| Item | Behaviour |
| --- | --- |
| Daily sync | `0 1 * * *` **Asia/Kolkata** — previous IST day |
| Startup catch-up | If yesterday was missed, runs once when backend starts |
| Extra catch-up | Every 15 minutes while process is up |
| Manual sync | UI `/sync` → `POST /freshcaller/sync/run` |
| Idempotency | One export job per `callDate` unless `force=true` |
| Concurrency | Only **one** sync at a time (HTTP 409 otherwise) |

Process manager: **systemd** (or Docker restart policy) for backend + AI. If the backend dies, cron stops.

Suggested systemd units: `voiceiq-backend`, `voiceiq-ai`. `Restart=on-failure`. After `network-online` and Mongo.

---

## 16. Freshcaller API used

Header: `X-Api-Auth: <token>`

| Call | Path |
| --- | --- |
| Create export | `POST /api/v1/account/export` |
| Poll job | `GET /api/v1/jobs/:id` |
| Download ZIP | URL from job (follow redirects) |
| Fallback list | `GET /api/v1/calls?per_page=1000&by_time[from|to]` |
| Download recording | `GET /api/v1/calls/:callId/recording/:recordingId` (may return signed URL) |

Token needs export + recording download permissions on that Freshcaller account.

---

## 17. Build / deploy checklist

1. Provision Linux VM + **working-cache** disk (80–150 GB).
2. Create **MongoDB Atlas** cluster (M10+, Mumbai, MongoDB 7, DB `voice_analysis`, IP allowlist, DB user). Put `mongodb+srv://.../voice_analysis` in `backend/.env` as `MONGODB_URI`.
3. Create **S3 buckets** (section 21): private, `ap-south-1`, Block Public Access, IAM role on the VM, lifecycle rules. App wiring is a follow-up engineering task — buckets can be created now.
4. Install Node 20, Python 3.12, ffmpeg, ffprobe, libsndfile.
5. Clone repo; install npm deps; build frontend.
6. Create Python venv; install `requirements.txt` + CPU torch + SpeechBrain.
7. Place `embedding_model.ckpt` under `SPEAKER_EMBEDDING_MODEL_DIR`.
8. Write `backend/.env` and `ai-service/.env` (real secrets, including S3 bucket/region when the app supports it).
9. Create local cache dirs with shared ownership; same absolute paths for backend and AI.
10. Start AI → backend (Mongo is Atlas; no local mongod).
11. Confirm:
    - `GET /health` shows `mongo.connected: true`
    - `GET :8001/health` (`api_key_configured: true`)
    - ffmpeg/ffprobe on PATH for both processes
12. Configure nginx 443 + `/api/` strip + 20 min timeouts + SPA fallback.
13. Put UI behind VPN/SSO.
14. Smoke test: open UI → Sync one date → Analyze one short connect → play audio → set disposition. After S3 is wired, confirm the object exists in the bucket and playback still works.
15. Verify cron after 01:00 IST (or trigger manual sync).
16. Enable Atlas snapshots, S3 lifecycle, and disk alerts on the VM.

---

## 18. What is **not** in the repo (DevOps must add)

- Dockerfiles / K8s manifests for app services
- CI/CD pipeline
- HTTPS certificates
- User authentication
- Log aggregation / APM
- Horizontal scaling / analysis queue
- **S3 upload/download in application code** — wired (F11); buckets + IAM still DevOps; default `S3_ENABLED=false`

---

## 19. Suggested first production layout

```
/opt/voiceiq/
  app/                 # git checkout
  frontend-dist/       # copy of frontend/dist
  ai-venv/
  data/                 # working cache only after S3 is live
    fc-recordings/
    normalized/
    exports/
    uploads/
  cache/
    speechbrain-ecapa/embedding_model.ckpt
  env/
    backend.env
    ai.env
```

Point `FC_RECORDINGS_DIR`, `NORMALIZED_DIR`, `EXPORTS_DIR` at `/opt/voiceiq/data/...` **absolute paths** so backend and AI always agree.

---

## 20. Decisions needed from the product team

1. Public hostname and who may access it (VPN vs SSO).
2. Freshcaller account URL + API token.
3. AssemblyAI key and expected monthly analyze volume (cost).
4. Dual STT on or off (default **off**).
5. Audio retention in **S3** (recommended default: 365 days originals, 90 days export ZIPs).
6. Whether they want containers now or systemd on a VM first.

---

## 21. Amazon S3 audio storage (F11)

**Status:** Application wiring **implemented** (`S3_ENABLED` switch). DevOps must still create private buckets and IAM. With `S3_ENABLED=false` (default), behaviour is local-disk only.

Call recordings are **PII** (voice + phone). Buckets must stay **private**. Never enable public ACLs, static website hosting, or anonymous `GetObject`.

### 21.1 Design (required)

```
Freshcaller
    → Backend downloads bytes
    → If S3_ENABLED: PUT to S3  (source of truth) + optional local cache
    → Else: write FC_RECORDINGS_DIR only
    → Mongo stores s3Bucket + s3Key when S3; localPath as cache path

Playback  GET /recordings/db/:callId/audio
    → Backend streams from local cache or GetObject from S3
    → Do not redirect the browser to a public S3 URL

Analyze
    → ensureLocalAudio: cache hit → else S3 GetObject → else Freshcaller
    → ffmpeg normalize on local disk
    → POST AI /analyze { audio_path: local wav }
```

Do **not** teach the AI service to read `s3://` in the first version. Keep `/analyze` on local paths.

Do **not** store normalized WAVs in S3 long-term. They are ~4–10× larger than mp3 and can be rebuilt with ffmpeg from the original.

### 21.2 Buckets to create

One bucket per environment. Same AWS region as the app VM and Atlas preference: **`ap-south-1` (Mumbai)**.

| Environment | Bucket name (example) | Purpose |
| --- | --- | --- |
| Production | `voiceiq-prod-audio` | Original recordings + export ZIPs |
| Staging (optional) | `voiceiq-staging-audio` | Same layout, shorter lifecycle |

Optional second bucket `voiceiq-{env}-exports` is **not required**. Use prefixes in the same bucket (simpler IAM).

**Create settings for each bucket:**

| Setting | Value |
| --- | --- |
| Region | `ap-south-1` |
| Object Ownership | Bucket owner enforced |
| ACLs | Disabled |
| Block Public Access | **All four** ON |
| Versioning | Off for v1 (cost). Turn on later if you need undelete. |
| Default encryption | **SSE-S3** (AES-256). Use SSE-KMS if the org requires a CMK. |
| Bucket key (if KMS) | Enabled |
| Static website | Disabled |
| Transfer acceleration | Off |

### 21.3 Key layout (prefixes)

Use IST `callDate` (`YYYY-MM-DD`) so lifecycle and browsing match the product calendar.

```
s3://voiceiq-prod-audio/
  recordings/2026/09/18/fc_9064160_5384090.mp3
  exports/2026/09/18/export_12345_2026-09-18.zip
  uploads/2026/09/18/1726660000_manual.wav
```

| Prefix | What | S3 retention |
| --- | --- | --- |
| `recordings/` | Original Freshcaller audio (mp3/wav/m4a) | **365 days** then expire (product can change) |
| `exports/` | Daily Freshcaller JSON ZIP | **90 days** then expire |
| `uploads/` | Legacy manual uploads | 365 days |
| `normalized/` | **Do not upload** in v1 | — |

Object key must be unique per `(callId, recordingId)`. Re-download overwrites the same key (idempotent).

### 21.4 IAM (prefer instance role)

Attach an **IAM role** to the EC2 instance (or IRSA / task role if containers). Do **not** put long-lived access keys in `.env` unless there is no instance role.

Example policy (replace account and bucket):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ListBucket",
      "Effect": "Allow",
      "Action": ["s3:ListBucket", "s3:GetBucketLocation"],
      "Resource": "arn:aws:s3:::voiceiq-prod-audio",
      "Condition": {
        "StringLike": {
          "s3:prefix": ["recordings/*", "exports/*", "uploads/*"]
        }
      }
    },
    {
      "Sid": "ObjectRW",
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:PutObject",
        "s3:DeleteObject",
        "s3:AbortMultipartUpload"
      ],
      "Resource": [
        "arn:aws:s3:::voiceiq-prod-audio/recordings/*",
        "arn:aws:s3:::voiceiq-prod-audio/exports/*",
        "arn:aws:s3:::voiceiq-prod-audio/uploads/*"
      ]
    }
  ]
}
```

No `s3:*` on `*`. No CloudFront public distribution in v1.

### 21.5 Lifecycle rules

| Rule name | Prefix | Action |
| --- | --- | --- |
| `recordings-expire` | `recordings/` | Expire after **365** days |
| `exports-expire` | `exports/` | Expire after **90** days |
| `abort-mpu` | (bucket) | Abort incomplete multipart after **7** days |

Optional cost save (if objects are rarely re-analyzed after 90 days):

- After 90 days: transition `recordings/` to **S3 Standard-IA** or **Glacier Instant Retrieval**
- Keep **Instant Retrieval** if QA still plays old calls from the UI. Do not use Glacier Flexible/Deep Archive — restore delay will break playback and re-analyze.

### 21.6 App env vars

```
AWS_REGION=ap-south-1
S3_AUDIO_BUCKET=voiceiq-prod-audio
S3_ENABLED=true
# Only if not using an EC2 instance role:
# AWS_ACCESS_KEY_ID=
# AWS_SECRET_ACCESS_KEY=
```

Default for developers: omit `S3_ENABLED` or set `false` — local `FC_RECORDINGS_DIR` only.

Mongo `recordings` documents:

| Field | Example |
| --- | --- |
| `s3Bucket` | `voiceiq-prod-audio` |
| `s3Key` | `recordings/2026-09-18/fc_9064160_5384090.mp3` |
| `localPath` | cache path only; may be empty after prune |

### 21.7 Target data flow

**Daily sync (F01)**

1. Freshcaller export ZIP → optional PUT `exports/{date}/...zip`
2. For each connect with a recording: download audio → PUT `recordings/{date}/fc_{callId}_{recordingId}{ext}`
3. Upsert Mongo with `s3Key` (and a cache `localPath` if the file is still on disk)

**Analyze (F02)**

1. If local cache miss: `GetObject` → `data/fc-recordings/...`
2. ffmpeg → `data/normalized/fc_{callId}_{recordingId}.wav`
3. AI `/analyze` with that wav path
4. After success: keep S3 object; local files may be deleted by a cache cleaner

**Playback**

Keep `GET /api/recordings/db/:callId/audio`. Backend streams from cache or S3. Browser never talks to S3 directly (avoids CORS and leaked URLs).

### 21.8 Application wiring (F11)

Implemented in:

- `backend/src/storage/audioStore.ts` — local vs S3 helpers
- `backend/src/freshcaller/dailySyncPipeline.ts` — PUT after download when enabled
- `backend/src/services/analyzeRecording.ts` — `ensureLocalAudio` GetObject / Freshcaller / PUT
- `backend/src/routes/dbRecordings.ts` — `/audio` streams cache or S3
- `backend/src/db/mongo.ts` — `s3Bucket` / `s3Key` fields
- Spec: [F11-dual-audio-storage.md](./specs/features/F11-dual-audio-storage.md)

Local `docker compose` Mongo + local files remain valid for developer machines (`S3_ENABLED=false`).

Still later: export ZIP PUT, automatic cache prune, bulk backfill script.

### 21.9 DevOps create checklist

1. Create `voiceiq-prod-audio` in `ap-south-1`.
2. Block Public Access (all four).
3. Default encryption SSE-S3 (or KMS).
4. Apply lifecycle rules in 21.5.
5. Create IAM role; attach policy in 21.4; attach role to the app VM.
6. From the VM: `aws s3 ls s3://voiceiq-prod-audio` and a test `put` / `get` / `delete` of a dummy object under `recordings/`.
7. Confirm VPC endpoint for S3 **or** NAT/internet so the VM can reach S3 (required).
8. Hand bucket name + region to engineering. Do not create a public bucket “for testing”.

### 21.10 Cost sketch (order of magnitude)

| Item | Rough |
| --- | --- |
| 1,000 calls/day × 3 MB × 365 days | ~1 TB Standard stored at day 365 if nothing expires yet; with 365-day expire, steady state ≈ 1 year of audio |
| PUT/GET | Sync = 1 PUT per recording; analyze/play = 1 GET on cache miss |
| Egress | S3 → VM in the **same region** is cheap; keep VM in `ap-south-1` |

Exact rupee/USD quotes belong in the AWS calculator with real daily call volume.
