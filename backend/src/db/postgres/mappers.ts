import type { AgentDocument } from "../agents.js";
import type { RecordingDocument } from "../mongo.js";
import type { RecordingListingDoc } from "../recordingListings.js";
import type { CronJobLogDocument, ExportJobDocument } from "../syncCollections.js";
import type { AgentEntity } from "./entities/AgentEntity.js";
import type { CronJobLogEntity } from "./entities/CronJobLogEntity.js";
import type { ExportJobEntity } from "./entities/ExportJobEntity.js";
import type { RecordingEntity } from "./entities/RecordingEntity.js";
import type { RecordingListingEntity } from "./entities/RecordingListingEntity.js";

function bigintStr(value: number | string | null | undefined): string | null {
  if (value == null) return null;
  return String(value);
}

function parseTimestamp(value: string | Date | null | undefined): Date | null {
  if (value == null) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Mongo RecordingDocument → TypeORM RecordingEntity fields (upsert). */
export function recordingDocToEntity(doc: RecordingDocument): RecordingEntity {
  const row = {
    callId: String(doc.callId),
    recordingId: String(doc.recordingId),
    exportJobId: bigintStr(doc.exportJobId ?? null),
    sourceFile: doc.sourceFile ?? null,
    direction: doc.direction ?? null,
    createdTime: parseTimestamp(doc.createdTime ?? null),
    agentId: doc.agentId ?? null,
    agentName: doc.agentName ?? null,
    phoneNumber: doc.phoneNumber ?? null,
    callNotes: doc.callNotes ?? null,
    participants: doc.participants ?? [],
    recordingUrl: doc.recordingUrl ?? "",
    durationSec: doc.durationSec ?? null,
    callDate: doc.callDate ?? null,
    isVoicemail: doc.isVoicemail ?? false,
    isConnected: doc.isConnected ?? null,
    callStatus: doc.callStatus ?? null,
    botHandling: doc.botHandling ?? "none",
    isBotInvolved: doc.isBotInvolved ?? false,
    disposition: doc.disposition ?? null,
    localPath: doc.localPath ?? null,
    localFileName: doc.localFileName ?? null,
    s3Bucket: doc.s3Bucket ?? null,
    s3Key: doc.s3Key ?? null,
    analysisStatus: doc.analysisStatus ?? "none",
    analysisError: doc.analysisError ?? null,
    analyzedAt: doc.analyzedAt ?? null,
    analysisResult: doc.analysisResult ?? null,
    analysisCorrections: doc.analysisCorrections ?? [],
    createdAt: doc.createdAt ?? new Date(),
    updatedAt: doc.updatedAt ?? new Date(),
  };
  return row as RecordingEntity;
}

export function listingDocToEntity(listing: RecordingListingDoc): RecordingListingEntity {
  const row = {
    callId: String(listing.callId),
    recordingId: String(listing.recordingId),
    exportJobId: bigintStr(listing.exportJobId ?? null),
    sourceFile: listing.sourceFile ?? null,
    direction: listing.direction ?? null,
    createdTime: parseTimestamp(listing.createdTime ?? null),
    agentId: listing.agentId ?? null,
    agentName: listing.agentName ?? null,
    phoneNumber: listing.phoneNumber ?? null,
    customerName: listing.customerName ?? null,
    callNotes: listing.callNotes ?? null,
    participants: listing.participants ?? [],
    recordingUrl: listing.recordingUrl ?? "",
    durationSec: listing.durationSec ?? null,
    callDate: listing.callDate ?? null,
    isVoicemail: listing.isVoicemail,
    isConnected: listing.isConnected ?? null,
    callStatus: listing.callStatus ?? null,
    botHandling: listing.botHandling ?? "none",
    isBotInvolved: listing.isBotInvolved ?? false,
    disposition: listing.disposition ?? null,
    localFileName: listing.localFileName ?? null,
    hasLocalAudio: listing.hasLocalAudio,
    analysisStatus: listing.analysisStatus,
    analysisError: listing.analysisError ?? null,
    analyzedAt: listing.analyzedAt ?? null,
    audioClarityFlag: listing.audioClarityFlag ?? null,
    createdAt: listing.createdAt,
    updatedAt: listing.updatedAt,
  };
  return row as RecordingListingEntity;
}

export function agentDocToEntity(doc: AgentDocument): AgentEntity {
  const row = {
    agentId: doc.agentId,
    freshcallerAgentId: doc.freshcallerAgentId ?? null,
    name: doc.name,
    teamName: doc.teamName ?? null,
    callCount: doc.callCount ?? 0,
    recordingCount: doc.recordingCount ?? 0,
    analyzedCount: doc.analyzedCount ?? 0,
    appointmentCount: doc.appointmentCount ?? 0,
    averageScore: doc.averageScore ?? null,
    firstCallAt: parseTimestamp(doc.firstCallAt ?? null),
    lastCallAt: parseTimestamp(doc.lastCallAt ?? null),
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
  return row as AgentEntity;
}

export function exportJobDocToEntity(doc: ExportJobDocument): ExportJobEntity {
  const row = {
    callDate: doc.callDate,
    jobId: bigintStr(doc.jobId ?? null),
    runId: doc.runId,
    startDate: doc.startDate,
    endDate: doc.endDate,
    status: doc.status,
    phase: doc.phase,
    phaseMessage: doc.phaseMessage ?? null,
    trigger: doc.trigger,
    downloadPath: doc.downloadPath ?? null,
    callCount: doc.callCount ?? 0,
    callsWithRecording: doc.callsWithRecording ?? 0,
    voicemailSkipped: doc.voicemailSkipped ?? 0,
    audioDownloaded: doc.audioDownloaded ?? 0,
    audioFailed: doc.audioFailed ?? 0,
    callsIndexed: doc.callsIndexed ?? 0,
    error: doc.error ?? null,
    startedAt: doc.startedAt,
    finishedAt: doc.finishedAt ?? null,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
  return row as ExportJobEntity;
}

export function cronLogDocToEntity(doc: CronJobLogDocument): Omit<CronJobLogEntity, "id"> {
  return {
    runId: doc.runId,
    exportJobId: bigintStr(doc.exportJobId ?? null),
    callDate: doc.callDate,
    trigger: doc.trigger,
    level: doc.level,
    phase: doc.phase,
    message: doc.message,
    meta: doc.meta ?? null,
    createdAt: doc.createdAt,
  };
}
