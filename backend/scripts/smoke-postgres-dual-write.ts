/**
 * F12 Phase 2 smoke: dual-write one recording pair into Postgres from Mongo (or a fixture).
 *
 * Usage:
 *   npx tsx scripts/smoke-postgres-dual-write.ts
 *   npx tsx scripts/smoke-postgres-dual-write.ts 9033484 5384090
 */
import "dotenv/config";
import "reflect-metadata";
import { closeMongo, connectMongo, recordingsCollection } from "../src/db/mongo.js";
import {
  closePostgres,
  connectPostgres,
  isPostgresConfigured,
  AppDataSource,
} from "../src/db/postgres/index.js";
import { RecordingEntity } from "../src/db/postgres/entities/RecordingEntity.js";
import { RecordingListingEntity } from "../src/db/postgres/entities/RecordingListingEntity.js";
import { dualWriteRecordingPair } from "../src/db/postgres/dualWrite.js";
import type { RecordingDocument } from "../src/db/mongo.js";

async function main() {
  if (!isPostgresConfigured()) {
    console.error("Set DATABASE_URL before running this smoke test.");
    process.exit(1);
  }

  await connectMongo();
  await connectPostgres();

  const callIdArg = process.argv[2] ? Number(process.argv[2]) : null;
  const recordingIdArg = process.argv[3] ? Number(process.argv[3]) : null;

  let doc: RecordingDocument | null = null;
  if (callIdArg != null && recordingIdArg != null && Number.isFinite(callIdArg)) {
    doc = await recordingsCollection().findOne({ callId: callIdArg, recordingId: recordingIdArg });
  } else {
    doc = await recordingsCollection().findOne({});
  }

  if (!doc) {
    console.error("No Mongo recording found to dual-write. Sync a day first or pass callId recordingId.");
    process.exit(1);
  }

  console.log(`Dual-writing call ${doc.callId} / recording ${doc.recordingId}…`);
  await dualWriteRecordingPair(doc);

  const pgRec = await AppDataSource.getRepository(RecordingEntity).findOneBy({
    callId: String(doc.callId),
    recordingId: String(doc.recordingId),
  });
  const pgList = await AppDataSource.getRepository(RecordingListingEntity).findOneBy({
    callId: String(doc.callId),
    recordingId: String(doc.recordingId),
  });

  console.log("postgres.recordings", pgRec ? "ok" : "MISSING");
  console.log("postgres.recording_listings", pgList ? "ok" : "MISSING");
  console.log("analysisStatus", pgRec?.analysisStatus ?? null);
  console.log("botHandling", pgRec?.botHandling ?? null);

  await closePostgres();
  await closeMongo();

  if (!pgRec || !pgList) process.exit(1);
  console.log("ok");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
