import fs from "node:fs/promises";
import path from "node:path";
import { FreshcallerClient, summarizeCall } from "./client.js";
import { exportStore } from "./exportStore.js";
import type { FreshcallerCall } from "./types.js";
import { extractCallsJsonFromZip } from "./zipCalls.js";

const POLL_INTERVAL_MS = Number(process.env.FRESHCALLER_POLL_INTERVAL_MS ?? 4000);
const MAX_POLL_ATTEMPTS = Number(process.env.FRESHCALLER_MAX_POLL_ATTEMPTS ?? 90);

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runExportSync(jobId: number, exportsDir: string): Promise<void> {
  const client = new FreshcallerClient();

  try {
    let downloadUrl: string | undefined;

    for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt += 1) {
      const status = await client.getJob(jobId);
      const bulk = status.bulk_job;
      const remoteStatus = String(bulk.status || "").toLowerCase();

      exportStore.updateExport(jobId, {
        status: remoteStatus === "completed" ? "completed" : (remoteStatus as "started" | "in_progress"),
        downloadPath: bulk.job_data?.path,
      });

      if (remoteStatus === "completed" && bulk.job_data?.path) {
        downloadUrl = bulk.job_data.path;
        break;
      }

      if (remoteStatus === "failed" || remoteStatus === "error") {
        throw new Error(`Freshcaller export job ${jobId} failed with status: ${bulk.status}`);
      }

      await sleep(POLL_INTERVAL_MS);
    }

    if (!downloadUrl) {
      throw new Error(`Freshcaller export job ${jobId} timed out waiting for completion`);
    }

    exportStore.updateExport(jobId, { status: "downloading" });
    await fs.mkdir(exportsDir, { recursive: true });

    const zipBuffer = await client.downloadZip(downloadUrl);
    const zipPath = path.join(exportsDir, `export_${jobId}.zip`);
    await fs.writeFile(zipPath, zipBuffer);

    exportStore.updateExport(jobId, { status: "indexing" });

    const extracted = extractCallsJsonFromZip(zipBuffer);
    const parsed = JSON.parse(extracted.rawText) as { calls?: Record<string, unknown>[] };
    const rawCalls = Array.isArray(parsed.calls) ? parsed.calls : [];

    const summarized: FreshcallerCall[] = rawCalls.map((item) => summarizeCall(item));
    exportStore.clearCalls();
    exportStore.setCalls(summarized);

    const withRecording = summarized.filter((c) => c.recording != null).length;

    exportStore.updateExport(jobId, {
      status: "completed",
      callCount: summarized.length,
      callsWithRecording: withRecording,
      downloadPath: downloadUrl,
      message: extracted.empty
        ? "Export ZIP was empty (no calls for date range)"
        : `Indexed ${summarized.length} calls (${withRecording} with recordings)`,
    });  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    try {
      exportStore.updateExport(jobId, { status: "failed", error: message });
    } catch {
      // ignore missing job
    }
  }
}
