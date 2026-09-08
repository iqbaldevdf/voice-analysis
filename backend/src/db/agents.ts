import type { Collection } from "mongodb";
import { getDb, recordingsCollection, type RecordingDocument } from "./mongo.js";

export type AgentDocument = {
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
  createdAt: Date;
  updatedAt: Date;
};

export function agentsCollection(): Collection<AgentDocument> {
  return getDb().collection<AgentDocument>("agents");
}

export function agentKey(input: {
  assignedAgentId?: number | null;
  agentName?: string | null;
}): string | null {
  if (input.assignedAgentId != null && Number.isFinite(input.assignedAgentId)) {
    return `fc:${input.assignedAgentId}`;
  }
  const name = (input.agentName ?? "").trim();
  if (!name) return null;
  return `name:${name.toLowerCase().replace(/\s+/g, " ")}`;
}

export async function upsertAgentFromRecording(input: {
  assignedAgentId?: number | null;
  agentName?: string | null;
  teamName?: string | null;
  createdTime?: string | null;
}): Promise<string | null> {
  const agentId = agentKey(input);
  const name = (input.agentName ?? "").trim();
  if (!agentId || !name) return null;

  const now = new Date();
  const existing = await agentsCollection().findOne({ agentId });
  const createdTime = input.createdTime ?? null;
  const firstCallAt =
    !existing?.firstCallAt || (createdTime && createdTime < existing.firstCallAt)
      ? createdTime
      : existing.firstCallAt;
  const lastCallAt =
    !existing?.lastCallAt || (createdTime && createdTime > existing.lastCallAt)
      ? createdTime
      : existing.lastCallAt;

  await agentsCollection().updateOne(
    { agentId },
    {
      $set: {
        agentId,
        freshcallerAgentId: input.assignedAgentId ?? existing?.freshcallerAgentId ?? null,
        name,
        teamName: input.teamName ?? existing?.teamName ?? null,
        firstCallAt,
        lastCallAt,
        updatedAt: now,
      },
      $setOnInsert: {
        callCount: 0,
        recordingCount: 0,
        analyzedCount: 0,
        averageScore: null,
        createdAt: now,
      },
    },
    { upsert: true },
  );
  return agentId;
}

export async function refreshAgentStats(agentId: string): Promise<void> {
  const recordings = await recordingsCollection()
    .find({ agentId })
    .project({ callId: 1, analysisStatus: 1, analysisResult: 1, createdTime: 1 })
    .toArray();

  const callIds = new Set<number>();
  let analyzedCount = 0;
  let scoreSum = 0;
  let scoreCount = 0;
  let firstCallAt: string | null = null;
  let lastCallAt: string | null = null;

  for (const rec of recordings) {
    callIds.add(rec.callId);
    if (rec.createdTime) {
      if (!firstCallAt || rec.createdTime < firstCallAt) firstCallAt = rec.createdTime;
      if (!lastCallAt || rec.createdTime > lastCallAt) lastCallAt = rec.createdTime;
    }
    const performance = (
      rec.analysisResult as { participant_performance?: Array<{ participantRole?: string; overallScore?: number | null }> } | undefined
    )?.participant_performance;
    const agentScore = performance?.find((item) => item.participantRole === "agent")?.overallScore;
    if (rec.analysisStatus === "completed") analyzedCount += 1;
    if (typeof agentScore === "number") {
      scoreSum += agentScore;
      scoreCount += 1;
    }
  }

  await agentsCollection().updateOne(
    { agentId },
    {
      $set: {
        callCount: callIds.size,
        recordingCount: recordings.length,
        analyzedCount,
        averageScore: scoreCount ? Math.round((scoreSum / scoreCount) * 10) / 10 : null,
        firstCallAt,
        lastCallAt,
        updatedAt: new Date(),
      },
    },
  );
}

export async function backfillAgentsFromRecordings(): Promise<number> {
  const cursor = recordingsCollection().find({});
  const seen = new Set<string>();
  for await (const doc of cursor) {
    const agentId = await upsertAgentFromRecording({
      assignedAgentId: agentIdNumber(doc),
      agentName: doc.agentName,
      createdTime: doc.createdTime,
    });
    if (!agentId) continue;
    if (doc.agentId !== agentId) {
      await recordingsCollection().updateOne(
        { callId: doc.callId, recordingId: doc.recordingId },
        { $set: { agentId } },
      );
    }
    seen.add(agentId);
  }
  for (const agentId of seen) {
    await refreshAgentStats(agentId);
  }
  return seen.size;
}

function agentIdNumber(doc: RecordingDocument): number | null {
  if (doc.agentId?.startsWith("fc:")) {
    const value = Number(doc.agentId.slice(3));
    return Number.isFinite(value) ? value : null;
  }
  return null;
}
