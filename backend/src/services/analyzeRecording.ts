import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { refreshAgentStats, upsertAgentFromRecording } from "../db/agents.js";
import { FreshcallerClient } from "../freshcaller/client.js";
import { recordingsCollection, type RecordingDocument } from "../db/mongo.js";
import { upsertRecordingListing } from "../db/recordingListings.js";
import { normalizeInWorker } from "../audioPool.js";
import { isLikelyVoicemail, VOICEMAIL_MAX_DURATION_SEC } from "../voicemail.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendRoot = path.resolve(__dirname, "../..");

const AI_SERVICE_URL = process.env.AI_SERVICE_URL ?? "http://127.0.0.1:8001";
const NORMALIZED_DIR = path.resolve(backendRoot, process.env.NORMALIZED_DIR ?? "./data/normalized");
const FC_RECORDINGS_DIR = path.resolve(
  backendRoot,
  process.env.FC_RECORDINGS_DIR ?? "./data/fc-recordings",
);

const runningKeys = new Set<string>();

function keyOf(callId: number, recordingId: number) {
  return `${callId}:${recordingId}`;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function callAiService(normalizedPath: string, doc: RecordingDocument) {
  const response = await fetch(`${AI_SERVICE_URL}/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      audio_path: normalizedPath,
      participant_context: {
        direction: doc.direction,
        callNotes: doc.callNotes,
        participants: (doc.participants ?? []).map((p) => ({
          role: p.role,
          name: p.name,
        })),
      },
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`AI service failed (${response.status}): ${body}`);
  }

  return response.json();
}

export async function findRecordingDoc(
  callId: number,
  recordingId?: number,
): Promise<RecordingDocument | null> {
  const collection = recordingsCollection();
  if (recordingId != null && Number.isFinite(recordingId)) {
    return collection.findOne({ callId, recordingId });
  }
  return collection.findOne({ callId }, { sort: { updatedAt: -1 } });
}

async function ensureLocalAudio(doc: RecordingDocument): Promise<{
  localPath: string;
  localFileName: string;
}> {
  if (doc.localPath && (await fileExists(doc.localPath))) {
    return {
      localPath: doc.localPath,
      localFileName: doc.localFileName || path.basename(doc.localPath),
    };
  }

  const client = new FreshcallerClient();
  const downloaded = await client.downloadRecording(doc.callId, doc.recordingId);
  await fs.mkdir(FC_RECORDINGS_DIR, { recursive: true });
  const localFileName = `fc_${doc.callId}_${doc.recordingId}${downloaded.extension}`;
  const localPath = path.join(FC_RECORDINGS_DIR, localFileName);
  await fs.writeFile(localPath, downloaded.buffer);

  await recordingsCollection().updateOne(
    { callId: doc.callId, recordingId: doc.recordingId },
    {
      $set: {
        localPath,
        localFileName,
        updatedAt: new Date(),
      },
    },
  );

  return { localPath, localFileName };
}

/**
 * Analyze a Mongo recording at most once.
 * - completed → return stored result immediately
 * - running → throw conflict
 * - otherwise download if needed, normalize, AI analyze, persist
 */
export async function analyzeRecordingOnce(
  callId: number,
  recordingId?: number,
): Promise<{
  recording: RecordingDocument;
  reused: boolean;
}> {
  const collection = recordingsCollection();
  const doc = await findRecordingDoc(callId, recordingId);
  if (!doc) {
    throw Object.assign(new Error(`Recording not found for call ${callId}`), { status: 404 });
  }

  const durationSec = doc.durationSec ?? null;
  const voicemail = doc.isVoicemail ?? isLikelyVoicemail(durationSec);
  if (voicemail) {
    throw Object.assign(
      new Error(
        `Call ${doc.callId} was skipped. It looks like a voicemail or a short call (≤${VOICEMAIL_MAX_DURATION_SEC}s). Duration: ${durationSec ?? "unknown"}s.`,
      ),
      { status: 422 },
    );
  }

  if (doc.analysisStatus === "completed" && doc.analysisResult) {
    await upsertRecordingListing(doc);
    return { recording: doc, reused: true };
  }

  const runKey = keyOf(doc.callId, doc.recordingId);
  // Only block if another process in this server is actively running it.
  // Stale "running" in Mongo (crash/restart) is allowed to retry.
  if (runningKeys.has(runKey)) {
    throw Object.assign(
      new Error(`Analysis is already running for call ${doc.callId}. Wait for it to finish before starting it again.`),
      { status: 409 },
    );
  }

  runningKeys.add(runKey);
  await collection.updateOne(
    { callId: doc.callId, recordingId: doc.recordingId },
    {
      $set: {
        analysisStatus: "running",
        analysisError: null,
        updatedAt: new Date(),
      },
    },
  );

  try {
    const audio = await ensureLocalAudio(doc);
    await fs.mkdir(NORMALIZED_DIR, { recursive: true });
    const outputPath = path.join(
      NORMALIZED_DIR,
      `fc_${doc.callId}_${doc.recordingId}.wav`,
    );

    const normalized = await normalizeInWorker({
      inputPath: audio.localPath,
      outputPath,
    });

    const analysisResult = await callAiService(normalized.outputPath, doc);
    const now = new Date();

    await collection.updateOne(
      { callId: doc.callId, recordingId: doc.recordingId },
      {
        $set: {
          localPath: audio.localPath,
          localFileName: audio.localFileName,
          analysisStatus: "completed",
          analysisResult,
          analyzedAt: now,
          analysisError: null,
          durationSec: doc.durationSec ?? normalized.durationSec,
          updatedAt: now,
        },
      },
    );

    const updated = await collection.findOne({
      callId: doc.callId,
      recordingId: doc.recordingId,
    });
    if (!updated) {
      throw new Error("Recording disappeared after analysis");
    }
    await upsertRecordingListing(updated);
    if (updated.agentId) {
      await refreshAgentStats(updated.agentId);
    } else if (doc.agentName) {
      const agentId = await upsertAgentFromRecording({
        agentName: doc.agentName,
        createdTime: doc.createdTime,
      });
      if (agentId) {
        await recordingsCollection().updateOne(
          { callId: doc.callId, recordingId: doc.recordingId },
          { $set: { agentId } },
        );
        await refreshAgentStats(agentId);
      }
    }
    return { recording: updated, reused: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await collection.updateOne(
      { callId: doc.callId, recordingId: doc.recordingId },
      {
        $set: {
          analysisStatus: "failed",
          analysisError: message,
          updatedAt: new Date(),
        },
      },
    );
    const failedDoc = await collection.findOne({
      callId: doc.callId,
      recordingId: doc.recordingId,
    });
    if (failedDoc) {
      await upsertRecordingListing(failedDoc).catch(() => undefined);
    }
    throw error;
  } finally {
    runningKeys.delete(runKey);
  }
}
