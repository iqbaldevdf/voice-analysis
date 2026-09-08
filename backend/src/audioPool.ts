import path from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";
import Piscina from "piscina";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const cpuCount = typeof os.availableParallelism === "function" ? os.availableParallelism() : os.cpus().length;

const maxThreads = Math.max(
  1,
  Math.min(Number(process.env.FFMPEG_CONCURRENCY ?? 2), Math.max(1, cpuCount - 1))
);

const pool = new Piscina({
  filename: path.join(__dirname, "workers", "normalizeAudio.mjs"),
  maxThreads,
  idleTimeout: 30_000,
});

export async function normalizeInWorker(task: {
  inputPath: string;
  outputPath: string;
}): Promise<{
  outputPath: string;
  durationSec: number;
  sampleRate: number;
  channels: number;
}> {
  return pool.run(task);
}

export function getWorkerPoolStats() {
  return {
    maxThreads,
    completed: pool.completed,
    queueSize: pool.queueSize,
    utilization: pool.utilization,
  };
}
