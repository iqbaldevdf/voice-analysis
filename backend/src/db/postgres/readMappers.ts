import type { AgentDocument } from "../agents.js";
import type { AnalysisStatus, BotHandling, RecordingDocument, SalesDisposition } from "../mongo.js";
import type { RecordingListingDoc } from "../recordingListings.js";
import type { CronJobLogDocument, ExportJobDocument } from "../syncCollections.js";
import type { AgentEntity } from "./entities/AgentEntity.js";
import type { CronJobLogEntity } from "./entities/CronJobLogEntity.js";
import type {
  ExportJobEntity,
  PgExportJobPhase,
  PgExportJobStatus,
} from "./entities/ExportJobEntity.js";
import type { RecordingEntity } from "./entities/RecordingEntity.js";
import type { RecordingListingEntity } from "./entities/RecordingListingEntity.js";

function num(value: string | number | null | undefined): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function callDateStr(value: string | Date | null | undefined): string | null {
  if (value == null) return null;
  if (typeof value === "string") return value.slice(0, 10);
  // PG `date` often arrives as UTC midnight Date
  const y = value.getUTCFullYear();
  const m = String(value.getUTCMonth() + 1).padStart(2, "0");
  const d = String(value.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function isoOrNull(value: Date | null | undefined): string | null {
  if (!value) return null;
  return value.toISOString();
}

export function recordingEntityToDoc(row: RecordingEntity): RecordingDocument {
  return {
    callId: Number(row.callId),
    recordingId: Number(row.recordingId),
    exportJobId: num(row.exportJobId),
    sourceFile: row.sourceFile,
    direction: row.direction ?? undefined,
    createdTime: isoOrNull(row.createdTime) ?? undefined,
    agentId: row.agentId,
    agentName: row.agentName,
    phoneNumber: row.phoneNumber,
    callNotes: row.callNotes,
    participants: (row.participants as RecordingDocument["participants"]) ?? [],
    recordingUrl: row.recordingUrl,
    durationSec: row.durationSec,
    callDate: callDateStr(row.callDate),
    isVoicemail: row.isVoicemail,
    isConnected: row.isConnected ?? undefined,
    callStatus: row.callStatus,
    botHandling: row.botHandling as BotHandling,
    isBotInvolved: row.isBotInvolved,
    disposition: row.disposition as SalesDisposition | null,
    localPath: row.localPath,
    localFileName: row.localFileName,
    s3Bucket: row.s3Bucket,
    s3Key: row.s3Key,
    analysisStatus: row.analysisStatus as AnalysisStatus,
    analysisError: row.analysisError,
    analyzedAt: row.analyzedAt,
    analysisResult: row.analysisResult,
    analysisCorrections: (row.analysisCorrections as RecordingDocument["analysisCorrections"]) ?? [],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function listingEntityToDoc(row: RecordingListingEntity): RecordingListingDoc {
  return {
    callId: Number(row.callId),
    recordingId: Number(row.recordingId),
    exportJobId: num(row.exportJobId),
    sourceFile: row.sourceFile,
    direction: row.direction ?? undefined,
    createdTime: isoOrNull(row.createdTime) ?? undefined,
    agentId: row.agentId,
    agentName: row.agentName,
    phoneNumber: row.phoneNumber,
    customerName: row.customerName,
    callNotes: row.callNotes,
    participants: (row.participants as RecordingListingDoc["participants"]) ?? [],
    recordingUrl: row.recordingUrl,
    durationSec: row.durationSec,
    callDate: callDateStr(row.callDate),
    isVoicemail: row.isVoicemail,
    isConnected: row.isConnected ?? undefined,
    callStatus: row.callStatus,
    botHandling: row.botHandling as BotHandling,
    isBotInvolved: row.isBotInvolved,
    disposition: row.disposition as SalesDisposition | null,
    localFileName: row.localFileName,
    hasLocalAudio: row.hasLocalAudio,
    analysisStatus: row.analysisStatus as AnalysisStatus,
    analysisError: row.analysisError,
    analyzedAt: row.analyzedAt,
    audioClarityFlag: (row.audioClarityFlag as RecordingListingDoc["audioClarityFlag"]) ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function agentEntityToDoc(row: AgentEntity): AgentDocument {
  return {
    agentId: row.agentId,
    freshcallerAgentId: row.freshcallerAgentId,
    name: row.name,
    teamName: row.teamName,
    callCount: row.callCount,
    recordingCount: row.recordingCount,
    analyzedCount: row.analyzedCount,
    appointmentCount: row.appointmentCount,
    averageScore: row.averageScore,
    firstCallAt: isoOrNull(row.firstCallAt),
    lastCallAt: isoOrNull(row.lastCallAt),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function exportJobEntityToDoc(row: ExportJobEntity): ExportJobDocument {
  return {
    jobId: num(row.jobId),
    runId: row.runId,
    callDate: callDateStr(row.callDate) ?? row.callDate,
    startDate: row.startDate,
    endDate: row.endDate,
    status: row.status as PgExportJobStatus,
    phase: row.phase as PgExportJobPhase,
    phaseMessage: row.phaseMessage,
    trigger: row.trigger,
    downloadPath: row.downloadPath,
    callCount: row.callCount,
    callsWithRecording: row.callsWithRecording,
    voicemailSkipped: row.voicemailSkipped,
    audioDownloaded: row.audioDownloaded,
    audioFailed: row.audioFailed,
    callsIndexed: row.callsIndexed,
    error: row.error,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function cronLogEntityToDoc(row: CronJobLogEntity): CronJobLogDocument {
  return {
    runId: row.runId,
    exportJobId: num(row.exportJobId),
    callDate: callDateStr(row.callDate) ?? String(row.callDate).slice(0, 10),
    trigger: row.trigger,
    level: row.level,
    phase: row.phase as CronJobLogDocument["phase"],
    message: row.message,
    meta: row.meta ?? undefined,
    createdAt: row.createdAt,
  };
}
