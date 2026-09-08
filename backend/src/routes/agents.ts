import { Router } from "express";
import { agentsCollection, backfillAgentsFromRecordings } from "../db/agents.js";
import { recordingsCollection } from "../db/mongo.js";
import { excludeVoicemailFilter, VOICEMAIL_MAX_DURATION_SEC } from "../voicemail.js";

const SORTABLE = new Set(["createdTime", "durationSec", "analysisStatus", "callId"]);

function speechRateFromResult(result: unknown): number | null {
  const metrics = (
    result as {
      speaker_metrics?: Array<{
        role_guess?: string | null;
        words_spoken?: number;
        talk_time_sec?: number;
        words_per_minute?: number;
      }>;
    } | null
  )?.speaker_metrics;
  const agent = metrics?.find((item) => item.role_guess === "agent");
  if (!agent) return null;
  if (typeof agent.talk_time_sec === "number" && agent.talk_time_sec > 0 && typeof agent.words_spoken === "number") {
    return Math.round((agent.words_spoken / agent.talk_time_sec) * 10) / 10;
  }
  if (typeof agent.words_per_minute === "number") {
    return Math.round((agent.words_per_minute / 60) * 10) / 10;
  }
  return null;
}

function serializeAgent(doc: {
  agentId: string;
  freshcallerAgentId?: number | null;
  name: string;
  teamName?: string | null;
  callCount: number;
  recordingCount: number;
  analyzedCount: number;
  averageScore: number | null;
  firstCallAt?: string | null;
  lastCallAt?: string | null;
}) {
  return {
    agentId: doc.agentId,
    freshcallerAgentId: doc.freshcallerAgentId ?? null,
    name: doc.name,
    teamName: doc.teamName ?? null,
    callCount: doc.callCount,
    recordingCount: doc.recordingCount,
    analyzedCount: doc.analyzedCount,
    averageScore: doc.averageScore,
    firstCallAt: doc.firstCallAt ?? null,
    lastCallAt: doc.lastCallAt ?? null,
  };
}

export function createAgentsRouter(): Router {
  const router = Router();

  router.get("/", async (req, res) => {
    try {
      const page = Math.max(1, Number(req.query.page ?? 1) || 1);
      const limit = Math.min(50, Math.max(1, Number(req.query.limit ?? 20) || 20));
      const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
      const filter = q ? { name: { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" } } : {};
      const collection = agentsCollection();
      const [total, docs] = await Promise.all([
        collection.countDocuments(filter),
        collection
          .find(filter)
          .sort({ lastCallAt: -1, name: 1 })
          .skip((page - 1) * limit)
          .limit(limit)
          .toArray(),
      ]);
      res.json({
        agents: docs.map(serializeAgent),
        total,
        page,
        limit,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: message });
    }
  });

  router.post("/backfill", async (_req, res) => {
    try {
      const count = await backfillAgentsFromRecordings();
      res.json({ ok: true, agents: count });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: message });
    }
  });

  router.get("/:agentId", async (req, res) => {
    try {
      const agentId = decodeURIComponent(req.params.agentId);
      const agent = await agentsCollection().findOne({ agentId });
      if (!agent) {
        res.status(404).json({ error: "Agent not found" });
        return;
      }

      const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
      const status = typeof req.query.status === "string" ? req.query.status.trim() : "";
      const dateFrom = typeof req.query.dateFrom === "string" ? req.query.dateFrom.trim() : "";
      const dateTo = typeof req.query.dateTo === "string" ? req.query.dateTo.trim() : "";
      const minDuration =
        req.query.minDuration != null && String(req.query.minDuration).trim() !== ""
          ? Number(req.query.minDuration)
          : undefined;
      const maxDuration =
        req.query.maxDuration != null && String(req.query.maxDuration).trim() !== ""
          ? Number(req.query.maxDuration)
          : undefined;
      const excludeVoicemail = String(req.query.excludeVoicemail ?? "true") !== "false";
      const sortByRaw = typeof req.query.sortBy === "string" ? req.query.sortBy : "createdTime";
      const sortBy = SORTABLE.has(sortByRaw) ? sortByRaw : "createdTime";
      const sortDir = String(req.query.sortDir ?? "desc").toLowerCase() === "asc" ? 1 : -1;
      const page = Math.max(1, Number(req.query.page ?? 1) || 1);
      const limit = Math.min(50, Math.max(1, Number(req.query.limit ?? 10) || 10));

      const filter: Record<string, unknown> = { agentId };
      const and: Record<string, unknown>[] = [];
      if (excludeVoicemail) {
        and.push({ isVoicemail: { $ne: true } });
        and.push(excludeVoicemailFilter());
      }
      if (status && status !== "all") filter.analysisStatus = status;
      if (dateFrom) and.push({ createdTime: { $gte: dateFrom } });
      if (dateTo) {
        const end = /^\d{4}-\d{2}-\d{2}$/.test(dateTo) ? `${dateTo}T23:59:59.999Z` : dateTo;
        and.push({ createdTime: { $lte: end } });
      }
      if (minDuration != null && Number.isFinite(minDuration)) and.push({ durationSec: { $gte: minDuration } });
      if (maxDuration != null && Number.isFinite(maxDuration)) and.push({ durationSec: { $lte: maxDuration } });
      if (q) {
        const regex = { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" };
        and.push({
          $or: [
            { phoneNumber: regex },
            { callNotes: regex },
            { "participants.name": regex },
            { "participants.phone": regex },
            ...(Number.isFinite(Number(q)) ? [{ callId: Number(q) }] : []),
          ],
        });
      }
      if (and.length > 0) filter.$and = and;

      const [total, recordings] = await Promise.all([
        recordingsCollection().countDocuments(filter),
        recordingsCollection()
          .find(filter)
          .project({
            callId: 1,
            recordingId: 1,
            createdTime: 1,
            callDate: 1,
            durationSec: 1,
            direction: 1,
            phoneNumber: 1,
            analysisStatus: 1,
            agentName: 1,
            participants: 1,
            analysisResult: 1,
            isConnected: 1,
            isVoicemail: 1,
          })
          .sort({ [sortBy]: sortDir })
          .skip((page - 1) * limit)
          .limit(limit)
          .toArray(),
      ]);

      const rows = recordings.map((rec) => {
        const customer = rec.participants?.find((p) => p.role.toLowerCase() === "customer");
        const performance = (
          rec.analysisResult as {
            participant_performance?: Array<{
              participantRole?: string;
              overallScore?: number | null;
              talkPercentage?: number;
              totalTalkDuration?: number;
              interruptionCount?: number;
              questionCount?: number;
              strengths?: string[];
              improvements?: string[];
              scores?: Record<string, { score?: number }>;
            }>;
          } | undefined
        )?.participant_performance;
        const agentPerf = performance?.find((item) => item.participantRole === "agent");
        const categoryScores = agentPerf?.scores
          ? Object.fromEntries(
              Object.entries(agentPerf.scores).map(([key, value]) => [key, value?.score ?? null]),
            )
          : null;
        return {
          callId: rec.callId,
          recordingId: rec.recordingId,
          createdTime: rec.createdTime ?? null,
          callDate: rec.callDate ?? null,
          durationSec: rec.durationSec ?? null,
          direction: rec.direction ?? null,
          phoneNumber: rec.phoneNumber ?? null,
          customerName: customer?.name ?? null,
          customerPhone: customer?.phone ?? null,
          analysisStatus: rec.analysisStatus,
          overallScore: agentPerf?.overallScore ?? null,
          wordsPerSecond: speechRateFromResult(rec.analysisResult),
          talkPercentage: agentPerf?.talkPercentage ?? null,
          talkDurationSec: agentPerf?.totalTalkDuration ?? null,
          interruptionCount: agentPerf?.interruptionCount ?? null,
          questionCount: agentPerf?.questionCount ?? null,
          highlight: agentPerf?.strengths?.[0] ?? agentPerf?.improvements?.[0] ?? null,
          categoryScores,
        };
      });

      const analyzed = rows.filter((row) => typeof row.overallScore === "number");
      const rated = rows.filter((row) => typeof row.wordsPerSecond === "number");
      const categoryTotals: Record<string, { sum: number; count: number }> = {};
      for (const row of analyzed) {
        for (const [key, score] of Object.entries(row.categoryScores ?? {})) {
          if (typeof score !== "number") continue;
          categoryTotals[key] ??= { sum: 0, count: 0 };
          categoryTotals[key].sum += score;
          categoryTotals[key].count += 1;
        }
      }

      res.json({
        agent: serializeAgent(agent),
        summary: {
          inbound: rows.filter((row) => row.direction === "incoming" || row.direction === "inbound").length,
          outbound: rows.filter((row) => row.direction === "outgoing" || row.direction === "outbound").length,
          pendingAnalysis: rows.filter((row) => row.analysisStatus !== "completed").length,
          totalDurationSec: rows.reduce((sum, row) => sum + (row.durationSec ?? 0), 0),
          talkDurationSec: rows.reduce((sum, row) => sum + (row.talkDurationSec ?? 0), 0),
          averageWordsPerSecond:
            rated.length > 0
              ? Math.round((rated.reduce((sum, row) => sum + (row.wordsPerSecond ?? 0), 0) / rated.length) * 10) / 10
              : null,
          categoryAverages: Object.fromEntries(
            Object.entries(categoryTotals).map(([key, value]) => [
              key,
              Math.round((value.sum / value.count) * 10) / 10,
            ]),
          ),
        },
        recordings: rows,
        total,
        page,
        limit,
        totalPages: Math.max(1, Math.ceil(total / limit)),
        excludeVoicemail,
        voicemailMaxSec: VOICEMAIL_MAX_DURATION_SEC,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: message });
    }
  });

  return router;
}
