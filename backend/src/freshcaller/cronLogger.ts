import { randomUUID } from "node:crypto";
import {
  cronJobLogsCollection,
  type CronJobLogDocument,
  type CronLogLevel,
  type CronLogPhase,
} from "../db/syncCollections.js";
import { dualWriteCronLog } from "../db/postgres/dualWrite.js";

export type CronRunContext = {
  runId: string;
  callDate: string;
  trigger: CronJobLogDocument["trigger"];
  exportJobId?: number | null;
};

export function createRunId(): string {
  return randomUUID();
}

export async function appendCronLog(
  ctx: CronRunContext,
  level: CronLogLevel,
  phase: CronLogPhase,
  message: string,
  meta?: Record<string, unknown>,
): Promise<void> {
  const doc: CronJobLogDocument = {
    runId: ctx.runId,
    exportJobId: ctx.exportJobId ?? null,
    callDate: ctx.callDate,
    trigger: ctx.trigger,
    level,
    phase,
    message,
    meta,
    createdAt: new Date(),
  };
  await cronJobLogsCollection().insertOne(doc);
  await dualWriteCronLog(doc);
  const prefix = `[cron:${ctx.callDate}/${ctx.runId.slice(0, 8)}]`;
  const line = `${prefix} [${level}] ${phase}: ${message}`;
  if (level === "error") console.error(line, meta ?? "");
  else if (level === "warn") console.warn(line, meta ?? "");
  else console.log(line, meta ?? "");
}

export function withExportJobId(ctx: CronRunContext, exportJobId: number): CronRunContext {
  return { ...ctx, exportJobId };
}
