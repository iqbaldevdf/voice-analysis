/**
 * Export speaker/start/end only (no transcript text) for POC sample selection.
 * Run from backend/: npx tsx scripts/export_poc_timings.ts
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { MongoClient } from "mongodb";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(__dirname, "..");
const outDir = path.resolve(backendRoot, "../ai-service/scripts/poc_data");
const wavDir = path.resolve(backendRoot, "data/fc-recordings");

function loadEnv() {
  const envPath = path.join(backendRoot, ".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
  }
}

type Utt = { speaker?: string; start?: number; end?: number };

async function main() {
  loadEnv();
  const uri = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/voice_analysis";
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db();
  const recs = db.collection("recordings");

  const sample = await recs.findOne({ analysisStatus: "completed" });
  console.log("sample keys", sample ? Object.keys(sample) : null);
  if (sample?.analysisResult && typeof sample.analysisResult === "object") {
    console.log("analysisResult keys", Object.keys(sample.analysisResult as object).slice(0, 40));
  }

  const docs = await recs
    .find({ analysisStatus: "completed", "analysisResult.utterances.0": { $exists: true } })
    .project({
      callId: 1,
      recordingId: 1,
      "analysisResult.utterances.speaker": 1,
      "analysisResult.utterances.start": 1,
      "analysisResult.utterances.end": 1,
      "analysisResult.duration_sec": 1,
      "analysisResult.durationSec": 1,
    })
    .limit(80)
    .toArray();

  console.log("candidates", docs.length);
  fs.mkdirSync(outDir, { recursive: true });
  const wavFiles = fs.existsSync(wavDir) ? fs.readdirSync(wavDir) : [];
  let written = 0;

  for (const d of docs) {
    const result = d.analysisResult as { utterances?: Utt[]; duration_sec?: number; durationSec?: number } | undefined;
    const utts = result?.utterances || [];
    if (utts.length < 6) continue;
    const speakers = new Set(utts.map((u) => u.speaker).filter(Boolean));
    if (speakers.size < 2) continue;
    const callId = String(d.callId ?? "");
    const rid = String(d.recordingId ?? "");
    const files = wavFiles.filter((f) => (callId && f.includes(callId)) || (rid && f.includes(rid)));
    if (!files.length) continue;
    const slim = utts.map((u) => ({
      speaker: u.speaker,
      start: u.start,
      end: u.end,
      text: "",
    }));
    const name = `${path.basename(files[0], ".wav")}.utterances.json`;
    // Do not overwrite the curated known-failure fixture that includes text.
    const outPath = path.join(outDir, name);
    if (fs.existsSync(outPath) && name.includes("9002261")) {
      console.log("skip existing curated", name);
      continue;
    }
    fs.writeFileSync(outPath, JSON.stringify(slim, null, 2));
    console.log("wrote", name, "utts", slim.length, "dur", result?.duration_sec ?? result?.durationSec);
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
