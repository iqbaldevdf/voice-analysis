import { AppDataSource, isPostgresConfigured } from "./data-source.js";
import { AgentEntity } from "./entities/AgentEntity.js";
import { CronJobLogEntity } from "./entities/CronJobLogEntity.js";
import { ExportJobEntity } from "./entities/ExportJobEntity.js";
import { RecordingEntity } from "./entities/RecordingEntity.js";
import { RecordingListingEntity } from "./entities/RecordingListingEntity.js";
import type { AgentDocument } from "../agents.js";
import type { RecordingDocument } from "../mongo.js";
import { toListingDoc } from "../recordingListings.js";
import type { CronJobLogDocument, ExportJobDocument } from "../syncCollections.js";
import {
  agentDocToEntity,
  cronLogDocToEntity,
  exportJobDocToEntity,
  listingDocToEntity,
  recordingDocToEntity,
} from "./mappers.js";

function ready(): boolean {
  return isPostgresConfigured() && AppDataSource.isInitialized;
}

function logDualWriteError(scope: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  console.warn(`[postgres dual-write] ${scope}: ${message}`);
}

/** Upsert recordings + recording_listings from a Mongo recording doc (F12 Phase 2). */
export async function dualWriteRecordingPair(doc: RecordingDocument): Promise<void> {
  if (!ready()) return;
  try {
    const recordingRepo = AppDataSource.getRepository(RecordingEntity);
    const listingRepo = AppDataSource.getRepository(RecordingListingEntity);
    await recordingRepo.upsert(recordingDocToEntity(doc) as never, {
      conflictPaths: ["callId", "recordingId"],
      skipUpdateIfNoValuesChanged: false,
    });
    await listingRepo.upsert(listingDocToEntity(toListingDoc(doc)) as never, {
      conflictPaths: ["callId", "recordingId"],
      skipUpdateIfNoValuesChanged: false,
    });
  } catch (error) {
    logDualWriteError(`recording ${doc.callId}/${doc.recordingId}`, error);
  }
}

/** Patch analysis_result when fill scripts update Mongo without a full reload. */
export async function dualWriteRecordingAnalysisPatch(input: {
  callId: number;
  recordingId: number;
  analysisResult: unknown;
  updatedAt?: Date;
}): Promise<void> {
  if (!ready()) return;
  try {
    await AppDataSource.getRepository(RecordingEntity).update(
      { callId: String(input.callId), recordingId: String(input.recordingId) },
      {
        analysisResult: input.analysisResult as never,
        updatedAt: input.updatedAt ?? new Date(),
      },
    );
  } catch (error) {
    logDualWriteError(`analysis patch ${input.callId}/${input.recordingId}`, error);
  }
}

export async function dualWriteAgent(doc: AgentDocument): Promise<void> {
  if (!ready()) return;
  try {
    await AppDataSource.getRepository(AgentEntity).upsert(agentDocToEntity(doc) as never, {
      conflictPaths: ["agentId"],
      skipUpdateIfNoValuesChanged: false,
    });
  } catch (error) {
    logDualWriteError(`agent ${doc.agentId}`, error);
  }
}

export async function dualWriteExportJob(doc: ExportJobDocument): Promise<void> {
  if (!ready()) return;
  try {
    await AppDataSource.getRepository(ExportJobEntity).upsert(exportJobDocToEntity(doc) as never, {
      conflictPaths: ["callDate"],
      skipUpdateIfNoValuesChanged: false,
    });
  } catch (error) {
    logDualWriteError(`export_job ${doc.callDate}`, error);
  }
}

export async function dualWriteCronLog(doc: CronJobLogDocument): Promise<void> {
  if (!ready()) return;
  try {
    await AppDataSource.getRepository(CronJobLogEntity).insert(cronLogDocToEntity(doc) as never);
  } catch (error) {
    logDualWriteError(`cron_log ${doc.runId}`, error);
  }
}
