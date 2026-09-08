/**
 * Run the daily Freshcaller sync pipeline (await completion).
 *
 * Examples:
 *   npm run sync:daily
 *   npm run sync:daily -- --date 2026-09-06
 *   npm run sync:daily -- --date 2026-09-06 --force
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { closeMongo, connectMongo } from "../src/db/mongo.js";
import { runDailySync } from "../src/freshcaller/dailySyncPipeline.js";
import { previousIstCallDate } from "../src/freshcaller/dateUtils.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, "../.env") });

function parseArgs(argv: string[]) {
  let date: string | undefined;
  let force = false;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--date") date = argv[++i];
    else if (argv[i] === "--force") force = true;
  }
  return { date, force };
}

async function main() {
  const { date, force } = parseArgs(process.argv.slice(2));
  const callDate = date || previousIstCallDate();
  console.log(`Connecting Mongo…`);
  await connectMongo();
  console.log(`Running daily sync for ${callDate} (force=${force})…`);
  const result = await runDailySync({ callDate, force, trigger: "cli" });
  console.log(JSON.stringify(result, null, 2));
  await closeMongo();
}

main().catch(async (error) => {
  console.error(error instanceof Error ? error.message : error);
  try {
    await closeMongo();
  } catch {
    // ignore
  }
  process.exit(1);
});
