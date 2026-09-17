import "dotenv/config";
import { closeMongo, connectMongo, recordingsCollection } from "../src/db/mongo.js";
import { confirmTranscriptOnce } from "../src/services/analyzeRecording.js";

const date = "2026-09-03";

async function main() {
  await connectMongo();
  const pending = await recordingsCollection()
    .find({ callDate: date, analysisStatus: "awaiting_transcript_review" })
    .toArray();
  for (const doc of pending) {
    try {
      const { recording } = await confirmTranscriptOnce(Number(doc.callId), Number(doc.recordingId), {
        chosenSource: "assemblyai",
      });
      const sv = (recording.analysisResult as { speaker_validation?: { status?: string; corrections_count?: number } })
        ?.speaker_validation;
      console.log(
        JSON.stringify({
          callId: doc.callId,
          status: recording.analysisStatus,
          sv: sv?.status,
          corrections: sv?.corrections_count ?? null,
        }),
      );
    } catch (err) {
      console.log(JSON.stringify({ callId: doc.callId, error: String(err) }));
    }
  }

  const docs = await recordingsCollection()
    .find({ callDate: date, localPath: { $ne: null }, isVoicemail: { $ne: true } })
    .toArray();
  const byStatus: Record<string, number> = {};
  let ecapa = 0;
  let corr = 0;
  let islands = 0;
  let boundary = 0;
  let uncertain = 0;
  for (const d of docs) {
    byStatus[d.analysisStatus] = (byStatus[d.analysisStatus] || 0) + 1;
    const sv = (d.analysisResult as { speaker_validation?: Record<string, unknown> } | undefined)
      ?.speaker_validation;
    if (sv?.status === "completed") {
      ecapa += 1;
      corr += Number(sv.corrections_count || 0);
      islands += Number(sv.islands_checked || 0);
      boundary += Number(sv.boundary_corrections || 0);
      uncertain += Number(sv.uncertain_regions_count || 0);
    }
  }
  console.log(
    JSON.stringify(
      {
        totalConnects: docs.length,
        byStatus,
        ecapaCompleted: ecapa,
        totalCorrections: corr,
        totalIslandsChecked: islands,
        totalBoundaryCorrections: boundary,
        totalUncertain: uncertain,
      },
      null,
      2,
    ),
  );
  await closeMongo();
}

main().catch(async (e) => {
  console.error(e);
  await closeMongo().catch(() => undefined);
  process.exit(1);
});
