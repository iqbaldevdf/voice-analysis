import "dotenv/config";
import { closeMongo, connectMongo, recordingsCollection } from "../src/db/mongo.js";

const callId = Number(process.argv[2]);
const recordingId = Number(process.argv[3]);

async function main() {
  if (!callId || !recordingId) {
    console.error("Usage: npx tsx scripts/inspect-recording.ts <callId> <recordingId>");
    process.exit(1);
  }

  await connectMongo();
  const doc = await recordingsCollection().findOne({ callId, recordingId });
  if (!doc) {
    console.error("Not found");
    process.exit(1);
  }

  const result = doc.analysisResult as Record<string, unknown> | undefined;
  const utterances = (result?.utterances as Array<Record<string, unknown>>) ?? [];
  const mapping = result?.speaker_mapping as Record<string, unknown> | undefined;
  const metrics = (result?.speaker_metrics as Array<Record<string, unknown>>) ?? [];

  console.log(
    JSON.stringify(
      {
        direction: doc.direction,
        agentName: doc.agentName,
        participants: doc.participants,
        analysisStatus: doc.analysisStatus,
        speaker_mapping: mapping ?? null,
        has_speaker_mapping: Boolean(mapping),
        speaker_metrics: metrics,
        utterances_preview: utterances.slice(0, 12).map((u) => ({
          speaker: u.speaker,
          start: u.start,
          end: u.end,
          text: String(u.text).slice(0, 120),
        })),
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
