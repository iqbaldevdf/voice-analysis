import { Router } from "express";
import { agentsCollection, backfillAgentsFromRecordings, type AgentDocument } from "../db/agents.js";
import { recordingsCollection, type RecordingDocument } from "../db/mongo.js";
import {
  agentPerformance,
  callMetricsFromResult,
  callQualityFromResult,
  inQuarter,
  introductionScriptFromResult,
  mean,
  parseQuarter,
  recentQuarters,
  recordingCallDate,
  summarizeAgentQuarterStats,
} from "../scoring/agentQuarter.js";
import { fillMissingIntroductionScripts } from "../scoring/fillIntroductionScript.js";
import { fillMissingPerformanceScores } from "../scoring/fillPerformanceScore.js";
import { audioClarityFlagFromResult } from "../lib/audioClarity.js";
import {
  isAnsweredCall,
  isConnectedConversation,
  isForwardedMailCall,
  VOICEMAIL_MAX_DURATION_SEC,
} from "../voicemail.js";
import {
  pgFindAgent,
  pgListAgents,
  pgRecordingsForAgent,
  pgRecordingsForAgents,
  postgresReadsEnabled,
} from "../db/postgres/reads.js";

const SORTABLE = new Set(["createdTime", "durationSec", "analysisStatus", "callId"]);

type AgentRecordingDoc = Pick<
  RecordingDocument,
  | "callId"
  | "recordingId"
  | "createdTime"
  | "callDate"
  | "durationSec"
  | "direction"
  | "phoneNumber"
  | "callNotes"
  | "analysisStatus"
  | "participants"
  | "analysisResult"
  | "isConnected"
  | "isVoicemail"
  | "botHandling"
  | "disposition"
>;

function scoreNoteFor(agentPerf: { overallScore?: number | null; note?: string | null } | undefined): string | null {
  if (!agentPerf || typeof agentPerf.overallScore === "number") return null;
  const note = agentPerf.note ?? "";
  if (/429|too many requests/i.test(note)) {
    return "Performance score was not returned. The scoring model was rate-limited.";
  }
  if (note) return "Performance score was not returned for this call.";
  return null;
}

type BotHandlingValue = NonNullable<RecordingDocument["botHandling"]>;

/** Script-inferred bot_segment from analyze (F09 Phase 3) — does not rewrite sync fields. */
function analysisBotHandling(result: unknown): BotHandlingValue | null {
  const segment = (
    result as
      | {
          bot_segment?: { handling?: string; involved?: boolean } | null;
        }
      | null
      | undefined
  )?.bot_segment;
  if (!segment) return null;
  if (segment.handling === "bot_only" || segment.handling === "bot_transferred") {
    return segment.handling;
  }
  if (segment.involved) return "bot_transferred";
  return null;
}

/**
 * Prefer Freshcaller sync `botHandling`; when `none`, fall back to analysis `bot_segment`
 * so agent table Bot column matches call-details badges (F09 AC4c + Phase 3).
 */
function effectiveBotHandling(doc: AgentRecordingDoc): BotHandlingValue {
  const sync = doc.botHandling ?? "none";
  if (sync === "bot_only" || sync === "bot_transferred") return sync;
  if (doc.analysisStatus !== "completed") return "none";
  return analysisBotHandling(doc.analysisResult) ?? "none";
}

function toAgentRow(doc: AgentRecordingDoc) {
  const customer = doc.participants?.find((p) => p.role.toLowerCase() === "customer");
  const agentPerf = agentPerformance(doc.analysisResult);
  const quality = callQualityFromResult(doc.analysisStatus === "completed" ? doc.analysisResult : null);
  const intro = introductionScriptFromResult(doc.analysisStatus === "completed" ? doc.analysisResult : null);
  const categoryScores = agentPerf?.scores
    ? Object.fromEntries(Object.entries(agentPerf.scores).map(([key, value]) => [key, value?.score ?? null]))
    : null;
  const botHandling = effectiveBotHandling(doc);
  return {
    callId: doc.callId,
    recordingId: doc.recordingId,
    createdTime: doc.createdTime ?? null,
    callDate: doc.callDate ?? null,
    durationSec: doc.durationSec ?? null,
    direction: doc.direction ?? null,
    phoneNumber: doc.phoneNumber ?? null,
    customerName: customer?.name ?? null,
    customerPhone: customer?.phone ?? null,
    analysisStatus: doc.analysisStatus,
    disposition: doc.disposition ?? null,
    answered: isAnsweredCall(doc),
    overallScore: agentPerf?.overallScore ?? null,
    callQualityScore: quality.callQualityScore,
    clarityScore: quality.clarityScore,
    speechRateScore: quality.speechRateScore,
    wordsPerSecond: quality.wordsPerSecond,
    talkPercentage: agentPerf?.talkPercentage ?? null,
    talkDurationSec: agentPerf?.totalTalkDuration ?? null,
    interruptionCount: agentPerf?.interruptionCount ?? null,
    questionCount: agentPerf?.questionCount ?? null,
    highlight: agentPerf?.strengths?.[0] ?? agentPerf?.improvements?.[0] ?? null,
    scoreNote: scoreNoteFor(agentPerf),
    introductionScore: intro?.score ?? null,
    introductionRank: intro?.rank ?? null,
    botHandling,
    isBotInvolved: botHandling !== "none",
    audioClarityFlag: audioClarityFlagFromResult(
      doc.analysisStatus === "completed" ? doc.analysisResult : null,
    ),
    categoryScores,
  };
}

function matchesTableFilters(
  doc: AgentRecordingDoc,
  filters: {
    q: string;
    status: string;
    dateFrom: string;
    dateTo: string;
    minDuration?: number;
    maxDuration?: number;
  },
): boolean {
  if (filters.status && filters.status !== "all" && doc.analysisStatus !== filters.status) return false;
  const callDate = recordingCallDate(doc);
  if (filters.dateFrom && (!callDate || callDate < filters.dateFrom)) return false;
  if (filters.dateTo && (!callDate || callDate > filters.dateTo)) return false;
  if (filters.minDuration != null && Number.isFinite(filters.minDuration) && (doc.durationSec ?? 0) < filters.minDuration) {
    return false;
  }
  if (filters.maxDuration != null && Number.isFinite(filters.maxDuration) && (doc.durationSec ?? 0) > filters.maxDuration) {
    return false;
  }
  if (filters.q) {
    const needle = filters.q.toLowerCase();
    const haystack = [
      doc.phoneNumber,
      doc.callNotes,
      ...(doc.participants ?? []).flatMap((p) => [p.name, p.phone]),
      String(doc.callId),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    if (!haystack.includes(needle)) return false;
  }
  return true;
}

function compareRecordings(a: AgentRecordingDoc, b: AgentRecordingDoc, sortBy: string, sortDir: 1 | -1): number {
  const left = a[sortBy as keyof AgentRecordingDoc];
  const right = b[sortBy as keyof AgentRecordingDoc];
  if (left == null && right == null) return 0;
  if (left == null) return 1;
  if (right == null) return -1;
  if (typeof left === "number" && typeof right === "number") return (left - right) * sortDir;
  return String(left).localeCompare(String(right)) * sortDir;
}

function serializeAgent(doc: {
  agentId: string;
  freshcallerAgentId?: number | null;
  name: string;
  teamName?: string | null;
  callCount: number;
  recordingCount: number;
  analyzedCount: number;
  appointmentCount: number;
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
    appointmentCount: doc.appointmentCount ?? 0,
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
      const quarter = parseQuarter(typeof req.query.quarter === "string" ? req.query.quarter : undefined);
      const skip = (page - 1) * limit;

      let total = 0;
      let docs: AgentDocument[] = [];
      let source: "postgres" | "mongo" = "mongo";

      if (postgresReadsEnabled()) {
        try {
          const pg = await pgListAgents({ q: q || undefined, skip, limit });
          // Prefer PG whenever the agents table has been populated (even if this page is empty).
          const probe = await pgListAgents({ skip: 0, limit: 1 });
          if (probe.total > 0) {
            total = pg.total;
            docs = pg.docs;
            source = "postgres";
          }
        } catch (error) {
          console.warn(
            "[postgres read] agents list fallback to mongo:",
            error instanceof Error ? error.message : error,
          );
        }
      }

      if (source === "mongo") {
        const filter = q ? { name: { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" } } : {};
        const collection = agentsCollection();
        const [mongoTotal, mongoDocs] = await Promise.all([
          collection.countDocuments(filter),
          collection
            .find(filter)
            .sort({ lastCallAt: -1, name: 1 })
            .skip(skip)
            .limit(limit)
            .toArray(),
        ]);
        total = mongoTotal;
        docs = mongoDocs;
      }

      const agentIds = docs.map((doc) => doc.agentId);
      const recordingsByAgent = new Map<string, AgentRecordingDoc[]>();
      if (agentIds.length > 0) {
        let recordings: Array<AgentRecordingDoc & { agentId?: string | null }> = [];
        if (source === "postgres") {
          recordings = (await pgRecordingsForAgents(agentIds)) as Array<
            AgentRecordingDoc & { agentId?: string | null }
          >;
        } else {
          recordings = (await recordingsCollection()
            .find({ agentId: { $in: agentIds } })
            .project({
              agentId: 1,
              callId: 1,
              callDate: 1,
              createdTime: 1,
              analysisStatus: 1,
              analysisResult: 1,
              disposition: 1,
              isConnected: 1,
              isVoicemail: 1,
              botHandling: 1,
              callNotes: 1,
            })
            .toArray()) as Array<AgentRecordingDoc & { agentId?: string }>;
        }

        for (const recording of recordings) {
          if (!recording.agentId) continue;
          const bucket = recordingsByAgent.get(recording.agentId) ?? [];
          bucket.push(recording);
          recordingsByAgent.set(recording.agentId, bucket);
        }
      }

      const agents = docs.map((doc) => {
        const base = serializeAgent(doc);
        const stats = summarizeAgentQuarterStats(
          recordingsByAgent.get(doc.agentId) ?? [],
          quarter,
          isConnectedConversation,
          isForwardedMailCall,
        );
        return {
          ...base,
          recordingCount: stats.connects,
          analyzedCount: stats.analyzedCount,
          averageScore: stats.averageScore,
          appointmentCount: stats.appointmentCount,
        };
      });

      res.json({
        agents,
        quarter,
        availableQuarters: recentQuarters(),
        total,
        page,
        limit,
        totalPages: Math.max(1, Math.ceil(total / limit)),
        source,
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
      let agent: AgentDocument | null = null;
      let source: "postgres" | "mongo" = "mongo";

      if (postgresReadsEnabled()) {
        try {
          agent = await pgFindAgent(agentId);
          if (agent) source = "postgres";
        } catch (error) {
          console.warn(
            "[postgres read] agent detail fallback to mongo:",
            error instanceof Error ? error.message : error,
          );
        }
      }
      if (!agent) {
        agent = await agentsCollection().findOne({ agentId });
        source = "mongo";
      }
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
      const appointmentOnly = String(req.query.appointmentOnly ?? "false") === "true";
      const quarter = parseQuarter(typeof req.query.quarter === "string" ? req.query.quarter : undefined);
      const sortByRaw = typeof req.query.sortBy === "string" ? req.query.sortBy : "createdTime";
      const sortBy = SORTABLE.has(sortByRaw) ? sortByRaw : "createdTime";
      const sortDir = String(req.query.sortDir ?? "desc").toLowerCase() === "asc" ? 1 : -1;
      const page = Math.max(1, Number(req.query.page ?? 1) || 1);
      const limit = Math.min(50, Math.max(1, Number(req.query.limit ?? 10) || 10));

      let docs: AgentRecordingDoc[] = [];
      if (source === "postgres") {
        docs = (await pgRecordingsForAgent(agentId)) as AgentRecordingDoc[];
        if (docs.length === 0) {
          // Agent exists in PG but recordings not backfilled — fall back to Mongo recordings.
          docs = (await recordingsCollection()
            .find({ agentId })
            .project({
              callId: 1,
              recordingId: 1,
              createdTime: 1,
              callDate: 1,
              durationSec: 1,
              direction: 1,
              phoneNumber: 1,
              callNotes: 1,
              analysisStatus: 1,
              agentName: 1,
              participants: 1,
              analysisResult: 1,
              isConnected: 1,
              isVoicemail: 1,
              botHandling: 1,
              disposition: 1,
            })
            .toArray()) as AgentRecordingDoc[];
        }
      } else {
        docs = (await recordingsCollection()
          .find({ agentId })
          .project({
            callId: 1,
            recordingId: 1,
            createdTime: 1,
            callDate: 1,
            durationSec: 1,
            direction: 1,
            phoneNumber: 1,
            callNotes: 1,
            analysisStatus: 1,
            agentName: 1,
            participants: 1,
            analysisResult: 1,
            isConnected: 1,
            isVoicemail: 1,
            botHandling: 1,
            disposition: 1,
          })
          .toArray()) as AgentRecordingDoc[];
      }

      await fillMissingPerformanceScores(docs);
      await fillMissingIntroductionScripts(docs);

      const quarterDocs = docs.filter(
        (doc) => inQuarter(recordingCallDate(doc), quarter) && !isForwardedMailCall(doc),
      );
      const connected = quarterDocs.filter((doc) => isConnectedConversation(doc));
      const scoreDocs = appointmentOnly
        ? connected.filter((doc) => doc.disposition === "appointment")
        : connected;
      const rows = scoreDocs.map(toAgentRow);

      const completed = rows.filter((row) => row.analysisStatus === "completed");
      const callMetrics = scoreDocs
        .filter((doc) => doc.analysisStatus === "completed")
        .map((doc) => callMetricsFromResult(doc.analysisResult));
      const scored = completed.filter((row) => typeof row.overallScore === "number");
      const qualityRows = completed.filter((row) => typeof row.callQualityScore === "number");
      const introRows = completed.filter((row) => typeof row.introductionScore === "number");
      const categoryTotals: Record<string, { sum: number; count: number }> = {};
      for (const row of scored) {
        for (const [key, score] of Object.entries(row.categoryScores ?? {})) {
          if (typeof score !== "number") continue;
          categoryTotals[key] ??= { sum: 0, count: 0 };
          categoryTotals[key].sum += score;
          categoryTotals[key].count += 1;
        }
      }

      // Hide voicemails / short / bot-only; always keep bot→agent transfers on the agent table.
      const tableSource = excludeVoicemail
        ? scoreDocs
        : appointmentOnly
          ? quarterDocs.filter((doc) => doc.disposition === "appointment")
          : quarterDocs;
      const filtered = tableSource.filter((doc) =>
        matchesTableFilters(doc, { q, status, dateFrom, dateTo, minDuration, maxDuration }),
      );
      filtered.sort((a, b) => compareRecordings(a, b, sortBy, sortDir));
      const total = filtered.length;
      const pageRows = filtered.slice((page - 1) * limit, page * limit).map(toAgentRow);

      res.json({
        agent: serializeAgent(agent),
        quarter,
        availableQuarters: recentQuarters(),
        appointmentOnly,
        summary: {
          connects: scoreDocs.length,
          analyzedConnects: scoreDocs.filter((doc) => doc.analysisStatus === "completed").length,
          scoredConnects: scored.length,
          qualityScoredConnects: qualityRows.length,
          averagePerformance: mean(scored.map((row) => row.overallScore)),
          averageCallQuality: mean(qualityRows.map((row) => row.callQualityScore)),
          averageClarity: mean(qualityRows.map((row) => row.clarityScore)),
          averageSpeechRateScore: mean(qualityRows.map((row) => row.speechRateScore)),
          averageWordsPerSecond: mean(callMetrics.map((row) => row.wordsPerSecond)),
          averageOverallScore: mean(callMetrics.map((row) => row.overallScore)),
          averageAgentTalkRatioPct: mean(callMetrics.map((row) => row.agentTalkRatioPct)),
          averageCustomerTalkRatioPct: mean(callMetrics.map((row) => row.customerTalkRatioPct)),
          averageResponseTimeSec: mean(callMetrics.map((row) => row.avgResponseTimeSec)),
          averageSilenceRatioPct: mean(callMetrics.map((row) => row.silenceRatioPct)),
          averageSilenceSec: mean(callMetrics.map((row) => row.silenceSec)),
          averageInterruptions: mean(callMetrics.map((row) => row.interruptionsCount)),
          averageIntroductionScore: mean(introRows.map((row) => row.introductionScore)),
          introductionScoredConnects: introRows.length,
          inbound: rows.filter((row) => row.direction === "incoming" || row.direction === "inbound").length,
          outbound: rows.filter((row) => row.direction === "outgoing" || row.direction === "outbound").length,
          pendingAnalysis: scoreDocs.filter((doc) => doc.analysisStatus !== "completed").length,
          totalDurationSec: scoreDocs.reduce((sum, doc) => sum + (doc.durationSec ?? 0), 0),
          talkDurationSec: scored.reduce((sum, row) => sum + (row.talkDurationSec ?? 0), 0),
          categoryAverages: Object.fromEntries(
            Object.entries(categoryTotals).map(([key, value]) => [
              key,
              Math.round((value.sum / value.count) * 10) / 10,
            ]),
          ),
        },
        recordings: pageRows,
        total,
        page,
        limit,
        totalPages: Math.max(1, Math.ceil(total / limit)),
        excludeVoicemail,
        voicemailMaxSec: VOICEMAIL_MAX_DURATION_SEC,
        source,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: message });
    }
  });

  return router;
}
