/**
 * Auto-confirm pending dual-STT reviews for a callDate (test/dev).
 * Usage: npx tsx scripts/finalize-pending-date.ts --date 2026-09-03 [--source assemblyai]
 */
import "dotenv/config";
import { closeMongo, connectMongo, recordingsCollection } from "../src/db/mongo.js";
import { analyzeRecordingOnce, confirmTranscriptOnce } from "../src/services/analyzeRecording.js";

function parseArgs(argv: string[]) {
  let date = "";
  let source: "assemblyai" | "whisper" = "assemblyai";
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--date") date = argv[++i];
    else if (argv[i] === "--source") source = argv[++i] as "assemblyai" | "whisper";
  }
  return { date, source };
}

async function main() {
  const { date, source } = parseArgs(process.argv.slice(2));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    console.error("Usage: npx tsx scripts/finalize-pending-date.ts --date YYYY-MM-DD");
    process.exit(1);
  }
  await connectMongo();

  const pending = await recordingsCollection()
    .find({ callDate: date, analysisStatus: "awaiting_transcript_review" })
    .project({ callId: 1, recordingId: 1 })
    .toArray();
  const failed = await recordingsCollection()
    .find({ callDate: date, analysisStatus: { $in: ["failed", "none"] }, localPath: { $ne: null } })
    .project({ callId: 1, recordingId: 1, analysisStatus: 1 })
    .toArray();

  console.log(JSON.stringify({ pending: pending.length, retry: failed.length, source }, null, 2));

  for (const doc of pending) {
    const callId = Number(doc.callId);
    const recordingId = Number(doc.recordingId);
    const t0 = Date.now();
    try {
      const { recording } = await confirmTranscriptOnce(callId, recordingId, { chosenSource: source });
      const sv = (recording.analysisResult as { speaker_validation?: Record<string, unknown> } | undefined)
        ?.speaker_validation;
      console.log(
        JSON.stringify({
          action: "finalize",
          callId,
          recordingId,
          analysisStatus: recording.analysisStatus,
          ms: Date.now() - t0,
          speaker_validation: sv
            ? {
                status: sv.status,
                method: sv.method,
                corrections_count: sv.corrections_count,
                islands_checked: sv.islands_checked,
                boundary_corrections: sv.boundary_corrections,
              }
            : null,
        }),
      );
    } catch (err) {
      console.log(
        JSON.stringify({
          action: "finalize",
          callId,
          recordingId,
          failed: true,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  }

  for (const doc of failed) {
    const callId = Number(doc.callId);
    const recordingId = Number(doc.recordingId);
    const t0 = Date.now();
    try {
      const { recording } = await analyzeRecordingOnce(callId, recordingId, { force: true });
      const sv = (recording.analysisResult as { speaker_validation?: Record<string, unknown> } | undefined)
        ?.speaker_validation;
      console.log(
        JSON.stringify({
          action: "retry",
          callId,
          recordingId,
          analysisStatus: recording.analysisStatus,
          ms: Date.now() - t0,
          speaker_validation: sv
            ? { status: sv.status, method: sv.method, corrections_count: sv.corrections_count }
            : null,
        }),
      );
    } catch (err) {
      console.log(
        JSON.stringify({
          action: "retry",
          callId,
          recordingId,
          failed: true,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  }

  const counts = await recordingsCollection()
    .aggregate([
      { $match: { callDate: date, localPath: { $ne: null }, isVoicemail: { $ne: true } } },
      { $group: { _id: "$analysisStatus", n: { $sum: 1 } } },
    ])
    .toArray();
  console.log(JSON.stringify({ statusCounts: counts }, null, 2));
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
