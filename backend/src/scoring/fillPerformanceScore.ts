import { recordingsCollection } from "../db/mongo.js";
import { agentPerformance } from "./agentQuarter.js";

const AI_SERVICE_URL = process.env.AI_SERVICE_URL ?? "http://127.0.0.1:8001";

type StoredAnalysis = {
  utterances?: Array<{
    speaker: string;
    start: number;
    end: number;
    text: string;
    confidence?: number;
    sentiment?: string;
    sentiment_confidence?: number;
  }>;
  speaker_metrics?: Array<{ speaker?: string; role_guess?: string | null }>;
  participant_performance?: unknown[];
};

function needsPerformanceScore(result: unknown): boolean {
  const agent = agentPerformance(result);
  return agent == null || typeof agent.overallScore !== "number";
}

export async function fillMissingPerformanceScores(
  docs: Array<{ callId: number; recordingId: number; direction?: string | null; callNotes?: string | null; participants?: Array<{ role: string; name?: string | null }>; analysisStatus?: string; analysisResult?: unknown }>,
): Promise<void> {
  const pending = docs.filter(
    (doc) => doc.analysisStatus === "completed" && needsPerformanceScore(doc.analysisResult),
  );
  for (const doc of pending.slice(0, 8)) {
    const result = doc.analysisResult as StoredAnalysis | null;
    const utterances = result?.utterances ?? [];
    if (utterances.length === 0) continue;

    const roleHints = Object.fromEntries(
      (result?.speaker_metrics ?? [])
        .filter((item) => item.speaker && item.role_guess)
        .map((item) => [item.speaker as string, item.role_guess as string]),
    );

    try {
      const response = await fetch(`${AI_SERVICE_URL}/score-performance`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          utterances,
          role_hints: roleHints,
          participants: doc.participants ?? [],
          direction: doc.direction ?? null,
          call_notes: doc.callNotes ?? null,
        }),
      });
      if (!response.ok) continue;
      const scored = (await response.json()) as Array<{ participantRole?: string; overallScore?: number | null }>;
      const agentScore = scored.find((item) => item.participantRole?.toLowerCase() === "agent")?.overallScore;
      if (typeof agentScore !== "number") continue;

      const nextResult = {
        ...(result ?? {}),
        participant_performance: scored,
      };
      await recordingsCollection().updateOne(
        { callId: doc.callId, recordingId: doc.recordingId },
        { $set: { analysisResult: nextResult, updatedAt: new Date() } },
      );
      doc.analysisResult = nextResult;
    } catch {
      // Leave the stored analysis untouched if the scoring model is unavailable.
    }
  }
}
