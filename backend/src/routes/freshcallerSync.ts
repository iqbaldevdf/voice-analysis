import { Router } from "express";
import {
  cronJobLogsCollection,
  exportJobsCollection,
  type ExportJobDocument,
} from "../db/syncCollections.js";
import { getCronRuntime, isCronEnabled } from "../freshcaller/cron.js";
import { activeSyncCallDate, isDailySyncRunning, runDailySync } from "../freshcaller/dailySyncPipeline.js";
import { previousIstCallDate } from "../freshcaller/dateUtils.js";
import {
  pgCronLogsForRun,
  pgFindExportJob,
  pgLatestExportJob,
  pgListCronLogs,
  pgListCronRuns,
  pgListExportJobs,
  postgresReadsEnabled,
} from "../db/postgres/reads.js";

function serializeJob(doc: ExportJobDocument) {
  return {
    ...doc,
    startedAt: doc.startedAt?.toISOString?.() ?? doc.startedAt,
    finishedAt: doc.finishedAt?.toISOString?.() ?? doc.finishedAt ?? null,
    createdAt: doc.createdAt?.toISOString?.() ?? doc.createdAt,
    updatedAt: doc.updatedAt?.toISOString?.() ?? doc.updatedAt,
  };
}

export function createFreshcallerSyncRouter(): Router {
  const router = Router();

  router.get("/status", async (_req, res) => {
    try {
      const cfg = getCronRuntime();
      let last: ExportJobDocument | null = null;
      let lastCron: ExportJobDocument | null = null;
      let source: "postgres" | "mongo" = "mongo";

      if (postgresReadsEnabled()) {
        try {
          last = await pgLatestExportJob();
          lastCron = await pgLatestExportJob("cron");
          if (last || lastCron) source = "postgres";
        } catch (error) {
          console.warn(
            "[postgres read] sync status fallback to mongo:",
            error instanceof Error ? error.message : error,
          );
        }
      }
      if (source === "mongo") {
        last = await exportJobsCollection().find().sort({ startedAt: -1 }).limit(1).next();
        lastCron = await exportJobsCollection()
          .find({ trigger: "cron" })
          .sort({ startedAt: -1 })
          .limit(1)
          .next();
      }

      res.json({
        cron: {
          enabled: isCronEnabled(),
          scheduled: cfg.scheduled,
          expression: cfg.expression,
          timezone: cfg.timezone,
          nextRunAt: cfg.nextRunAt,
          lastTickAt: cfg.lastTickAt,
          lastTickError: cfg.lastTickError,
          lastHeartbeatAt: cfg.lastHeartbeatAt,
          note: cfg.note,
          nextHint: `Runs at ${cfg.expression} ${cfg.timezone} for the previous IST day. Missed nights are caught up on startup.`,
        },
        lastCronJob: lastCron ? serializeJob(lastCron) : null,
        running: isDailySyncRunning(),
        runningCallDate: activeSyncCallDate(),
        previousCallDate: previousIstCallDate(),
        lastJob: last ? serializeJob(last) : null,
        source,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: message });
    }
  });

  router.get("/jobs", async (req, res) => {
    try {
      const page = Math.max(1, Number(req.query.page ?? 1) || 1);
      const limit = Math.min(50, Math.max(1, Number(req.query.limit ?? 10) || 10));
      const skip = (page - 1) * limit;

      if (postgresReadsEnabled()) {
        try {
          const pg = await pgListExportJobs({ skip, limit });
          if (pg.total > 0 || (await pgListExportJobs({ skip: 0, limit: 1 })).total > 0) {
            res.json({
              jobs: pg.docs.map(serializeJob),
              total: pg.total,
              page,
              limit,
              totalPages: Math.max(1, Math.ceil(pg.total / limit)),
              source: "postgres",
            });
            return;
          }
        } catch (error) {
          console.warn(
            "[postgres read] export jobs fallback to mongo:",
            error instanceof Error ? error.message : error,
          );
        }
      }

      const collection = exportJobsCollection();
      const [total, docs] = await Promise.all([
        collection.countDocuments({}),
        collection.find({}).sort({ startedAt: -1 }).skip(skip).limit(limit).toArray(),
      ]);
      res.json({
        jobs: docs.map(serializeJob),
        total,
        page,
        limit,
        totalPages: Math.max(1, Math.ceil(total / limit)),
        source: "mongo",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: message });
    }
  });

  router.get("/jobs/:callDate", async (req, res) => {
    try {
      const callDate = String(req.params.callDate);
      let doc: ExportJobDocument | null = null;
      if (postgresReadsEnabled()) {
        try {
          doc = await pgFindExportJob(callDate);
        } catch (error) {
          console.warn(
            "[postgres read] export job fallback to mongo:",
            error instanceof Error ? error.message : error,
          );
        }
      }
      if (!doc) {
        doc = await exportJobsCollection().findOne({ callDate });
      }
      if (!doc) {
        res.status(404).json({ error: `No sync job for ${callDate}` });
        return;
      }
      res.json({ job: serializeJob(doc) });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: message });
    }
  });

  router.post("/daily", async (req, res) => {
    const date =
      typeof req.body?.date === "string" && req.body.date.trim()
        ? req.body.date.trim()
        : previousIstCallDate();
    const force = Boolean(req.body?.force);

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      res.status(400).json({ error: "date must be YYYY-MM-DD" });
      return;
    }

    try {
      const { enqueueDailySync } = await import("../freshcaller/dailySyncPipeline.js");
      const result = await enqueueDailySync({ callDate: date, force, trigger: "manual" });
      res.status(result.skipped ? 200 : 202).json(result);
    } catch (error) {
      const status = (error as { status?: number }).status ?? 500;
      const message = error instanceof Error ? error.message : String(error);
      res.status(status).json({ error: message });
    }
  });

  /** Await full pipeline completion (CLI / long-running clients). */
  router.post("/daily/wait", async (req, res) => {
    const date =
      typeof req.body?.date === "string" && req.body.date.trim()
        ? req.body.date.trim()
        : previousIstCallDate();
    const force = Boolean(req.body?.force);

    try {
      const result = await runDailySync({ callDate: date, force, trigger: "manual" });
      res.status(result.skipped ? 200 : 201).json(result);
    } catch (error) {
      const status = (error as { status?: number }).status ?? 500;
      const message = error instanceof Error ? error.message : String(error);
      const runId = (error as { runId?: string }).runId;
      const callDate = (error as { callDate?: string }).callDate;
      res.status(status).json({ error: message, runId, callDate });
    }
  });

  router.get("/logs", async (req, res) => {
    try {
      const page = Math.max(1, Number(req.query.page ?? 1) || 1);
      const limit = Math.min(200, Math.max(1, Number(req.query.limit ?? 50) || 50));
      const skip = (page - 1) * limit;
      const runId =
        typeof req.query.runId === "string" && req.query.runId.trim()
          ? req.query.runId.trim()
          : undefined;
      const callDate =
        typeof req.query.callDate === "string" && req.query.callDate.trim()
          ? req.query.callDate.trim()
          : undefined;
      const level =
        typeof req.query.level === "string" && req.query.level !== "all"
          ? req.query.level
          : undefined;
      const dateFrom =
        typeof req.query.dateFrom === "string" && req.query.dateFrom.trim()
          ? req.query.dateFrom.trim()
          : undefined;
      const dateTo =
        typeof req.query.dateTo === "string" && req.query.dateTo.trim()
          ? req.query.dateTo.trim()
          : undefined;

      if (postgresReadsEnabled()) {
        try {
          const pg = await pgListCronLogs({
            filter: { runId, callDate, level, dateFrom, dateTo },
            skip,
            limit,
          });
          if (pg.total > 0 || (await pgListCronLogs({ filter: {}, skip: 0, limit: 1 })).total > 0) {
            res.json({
              logs: pg.docs.map((d) => ({
                ...d,
                createdAt: d.createdAt?.toISOString?.() ?? d.createdAt,
              })),
              total: pg.total,
              page,
              limit,
              totalPages: Math.max(1, Math.ceil(pg.total / limit)),
              source: "postgres",
            });
            return;
          }
        } catch (error) {
          console.warn(
            "[postgres read] cron logs fallback to mongo:",
            error instanceof Error ? error.message : error,
          );
        }
      }

      const filter: Record<string, unknown> = {};
      if (runId) filter.runId = runId;
      if (callDate) filter.callDate = callDate;
      if (level) filter.level = level;
      if (typeof req.query.trigger === "string" && req.query.trigger !== "all") {
        filter.trigger = req.query.trigger;
      }
      if (typeof req.query.phase === "string" && req.query.phase !== "all") {
        filter.phase = req.query.phase;
      }
      if (dateFrom) {
        filter.callDate = {
          ...(typeof filter.callDate === "object" && filter.callDate
            ? (filter.callDate as object)
            : {}),
          $gte: dateFrom,
        };
      }
      if (dateTo) {
        filter.callDate = {
          ...(typeof filter.callDate === "object" && filter.callDate
            ? (filter.callDate as object)
            : {}),
          $lte: dateTo,
        };
      }

      const collection = cronJobLogsCollection();
      const [total, docs] = await Promise.all([
        collection.countDocuments(filter),
        collection.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).toArray(),
      ]);

      res.json({
        logs: docs.map((d) => ({
          ...d,
          createdAt: d.createdAt?.toISOString?.() ?? d.createdAt,
        })),
        total,
        page,
        limit,
        totalPages: Math.max(1, Math.ceil(total / limit)),
        source: "mongo",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: message });
    }
  });

  router.get("/logs/runs", async (req, res) => {
    try {
      const page = Math.max(1, Number(req.query.page ?? 1) || 1);
      const limit = Math.min(50, Math.max(1, Number(req.query.limit ?? 10) || 10));
      const skip = (page - 1) * limit;

      if (postgresReadsEnabled()) {
        try {
          const pg = await pgListCronRuns({ skip, limit });
          if (pg.total > 0) {
            res.json({
              runs: pg.items,
              total: pg.total,
              page,
              limit,
              totalPages: Math.max(1, Math.ceil(pg.total / limit)),
              source: "postgres",
            });
            return;
          }
        } catch (error) {
          console.warn(
            "[postgres read] cron runs fallback to mongo:",
            error instanceof Error ? error.message : error,
          );
        }
      }

      const pipeline = [
        { $sort: { createdAt: -1 as const } },
        {
          $group: {
            _id: "$runId",
            runId: { $first: "$runId" },
            callDate: { $first: "$callDate" },
            trigger: { $first: "$trigger" },
            exportJobId: { $first: "$exportJobId" },
            lastLevel: { $first: "$level" },
            lastPhase: { $first: "$phase" },
            lastMessage: { $first: "$message" },
            startedAt: { $min: "$createdAt" },
            finishedAt: { $max: "$createdAt" },
            lineCount: { $sum: 1 },
            errorCount: {
              $sum: { $cond: [{ $eq: ["$level", "error"] }, 1, 0] },
            },
          },
        },
        { $sort: { startedAt: -1 as const } },
        {
          $facet: {
            total: [{ $count: "count" }],
            items: [{ $skip: skip }, { $limit: limit }],
          },
        },
      ];

      const [facet] = await cronJobLogsCollection().aggregate(pipeline).toArray();
      const total = facet?.total?.[0]?.count ?? 0;
      const items = (facet?.items ?? []).map(
        (r: {
          runId: string;
          callDate: string;
          trigger: string;
          exportJobId?: number | null;
          lastLevel: string;
          lastPhase: string;
          lastMessage: string;
          startedAt: Date;
          finishedAt: Date;
          lineCount: number;
          errorCount: number;
        }) => ({
          ...r,
          startedAt: r.startedAt?.toISOString?.() ?? r.startedAt,
          finishedAt: r.finishedAt?.toISOString?.() ?? r.finishedAt,
        }),
      );

      res.json({
        runs: items,
        total,
        page,
        limit,
        totalPages: Math.max(1, Math.ceil(total / limit)),
        source: "mongo",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: message });
    }
  });

  router.get("/logs/runs/:runId", async (req, res) => {
    try {
      const runId = String(req.params.runId);
      if (postgresReadsEnabled()) {
        try {
          const docs = await pgCronLogsForRun(runId);
          if (docs.length > 0) {
            res.json({
              runId,
              logs: docs.map((d) => ({
                ...d,
                createdAt: d.createdAt?.toISOString?.() ?? d.createdAt,
              })),
              source: "postgres",
            });
            return;
          }
        } catch (error) {
          console.warn(
            "[postgres read] cron run detail fallback to mongo:",
            error instanceof Error ? error.message : error,
          );
        }
      }

      const docs = await cronJobLogsCollection()
        .find({ runId })
        .sort({ createdAt: 1 })
        .toArray();
      res.json({
        runId,
        logs: docs.map((d) => ({
          ...d,
          createdAt: d.createdAt?.toISOString?.() ?? d.createdAt,
        })),
        source: "mongo",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: message });
    }
  });

  return router;
}
