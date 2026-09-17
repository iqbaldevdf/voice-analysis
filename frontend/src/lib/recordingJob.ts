import {
  dbRecordingAudioUrl,
  fetchDbRecording,
  type AnalysisJob,
  type CallAnalysisResult,
  type DbRecordingDetail,
} from "../api";

export function jobFromDbRecording(rec: DbRecordingDetail): AnalysisJob {
  const result = (rec.analysisResult ?? undefined) as CallAnalysisResult | undefined;
  const now = new Date().toISOString();
  return {
    id: `db-${rec.callId}-${rec.recordingId}`,
    sourceName: rec.localFileName || `fc_${rec.callId}_${rec.recordingId}`,
    sourcePath: rec.localPath || "",
    status:
      rec.analysisStatus === "failed"
        ? "failed"
        : rec.analysisStatus === "awaiting_transcript_review" || rec.analysisStatus === "completed"
          ? "completed"
          : rec.analysisStatus === "running" ||
              rec.analysisStatus === "transcribing" ||
              rec.analysisStatus === "queued"
            ? "analyzing"
            : rec.analysisStatus === "none"
              ? "queued"
              : "analyzing",
    dbAnalysisStatus: rec.analysisStatus,
    createdAt: rec.createdAt || now,
    updatedAt: rec.updatedAt || now,
    durationSec: rec.durationSec ?? undefined,
    result,
    freshcallerCallId: rec.callId,
    recordingId: rec.recordingId,
    disposition: rec.disposition ?? null,
    answered: rec.answered,
    botHandling: rec.botHandling ?? "none",
    isBotInvolved: rec.isBotInvolved ?? false,
    callMeta: {
      callId: rec.callId,
      direction: rec.direction,
      createdTime: rec.createdTime,
      phoneNumber: rec.phoneNumber,
      agentName: rec.agentName,
      billDuration: rec.durationSec,
      participants: (rec.participants ?? []).map((p) => ({
        role: p.role,
        name: p.name,
        phone: p.phone,
        email: null,
      })),
    },
  };
}

export async function loadDbRecordingJob(
  callId: number,
  recordingId: number,
): Promise<{ job: AnalysisJob; audioUrl: string }> {
  const data = await fetchDbRecording(callId, { recordingId, includeAnalysis: true });
  return {
    job: jobFromDbRecording(data.recording),
    audioUrl: dbRecordingAudioUrl(callId),
  };
}
