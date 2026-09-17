import "dotenv/config";
import { closeMongo, connectMongo, recordingsCollection } from "../src/db/mongo.js";
import { introductionScriptFromResult } from "../src/scoring/agentQuarter.js";
import { fillMissingIntroductionScripts } from "../src/scoring/fillIntroductionScript.js";

const BATCH = 80;

async function main() {
  await connectMongo();
  const collection = recordingsCollection();

  const cursor = collection.find(
    { analysisStatus: "completed" },
    {
      projection: {
        callId: 1,
        recordingId: 1,
        analysisStatus: 1,
        analysisResult: 1,
      },
    },
  );

  let total = 0;
  let needed = 0;
  let batch: Array<{
    callId: number;
    recordingId: number;
    analysisStatus?: string;
    analysisResult?: unknown;
  }> = [];

  for await (const doc of cursor) {
    total += 1;
    if (introductionScriptFromResult(doc.analysisResult) != null) continue;
    const utterances = (doc.analysisResult as { utterances?: unknown[] } | null)?.utterances ?? [];
    if (utterances.length === 0) continue;
    needed += 1;
    batch.push({
      callId: doc.callId,
      recordingId: doc.recordingId,
      analysisStatus: doc.analysisStatus,
      analysisResult: doc.analysisResult,
    });
    if (batch.length >= BATCH) {
      await fillMissingIntroductionScripts(batch);
      console.log(`Backfilled batch (${batch.length} recordings)…`);
      batch = [];
    }
  }

  if (batch.length > 0) {
    await fillMissingIntroductionScripts(batch);
    console.log(`Backfilled final batch (${batch.length} recordings).`);
  }

  const stillMissing = await collection.countDocuments({
    analysisStatus: "completed",
    $or: [
      { "analysisResult.introduction_script": { $exists: false } },
      { "analysisResult.introduction_script.score": { $exists: false } },
    ],
  });

  console.log(
    JSON.stringify(
      {
        completedScanned: total,
        candidatesWithUtterances: needed,
        stillMissingIntroInMongo: stillMissing,
      },
      null,
      2,
    ),
  );
}

main()
  .then(() => closeMongo())
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
