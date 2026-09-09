import { spawn } from "node:child_process";
import { writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import { MongoClient } from "mongodb";

const python = "C:\\va-ai\\Scripts\\python.exe";
const script = path.resolve("../ai-service/scripts/score_payload.py");
const client = new MongoClient("mongodb://127.0.0.1:27017/voice_analysis");
await client.connect();
const recordings = client.db().collection("recordings");
const docs = await recordings
  .find({
    analysisStatus: "completed",
    "analysisResult.participant_performance": {
      $elemMatch: { participantRole: "agent", overallScore: null },
    },
  })
  .project({
    callId: 1,
    recordingId: 1,
    direction: 1,
    callNotes: 1,
    participants: 1,
    analysisResult: 1,
  })
  .toArray();

function roleHints(result) {
  return Object.fromEntries(
    (result?.speaker_metrics ?? [])
      .filter((item) => item.speaker && item.role_guess)
      .map((item) => [item.speaker, item.role_guess]),
  );
}

for (const doc of docs) {
  const payloadPath = path.resolve(`./data/rescore-${doc.callId}.json`);
  const payload = {
    utterances: doc.analysisResult?.utterances ?? [],
    role_hints: roleHints(doc.analysisResult),
    participants: doc.participants ?? [],
    direction: doc.direction ?? null,
    call_notes: doc.callNotes ?? null,
  };
  await writeFile(payloadPath, JSON.stringify(payload), "utf8");
  const scored = await new Promise((resolve, reject) => {
    const child = spawn(python, [script, payloadPath], { cwd: path.resolve("../ai-service") });
    let out = "";
    let err = "";
    child.stdout.on("data", (chunk) => {
      out += chunk;
    });
    child.stderr.on("data", (chunk) => {
      err += chunk;
    });
    child.on("close", (code) => {
      if (code !== 0) reject(new Error(err || `score failed for ${doc.callId}`));
      else resolve(out);
    });
  });
  await unlink(payloadPath);
  const rows = JSON.parse(scored);
  const agent = rows.find((item) => String(item.participantRole).toLowerCase() === "agent");
  if (typeof agent?.overallScore !== "number") {
    console.log(`call ${doc.callId}: still missing`, agent?.note ?? "");
    continue;
  }
  await recordings.updateOne(
    { callId: doc.callId, recordingId: doc.recordingId },
    {
      $set: {
        "analysisResult.participant_performance": rowsFrom(doc.analysisResult, rows),
        updatedAt: new Date(),
      },
    },
  );
  console.log(`call ${doc.callId}: performance ${agent.overallScore}`);
}

function rowsFrom(result, rows) {
  return rows;
}

await client.close();
