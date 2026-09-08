/**
 * Step 2 — Import Freshcaller call export JSON into MongoDB and download recordings.
 *
 * Does NOT run sentiment / AI analysis.
 *
 * Examples:
 *   npm run import:recordings
 *   npx tsx scripts/import-recordings.ts --metadata-only
 *   npx tsx scripts/import-recordings.ts --dir "C:\Users\...\Downloads\20146\calls" --job 20146
 *   npx tsx scripts/import-recordings.ts --limit 5
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { FreshcallerClient } from "../src/freshcaller/client.js";
import {
  closeMongo,
  connectMongo,
  recordingsCollection,
  type RecordingDocument,
  type RecordingParticipant,
} from "../src/db/mongo.js";
import { upsertRecordingListing } from "../src/db/recordingListings.js";
import { isLikelyVoicemail, VOICEMAIL_MAX_DURATION_SEC } from "../src/voicemail.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendRoot = path.resolve(__dirname, "..");
const projectRoot = path.resolve(backendRoot, "..");

dotenv.config({ path: path.join(backendRoot, ".env") });

const DEFAULT_FILES = [
  path.join(projectRoot, "calls_2026-08-15T00_00_00Z-2026-08-28T23_59_59Z_9025323.json"),
  path.join(
    projectRoot,
    "calls_2026-09-01T01_03_00+00_00-2026-09-04T23_59_59+00_00_9041556.json",
  ),
];

type CliOptions = {
  files: string[];
  dir: string | null;
  jobId: number | null;
  metadataOnly: boolean;
  limit: number | null;
  forceDownload: boolean;
};

type RawCall = {
  id: number;
  direction?: string;
  phone_number?: string | null;
  assigned_agent_name?: string | null;
  created_time?: string;
  call_notes?: string | null;
  recording?: {
    id: number;
    url: string;
    duration?: number;
    duration_unit?: string;
  } | null;
  participants?: Array<{
    participant_type?: string;
    caller_name?: string | null;
    caller_number?: string | null;
  }>;
};

function parseArgs(argv: string[]): CliOptions {
  const files: string[] = [];
  let dir: string | null = null;
  let jobId: number | null = null;
  let metadataOnly = false;
  let limit: number | null = null;
  let forceDownload = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--files") {
      while (i + 1 < argv.length && !argv[i + 1].startsWith("--")) {
        files.push(path.resolve(argv[++i]));
      }
    } else if (arg === "--dir") {
      dir = path.resolve(argv[++i] ?? "");
    } else if (arg === "--job") {
      jobId = Number(argv[++i]);
      if (!Number.isFinite(jobId)) jobId = null;
    } else if (arg === "--metadata-only") {
      metadataOnly = true;
    } else if (arg === "--force-download") {
      forceDownload = true;
    } else if (arg === "--limit") {
      limit = Number(argv[++i]);
      if (!Number.isFinite(limit) || limit < 1) limit = null;
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
  }

  return {
    files: files.length > 0 ? files : DEFAULT_FILES,
    dir,
    jobId,
    metadataOnly,
    limit,
    forceDownload,
  };
}

function printHelp() {
  console.log(`Import Freshcaller calls_*.json into MongoDB and download recordings.

Options:
  --files <path...>     Explicit JSON file paths (default: both project-root export files)
  --dir <path>          Import all calls_*.json under a folder
  --job <id>            Optional export job id to store on documents
  --metadata-only       Upsert Mongo docs only; skip audio download
  --force-download      Re-download even if local file already exists
  --limit <n>           Process only first N recordings (useful for testing)
  -h, --help            Show help
`);
}

async function resolveFiles(options: CliOptions): Promise<string[]> {
  if (options.dir) {
    const entries = await fs.readdir(options.dir, { withFileTypes: true });
    return entries
      .filter((e) => e.isFile() && /^calls_.*\.json$/i.test(e.name))
      .map((e) => path.join(options.dir!, e.name))
      .sort();
  }
  return options.files;
}

function mapParticipants(call: RawCall): RecordingParticipant[] {
  return (call.participants ?? []).map((p) => ({
    role: String(p.participant_type ?? "Unknown"),
    name:
      p.caller_name ||
      (String(p.participant_type ?? "").toLowerCase() === "agent"
        ? call.assigned_agent_name
        : null) ||
      null,
    phone: p.caller_number ?? null,
  }));
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function loadCallsFromFile(filePath: string): Promise<{ sourceFile: string; calls: RawCall[] }> {
  const raw = await fs.readFile(filePath, "utf8");
  const parsed = JSON.parse(raw) as { calls?: RawCall[] };
  const calls = Array.isArray(parsed.calls) ? parsed.calls : [];
  return { sourceFile: path.basename(filePath), calls };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const files = await resolveFiles(options);

  if (files.length === 0) {
    throw new Error("No calls_*.json files found to import");
  }

  console.log("MongoDB connecting...");
  await connectMongo();
  const collection = recordingsCollection();

  const outDir = path.resolve(
    backendRoot,
    process.env.FC_RECORDINGS_DIR ?? "./data/fc-recordings",
  );
  await fs.mkdir(outDir, { recursive: true });

  let client: FreshcallerClient | null = null;
  if (!options.metadataOnly) {
    client = new FreshcallerClient();
  }

  let scanned = 0;
  let withRecording = 0;
  let upserted = 0;
  let downloaded = 0;
  let skippedDownload = 0;
  let failed = 0;
  let processedRecordings = 0;
  let skippedVoicemail = 0;

  const seen = new Set<string>();
  let hitLimit = false;

  for (const filePath of files) {
    if (hitLimit) break;

    if (!(await fileExists(filePath))) {
      console.warn(`Skip missing file: ${filePath}`);
      continue;
    }

    console.log(`\nReading ${filePath}`);
    const { sourceFile, calls } = await loadCallsFromFile(filePath);

    for (const call of calls) {
      scanned += 1;
      if (!call.recording || typeof call.recording.id !== "number" || !call.recording.url) {
        continue;
      }

      withRecording += 1;

      const durationSec =
        typeof call.recording.duration === "number" ? call.recording.duration : null;
      if (isLikelyVoicemail(durationSec)) {
        skippedVoicemail += 1;
        continue;
      }

      const key = `${call.id}:${call.recording.id}`;
      if (seen.has(key)) continue;
      seen.add(key);

      if (options.limit != null && processedRecordings >= options.limit) {
        hitLimit = true;
        break;
      }

      processedRecordings += 1;

      const recordingId = call.recording.id;
      const callId = call.id;
      const recordingUrl = String(call.recording.url);
      const now = new Date();

      const existing = await collection.findOne({ callId, recordingId });
      let localPath = existing?.localPath ?? null;
      let localFileName = existing?.localFileName ?? null;

      if (!options.metadataOnly && client) {
        const needsDownload =
          options.forceDownload || !localPath || !(await fileExists(localPath));

        if (needsDownload) {
          try {
            console.log(`  Downloading call ${callId} / recording ${recordingId}...`);
            const audio = await client.downloadRecording(callId, recordingId);
            localFileName = `fc_${callId}_${recordingId}${audio.extension}`;
            localPath = path.join(outDir, localFileName);
            await fs.writeFile(localPath, audio.buffer);
            downloaded += 1;
          } catch (error) {
            failed += 1;
            const message = error instanceof Error ? error.message : String(error);
            console.error(`  FAILED download ${callId}/${recordingId}: ${message}`);
          }
        } else {
          skippedDownload += 1;
        }
      }

      const doc: RecordingDocument = {
        callId,
        recordingId,
        exportJobId: options.jobId,
        sourceFile,
        direction: call.direction,
        createdTime: call.created_time,
        agentName: call.assigned_agent_name ?? null,
        phoneNumber: call.phone_number ?? null,
        callNotes: call.call_notes ?? null,
        participants: mapParticipants(call),
        recordingUrl,
        durationSec,
        isVoicemail: false,
        localPath,
        localFileName,
        analysisStatus: existing?.analysisStatus ?? "none",
        analysisError: existing?.analysisError ?? null,
        analyzedAt: existing?.analyzedAt ?? null,
        analysisResult: existing?.analysisResult,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };

      await collection.updateOne({ callId, recordingId }, { $set: doc }, { upsert: true });
      await upsertRecordingListing(doc);
      upserted += 1;
    }
  }

  // Mark any already-imported short clips as voicemail and sync listings.
  const voicemailMark = await collection.updateMany(
    {
      durationSec: { $gt: 0, $lte: VOICEMAIL_MAX_DURATION_SEC },
      isVoicemail: { $ne: true },
    },
    { $set: { isVoicemail: true, updatedAt: new Date() } },
  );
  if (voicemailMark.modifiedCount > 0) {
    const shortOnes = await collection
      .find({ isVoicemail: true })
      .project({ analysisResult: 0 })
      .toArray();
    for (const doc of shortOnes as RecordingDocument[]) {
      await upsertRecordingListing(doc);
    }
  }

  console.log("\n=== Import summary ===");
  console.log(`Files:              ${files.length}`);
  console.log(`Calls scanned:      ${scanned}`);
  console.log(`With recording:     ${withRecording}`);
  console.log(`Skipped voicemail:  ${skippedVoicemail} (≤${VOICEMAIL_MAX_DURATION_SEC}s)`);
  console.log(`Marked voicemail:   ${voicemailMark.modifiedCount}`);
  console.log(`Upserted to Mongo:  ${upserted}`);
  console.log(`Downloaded audio:   ${downloaded}`);
  console.log(`Skipped download:   ${skippedDownload}`);
  console.log(`Download failures:  ${failed}`);
  console.log(`Audio directory:    ${outDir}`);
  if (options.metadataOnly) {
    console.log("Mode:               metadata-only (no downloads)");
  }

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
