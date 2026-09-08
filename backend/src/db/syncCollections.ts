import { type Collection } from "mongodb";
import { getDb } from "./mongo.js";

export type ExportJobPhase =
  | "queued"
  | "export"
  | "poll"
  | "zip"
  | "index"
  | "download"
  | "complete"
  | "failed";

export type ExportJobDocStatus =
  | "started"
  | "in_progress"
  | "downloading"
  | "indexing"
  | "downloading_audio"
  | "completed"
  | "failed"
  | "skipped";

export type ExportJobDocument = {
  jobId: number | null;
  runId: string;
  callDate: string;
  startDate: string;
  endDate: string;
  status: ExportJobDocStatus;
  phase: ExportJobPhase;
  phaseMessage?: string | null;
  trigger: "cron" | "manual" | "cli";
  downloadPath?: string | null;
  callCount: number;
  callsWithRecording: number;
  voicemailSkipped: number;
  audioDownloaded: number;
  audioFailed: number;
  callsIndexed: number;
  error?: string | null;
  startedAt: Date;
  finishedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type CronLogLevel = "info" | "warn" | "error";

export type CronLogPhase =
  | "scheduler"
  | "export"
  | "poll"
  | "zip"
  | "index"
  | "download"
  | "complete"
  | "failed";

export type CronJobLogDocument = {
  runId: string;
  exportJobId?: number | null;
  callDate: string;
  trigger: "cron" | "manual" | "cli";
  level: CronLogLevel;
  phase: CronLogPhase;
  message: string;
  meta?: Record<string, unknown>;
  createdAt: Date;
};

export function exportJobsCollection(): Collection<ExportJobDocument> {
  return getDb().collection<ExportJobDocument>("export_jobs");
}

export function cronJobLogsCollection(): Collection<CronJobLogDocument> {
  return getDb().collection<CronJobLogDocument>("cron_job_logs");
}

export async function ensureSyncCollections(): Promise<void> {
  const exportJobs = exportJobsCollection();
  await exportJobs.createIndex({ callDate: 1 }, { unique: true });
  await exportJobs.createIndex({ jobId: 1 });
  await exportJobs.createIndex({ runId: 1 }, { unique: true });
  await exportJobs.createIndex({ startedAt: -1 });

  const logs = cronJobLogsCollection();
  await logs.createIndex({ runId: 1, createdAt: 1 });
  await logs.createIndex({ callDate: -1, createdAt: -1 });
  await logs.createIndex({ level: 1, createdAt: -1 });

  const ttlDays = Number(process.env.CRON_LOG_TTL_DAYS ?? 90);
  if (Number.isFinite(ttlDays) && ttlDays > 0) {
    await logs.createIndex(
      { createdAt: 1 },
      { expireAfterSeconds: Math.floor(ttlDays * 24 * 60 * 60), name: "cron_logs_ttl" },
    );
  }
}
