/**
 * Reset analysis payloads so recordings can be re-analyzed with the updated pipeline.
 *
 * Usage:
 *   npx tsx scripts/clear-analysis-data.ts --confirm
 *   npx tsx scripts/clear-analysis-data.ts --confirm --agent-id fc:12345
 */
import "dotenv/config";
import { agentsCollection, refreshAgentStats } from "../src/db/agents.js";
import { closeMongo, connectMongo, recordingsCollection } from "../src/db/mongo.js";
import { upsertRecordingListing } from "../src/db/recordingListings.js";

function parseArgs(argv: string[]) {
  const confirm = argv.includes("--confirm");
  const agentId = argv.find((arg, index) => argv[index - 1] === "--agent-id");
  return { confirm, agentId };
}

async function main() {
  const { confirm, agentId } = parseArgs(process.argv.slice(2));
  if (!confirm) {
    console.error("Refusing to run without --confirm");
    console.error("This clears analysisResult / analysisStatus on recordings (metadata kept).");
    process.exit(1);
  }

  await connectMongo();
  const collection = recordingsCollection();
  const filter = agentId ? { agentId } : {};
  const cursor = collection.find(filter);

  let cleared = 0;
  const agentIds = new Set<string>();

  for await (const doc of cursor) {
    await collection.updateOne(
      { callId: doc.callId, recordingId: doc.recordingId },
      {
        $set: {
          analysisStatus: "none",
          analysisError: null,
          updatedAt: new Date(),
        },
        $unset: {
          analysisResult: "",
          analyzedAt: "",
        },
      },
    );

    const updated = await collection.findOne({ callId: doc.callId, recordingId: doc.recordingId });
    if (updated) {
      await upsertRecordingListing(updated);
      if (updated.agentId) agentIds.add(updated.agentId);
    }
    cleared += 1;
  }

  for (const id of agentIds) {
    await refreshAgentStats(id);
  }

  const agentCount = await agentsCollection().countDocuments(agentId ? { agentId } : {});
  console.log(
    JSON.stringify(
      {
        cleared,
        agentIdsRefreshed: agentIds.size,
        agentsInDb: agentCount,
        filter: agentId ? { agentId } : "all",
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
