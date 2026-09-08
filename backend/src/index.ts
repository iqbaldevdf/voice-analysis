import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import multer from "multer";
import { v4 as uuidv4 } from "uuid";
import { JobStore, type AnalysisJob, type CallMeta } from "./jobStore.js";
import { getWorkerPoolStats, normalizeInWorker } from "./audioPool.js";
import { FreshcallerClient } from "./freshcaller/client.js";
import { exportStore } from "./freshcaller/exportStore.js";
import { runExportSync } from "./freshcaller/syncWorker.js";
import type { FreshcallerCall } from "./freshcaller/types.js";
import { connectMongo, getMongoUri, pingMongo } from "./db/mongo.js";
import { createDbRecordingsRouter } from "./routes/dbRecordings.js";
import { createFreshcallerSyncRouter } from "./routes/freshcallerSync.js";
import { createAgentsRouter } from "./routes/agents.js";
import { startFreshcallerCron } from "./freshcaller/cron.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

const PORT = Number(process.env.PORT ?? 5050);
const AI_SERVICE_URL = process.env.AI_SERVICE_URL ?? "http://127.0.0.1:8001";
const RECORDINGS_DIR = path.resolve(rootDir, process.env.RECORDINGS_DIR ?? "../recordings");
const UPLOADS_DIR = path.resolve(rootDir, process.env.UPLOADS_DIR ?? "./data/uploads");
const NORMALIZED_DIR = path.resolve(rootDir, process.env.NORMALIZED_DIR ?? "./data/normalized");
const EXPORTS_DIR = path.resolve(rootDir, process.env.EXPORTS_DIR ?? "./data/exports");
const JOBS_FILE = path.resolve(rootDir, process.env.JOBS_FILE ?? "./data/jobs.json");

const store = new JobStore(JOBS_FILE);
const app = express();

app.use(cors());
app.use(express.json());

const AUDIO_EXTENSIONS = new Set([".wav", ".mp3", ".m4a", ".flac", ".ogg", ".webm", ".mp4", ".aac"]);

await fs.mkdir(UPLOADS_DIR, { recursive: true });
await fs.mkdir(RECORDINGS_DIR, { recursive: true });
await fs.mkdir(EXPORTS_DIR, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      cb(null, UPLOADS_DIR);
    },
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase() || ".wav";
      const base = path
        .basename(file.originalname, path.extname(file.originalname))
        .replace(/[^a-zA-Z0-9._-]/g, "_")
        .slice(0, 80);
      cb(null, `${Date.now()}_${base}${ext}`);
    },
  }),
  limits: {
    fileSize: 100 * 1024 * 1024,
  },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!AUDIO_EXTENSIONS.has(ext)) {
      cb(new Error(`Unsupported audio type: ${ext || "(none)"}`));
      return;
    }
    cb(null, true);
  },
});

async function listAudioInDir(dir: string, source: "recordings" | "uploads") {
  await fs.mkdir(dir, { recursive: true });
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const ext = path.extname(entry.name).toLowerCase();
    if (!AUDIO_EXTENSIONS.has(ext)) continue;
    const fullPath = path.join(dir, entry.name);
    const stat = await fs.stat(fullPath);
    files.push({
      name: entry.name,
      sizeBytes: stat.size,
      modifiedAt: stat.mtime.toISOString(),
      source,
    });
  }

  return files;
}

async function listRecordings() {
  const [recordings, uploads] = await Promise.all([
    listAudioInDir(RECORDINGS_DIR, "recordings"),
    listAudioInDir(UPLOADS_DIR, "uploads"),
  ]);
  return [...uploads, ...recordings].sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
}

function resolveExistingAudioPath(sourceName: string, source?: string): Promise<string | null> {
  const safeName = path.basename(sourceName);
  const candidates =
    source === "uploads"
      ? [path.join(UPLOADS_DIR, safeName)]
      : source === "recordings"
        ? [path.join(RECORDINGS_DIR, safeName)]
        : [path.join(UPLOADS_DIR, safeName), path.join(RECORDINGS_DIR, safeName)];

  return (async () => {
    for (const candidate of candidates) {
      try {
        await fs.access(candidate);
        return candidate;
      } catch {
        // try next
      }
    }
    return null;
  })();
}

function buildCallMeta(call: FreshcallerCall): CallMeta {
  return {
    callId: call.id,
    direction: call.direction,
    createdTime: call.created_time,
    phoneNumber: call.phone_number,
    agentName: call.assigned_agent_name,
    billDuration: call.bill_duration,
    participants: call.participants.map((p) => ({
      role: p.participant_type,
      name:
        p.caller_name ||
        (p.participant_type.toLowerCase() === "agent" ? call.assigned_agent_name : null) ||
        null,
      phone: p.caller_number ?? (p.participant_type.toLowerCase() === "agent" ? call.phone_number : null),
      email: null,
    })),
  };
}

async function ensureFreshcallerRecording(call: FreshcallerCall): Promise<{
  sourceName: string;
  sourcePath: string;
}> {
  if (call.localRecordingPath && call.localRecordingName) {
    try {
      await fs.access(call.localRecordingPath);
      return { sourceName: call.localRecordingName, sourcePath: call.localRecordingPath };
    } catch {
      // re-download
    }
  }

  if (!call.recording) {
    throw new Error(`Call ${call.id} has no recording`);
  }

  const client = new FreshcallerClient();
  const downloaded = await client.downloadRecording(call.id, call.recording.id);
  const sourceName = `fc_${call.id}_${call.recording.id}${downloaded.extension}`;
  const sourcePath = path.join(UPLOADS_DIR, sourceName);
  await fs.writeFile(sourcePath, downloaded.buffer);

  exportStore.updateCall(call.id, {
    localRecordingPath: sourcePath,
    localRecordingName: sourceName,
  });

  return { sourceName, sourcePath };
}

async function callAiService(normalizedPath: string) {
  const response = await fetch(`${AI_SERVICE_URL}/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ audio_path: normalizedPath }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`AI service failed (${response.status}): ${body}`);
  }

  return response.json();
}

async function processJob(jobId: string): Promise<void> {
  const job = await store.get(jobId);
  if (!job) return;

  try {
    await store.update(jobId, { status: "normalizing", error: undefined });
    await fs.mkdir(NORMALIZED_DIR, { recursive: true });

    const outputPath = path.join(NORMALIZED_DIR, `${jobId}.wav`);
    const normalized = await normalizeInWorker({
      inputPath: job.sourcePath,
      outputPath,
    });

    await store.update(jobId, {
      status: "analyzing",
      normalizedPath: normalized.outputPath,
      durationSec: normalized.durationSec,
    });

    const result = await callAiService(normalized.outputPath);

    await store.update(jobId, {
      status: "completed",
      result,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await store.update(jobId, {
      status: "failed",
      error: message,
    });
  }
}

async function createAndStartJob(
  sourceName: string,
  sourcePath: string,
  extras?: Partial<Pick<AnalysisJob, "callMeta" | "freshcallerCallId">>,
) {
  const now = new Date().toISOString();
  const job: AnalysisJob = {
    id: uuidv4(),
    sourceName,
    sourcePath,
    status: "queued",
    createdAt: now,
    updatedAt: now,
    ...extras,
  };
  await store.create(job);
  void processJob(job.id);
  return job;
}

app.get("/health", async (_req, res) => {
  const mongoOk = await pingMongo();
  res.json({
    ok: true,
    recordingsDir: RECORDINGS_DIR,
    uploadsDir: UPLOADS_DIR,
    aiServiceUrl: AI_SERVICE_URL,
    workers: getWorkerPoolStats(),
    freshcallerConfigured: Boolean(
      process.env.FRESHCALLER_API_AUTH &&
        process.env.FRESHCALLER_API_AUTH !== "changeme" &&
        process.env.FRESHCALLER_BASE_URL,
    ),
    mongo: {
      configured: true,
      uri: getMongoUri().replace(/\/\/.*@/, "//***@"),
      connected: mongoOk,
    },
  });
});

app.get("/recordings", async (_req, res) => {
  try {
    const recordings = await listRecordings();
    res.json({ recordings });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

/** Mongo-backed Freshcaller recordings (imported via scripts/import-recordings.ts) */
app.use("/recordings/db", createDbRecordingsRouter());

/** Daily Freshcaller export sync + cron logs */
app.use("/freshcaller/sync", createFreshcallerSyncRouter());

/** Agent roster only — customers are never listed here */
app.use("/agents", createAgentsRouter());

app.get("/jobs", async (_req, res) => {
  const jobs = await store.list();
  res.json({ jobs });
});

app.get("/jobs/:id", async (req, res) => {
  const job = await store.get(req.params.id);
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  res.json({ job });
});

app.get("/jobs/:id/audio", async (req, res) => {
  const job = await store.get(req.params.id);
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  const audioPath = job.normalizedPath ?? job.sourcePath;
  try {
    await fs.access(audioPath);
  } catch {
    res.status(404).json({ error: "Audio file missing" });
    return;
  }

  res.sendFile(audioPath);
});

app.post("/jobs", async (req, res) => {
  try {
    const sourceName = String(req.body?.sourceName ?? "").trim();
    const source = typeof req.body?.source === "string" ? req.body.source : undefined;
    if (!sourceName) {
      res.status(400).json({ error: "sourceName is required" });
      return;
    }

    const safeName = path.basename(sourceName);
    const sourcePath = await resolveExistingAudioPath(safeName, source);

    if (!sourcePath) {
      res.status(404).json({ error: `Recording not found: ${safeName}` });
      return;
    }

    const job = await createAndStartJob(safeName, sourcePath);
    res.status(202).json({ job });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

app.post("/jobs/upload", (req, res) => {
  upload.single("audio")(req, res, async (err) => {
    try {
      if (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
        return;
      }

      const file = req.file;
      if (!file) {
        res.status(400).json({ error: "audio file is required (field name: audio)" });
        return;
      }

      const job = await createAndStartJob(file.filename, file.path);
      res.status(202).json({
        job,
        uploaded: {
          name: file.filename,
          originalName: file.originalname,
          sizeBytes: file.size,
          source: "uploads",
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: message });
    }
  });
});

app.post("/freshcaller/exports", async (req, res) => {
  try {
    const startDate = String(req.body?.start_date ?? req.body?.startDate ?? "").trim();
    const endDate = String(req.body?.end_date ?? req.body?.endDate ?? "").trim();
    if (!startDate || !endDate) {
      res.status(400).json({ error: "start_date and end_date are required (ISO-8601)" });
      return;
    }

    const client = new FreshcallerClient();
    const created = await client.createExport({ startDate, endDate });
    const now = new Date().toISOString();
    const record = exportStore.upsertExport({
      id: created.id,
      status: "started",
      message: created.message,
      createdAt: now,
      updatedAt: now,
      startDate,
      endDate,
    });

    void runExportSync(created.id, EXPORTS_DIR);
    res.status(202).json({ export: record });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

app.get("/freshcaller/exports", (_req, res) => {
  res.json({ exports: exportStore.listExports() });
});

app.get("/freshcaller/exports/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "Invalid export id" });
      return;
    }

    let record = exportStore.getExport(id);
    if (!record) {
      res.status(404).json({ error: "Export job not found in memory" });
      return;
    }

    // Refresh from Freshcaller while still running
    if (!["completed", "failed", "indexing", "downloading"].includes(record.status)) {
      try {
        const client = new FreshcallerClient();
        const remote = await client.getJob(id);
        const remoteStatus = String(remote.bulk_job.status || "").toLowerCase();
        record = exportStore.updateExport(id, {
          status: remoteStatus as typeof record.status,
          downloadPath: remote.bulk_job.job_data?.path ?? record.downloadPath,
        });
      } catch {
        // keep in-memory status
      }
    }

    res.json({ export: record });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

app.get("/freshcaller/calls", (_req, res) => {
  const withRecordingOnly = String(_req.query.withRecording ?? "true") !== "false";
  const calls = exportStore.listCalls({ withRecordingOnly });
  res.json({ calls, count: calls.length });
});

app.get("/freshcaller/calls/:id", (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid call id" });
    return;
  }
  const call = exportStore.getCall(id);
  if (!call) {
    res.status(404).json({ error: "Call not found. Sync an export first." });
    return;
  }
  res.json({ call });
});

app.post("/jobs/freshcaller", async (req, res) => {
  try {
    const callId = Number(req.body?.callId ?? req.body?.call_id);
    if (!Number.isFinite(callId)) {
      res.status(400).json({ error: "callId is required" });
      return;
    }

    const call = exportStore.getCall(callId);
    if (!call) {
      res.status(404).json({ error: `Call ${callId} not found. Sync an export first.` });
      return;
    }
    if (!call.recording) {
      res.status(400).json({ error: `Call ${callId} has no recording` });
      return;
    }

    const { sourceName, sourcePath } = await ensureFreshcallerRecording(call);
    const job = await createAndStartJob(sourceName, sourcePath, {
      callMeta: buildCallMeta(call),
      freshcallerCallId: call.id,
    });
    res.status(202).json({ job, call });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

try {
  await connectMongo();
  console.log(`MongoDB connected: ${getMongoUri()}`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`MongoDB connection failed: ${message}`);
  console.error("Start Mongo with: docker compose up -d");
  process.exit(1);
}

app.listen(PORT, () => {
  console.log(`Backend listening on http://127.0.0.1:${PORT}`);
  console.log(`Recordings dir: ${RECORDINGS_DIR}`);
  console.log(`Uploads dir: ${UPLOADS_DIR}`);
  console.log(`AI service: ${AI_SERVICE_URL}`);
  startFreshcallerCron();
  void import("./db/agents.js")
    .then((mod) => mod.backfillAgentsFromRecordings())
    .then((count) => console.log(`[agents] roster ready (${count} agents)`))
    .catch((err) => console.error("[agents] backfill failed", err));
});
