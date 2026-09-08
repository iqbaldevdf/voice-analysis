import { spawn } from "node:child_process";

function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new Error(`${command} exited with code ${code}: ${stderr || stdout}`));
    });
  });
}

async function probeDuration(filePath) {
  const { stdout } = await runCommand("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    filePath,
  ]);
  const value = Number.parseFloat(stdout.trim());
  if (!Number.isFinite(value)) {
    throw new Error(`Unable to probe duration for ${filePath}`);
  }
  return value;
}

export default async function normalizeAudio(task) {
  await runCommand("ffmpeg", [
    "-y",
    "-i",
    task.inputPath,
    "-ac",
    "1",
    "-ar",
    "16000",
    "-c:a",
    "pcm_s16le",
    task.outputPath,
  ]);

  const durationSec = await probeDuration(task.outputPath);

  return {
    outputPath: task.outputPath,
    durationSec,
    sampleRate: 16000,
    channels: 1,
  };
}
