import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { refreshAgentStats, upsertAgentFromRecording } from "../db/agents.js";
import { FreshcallerClient } from "../freshcaller/client.js";
import { recordingsCollection, type RecordingDocument } from "../db/mongo.js";
import { upsertRecordingListing } from "../db/recordingListings.js";
import { normalizeInWorker } from "../audioPool.js";
import { isLikelyVoicemail, VOICEMAIL_MAX_DURATION_SEC } from "../voicemail.js";
import {
  resolveSpeakerOverride,
  storedAnalysisForRemap,
} from "./speakerRemap.js";
import type { AnalysisCorrection } from "../db/mongo.js";

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

function participantContext(doc: RecordingDocument) {
  return {
    direction: doc.direction,
    callNotes: doc.callNotes,
    agentName: doc.agentName,
    participants: (doc.participants ?? []).map((p) => ({
      role: p.role,
      name: p.name,
    })),
  };
}

async function callAiService(normalizedPath: string, doc: RecordingDocument) {
  const response = await fetch(`${AI_SERVICE_URL}/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      audio_path: normalizedPath,
      participant_context: participantContext(doc),
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`AI service failed (${response.status}): ${body}`);
  }

  return response.json();
}

async function callAiRemapService(
  doc: RecordingDocument,
  stored: NonNullable<ReturnType<typeof storedAnalysisForRemap>>,
  speakerOverride?: Record<string, string>,
) {
  const response = await fetch(`${AI_SERVICE_URL}/remap-speakers`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      utterances: stored.utterances,
      words: stored.words,
      duration_sec: stored.duration_sec,
      transcript_id: stored.transcript_id,
      language: stored.language,
      participant_context: participantContext(doc),
      speaker_override: speakerOverride,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`AI remap failed (${response.status}): ${body}`);
  }

  return response.json();
}

export type AnalyzeRecordingOptions = {
  force?: boolean;
  remapOnly?: boolean;
  swapSpeakers?: boolean;
  speakerOverride?: Record<string, string>;
  correctionReason?: string;
};

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
  options?: AnalyzeRecordingOptions,
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

  const remapOnly = Boolean(options?.remapOnly);
  const force = Boolean(options?.force) || remapOnly;

  if (!force && doc.analysisStatus === "completed" && doc.analysisResult) {
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
    let analysisResult: unknown;
    let localPath = doc.localPath ?? null;
    let localFileName = doc.localFileName ?? null;
    let durationSec = doc.durationSec ?? null;

    if (remapOnly) {
      const stored = storedAnalysisForRemap(doc.analysisResult);
      if (!stored) {
        throw Object.assign(
          new Error(
            "Remap-only requires a completed analysis with stored utterances. Run full analyze first.",
          ),
          { status: 422 },
        );
      }

      const existingMapping = (doc.analysisResult as { speaker_mapping?: unknown } | undefined)
        ?.speaker_mapping as { mapping?: Record<string, string> } | undefined;
      const speakerOverride = resolveSpeakerOverride(existingMapping, {
        swapSpeakers: options?.swapSpeakers,
        speakerOverride: options?.speakerOverride,
      });

      analysisResult = await callAiRemapService(
        doc,
        stored,
        speakerOverride && Object.keys(speakerOverride).length > 0
          ? speakerOverride
          : undefined,
      );
    } else {
      const audio = await ensureLocalAudio(doc);
      localPath = audio.localPath;
      localFileName = audio.localFileName;
      await fs.mkdir(NORMALIZED_DIR, { recursive: true });
      const outputPath = path.join(
        NORMALIZED_DIR,
        `fc_${doc.callId}_${doc.recordingId}.wav`,
      );

      const normalized = await normalizeInWorker({
        inputPath: audio.localPath,
        outputPath,
      });

      analysisResult = await callAiService(normalized.outputPath, doc);
      durationSec = doc.durationSec ?? normalized.durationSec;
    }

    const now = new Date();
    const resolvedOverride = remapOnly
      ? resolveSpeakerOverride(
          (doc.analysisResult as { speaker_mapping?: { mapping?: Record<string, string> } } | undefined)
            ?.speaker_mapping,
          {
            swapSpeakers: options?.swapSpeakers,
            speakerOverride: options?.speakerOverride,
          },
        )
      : undefined;

    const correction: AnalysisCorrection | null = remapOnly
      ? {
          at: now,
          reason:
            options?.correctionReason ??
            (options?.swapSpeakers
              ? "speakers_swapped"
              : resolvedOverride
                ? "manual_override"
                : "remap_heuristics"),
          remapOnly: true,
          ...(resolvedOverride ? { speakerOverride: resolvedOverride } : {}),
        }
      : null;

    const update: Record<string, unknown> = {
      analysisStatus: "completed",
      analysisResult,
      analyzedAt: now,
      analysisError: null,
      updatedAt: now,
    };
    if (localPath) update.localPath = localPath;
    if (localFileName) update.localFileName = localFileName;
    if (durationSec != null) update.durationSec = durationSec;

    await collection.updateOne(
      { callId: doc.callId, recordingId: doc.recordingId },
      {
        $set: update,
        ...(correction ? { $push: { analysisCorrections: correction } } : {}),
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
