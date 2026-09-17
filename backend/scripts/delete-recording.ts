/**
 * Delete one recording from Mongo + local wav files.
 * Usage: npx tsx scripts/delete-recording.ts <callId> <recordingId>
 */
import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { refreshAgentStats } from "../src/db/agents.js";
import {
  closeMongo,
  connectMongo,
  recordingListingsCollection,
  recordingsCollection,
} from "../src/db/mongo.js";

async function main() {
  const callId = Number(process.argv[2]);
  const recordingId = Number(process.argv[3]);
  if (!callId || !recordingId) {
    console.error("Usage: npx tsx scripts/delete-recording.ts <callId> <recordingId>");
    process.exit(1);
  }

  await connectMongo();
  const before = await recordingsCollection().findOne({ callId, recordingId });
  if (!before) {
    console.log(JSON.stringify({ ok: false, error: "not found", callId, recordingId }, null, 2));
    await closeMongo();
    process.exit(1);
  }

  const agentId = before.agentId ?? null;
  const recDel = await recordingsCollection().deleteOne({ callId, recordingId });
  const listDel = await recordingListingsCollection().deleteOne({ callId, recordingId });

  const removedFiles: string[] = [];
  const candidates = new Set<string>();
  if (before.localPath) candidates.add(before.localPath);
  const baseName = before.localFileName || `fc_${callId}_${recordingId}.wav`;
  candidates.add(path.resolve("data/fc-recordings", baseName));
  candidates.add(path.resolve("data/normalized", baseName));
  candidates.add(path.resolve("data/fc-recordings", `fc_${callId}_${recordingId}.wav`));
  candidates.add(path.resolve("data/normalized", `fc_${callId}_${recordingId}.wav`));

  for (const filePath of candidates) {
    try {
      await fs.access(filePath);
      await fs.unlink(filePath);
      removedFiles.push(filePath);
    } catch {
      // missing is fine
    }
  }

  if (agentId) {
    await refreshAgentStats(agentId).catch(() => undefined);
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        callId,
        recordingId,
        deletedRecording: recDel.deletedCount,
        deletedListing: listDel.deletedCount,
        agentId,
        removedFiles,
      },
      null,
      2,
    ),
  );
  await closeMongo();
}

main().catch(async (err) => {
  console.error(err);
  try {
    await closeMongo();
  } catch {
    // ignore
  }
  process.exit(1);
});
