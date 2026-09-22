import type { RecordingDocument } from "./mongo.js";
import { recordingListingsCollection } from "./mongo.js";
import { isLikelyVoicemail } from "../voicemail.js";
import { audioClarityFlagFromResult, type AudioClarityFlag } from "../lib/audioClarity.js";
import { hasAudioAvailable } from "../storage/audioStore.js";

export type RecordingListingDoc = {
  callId: number;
  recordingId: number;
  exportJobId?: number | null;
  sourceFile?: string | null;
  direction?: string;
  createdTime?: string;
  agentId?: string | null;
  agentName?: string | null;
  phoneNumber?: string | null;
  customerName?: string | null;
  callNotes?: string | null;
  participants: RecordingDocument["participants"];
  recordingUrl: string;
  durationSec?: number | null;
  callDate?: string | null;
  isVoicemail: boolean;
  isConnected?: boolean;
  callStatus?: number | null;
  botHandling?: RecordingDocument["botHandling"];
  isBotInvolved?: boolean;
  disposition?: RecordingDocument["disposition"];
  localFileName?: string | null;
  hasLocalAudio: boolean;
  analysisStatus: RecordingDocument["analysisStatus"];
  analysisError?: string | null;
  analyzedAt?: Date | null;
  audioClarityFlag?: AudioClarityFlag | null;
  createdAt: Date;
  updatedAt: Date;
};

function customerNameFrom(doc: RecordingDocument): string | null {
  const customer = doc.participants?.find((p) => p.role.toLowerCase() === "customer");
  return customer?.name ?? customer?.phone ?? null;
}

export function toListingDoc(doc: RecordingDocument): RecordingListingDoc {
  const durationSec = doc.durationSec ?? null;
  return {
    callId: doc.callId,
    recordingId: doc.recordingId,
    exportJobId: doc.exportJobId,
    sourceFile: doc.sourceFile,
    direction: doc.direction,
    createdTime: doc.createdTime,
    agentId: doc.agentId ?? null,
    agentName: doc.agentName,
    phoneNumber: doc.phoneNumber,
    customerName: customerNameFrom(doc),
    callNotes: doc.callNotes,
    participants: doc.participants ?? [],
    recordingUrl: doc.recordingUrl,
    durationSec,
    callDate: doc.callDate ?? null,
    isVoicemail: doc.isVoicemail ?? isLikelyVoicemail(durationSec),
    isConnected: doc.isConnected,
    callStatus: doc.callStatus ?? null,
    botHandling: doc.botHandling ?? "none",
    isBotInvolved: doc.isBotInvolved ?? false,
    disposition: doc.disposition ?? null,
    localFileName: doc.localFileName,
    hasLocalAudio: hasAudioAvailable(doc),
    analysisStatus: doc.analysisStatus,
    analysisError: doc.analysisError,
    analyzedAt: doc.analyzedAt,
    audioClarityFlag: audioClarityFlagFromResult(doc.analysisResult),
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

/** Keep recording_listings in sync (listing table without analysis payloads). */
export async function upsertRecordingListing(doc: RecordingDocument): Promise<void> {
  const listing = toListingDoc(doc);
  await recordingListingsCollection().updateOne(
    { callId: listing.callId, recordingId: listing.recordingId },
    { $set: listing },
    { upsert: true },
  );
  // F12 Phase 2: mirror recording + listing into Postgres when configured.
  const { dualWriteRecordingPair } = await import("./postgres/dualWrite.js");
  await dualWriteRecordingPair(doc);
}
