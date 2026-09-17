/**
 * Analyze all synced recordings for a callDate (developer/test).
 * Usage: npx tsx scripts/analyze-call-date.ts --date 2026-09-03 [--limit 5] [--force]
 */
import "dotenv/config";
import { closeMongo, connectMongo, recordingsCollection } from "../src/db/mongo.js";
import { analyzeRecordingOnce } from "../src/services/analyzeRecording.js";

function parseArgs(argv: string[]) {
  let date = "";
  let limit = 0;
  let force = false;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--date") date = argv[++i];
    else if (argv[i] === "--limit") limit = Number(argv[++i]) || 0;
    else if (argv[i] === "--force") force = true;
  }
  return { date, limit, force };
}

async function main() {
  const { date, limit, force } = parseArgs(process.argv.slice(2));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    console.error("Usage: npx tsx scripts/analyze-call-date.ts --date YYYY-MM-DD [--limit N] [--force]");
    process.exit(1);
  }

  await connectMongo();
  const filter: Record<string, unknown> = {
    callDate: date,
    localPath: { $exists: true, $ne: null },
    isVoicemail: { $ne: true },
  };
  let docs = await recordingsCollection()
    .find(filter)
    .project({ callId: 1, recordingId: 1, analysisStatus: 1, durationSec: 1 })
    .sort({ createdTime: 1 })
    .toArray();
  if (limit > 0) docs = docs.slice(0, limit);

  console.log(JSON.stringify({ date, candidates: docs.length, force }, null, 2));

  const results: Array<Record<string, unknown>> = [];
  for (const doc of docs) {
    const callId = Number(doc.callId);
    const recordingId = Number(doc.recordingId);
    const started = Date.now();
    try {
      const { recording, reused } = await analyzeRecordingOnce(callId, recordingId, { force });
      const sv = (recording.analysisResult as { speaker_validation?: Record<string, unknown> } | undefined)
        ?.speaker_validation;
      const row = {
        callId,
        recordingId,
        reused,
        analysisStatus: recording.analysisStatus,
        ms: Date.now() - started,
        speaker_validation: sv
          ? {
              enabled: sv.enabled,
              status: sv.status,
              method: sv.method,
              corrections_count: sv.corrections_count,
              islands_checked: sv.islands_checked,
              boundary_corrections: sv.boundary_corrections,
              uncertain_regions_count: sv.uncertain_regions_count,
              profile_status: sv.profile_status,
              profile_separation: sv.profile_separation,
            }
          : null,
        error: recording.analysisError ?? null,
      };
      console.log(JSON.stringify(row));
      results.push(row);
    } catch (err) {
      const row = {
        callId,
        recordingId,
        failed: true,
        ms: Date.now() - started,
        error: err instanceof Error ? err.message : String(err),
      };
      console.log(JSON.stringify(row));
      results.push(row);
    }
  }

  const completed = results.filter((r) => r.analysisStatus === "completed").length;
  const failed = results.filter((r) => r.failed || r.analysisStatus === "failed").length;
  const ecapa = results.filter(
    (r) => (r.speaker_validation as { status?: string } | null)?.status === "completed",
  ).length;
  console.log(JSON.stringify({ summary: { total: results.length, completed, failed, ecapaCompleted: ecapa } }, null, 2));
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
