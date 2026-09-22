/**
 * F12 Phase 3 helper: copy Mongo recordings/agents/export_jobs/cron logs into Postgres
 * so PG reads are not empty before full dual-write history exists.
 *
 * Usage: npx tsx scripts/backfill-postgres-from-mongo.ts
 */
import "dotenv/config";
import "reflect-metadata";
import { agentsCollection } from "../src/db/agents.js";
import { closeMongo, connectMongo, recordingsCollection } from "../src/db/mongo.js";
import {
  closePostgres,
  connectPostgres,
  isPostgresConfigured,
} from "../src/db/postgres/index.js";
import {
  dualWriteAgent,
  dualWriteCronLog,
  dualWriteExportJob,
  dualWriteRecordingPair,
} from "../src/db/postgres/dualWrite.js";
import { cronJobLogsCollection, exportJobsCollection } from "../src/db/syncCollections.js";

async function main() {
  if (!isPostgresConfigured()) {
    console.error("Set DATABASE_URL first.");
    process.exit(1);
  }

  await connectMongo();
  await connectPostgres();

  let recordings = 0;
  const cursor = recordingsCollection().find({});
  for await (const doc of cursor) {
    await dualWriteRecordingPair(doc);
    recordings += 1;
    if (recordings % 50 === 0) console.log(`recordings ${recordings}…`);
  }
  console.log(`recordings dual-written: ${recordings}`);

  let agents = 0;
  for await (const doc of agentsCollection().find({})) {
    await dualWriteAgent(doc);
    agents += 1;
  }
  console.log(`agents dual-written: ${agents}`);

  let jobs = 0;
  for await (const doc of exportJobsCollection().find({})) {
    await dualWriteExportJob(doc);
    jobs += 1;
  }
  console.log(`export_jobs dual-written: ${jobs}`);

  let logs = 0;
  for await (const doc of cronJobLogsCollection().find({})) {
    await dualWriteCronLog(doc);
    logs += 1;
    if (logs % 200 === 0) console.log(`cron_logs ${logs}…`);
  }
  console.log(`cron_job_logs dual-written: ${logs}`);

  await closePostgres();
  await closeMongo();
  console.log("ok");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
