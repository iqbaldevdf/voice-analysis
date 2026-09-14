import { MongoClient, type Db, type Collection } from "mongodb";

export type AnalysisStatus = "none" | "queued" | "running" | "completed" | "failed";

/** Reviewer-set sales result. Separate from the model's Successful / Unsuccessful / Unclear. */
export type SalesDisposition = "hung_up" | "not_interested" | "appointment" | "follow_up" | "dnc";

export type RecordingParticipant = {
  role: string;
  name?: string | null;
  phone?: string | null;
};

export type AnalysisCorrection = {
  at: Date;
  reason: string;
  remapOnly: boolean;
  speakerOverride?: Record<string, string>;
};

/** One Freshcaller call that has a downloadable recording. */
export type RecordingDocument = {
  callId: number;
  recordingId: number;
  exportJobId?: number | null;
  sourceFile?: string | null;
  direction?: string;
  createdTime?: string;
  agentId?: string | null;
  agentName?: string | null;
  phoneNumber?: string | null;
  callNotes?: string | null;
  participants: RecordingParticipant[];
  recordingUrl: string;
  durationSec?: number | null;
  /** Calendar day in Asia/Kolkata (YYYY-MM-DD) for sync/listing filters. */
  callDate?: string | null;
  /** Freshcaller voicemail (status 10/16 or lifecycle), not a live conversation. */
  isVoicemail?: boolean;
  /** Answered/completed conversation. False for missed and voicemail. */
  isConnected?: boolean;
  /** Freshcaller participant call_status when known. */
  callStatus?: number | null;
  /** Reviewer-set sales disposition. Null until set. Appointment is the AG filter. */
  disposition?: SalesDisposition | null;
  localPath?: string | null;
  localFileName?: string | null;
  analysisStatus: AnalysisStatus;
  analysisError?: string | null;
  analyzedAt?: Date | null;
  analysisResult?: unknown;
  analysisCorrections?: AnalysisCorrection[];
  createdAt: Date;
  updatedAt: Date;
};

let client: MongoClient | null = null;
let db: Db | null = null;

export function getMongoUri(): string {
  return (process.env.MONGODB_URI ?? "mongodb://127.0.0.1:27017/voice_analysis").trim();
}

export async function connectMongo(): Promise<Db> {
  if (db) return db;

  const uri = getMongoUri();
  client = new MongoClient(uri);
  await client.connect();
  db = client.db();

  const recordings = db.collection<RecordingDocument>("recordings");
  await recordings.createIndex({ callId: 1, recordingId: 1 }, { unique: true });
  await recordings.createIndex({ analysisStatus: 1 });
  await recordings.createIndex({ createdTime: -1 });
  await recordings.createIndex({ durationSec: 1 });
  await recordings.createIndex({ isVoicemail: 1, createdTime: -1 });
  await recordings.createIndex({ callDate: -1 });
  await recordings.createIndex({ agentId: 1, createdTime: -1 });

  const agents = db.collection("agents");
  await agents.createIndex({ agentId: 1 }, { unique: true });
  await agents.createIndex({ name: 1 });
  await agents.createIndex({ lastCallAt: -1 });

  // Lightweight listing projection collection (metadata only, no analysisResult).
  const listing = db.collection("recording_listings");
  await listing.createIndex({ callId: 1, recordingId: 1 }, { unique: true });
  await listing.createIndex({ createdTime: -1 });
  await listing.createIndex({ durationSec: 1 });
  await listing.createIndex({ isVoicemail: 1 });
  await listing.createIndex({ agentId: 1, createdTime: -1 });
  await listing.createIndex({ isConnected: 1, createdTime: -1 });
  await listing.createIndex({ callDate: -1 });

  const { ensureSyncCollections } = await import("./syncCollections.js");
  await ensureSyncCollections();

  return db;
}

export function recordingListingsCollection(): Collection {
  return getDb().collection("recording_listings");
}

export function getDb(): Db {
  if (!db) {
    throw new Error("MongoDB is not connected. Call connectMongo() first.");
  }
  return db;
}

export function recordingsCollection(): Collection<RecordingDocument> {
  return getDb().collection<RecordingDocument>("recordings");
}

export async function pingMongo(): Promise<boolean> {
  try {
    if (!db) await connectMongo();
    await getDb().command({ ping: 1 });
    return true;
  } catch {
    return false;
  }
}

export async function closeMongo(): Promise<void> {
  if (client) {
    await client.close();
    client = null;
    db = null;
  }
}
