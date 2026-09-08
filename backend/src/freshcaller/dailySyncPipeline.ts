import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { upsertAgentFromRecording, refreshAgentStats } from "../db/agents.js";
import { recordingsCollection, type RecordingDocument } from "../db/mongo.js";
import { upsertRecordingListing } from "../db/recordingListings.js";
import {
  exportJobsCollection,
  type ExportJobDocument,
  type ExportJobPhase,
} from "../db/syncCollections.js";
import { classifyFreshcallerCall } from "./connection.js";
import { FreshcallerClient, summarizeCall } from "./client.js";
import { appendCronLog, createRunId, withExportJobId, type CronRunContext } from "./cronLogger.js";
import { callDateFromCreatedTime, istDayRangeIso, previousIstCallDate } from "./dateUtils.js";
import { extractCallsJsonFromZip } from "./zipCalls.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendRoot = path.resolve(__dirname, "../..");

const POLL_INTERVAL_MS = Number(process.env.FRESHCALLER_POLL_INTERVAL_MS ?? 4000);
const MAX_POLL_ATTEMPTS = Number(process.env.FRESHCALLER_MAX_POLL_ATTEMPTS ?? 90);
const EXPORTS_DIR = path.resolve(backendRoot, process.env.EXPORTS_DIR ?? "./data/exports");
const FC_RECORDINGS_DIR = path.resolve(
  backendRoot,
  process.env.FC_RECORDINGS_DIR ?? "./data/fc-recordings",
);

let running = false;

export function isDailySyncRunning(): boolean {
  return running;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function patchExportJob(
  runId: string,
  patch: Partial<ExportJobDocument>,
): Promise<ExportJobDocument | null> {
  const now = new Date();
  await exportJobsCollection().updateOne(
    { runId },
    { $set: { ...patch, updatedAt: now } },
  );
  return exportJobsCollection().findOne({ runId });
}

export type DailySyncOptions = {
  /** YYYY-MM-DD IST; defaults to previous calendar day */
  callDate?: string;
  force?: boolean;
  trigger?: "cron" | "manual" | "cli";
};

export type DailySyncResult = {
  runId: string;
  callDate: string;
  status: ExportJobDocument["status"];
  jobId: number | null;
  skipped?: boolean;
  message?: string;
};

/**
 * Start sync and return immediately with runId (work continues in background).
 * Use runDailySync() when the caller wants to await completion (CLI).
 */
export async function enqueueDailySync(
  options: DailySyncOptions = {},
): Promise<DailySyncResult> {
  if (running) {
    throw Object.assign(new Error("A daily sync is already running"), { status: 409 });
  }

  const callDate = options.callDate || previousIstCallDate();
  const force = Boolean(options.force);
  const trigger = options.trigger ?? "manual";

  const existing = await exportJobsCollection().findOne({ callDate });
  if (existing?.status === "completed" && !force) {
    return {
      runId: existing.runId,
      callDate,
      status: "skipped",
      jobId: existing.jobId,
      skipped: true,
      message: `Sync for ${callDate} already completed (use force=true to re-run)`,
    };
  }

  const runId = createRunId();
  const { startDate, endDate } = istDayRangeIso(callDate);
  const now = new Date();
  const jobDoc: ExportJobDocument = {
    jobId: null,
    runId,
    callDate,
    startDate,
    endDate,
    status: "started",
    phase: "queued",
    phaseMessage: "Queued",
    trigger,
    downloadPath: null,
    callCount: 0,
    callsWithRecording: 0,
    voicemailSkipped: 0,
    audioDownloaded: 0,
    audioFailed: 0,
    callsIndexed: 0,
    error: null,
    startedAt: now,
    finishedAt: null,
    createdAt: now,
    updatedAt: now,
  };

  await exportJobsCollection().updateOne({ callDate }, { $set: jobDoc }, { upsert: true });

  void runDailySync({ callDate, force: true, trigger, runId }).catch((err) => {
    console.error("[enqueueDailySync]", err instanceof Error ? err.message : err);
  });

  return {
    runId,
    callDate,
    status: "started",
    jobId: null,
    message: `Sync started for ${callDate}`,
  };
}

export async function runDailySync(
  options: DailySyncOptions & { runId?: string } = {},
): Promise<DailySyncResult> {
  if (running && !options.runId) {
    throw Object.assign(new Error("A daily sync is already running"), { status: 409 });
  }

  const callDate = options.callDate || previousIstCallDate();
  const force = Boolean(options.force);
  const trigger = options.trigger ?? "manual";
  const { startDate, endDate } = istDayRangeIso(callDate);

  if (!options.runId) {
    const existing = await exportJobsCollection().findOne({ callDate });
    if (existing?.status === "completed" && !force) {
      return {
        runId: existing.runId,
        callDate,
        status: "skipped",
        jobId: existing.jobId,
        skipped: true,
        message: `Sync for ${callDate} already completed (use force=true to re-run)`,
      };
    }
  }

  running = true;
  const runId = options.runId || createRunId();
  let ctx: CronRunContext = { runId, callDate, trigger };
  const now = new Date();

  if (!options.runId) {
    const jobDoc: ExportJobDocument = {
      jobId: null,
      runId,
      callDate,
      startDate,
      endDate,
      status: "started",
      phase: "export",
      phaseMessage: "Starting daily sync",
      trigger,
      downloadPath: null,
      callCount: 0,
      callsWithRecording: 0,
      voicemailSkipped: 0,
      audioDownloaded: 0,
      audioFailed: 0,
      callsIndexed: 0,
      error: null,
      startedAt: now,
      finishedAt: null,
      createdAt: now,
      updatedAt: now,
    };

    await exportJobsCollection().updateOne({ callDate }, { $set: jobDoc }, { upsert: true });
  } else {
    await patchExportJob(runId, {
      status: "started",
      phase: "export",
      phaseMessage: "Starting daily sync",
      error: null,
      finishedAt: null,
    });
  }

  try {
    await appendCronLog(ctx, "info", "export", `Starting sync for ${callDate}`, {
      startDate,
      endDate,
      trigger,
      force,
    });

    const client = new FreshcallerClient();

    await patchExportJob(runId, {
      status: "in_progress",
      phase: "export",
      phaseMessage: "Requesting Freshcaller account export",
    });

    const created = await client.createExport({ startDate, endDate });
    const jobId = created.id;
    ctx = withExportJobId(ctx, jobId);

    await patchExportJob(runId, {
      jobId,
      phase: "poll",
      phaseMessage: `Export job ${jobId} created; polling status`,
    });
    await appendCronLog(ctx, "info", "export", `Export job created: ${jobId}`, {
      status: created.status,
    });

    let downloadUrl: string | undefined;
    for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt += 1) {
      const status = await client.getJob(jobId);
      const bulk = status.bulk_job;
      const remoteStatus = String(bulk.status || "").toLowerCase();

      await patchExportJob(runId, {
        phase: "poll",
        phaseMessage: `Poll ${attempt + 1}/${MAX_POLL_ATTEMPTS}: ${bulk.status}`,
      });

      if (attempt === 0 || attempt % 5 === 0) {
        await appendCronLog(ctx, "info", "poll", `Job ${jobId} status=${bulk.status}`, {
          attempt: attempt + 1,
          path: bulk.job_data?.path ?? null,
        });
      }

      if (remoteStatus === "completed" && bulk.job_data?.path) {
        downloadUrl = bulk.job_data.path;
        break;
      }
      if (remoteStatus === "failed" || remoteStatus === "error") {
        throw new Error(`Freshcaller export job ${jobId} failed with status: ${bulk.status}`);
      }
      await sleep(POLL_INTERVAL_MS);
    }

    if (!downloadUrl) {
      throw new Error(`Freshcaller export job ${jobId} timed out waiting for completion`);
    }

    await patchExportJob(runId, {
      status: "downloading",
      phase: "zip",
      phaseMessage: "Downloading export ZIP",
      downloadPath: downloadUrl,
    });
    await appendCronLog(ctx, "info", "zip", "Downloading export ZIP", { downloadUrl });

    await fs.mkdir(EXPORTS_DIR, { recursive: true });
    const zipBuffer = await client.downloadZip(downloadUrl);
    const zipPath = path.join(EXPORTS_DIR, `export_${jobId}_${callDate}.zip`);
    await fs.writeFile(zipPath, zipBuffer);
    await appendCronLog(ctx, "info", "zip", `ZIP saved (${zipBuffer.length} bytes)`, { zipPath });

    await patchExportJob(runId, {
      status: "indexing",
      phase: "index",
      phaseMessage: "Parsing calls from export ZIP",
    });

    const extracted = extractCallsJsonFromZip(zipBuffer);
    if (extracted.empty) {
      const finishedAt = new Date();
      const message = `No calls in Freshcaller export for ${callDate} (empty ZIP)`;
      await patchExportJob(runId, {
        status: "completed",
        phase: "complete",
        phaseMessage: message,
        callCount: 0,
        callsWithRecording: 0,
        voicemailSkipped: 0,
        callsIndexed: 0,
        audioDownloaded: 0,
        audioFailed: 0,
        finishedAt,
        error: null,
      });
      await appendCronLog(ctx, "info", "complete", message, {
        zipBytes: zipBuffer.length,
        zipPath,
      });
      return {
        runId,
        callDate,
        status: "completed",
        jobId,
        message,
      };
    }

    const parsed = JSON.parse(extracted.rawText) as { calls?: Record<string, unknown>[] };
    const rawCalls = Array.isArray(parsed.calls) ? parsed.calls : [];
    const summarized = rawCalls.map((item) => summarizeCall(item));
    const withRecording = summarized.filter((c) => c.recording != null);

    await appendCronLog(ctx, "info", "index", `Parsed ${summarized.length} calls`, {
      withRecording: withRecording.length,
      sourceFile: extracted.entryName,
    });

    let voicemailSkipped = 0;
    let callsIndexed = 0;
    const touchedAgents = new Set<string>();
    const collection = recordingsCollection();
    const toDownload: Array<{ callId: number; recordingId: number; url: string }> = [];

    for (const call of withRecording) {
      const recording = call.recording!;
      const durationSec =
        typeof recording.duration === "number" ? recording.duration : call.bill_duration ?? null;
      const connection = classifyFreshcallerCall(call, durationSec);
      const voicemail = connection.isVoicemail || !connection.isConnected;
      if (voicemail) {
        voicemailSkipped += 1;
      }

      const derivedCallDate = callDateFromCreatedTime(call.created_time) ?? callDate;
      const agentId = await upsertAgentFromRecording({
        assignedAgentId: call.assigned_agent_id ?? null,
        agentName: call.assigned_agent_name ?? null,
        teamName: call.assigned_team_name ?? null,
        createdTime: call.created_time,
      });
      const existingRec = await collection.findOne({
        callId: call.id,
        recordingId: recording.id,
      });
      const nowDoc = new Date();

      const doc: RecordingDocument = {
        callId: call.id,
        recordingId: recording.id,
        exportJobId: jobId,
        sourceFile: extracted.entryName,
        direction: call.direction,
        createdTime: call.created_time,
        callDate: derivedCallDate,
        agentId,
        agentName: call.assigned_agent_name ?? null,
        phoneNumber: call.phone_number ?? null,
        callNotes: call.call_notes ?? null,
        participants: (call.participants ?? []).map((p) => ({
          role: String(p.participant_type ?? "Unknown"),
          name: p.caller_name ?? null,
          phone: p.caller_number ?? null,
        })),
        recordingUrl: String(recording.url ?? ""),
        durationSec,
        isVoicemail: connection.isVoicemail,
        isConnected: connection.isConnected,
        callStatus: connection.callStatus,
        localPath: existingRec?.localPath ?? null,
        localFileName: existingRec?.localFileName ?? null,
        analysisStatus: existingRec?.analysisStatus ?? "none",
        analysisError: existingRec?.analysisError ?? null,
        analyzedAt: existingRec?.analyzedAt ?? null,
        analysisResult: existingRec?.analysisResult,
        createdAt: existingRec?.createdAt ?? nowDoc,
        updatedAt: nowDoc,
      };

      await collection.updateOne(
        { callId: doc.callId, recordingId: doc.recordingId },
        { $set: doc },
        { upsert: true },
      );
      await upsertRecordingListing(doc);
      if (agentId) touchedAgents.add(agentId);
      callsIndexed += 1;

      if (!voicemail) {
        toDownload.push({
          callId: call.id,
          recordingId: recording.id,
          url: String(recording.url ?? ""),
        });
      }
    }

    for (const id of touchedAgents) {
      await refreshAgentStats(id);
    }

    await patchExportJob(runId, {
      callCount: summarized.length,
      callsWithRecording: withRecording.length,
      voicemailSkipped,
      callsIndexed,
      phase: "download",
      phaseMessage: `Indexed ${callsIndexed} recordings; downloading audio`,
      status: "downloading_audio",
    });
    await appendCronLog(ctx, "info", "index", "Indexing complete", {
      callsIndexed,
      voicemailSkipped,
      toDownload: toDownload.length,
    });

    await fs.mkdir(FC_RECORDINGS_DIR, { recursive: true });
    let audioDownloaded = 0;
    let audioFailed = 0;

    for (const item of toDownload) {
      const existingRec = await collection.findOne({
        callId: item.callId,
        recordingId: item.recordingId,
      });
      if (existingRec?.localPath && (await fileExists(existingRec.localPath))) {
        audioDownloaded += 1;
        continue;
      }

      try {
        const audio = await client.downloadRecording(item.callId, item.recordingId);
        const localFileName = `fc_${item.callId}_${item.recordingId}${audio.extension}`;
        const localPath = path.join(FC_RECORDINGS_DIR, localFileName);
        await fs.writeFile(localPath, audio.buffer);

        const updated = await collection.findOneAndUpdate(
          { callId: item.callId, recordingId: item.recordingId },
          {
            $set: {
              localPath,
              localFileName,
              updatedAt: new Date(),
            },
          },
          { returnDocument: "after" },
        );
        if (updated) {
          await upsertRecordingListing(updated);
        }
        audioDownloaded += 1;
        await appendCronLog(ctx, "info", "download", `Downloaded ${localFileName}`, {
          callId: item.callId,
          recordingId: item.recordingId,
          bytes: audio.buffer.length,
        });
      } catch (err) {
        audioFailed += 1;
        const message = err instanceof Error ? err.message : String(err);
        await appendCronLog(ctx, "error", "download", `Failed download ${item.callId}/${item.recordingId}`, {
          callId: item.callId,
          recordingId: item.recordingId,
          error: message,
        });
      }

      await patchExportJob(runId, {
        audioDownloaded,
        audioFailed,
        phaseMessage: `Audio ${audioDownloaded + audioFailed}/${toDownload.length}`,
      });
    }

    const finishedAt = new Date();
    await patchExportJob(runId, {
      status: "completed",
      phase: "complete",
      phaseMessage: `Completed: ${callsIndexed} indexed, ${audioDownloaded} audio, ${voicemailSkipped} voicemail skipped`,
      audioDownloaded,
      audioFailed,
      finishedAt,
      error: null,
    });
    await appendCronLog(ctx, "info", "complete", "Daily sync completed", {
      callsIndexed,
      audioDownloaded,
      audioFailed,
      voicemailSkipped,
    });

    return {
      runId,
      callDate,
      status: "completed",
      jobId,
      message: `Completed sync for ${callDate}`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const phase: ExportJobPhase = "failed";
    await patchExportJob(runId, {
      status: "failed",
      phase,
      phaseMessage: message,
      error: message,
      finishedAt: new Date(),
    });
    await appendCronLog(ctx, "error", "failed", message).catch(() => undefined);
    throw Object.assign(error instanceof Error ? error : new Error(message), { runId, callDate });
  } finally {
    running = false;
  }
}
