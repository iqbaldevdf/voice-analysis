import fs from "node:fs/promises";
import path from "node:path";
import { Router } from "express";
import { recordingsCollection, recordingListingsCollection, type RecordingDocument } from "../db/mongo.js";
import { toListingDoc, upsertRecordingListing } from "../db/recordingListings.js";
import { analyzeRecordingOnce } from "../services/analyzeRecording.js";
import {
  excludeVoicemailFilter,
  isLikelyVoicemail,
  VOICEMAIL_MAX_DURATION_SEC,
} from "../voicemail.js";

export type RecordingListItem = {
  callId: number;
  recordingId: number;
  exportJobId?: number | null;
  sourceFile?: string | null;
  direction?: string;
  createdTime?: string;
  agentName?: string | null;
  phoneNumber?: string | null;
  callNotes?: string | null;
  customerName?: string | null;
  participants: RecordingDocument["participants"];
  recordingUrl: string;
  durationSec?: number | null;
  isVoicemail?: boolean;
  localFileName?: string | null;
  hasLocalAudio: boolean;
  analysisStatus: RecordingDocument["analysisStatus"];
  analysisError?: string | null;
  analyzedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

const SORTABLE = new Set([
  "createdTime",
  "durationSec",
  "agentName",
  "analysisStatus",
  "callId",
  "updatedAt",
]);

function customerName(doc: RecordingDocument): string | null {
  const customer = doc.participants?.find((p) => p.role.toLowerCase() === "customer");
  return customer?.name ?? customer?.phone ?? null;
}

function toListItem(doc: RecordingDocument): RecordingListItem {
  const durationSec = doc.durationSec;
  return {
    callId: doc.callId,
    recordingId: doc.recordingId,
    exportJobId: doc.exportJobId,
    sourceFile: doc.sourceFile,
    direction: doc.direction,
    createdTime: doc.createdTime,
    agentName: doc.agentName,
    phoneNumber: doc.phoneNumber,
    callNotes: doc.callNotes,
    customerName: customerName(doc),
    participants: doc.participants ?? [],
    recordingUrl: doc.recordingUrl,
    durationSec,
    isVoicemail: doc.isVoicemail ?? isLikelyVoicemail(durationSec),
    localFileName: doc.localFileName,
    hasLocalAudio: Boolean(doc.localPath),
    analysisStatus: doc.analysisStatus,
    analysisError: doc.analysisError,
    analyzedAt: doc.analyzedAt,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

function toDetail(doc: RecordingDocument, includeAnalysis = true) {
  return {
    ...toListItem(doc),
    localPath: doc.localPath,
    ...(includeAnalysis ? { analysisResult: doc.analysisResult ?? null } : {}),
  };
}

async function findByCallId(callId: number, recordingId?: number): Promise<RecordingDocument | null> {
  const collection = recordingsCollection();
  if (recordingId != null && Number.isFinite(recordingId)) {
    return collection.findOne({ callId, recordingId });
  }
  return collection.findOne({ callId }, { sort: { updatedAt: -1 } });
}

function parseListQuery(req: {
  query: Record<string, unknown>;
}) {
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const hasAudio = req.query.hasAudio;
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
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
  const limit = Math.min(100, Math.max(1, Number(req.query.limit ?? 10) || 10));
  const skipRaw = req.query.skip != null ? Number(req.query.skip) : undefined;
  const skip =
    skipRaw != null && Number.isFinite(skipRaw) ? Math.max(0, skipRaw) : (page - 1) * limit;

  const filter: Record<string, unknown> = {};
  const and: Record<string, unknown>[] = [];

  if (excludeVoicemail) {
    and.push({ isVoicemail: { $ne: true } });
    and.push(excludeVoicemailFilter());
  }

  if (status && status !== "all") {
    filter.analysisStatus = status;
  }
  if (hasAudio === "true") {
    filter.hasLocalAudio = true;
  } else if (hasAudio === "false") {
    filter.hasLocalAudio = false;
  }

  if (dateFrom) {
    and.push({ createdTime: { $gte: dateFrom } });
  }
  if (dateTo) {
    // Inclusive end-of-day if date-only (YYYY-MM-DD)
    const end = /^\d{4}-\d{2}-\d{2}$/.test(dateTo) ? `${dateTo}T23:59:59.999Z` : dateTo;
    and.push({ createdTime: { $lte: end } });
  }

  if (minDuration != null && Number.isFinite(minDuration)) {
    and.push({ durationSec: { $gte: minDuration } });
  }
  if (maxDuration != null && Number.isFinite(maxDuration)) {
    and.push({ durationSec: { $lte: maxDuration } });
  }

  if (q) {
    const regex = { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" };
    and.push({
      $or: [
        { agentName: regex },
        { phoneNumber: regex },
        { callNotes: regex },
        { customerName: regex },
        { "participants.name": regex },
        { "participants.phone": regex },
        ...(Number.isFinite(Number(q)) ? [{ callId: Number(q) }] : []),
      ],
    });
  }

  if (and.length > 0) {
    filter.$and = and;
  }

  return {
    filter,
    sortBy,
    sortDir: sortDir as 1 | -1,
    page,
    limit,
    skip,
    excludeVoicemail,
    dateFrom: dateFrom || null,
    dateTo: dateTo || null,
    minDuration: minDuration ?? null,
    maxDuration: maxDuration ?? null,
  };
}

/** Build filter for the primary `recordings` collection (uses localPath instead of hasLocalAudio). */
function adaptFilterForRecordings(filter: Record<string, unknown>): Record<string, unknown> {
  const next = { ...filter };
  const and = Array.isArray(next.$and) ? [...(next.$and as Record<string, unknown>[])] : [];
  if (next.hasLocalAudio === true) {
    and.push({ localPath: { $nin: [null, ""] } });
    delete next.hasLocalAudio;
  } else if (next.hasLocalAudio === false) {
    and.push({
      $or: [{ localPath: null }, { localPath: "" }, { localPath: { $exists: false } }],
    });
    delete next.hasLocalAudio;
  }
  if (and.length > 0) {
    next.$and = and;
  }
  return next;
}

export function createDbRecordingsRouter(): Router {
  const router = Router();

  /** GET /recordings/db — meetings/recordings from primary collection */
  router.get("/", async (req, res) => {
    try {
      const parsed = parseListQuery(req);
      const filter = adaptFilterForRecordings(parsed.filter);
      const collection = recordingsCollection();
      const [total, docs] = await Promise.all([
        collection.countDocuments(filter),
        collection
          .find(filter)
          .sort({ [parsed.sortBy]: parsed.sortDir })
          .skip(parsed.skip)
          .limit(parsed.limit)
          .project({ analysisResult: 0 })
          .toArray(),
      ]);

      const recordings = (docs as RecordingDocument[]).map((doc) => toListItem(doc));
      const totalPages = Math.max(1, Math.ceil(total / parsed.limit));

      res.json({
        recordings,
        total,
        limit: parsed.limit,
        skip: parsed.skip,
        page: parsed.page,
        totalPages,
        sortBy: parsed.sortBy,
        sortDir: parsed.sortDir === 1 ? "asc" : "desc",
        excludeVoicemail: parsed.excludeVoicemail,
        voicemailMaxSec: VOICEMAIL_MAX_DURATION_SEC,
        filters: {
          dateFrom: parsed.dateFrom,
          dateTo: parsed.dateTo,
          minDuration: parsed.minDuration,
          maxDuration: parsed.maxDuration,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: message });
    }
  });

  /**
   * GET /recordings/db/listings
   * Separate listing table (no analysis payloads) — for the Recordings table UI.
   */
  router.get("/listings", async (req, res) => {
    try {
      const parsed = parseListQuery(req);
      const collection = recordingListingsCollection();
      let total = await collection.countDocuments(parsed.filter);

      // Bootstrap listings from recordings if empty
      if (total === 0) {
        const source = await recordingsCollection()
          .find({})
          .project({ analysisResult: 0 })
          .toArray();
        if (source.length > 0) {
          const ops = (source as RecordingDocument[]).map((doc) => ({
            updateOne: {
              filter: { callId: doc.callId, recordingId: doc.recordingId },
              update: { $set: toListingDoc(doc) },
              upsert: true,
            },
          }));
          for (let i = 0; i < ops.length; i += 500) {
            await collection.bulkWrite(ops.slice(i, i + 500));
          }
          total = await collection.countDocuments(parsed.filter);
        }
      }

      const docs = await collection
        .find(parsed.filter)
        .sort({ [parsed.sortBy]: parsed.sortDir })
        .skip(parsed.skip)
        .limit(parsed.limit)
        .toArray();

      const totalPages = Math.max(1, Math.ceil(total / parsed.limit));
      res.json({
        recordings: docs,
        total,
        limit: parsed.limit,
        skip: parsed.skip,
        page: parsed.page,
        totalPages,
        sortBy: parsed.sortBy,
        sortDir: parsed.sortDir === 1 ? "asc" : "desc",
        excludeVoicemail: parsed.excludeVoicemail,
        voicemailMaxSec: VOICEMAIL_MAX_DURATION_SEC,
        filters: {
          dateFrom: parsed.dateFrom,
          dateTo: parsed.dateTo,
          minDuration: parsed.minDuration,
          maxDuration: parsed.maxDuration,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: message });
    }
  });

  /**
   * POST /recordings/db/:callId/analyze
   * Must be registered before GET /:callId
   */
  router.post("/:callId/analyze", async (req, res) => {
    const callId = Number(req.params.callId);
    if (!Number.isFinite(callId)) {
      res.status(400).json({ error: "Invalid callId" });
      return;
    }

    const recordingIdRaw = req.body?.recordingId ?? req.query.recordingId;
    const recordingId =
      recordingIdRaw != null && String(recordingIdRaw).trim() !== ""
        ? Number(recordingIdRaw)
        : undefined;

    req.setTimeout(20 * 60 * 1000);
    res.setTimeout(20 * 60 * 1000);

    try {
      const { recording, reused } = await analyzeRecordingOnce(callId, recordingId);
      await upsertRecordingListing(recording);
      res.status(reused ? 200 : 201).json({
        reused,
        recording: toDetail(recording, true),
      });
    } catch (error) {
      const status = (error as { status?: number }).status ?? 500;
      const message = error instanceof Error ? error.message : String(error);
      res.status(status).json({ error: message });
    }
  });

  /** GET /recordings/db/:callId/audio */
  router.get("/:callId/audio", async (req, res) => {
    try {
      const callId = Number(req.params.callId);
      if (!Number.isFinite(callId)) {
        res.status(400).json({ error: "Invalid callId" });
        return;
      }

      const recordingIdParam = req.query.recordingId;
      const recordingId =
        recordingIdParam != null && String(recordingIdParam).trim() !== ""
          ? Number(recordingIdParam)
          : undefined;

      const doc = await findByCallId(callId, recordingId);
      if (!doc) {
        res.status(404).json({ error: `Recording not found for call ${callId}` });
        return;
      }

      if (!doc.localPath) {
        res.status(404).json({
          error: "Local audio not available. Re-run import:recordings to download.",
        });
        return;
      }

      try {
        await fs.access(doc.localPath);
      } catch {
        res.status(404).json({ error: "Audio file missing on disk", path: doc.localPath });
        return;
      }

      res.sendFile(path.resolve(doc.localPath));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: message });
    }
  });

  /** GET /recordings/db/:callId */
  router.get("/:callId", async (req, res) => {
    try {
      const callId = Number(req.params.callId);
      if (!Number.isFinite(callId)) {
        res.status(400).json({ error: "Invalid callId" });
        return;
      }

      const recordingIdParam = req.query.recordingId;
      const recordingId =
        recordingIdParam != null && String(recordingIdParam).trim() !== ""
          ? Number(recordingIdParam)
          : undefined;

      const includeAnalysis = String(req.query.includeAnalysis ?? "true") !== "false";
      const doc = await findByCallId(callId, recordingId);
      if (!doc) {
        res.status(404).json({ error: `Recording not found for call ${callId}` });
        return;
      }

      res.json({ recording: toDetail(doc, includeAnalysis) });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: message });
    }
  });

  return router;
}
