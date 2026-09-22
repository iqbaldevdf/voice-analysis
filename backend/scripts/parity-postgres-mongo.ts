/**
 * F12 Phase 3: compare Mongo vs Postgres counts (parity smoke).
 *
 * Usage: npx tsx scripts/parity-postgres-mongo.ts
 */
import "dotenv/config";
import "reflect-metadata";
import { agentsCollection } from "../src/db/agents.js";
import { closeMongo, connectMongo, recordingsCollection, recordingListingsCollection } from "../src/db/mongo.js";
import {
  AppDataSource,
  closePostgres,
  connectPostgres,
  isPostgresConfigured,
} from "../src/db/postgres/index.js";
import { AgentEntity } from "../src/db/postgres/entities/AgentEntity.js";
import { CronJobLogEntity } from "../src/db/postgres/entities/CronJobLogEntity.js";
import { ExportJobEntity } from "../src/db/postgres/entities/ExportJobEntity.js";
import { RecordingEntity } from "../src/db/postgres/entities/RecordingEntity.js";
import { RecordingListingEntity } from "../src/db/postgres/entities/RecordingListingEntity.js";
import { cronJobLogsCollection, exportJobsCollection } from "../src/db/syncCollections.js";

async function main() {
  if (!isPostgresConfigured()) {
    console.error("Set DATABASE_URL first.");
    process.exit(1);
  }

  await connectMongo();
  await connectPostgres();

  const rows = [
    ["recordings", await recordingsCollection().countDocuments(), await AppDataSource.getRepository(RecordingEntity).count()],
    ["recording_listings", await recordingListingsCollection().countDocuments(), await AppDataSource.getRepository(RecordingListingEntity).count()],
    ["agents", await agentsCollection().countDocuments(), await AppDataSource.getRepository(AgentEntity).count()],
    ["export_jobs", await exportJobsCollection().countDocuments(), await AppDataSource.getRepository(ExportJobEntity).count()],
    ["cron_job_logs", await cronJobLogsCollection().countDocuments(), await AppDataSource.getRepository(CronJobLogEntity).count()],
  ] as const;

  console.log("collection | mongo | postgres | delta");
  let ok = true;
  for (const [name, mongo, pg] of rows) {
    const delta = mongo - pg;
    if (delta !== 0) ok = false;
    console.log(`${name} | ${mongo} | ${pg} | ${delta}`);
  }

  await closePostgres();
  await closeMongo();
  if (!ok) {
    console.log("parity incomplete — run: npm run backfill:postgres");
    process.exit(2);
  }
  console.log("ok — counts match");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
