import { recordingsCollection } from "../db/mongo.js";
import { dualWriteRecordingAnalysisPatch } from "../db/postgres/dualWrite.js";
import { introductionScriptFromResult } from "./agentQuarter.js";

const AI_SERVICE_URL = process.env.AI_SERVICE_URL ?? "http://127.0.0.1:8001";
const MAX_BACKFILL_PER_REQUEST = 80;

type StoredAnalysis = {
  utterances?: Array<{
    speaker: string;
    start: number;
    end: number;
    text: string;
    confidence?: number;
  }>;
  speaker_metrics?: Array<{ speaker?: string; role_guess?: string | null }>;
  speaker_mapping?: { mapping?: Record<string, string> };
  introduction_script?: unknown;
};

function needsIntroductionScript(result: unknown): boolean {
  return introductionScriptFromResult(result) == null;
}

function roleHintsFromResult(result: StoredAnalysis | null): Record<string, string> {
  const mapping = result?.speaker_mapping?.mapping;
  if (mapping && Object.keys(mapping).length > 0) {
    return mapping;
  }
  return Object.fromEntries(
    (result?.speaker_metrics ?? [])
      .filter((item) => item.speaker && item.role_guess)
      .map((item) => [item.speaker as string, item.role_guess as string]),
  );
}

export async function fillMissingIntroductionScripts(
  docs: Array<{
    callId: number;
    recordingId: number;
    analysisStatus?: string;
    analysisResult?: unknown;
  }>,
): Promise<void> {
  const pending = docs.filter(
    (doc) => doc.analysisStatus === "completed" && needsIntroductionScript(doc.analysisResult),
  );
  for (const doc of pending.slice(0, MAX_BACKFILL_PER_REQUEST)) {
    const result = doc.analysisResult as StoredAnalysis | null;
    const utterances = result?.utterances ?? [];
    if (utterances.length === 0) continue;

    try {
      const response = await fetch(`${AI_SERVICE_URL}/score-introduction-script`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          utterances,
          role_hints: roleHintsFromResult(result),
        }),
      });
      if (!response.ok) {
        const errBody = await response.text().catch(() => "");
        console.warn(
          `introduction_script backfill failed call ${doc.callId}: HTTP ${response.status} ${errBody.slice(0, 200)}`,
        );
        continue;
      }
      const introduction_script = await response.json();
      if (typeof (introduction_script as { score?: unknown }).score !== "number") continue;

      const nextResult = {
        ...(result ?? {}),
        introduction_script,
      };
      await recordingsCollection().updateOne(
        { callId: doc.callId, recordingId: doc.recordingId },
        { $set: { analysisResult: nextResult, updatedAt: new Date() } },
      );
      doc.analysisResult = nextResult;
      await dualWriteRecordingAnalysisPatch({
        callId: doc.callId,
        recordingId: doc.recordingId,
        analysisResult: nextResult,
      });
    } catch {
      // AI service unavailable — leave stored analysis unchanged.
    }
  }
}
