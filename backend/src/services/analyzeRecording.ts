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
const DUAL_STT_ENABLED = process.env.DUAL_STT_ENABLED === "true";
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
    botHandling: doc.botHandling ?? "none",
    isBotInvolved: doc.isBotInvolved ?? false,
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

type DualTranscribePayload = {
  needs_review: boolean;
  processing_version?: string;
  transcript_review: Record<string, unknown>;
  utterances: unknown[];
  words: unknown[];
  duration_sec: number;
  language: string;
  transcript_id?: string | null;
};

async function callAiTranscribeDual(normalizedPath: string, _doc: RecordingDocument) {
  const response = await fetch(`${AI_SERVICE_URL}/transcribe-dual`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ audio_path: normalizedPath }),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`AI transcribe-dual failed (${response.status}): ${body}`);
  }
  return response.json() as Promise<DualTranscribePayload>;
}

async function callAiFinalizeTranscript(
  doc: RecordingDocument,
  payload: {
    utterances: unknown[];
    words: unknown[];
    duration_sec: number;
    language: string;
    transcript_id?: string | null;
    chosen_source?: string;
    transcript_review?: Record<string, unknown>;
    audio_path?: string;
  },
) {
  const response = await fetch(`${AI_SERVICE_URL}/finalize-transcript`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      utterances: payload.utterances,
      words: payload.words,
      duration_sec: payload.duration_sec,
      language: payload.language,
      transcript_id: payload.transcript_id,
      participant_context: participantContext(doc),
      chosen_source: payload.chosen_source,
      transcript_review: payload.transcript_review,
      audio_path: payload.audio_path,
    }),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`AI finalize-transcript failed (${response.status}): ${body}`);
  }
  return response.json();
}

function utterancesForChosenSource(
  review: Record<string, unknown>,
  chosenSource: "assemblyai" | "whisper",
): unknown[] {
  const passA = review.pass_a as { utterances?: unknown[] } | undefined;
  const passB = review.pass_b as { utterances?: unknown[] } | undefined;
  if (chosenSource === "whisper" && passA?.utterances && passB?.utterances) {
    return mergeWhisperIntoDiarization(passA.utterances as UtteranceLike[], passB.utterances as UtteranceLike[]);
  }
  return passA?.utterances ?? [];
}

type UtteranceLike = { speaker: string; start: number; end: number; text: string; confidence?: number | null };

function mergeWhisperIntoDiarization(assembly: UtteranceLike[], whisper: UtteranceLike[]): UtteranceLike[] {
  return assembly.map((utt) => {
    const overlapping = whisper.filter((w) => w.end > utt.start && w.start < utt.end);
    if (!overlapping.length) return utt;
    const text = overlapping.map((w) => w.text.trim()).filter(Boolean).join(" ");
    const confidence =
      overlapping.reduce((sum, w) => sum + (w.confidence ?? 0), 0) / overlapping.length;
    return { ...utt, text: text || utt.text, confidence };
  });
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
  if (doc.botHandling === "bot_only") {
    throw Object.assign(
      new Error(
        `Call ${doc.callId} was skipped. Freshcaller marked this call as bot-handled with no human agent connect.`,
      ),
      { status: 422 },
    );
  }

  const remapOnly = Boolean(options?.remapOnly);
  const force = Boolean(options?.force) || remapOnly;

  if (!force && doc.analysisStatus === "awaiting_transcript_review") {
    await upsertRecordingListing(doc);
    return { recording: doc, reused: true };
  }

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

      durationSec = doc.durationSec ?? normalized.durationSec;

      if (DUAL_STT_ENABLED) {
        await collection.updateOne(
          { callId: doc.callId, recordingId: doc.recordingId },
          { $set: { analysisStatus: "transcribing", updatedAt: new Date() } },
        );

        const dual = await callAiTranscribeDual(normalized.outputPath, doc);

        if (dual.needs_review) {
          analysisResult = {
            processing_version: dual.processing_version ?? "2.0.0",
            transcript_review: dual.transcript_review,
            utterances: dual.utterances,
            words: dual.words,
            language: dual.language,
            duration_sec: dual.duration_sec,
            transcript_id: dual.transcript_id,
          };

          const reviewNow = new Date();
          await collection.updateOne(
            { callId: doc.callId, recordingId: doc.recordingId },
            {
              $set: {
                analysisStatus: "awaiting_transcript_review",
                analysisResult,
                analysisError: null,
                updatedAt: reviewNow,
                ...(localPath ? { localPath } : {}),
                ...(localFileName ? { localFileName } : {}),
                ...(durationSec != null ? { durationSec } : {}),
              },
            },
          );

          const pending = await collection.findOne({
            callId: doc.callId,
            recordingId: doc.recordingId,
          });
          if (!pending) throw new Error("Recording disappeared after transcribe");
          await upsertRecordingListing(pending);
          return { recording: pending, reused: false };
        }

        analysisResult = await callAiFinalizeTranscript(doc, {
          utterances: dual.utterances,
          words: dual.words,
          duration_sec: dual.duration_sec,
          language: dual.language,
          transcript_id: dual.transcript_id,
          chosen_source: "assemblyai",
          transcript_review: {
            ...dual.transcript_review,
            status: "auto_accepted",
            chosen_source: "assemblyai",
          },
          audio_path: normalized.outputPath,
        });
      } else {
        analysisResult = await callAiService(normalized.outputPath, doc);
      }
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

export type ConfirmTranscriptOptions = {
  chosenSource: "assemblyai" | "whisper";
};

export async function confirmTranscriptOnce(
  callId: number,
  recordingId?: number,
  options?: ConfirmTranscriptOptions,
): Promise<{ recording: RecordingDocument }> {
  const chosenSource = options?.chosenSource ?? "assemblyai";
  const collection = recordingsCollection();
  const doc = await findRecordingDoc(callId, recordingId);
  if (!doc) {
    throw Object.assign(new Error(`Recording not found for call ${callId}`), { status: 404 });
  }
  if (doc.analysisStatus !== "awaiting_transcript_review") {
    throw Object.assign(
      new Error("Recording is not awaiting transcript review."),
      { status: 422 },
    );
  }

  const partial = doc.analysisResult as {
    transcript_review?: Record<string, unknown>;
    words?: unknown[];
    duration_sec?: number;
    language?: string;
    transcript_id?: string | null;
  } | null;

  const review = partial?.transcript_review;
  if (!review) {
    throw Object.assign(new Error("Missing transcript_review payload."), { status: 422 });
  }

  const utterances = utterancesForChosenSource(review, chosenSource);
  if (!utterances.length) {
    throw Object.assign(new Error("No utterances available for confirmation."), { status: 422 });
  }

  const runKey = keyOf(doc.callId, doc.recordingId);
  if (runningKeys.has(runKey)) {
    throw Object.assign(
      new Error(`Analysis is already running for call ${doc.callId}.`),
      { status: 409 },
    );
  }

  runningKeys.add(runKey);
  await collection.updateOne(
    { callId: doc.callId, recordingId: doc.recordingId },
    { $set: { analysisStatus: "running", analysisError: null, updatedAt: new Date() } },
  );

  try {
    const confirmedReview = {
      ...review,
      status: "user_confirmed",
      chosen_source: chosenSource,
      confirmed_at: new Date().toISOString(),
      confirmed_by: "user",
    };

    const analysisResult = await callAiFinalizeTranscript(doc, {
      utterances,
      words: partial?.words ?? [],
      duration_sec: partial?.duration_sec ?? doc.durationSec ?? 0,
      language: partial?.language ?? "unknown",
      transcript_id: partial?.transcript_id,
      chosen_source: chosenSource,
      transcript_review: confirmedReview,
      audio_path: doc.localPath ?? undefined,
    });

    const now = new Date();
    await collection.updateOne(
      { callId: doc.callId, recordingId: doc.recordingId },
      {
        $set: {
          analysisStatus: "completed",
          analysisResult,
          analyzedAt: now,
          analysisError: null,
          updatedAt: now,
        },
        $push: {
          analysisCorrections: {
            at: now,
            reason: `transcript_confirmed_${chosenSource}`,
            remapOnly: false,
          },
        },
      },
    );

    const updated = await collection.findOne({ callId: doc.callId, recordingId: doc.recordingId });
    if (!updated) throw new Error("Recording disappeared after confirm");
    await upsertRecordingListing(updated);
    if (updated.agentId) {
      await refreshAgentStats(updated.agentId);
    }
    return { recording: updated };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await collection.updateOne(
      { callId: doc.callId, recordingId: doc.recordingId },
      {
        $set: {
          analysisStatus: "awaiting_transcript_review",
          analysisError: message,
          updatedAt: new Date(),
        },
      },
    );
    throw error;
  } finally {
    runningKeys.delete(runKey);
  }
}
