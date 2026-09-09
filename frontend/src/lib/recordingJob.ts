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
    status: rec.analysisStatus === "completed" && result ? "completed" : "queued",
    createdAt: rec.createdAt || now,
    updatedAt: rec.updatedAt || now,
    durationSec: rec.durationSec ?? undefined,
    result,
    freshcallerCallId: rec.callId,
    recordingId: rec.recordingId,
    disposition: rec.disposition ?? null,
    answered: rec.answered,
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
