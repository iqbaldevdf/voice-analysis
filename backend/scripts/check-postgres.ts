import "dotenv/config";
import "reflect-metadata";
import {
  closePostgres,
  connectPostgres,
  getDatabaseUrlForLog,
  isPostgresConfigured,
  pingPostgres,
} from "../src/db/postgres/index.js";

async function main() {
  if (!isPostgresConfigured()) {
    console.log("DATABASE_URL is not set — Postgres is optional until cutover (F12).");
    console.log("Local example: postgres://voiceiq:voiceiq@127.0.0.1:5432/voice_analysis");
    process.exit(0);
  }

  console.log("url", getDatabaseUrlForLog());
  await connectPostgres();
  console.log("ping", await pingPostgres());
  await closePostgres();
  console.log("ok");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
