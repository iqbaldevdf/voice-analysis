import "dotenv/config";
import { closeMongo, connectMongo } from "../src/db/mongo.js";
import { analyzeRecordingOnce } from "../src/services/analyzeRecording.js";

function parseArgs(argv: string[]) {
  const positional: string[] = [];
  let remapOnly = false;
  let swapSpeakers = false;
  let force = false;
  let agentSpeaker: string | undefined;
  let customerSpeaker: string | undefined;
  let correctionReason: string | undefined;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--remap-only") remapOnly = true;
    else if (arg === "--swap-speakers") swapSpeakers = true;
    else if (arg === "--force") force = true;
    else if (arg === "--agent-speaker") agentSpeaker = argv[++i];
    else if (arg === "--customer-speaker") customerSpeaker = argv[++i];
    else if (arg === "--reason") correctionReason = argv[++i];
    else if (!arg.startsWith("--")) positional.push(arg);
  }

  const speakerOverride =
    agentSpeaker && customerSpeaker
      ? { [agentSpeaker]: "agent", [customerSpeaker]: "customer" }
      : undefined;

  return {
    callId: Number(positional[0]),
    recordingId: Number(positional[1]),
    remapOnly,
    swapSpeakers,
    force: force || remapOnly,
    speakerOverride,
    correctionReason,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.callId || !args.recordingId) {
    console.error(
      "Usage: npx tsx scripts/reanalyze-recording.ts <callId> <recordingId> [--force] [--remap-only] [--swap-speakers] [--agent-speaker A] [--customer-speaker B] [--reason text]",
    );
    process.exit(1);
  }

  await connectMongo();
  const { recording, reused } = await analyzeRecordingOnce(args.callId, args.recordingId, {
    force: args.force,
    remapOnly: args.remapOnly,
    swapSpeakers: args.swapSpeakers,
    speakerOverride: args.speakerOverride,
    correctionReason: args.correctionReason,
  });
  const mapping = (recording.analysisResult as { speaker_mapping?: unknown } | undefined)?.speaker_mapping;
  console.log(
    JSON.stringify(
      {
        callId: args.callId,
        recordingId: args.recordingId,
        reused,
        remapOnly: args.remapOnly,
        swapSpeakers: args.swapSpeakers,
        speaker_mapping: mapping,
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
