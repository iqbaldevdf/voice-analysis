/**
 * Export speaker/start/end only (no transcript text) for POC sample selection.
 */
import fs from "fs";
import path from "path";
import { MongoClient } from "mongodb";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(__dirname, "../../backend");
const outDir = path.resolve(__dirname, "poc_data");
const wavDir = path.resolve(backendRoot, "data/fc-recordings");

async function main() {
  // Load backend .env if present
  const envPath = path.join(backendRoot, ".env");
  if (fs.existsSync(envPath)) {
    const text = fs.readFileSync(envPath, "utf8");
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
    }
  }

  const uri = process.env.MONGODB_URI || process.env.MONGO_URI || "mongodb://127.0.0.1:27017";
  const dbn = process.env.MONGODB_DB || process.env.MONGO_DB || "voice_analysis";
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(dbn);
  console.log(
    "collections",
    (await db.listCollections().toArray()).map((x) => x.name),
  );

  const recs = db.collection("recordings");
  const docs = await recs
    .find({ "analysis.utterances.0": { $exists: true } })
    .project({
      callId: 1,
      recordingId: 1,
      "analysis.utterances.speaker": 1,
      "analysis.utterances.start": 1,
      "analysis.utterances.end": 1,
      "analysis.durationSec": 1,
      "analysis.duration_sec": 1,
    })
    .limit(80)
    .toArray();

  console.log("candidates", docs.length);
  fs.mkdirSync(outDir, { recursive: true });
  const wavFiles = fs.existsSync(wavDir) ? fs.readdirSync(wavDir) : [];
  let written = 0;

  for (const d of docs) {
    const utts = (d as any).analysis?.utterances || [];
    if (utts.length < 6) continue;
    const speakers = new Set(utts.map((u: any) => u.speaker));
    if (speakers.size < 2) continue;
    const callId = String((d as any).callId ?? "");
    const rid = String((d as any).recordingId ?? "");
    const files = wavFiles.filter((f) => (callId && f.includes(callId)) || (rid && f.includes(rid)));
    if (!files.length) continue;
    const slim = utts.map((u: any) => ({
      speaker: u.speaker,
      start: u.start,
      end: u.end,
      text: "",
    }));
    const name = path.basename(files[0], ".wav") + ".utterances.json";
    fs.writeFileSync(path.join(outDir, name), JSON.stringify(slim, null, 2));
    console.log(
      "wrote",
      name,
      "utts",
      slim.length,
      "dur",
      (d as any).analysis?.durationSec ?? (d as any).analysis?.duration_sec,
    );
    written++;
    if (written >= 10) break;
  }
  console.log("written", written);
  await client.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
