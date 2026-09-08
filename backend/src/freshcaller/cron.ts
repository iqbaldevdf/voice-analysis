import cron from "node-cron";
import { exportJobsCollection } from "../db/syncCollections.js";
import { appendCronLog, createRunId } from "./cronLogger.js";
import { nextDailyRunIso, previousIstCallDate } from "./dateUtils.js";
import { isDailySyncRunning, runDailySync } from "./dailySyncPipeline.js";

const CATCHUP_INTERVAL_MS = 15 * 60 * 1000;
const IN_FLIGHT = new Set([
  "started",
  "in_progress",
  "downloading",
  "indexing",
  "downloading_audio",
]);

let task: cron.ScheduledTask | null = null;
let catchupTimer: ReturnType<typeof setInterval> | null = null;
let lastTickAt: string | null = null;
let lastTickError: string | null = null;
let lastHeartbeatAt: string | null = null;
let schedulerNote: string | null = null;

export function isCronEnabled(): boolean {
  const flag = String(process.env.FRESHCALLER_CRON_ENABLED ?? "true").toLowerCase();
  if (flag === "false" || flag === "0" || flag === "off") return false;
  const auth = (process.env.FRESHCALLER_API_AUTH ?? "").trim();
  if (!auth || auth === "changeme") return false;
  const base = (process.env.FRESHCALLER_BASE_URL ?? "").trim();
  return Boolean(base);
}

export function getCronConfig() {
  return {
    enabled: isCronEnabled(),
    expression: process.env.FRESHCALLER_CRON_EXPR ?? "0 1 * * *",
    timezone: process.env.FRESHCALLER_CRON_TZ ?? "Asia/Kolkata",
  };
}

export function getCronRuntime() {
  const cfg = getCronConfig();
  return {
    ...cfg,
    scheduled: Boolean(task),
    lastTickAt,
    lastTickError,
    lastHeartbeatAt,
    nextRunAt: nextDailyRunIso(),
    note: schedulerNote,
  };
}

async function writeSchedulerLog(
  level: "info" | "warn" | "error",
  message: string,
  meta?: Record<string, unknown>,
): Promise<void> {
  const callDate = previousIstCallDate();
  await appendCronLog(
    { runId: createRunId(), callDate, trigger: "cron" },
    level,
    "scheduler",
    message,
    meta,
  );
}

async function catchUpMissedCron(reason: "startup" | "interval" | "schedule"): Promise<void> {
  if (!isCronEnabled()) {
    schedulerNote = "Cron disabled";
    return;
  }

  lastHeartbeatAt = new Date().toISOString();
  const callDate = previousIstCallDate();

  if (isDailySyncRunning()) {
    schedulerNote = "Sync already running";
    return;
  }

  const existing = await exportJobsCollection().findOne({ callDate });
  if (existing?.status === "completed") {
    schedulerNote = `Previous day ${callDate} already synced. Next run ${nextDailyRunIso()}`;
    if (reason === "startup") {
      await writeSchedulerLog("info", schedulerNote, {
        reason,
        callDate,
        existingTrigger: existing.trigger,
        nextRunAt: nextDailyRunIso(),
      });
    }
    return;
  }

  if (existing && IN_FLIGHT.has(existing.status)) {
    schedulerNote = `Sync for ${callDate} is already in progress`;
    return;
  }

  if (existing?.status === "failed" && reason === "interval") {
    schedulerNote = `Cron for ${callDate} failed: ${existing.error ?? "unknown error"}`;
    lastTickError = existing.error ?? "failed";
    return;
  }

  schedulerNote = `Starting missed daily sync for ${callDate} (${reason})`;
  lastTickAt = new Date().toISOString();
  lastTickError = null;
  console.log(`[freshcaller-cron] ${schedulerNote}`);
  await writeSchedulerLog("info", schedulerNote, { reason, callDate });

  try {
    await runDailySync({ callDate, trigger: "cron", force: false });
    schedulerNote = `Cron sync finished for ${callDate}`;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    lastTickError = message;
    schedulerNote = message;
    console.error("[freshcaller-cron] failed:", message);
  }
}

export function startFreshcallerCron(): void {
  if (task) return;
  const cfg = getCronConfig();
  if (!cfg.enabled) {
    schedulerNote = "Cron disabled (set FRESHCALLER_CRON_ENABLED=true and API auth)";
    console.log("[freshcaller-cron] disabled (set FRESHCALLER_CRON_ENABLED=true and API auth)");
    return;
  }
  if (!cron.validate(cfg.expression)) {
    schedulerNote = `Invalid cron expression: ${cfg.expression}`;
    console.error(`[freshcaller-cron] invalid expression: ${cfg.expression}`);
    return;
  }

  task = cron.schedule(
    cfg.expression,
    () => {
      void catchUpMissedCron("schedule");
    },
    { timezone: cfg.timezone, scheduled: true },
  );

  if (catchupTimer) clearInterval(catchupTimer);
  catchupTimer = setInterval(() => {
    void catchUpMissedCron("interval").catch((err) => {
      console.error("[freshcaller-cron] catch-up failed:", err instanceof Error ? err.message : err);
    });
  }, CATCHUP_INTERVAL_MS);

  const nextRunAt = nextDailyRunIso();
  schedulerNote = `Scheduled ${cfg.expression} ${cfg.timezone}. Next run ${nextRunAt}`;
  console.log(`[freshcaller-cron] scheduled "${cfg.expression}" tz=${cfg.timezone} next=${nextRunAt}`);

  // node-cron does not replay a missed 01:00 tick after sleep or a late start.
  void catchUpMissedCron("startup").catch((err) => {
    console.error("[freshcaller-cron] startup catch-up failed:", err instanceof Error ? err.message : err);
  });
}

export function stopFreshcallerCron(): void {
  task?.stop();
  task = null;
  if (catchupTimer) {
    clearInterval(catchupTimer);
    catchupTimer = null;
  }
}
