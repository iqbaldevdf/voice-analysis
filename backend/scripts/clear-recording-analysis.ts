import "dotenv/config";
import { refreshAgentStats } from "../src/db/agents.js";
import { closeMongo, connectMongo, recordingsCollection } from "../src/db/mongo.js";
import { upsertRecordingListing } from "../src/db/recordingListings.js";

const callId = Number(process.argv[2]);
const recordingId = Number(process.argv[3]);

async function main() {
  if (!callId || !recordingId) {
    console.error("Usage: npx tsx scripts/clear-recording-analysis.ts <callId> <recordingId>");
    process.exit(1);
  }

  await connectMongo();
  const before = await recordingsCollection().findOne({ callId, recordingId });
  if (!before) {
    console.error(`Recording not found: ${callId}/${recordingId}`);
    process.exit(1);
  }

  await recordingsCollection().updateOne(
    { callId, recordingId },
    {
      $set: {
        analysisStatus: "none",
        analysisError: null,
        updatedAt: new Date(),
      },
      $unset: {
        analysisResult: "",
        analyzedAt: "",
        analysisCorrections: "",
      },
    },
  );

  const updated = await recordingsCollection().findOne({ callId, recordingId });
  if (updated) {
    await upsertRecordingListing(updated);
    if (updated.agentId) {
      await refreshAgentStats(updated.agentId);
    }
  }

  console.log(
    JSON.stringify(
      {
        callId,
        recordingId,
        analysisStatus: updated?.analysisStatus,
        hasAnalysisResult: Boolean(updated?.analysisResult),
        localAudioKept: Boolean(updated?.localPath),
      },
      null,
      2,
    ),
  );

  await closeMongo();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
