import type { SelectQueryBuilder } from "typeorm";
import { AppDataSource, isPostgresConfigured } from "./data-source.js";
import type { AgentDocument } from "../agents.js";
import type { RecordingDocument } from "../mongo.js";
import type { RecordingListingDoc } from "../recordingListings.js";
import type { CronJobLogDocument, ExportJobDocument } from "../syncCollections.js";
import { AgentEntity } from "./entities/AgentEntity.js";
import { CronJobLogEntity } from "./entities/CronJobLogEntity.js";
import { ExportJobEntity } from "./entities/ExportJobEntity.js";
import { RecordingEntity } from "./entities/RecordingEntity.js";
import { RecordingListingEntity } from "./entities/RecordingListingEntity.js";
import {
  agentEntityToDoc,
  cronLogEntityToDoc,
  exportJobEntityToDoc,
  listingEntityToDoc,
  recordingEntityToDoc,
} from "./readMappers.js";
import { VOICEMAIL_MAX_DURATION_SEC } from "../../voicemail.js";

/** Phase 3: prefer Postgres reads when connected (disable with POSTGRES_READS=false). */
export function postgresReadsEnabled(): boolean {
  if (!isPostgresConfigured() || !AppDataSource.isInitialized) return false;
  return String(process.env.POSTGRES_READS ?? "true").toLowerCase() !== "false";
}

const FORWARDED_MAIL_PG =
  "(vm|v\\/m|voicemail|voice mail|voice-mail|forwarded mail|forwarding mail|fwd mail|mail forward)";

export type ListQueryParams = {
  status?: string;
  hasAudio?: string;
  q?: string;
  dateFrom?: string;
  dateTo?: string;
  minDuration?: number | null;
  maxDuration?: number | null;
  excludeVoicemail: boolean;
  sortBy: string;
  sortDir: 1 | -1;
  skip: number;
  limit: number;
};

const LISTING_SORT: Record<string, string> = {
  createdTime: "created_time",
  durationSec: "duration_sec",
  agentName: "agent_name",
  analysisStatus: "analysis_status",
  callId: "call_id",
  updatedAt: "updated_at",
};

function applyListingFilters(
  qb: SelectQueryBuilder<RecordingListingEntity>,
  params: ListQueryParams,
  alias: string,
): void {
  qb.andWhere(`${alias}.is_voicemail = false`);
  qb.andWhere(`${alias}.bot_handling <> 'bot_only'`);
  qb.andWhere(`(${alias}.call_notes IS NULL OR ${alias}.call_notes !~* :fwdMail)`, {
    fwdMail: FORWARDED_MAIL_PG,
  });

  if (params.excludeVoicemail) {
    qb.andWhere(`(${alias}.duration_sec IS NULL OR ${alias}.duration_sec > :vmMax)`, {
      vmMax: VOICEMAIL_MAX_DURATION_SEC,
    });
  }

  if (params.status && params.status !== "all") {
    qb.andWhere(`${alias}.analysis_status = :status`, { status: params.status });
  }
  if (params.hasAudio === "true") {
    qb.andWhere(`${alias}.has_local_audio = true`);
  } else if (params.hasAudio === "false") {
    qb.andWhere(`${alias}.has_local_audio = false`);
  }

  if (params.dateFrom) {
    qb.andWhere(`${alias}.created_time >= :dateFrom`, {
      dateFrom: new Date(params.dateFrom),
    });
  }
  if (params.dateTo) {
    const end = /^\d{4}-\d{2}-\d{2}$/.test(params.dateTo)
      ? `${params.dateTo}T23:59:59.999Z`
      : params.dateTo;
    qb.andWhere(`${alias}.created_time <= :dateTo`, { dateTo: new Date(end) });
  }

  if (params.minDuration != null && Number.isFinite(params.minDuration)) {
    qb.andWhere(`${alias}.duration_sec >= :minDuration`, { minDuration: params.minDuration });
  }
  if (params.maxDuration != null && Number.isFinite(params.maxDuration)) {
    qb.andWhere(`${alias}.duration_sec <= :maxDuration`, { maxDuration: params.maxDuration });
  }

  if (params.q) {
    const q = params.q;
    const like = `%${q.replace(/[%_]/g, "\\$&")}%`;
    const orParts = [
      `${alias}.agent_name ILIKE :q`,
      `${alias}.phone_number ILIKE :q`,
      `${alias}.call_notes ILIKE :q`,
      `${alias}.customer_name ILIKE :q`,
      `${alias}.participants::text ILIKE :q`,
    ];
    if (Number.isFinite(Number(q))) {
      orParts.push(`${alias}.call_id = :qCallId`);
      qb.setParameter("qCallId", String(Number(q)));
    }
    qb.andWhere(`(${orParts.join(" OR ")})`, { q: like });
  }
}

function applyRecordingsAudioFilter(
  qb: SelectQueryBuilder<RecordingEntity>,
  hasAudio: string | undefined,
  alias: string,
): void {
  if (hasAudio === "true") {
    qb.andWhere(
      `((${alias}.local_path IS NOT NULL AND ${alias}.local_path <> '') OR (${alias}.s3_key IS NOT NULL AND ${alias}.s3_key <> ''))`,
    );
  } else if (hasAudio === "false") {
    qb.andWhere(
      `((${alias}.local_path IS NULL OR ${alias}.local_path = '') AND (${alias}.s3_key IS NULL OR ${alias}.s3_key = ''))`,
    );
  }
}

export async function pgCountListings(): Promise<number> {
  return AppDataSource.getRepository(RecordingListingEntity).count();
}

export async function pgFindRecording(
  callId: number,
  recordingId?: number,
): Promise<RecordingDocument | null> {
  const repo = AppDataSource.getRepository(RecordingEntity);
  if (recordingId != null && Number.isFinite(recordingId)) {
    const row = await repo.findOneBy({
      callId: String(callId),
      recordingId: String(recordingId),
    });
    return row ? recordingEntityToDoc(row) : null;
  }
  const row = await repo.findOne({
    where: { callId: String(callId) },
    order: { updatedAt: "DESC" },
  });
  return row ? recordingEntityToDoc(row) : null;
}

export async function pgListListings(
  params: ListQueryParams,
): Promise<{ total: number; docs: RecordingListingDoc[] }> {
  const repo = AppDataSource.getRepository(RecordingListingEntity);
  const qb = repo.createQueryBuilder("l");
  applyListingFilters(qb, params, "l");
  const sortCol = LISTING_SORT[params.sortBy] ?? "created_time";
  const dir = params.sortDir === 1 ? "ASC" : "DESC";
  qb.orderBy(`l.${sortCol}`, dir, "NULLS LAST");
  qb.skip(params.skip).take(params.limit);

  const [rows, total] = await qb.getManyAndCount();
  return { total, docs: rows.map(listingEntityToDoc) };
}

export async function pgListRecordings(
  params: ListQueryParams,
): Promise<{ total: number; docs: RecordingDocument[] }> {
  const repo = AppDataSource.getRepository(RecordingEntity);
  const qb = repo.createQueryBuilder("r");
  // Same exclusion rules as listings
  qb.andWhere("r.is_voicemail = false");
  qb.andWhere("r.bot_handling <> 'bot_only'");
  qb.andWhere(`(r.call_notes IS NULL OR r.call_notes !~* :fwdMail)`, {
    fwdMail: FORWARDED_MAIL_PG,
  });
  if (params.excludeVoicemail) {
    qb.andWhere(`(r.duration_sec IS NULL OR r.duration_sec > :vmMax)`, {
      vmMax: VOICEMAIL_MAX_DURATION_SEC,
    });
  }
  if (params.status && params.status !== "all") {
    qb.andWhere("r.analysis_status = :status", { status: params.status });
  }
  applyRecordingsAudioFilter(qb, params.hasAudio, "r");
  if (params.dateFrom) {
    qb.andWhere("r.created_time >= :dateFrom", { dateFrom: new Date(params.dateFrom) });
  }
  if (params.dateTo) {
    const end = /^\d{4}-\d{2}-\d{2}$/.test(params.dateTo)
      ? `${params.dateTo}T23:59:59.999Z`
      : params.dateTo;
    qb.andWhere("r.created_time <= :dateTo", { dateTo: new Date(end) });
  }
  if (params.minDuration != null && Number.isFinite(params.minDuration)) {
    qb.andWhere("r.duration_sec >= :minDuration", { minDuration: params.minDuration });
  }
  if (params.maxDuration != null && Number.isFinite(params.maxDuration)) {
    qb.andWhere("r.duration_sec <= :maxDuration", { maxDuration: params.maxDuration });
  }
  if (params.q) {
    const q = params.q;
    const like = `%${q.replace(/[%_]/g, "\\$&")}%`;
    const orParts = [
      "r.agent_name ILIKE :q",
      "r.phone_number ILIKE :q",
      "r.call_notes ILIKE :q",
      "r.participants::text ILIKE :q",
    ];
    if (Number.isFinite(Number(q))) {
      orParts.push("r.call_id = :qCallId");
      qb.setParameter("qCallId", String(Number(q)));
    }
    qb.andWhere(`(${orParts.join(" OR ")})`, { q: like });
  }

  const sortCol = LISTING_SORT[params.sortBy] ?? "created_time";
  const dir = params.sortDir === 1 ? "ASC" : "DESC";
  qb.orderBy(`r.${sortCol}`, dir, "NULLS LAST");
  qb.skip(params.skip).take(params.limit);

  const [rows, total] = await qb.getManyAndCount();
  return { total, docs: rows.map(recordingEntityToDoc) };
}

export async function pgFindAgent(agentId: string): Promise<AgentDocument | null> {
  const row = await AppDataSource.getRepository(AgentEntity).findOneBy({ agentId });
  return row ? agentEntityToDoc(row) : null;
}

export async function pgListAgents(input: {
  q?: string;
  skip: number;
  limit: number;
}): Promise<{ total: number; docs: AgentDocument[] }> {
  const repo = AppDataSource.getRepository(AgentEntity);
  const qb = repo.createQueryBuilder("a");
  if (input.q) {
    qb.andWhere("a.name ILIKE :q", { q: `%${input.q.replace(/[%_]/g, "\\$&")}%` });
  }
  qb.orderBy("a.last_call_at", "DESC", "NULLS LAST").addOrderBy("a.name", "ASC");
  qb.skip(input.skip).take(input.limit);
  const [rows, total] = await qb.getManyAndCount();
  return { total, docs: rows.map(agentEntityToDoc) };
}

export async function pgRecordingsForAgents(
  agentIds: string[],
): Promise<Array<RecordingDocument & { agentId?: string | null }>> {
  if (agentIds.length === 0) return [];
  const rows = await AppDataSource.getRepository(RecordingEntity)
    .createQueryBuilder("r")
    .where("r.agent_id IN (:...agentIds)", { agentIds })
    .getMany();
  return rows.map((row) => recordingEntityToDoc(row));
}

export async function pgRecordingsForAgent(agentId: string): Promise<RecordingDocument[]> {
  const rows = await AppDataSource.getRepository(RecordingEntity).find({
    where: { agentId },
  });
  return rows.map(recordingEntityToDoc);
}

export async function pgLatestExportJob(trigger?: "cron"): Promise<ExportJobDocument | null> {
  const qb = AppDataSource.getRepository(ExportJobEntity)
    .createQueryBuilder("j")
    .orderBy("j.started_at", "DESC")
    .take(1);
  if (trigger) qb.where("j.trigger = :trigger", { trigger });
  const row = await qb.getOne();
  return row ? exportJobEntityToDoc(row) : null;
}

export async function pgListExportJobs(input: {
  skip: number;
  limit: number;
}): Promise<{ total: number; docs: ExportJobDocument[] }> {
  const repo = AppDataSource.getRepository(ExportJobEntity);
  const [rows, total] = await repo.findAndCount({
    order: { startedAt: "DESC" },
    skip: input.skip,
    take: input.limit,
  });
  return { total, docs: rows.map(exportJobEntityToDoc) };
}

export async function pgFindExportJob(callDate: string): Promise<ExportJobDocument | null> {
  const row = await AppDataSource.getRepository(ExportJobEntity).findOneBy({ callDate });
  return row ? exportJobEntityToDoc(row) : null;
}

export async function pgListCronLogs(input: {
  filter: { runId?: string; callDate?: string; level?: string; dateFrom?: string; dateTo?: string };
  skip: number;
  limit: number;
}): Promise<{ total: number; docs: CronJobLogDocument[] }> {
  const qb = AppDataSource.getRepository(CronJobLogEntity).createQueryBuilder("c");
  if (input.filter.runId) qb.andWhere("c.run_id = :runId", { runId: input.filter.runId });
  if (input.filter.callDate) qb.andWhere("c.call_date = :callDate", { callDate: input.filter.callDate });
  if (input.filter.level) qb.andWhere("c.level = :level", { level: input.filter.level });
  if (input.filter.dateFrom) {
    qb.andWhere("c.call_date >= :dateFrom", { dateFrom: input.filter.dateFrom });
  }
  if (input.filter.dateTo) {
    qb.andWhere("c.call_date <= :dateTo", { dateTo: input.filter.dateTo });
  }
  qb.orderBy("c.created_at", "DESC").skip(input.skip).take(input.limit);
  const [rows, total] = await qb.getManyAndCount();
  return { total, docs: rows.map(cronLogEntityToDoc) };
}

export async function pgListCronRuns(input: {
  skip: number;
  limit: number;
}): Promise<{
  total: number;
  items: Array<{
    runId: string;
    callDate: string;
    trigger: string;
    exportJobId?: number | null;
    lastLevel: string;
    lastPhase: string;
    lastMessage: string;
    startedAt: string;
    finishedAt: string;
    lineCount: number;
    errorCount: number;
  }>;
}> {
  const countRows = await AppDataSource.query(`
    SELECT COUNT(*)::int AS count FROM (
      SELECT run_id FROM cron_job_logs GROUP BY run_id
    ) t
  `);
  const total = Number(countRows[0]?.count ?? 0);

  const rows = await AppDataSource.query(
    `
    SELECT
      run_id AS "runId",
      (array_agg(call_date ORDER BY created_at DESC))[1]::text AS "callDate",
      (array_agg(trigger ORDER BY created_at DESC))[1] AS trigger,
      (array_agg(export_job_id ORDER BY created_at DESC))[1] AS "exportJobId",
      (array_agg(level ORDER BY created_at DESC))[1] AS "lastLevel",
      (array_agg(phase ORDER BY created_at DESC))[1] AS "lastPhase",
      (array_agg(message ORDER BY created_at DESC))[1] AS "lastMessage",
      MIN(created_at) AS "startedAt",
      MAX(created_at) AS "finishedAt",
      COUNT(*)::int AS "lineCount",
      COUNT(*) FILTER (WHERE level = 'error')::int AS "errorCount"
    FROM cron_job_logs
    GROUP BY run_id
    ORDER BY MIN(created_at) DESC
    OFFSET $1 LIMIT $2
  `,
    [input.skip, input.limit],
  );

  return {
    total,
    items: rows.map(
      (r: {
        runId: string;
        callDate: string;
        trigger: string;
        exportJobId: string | number | null;
        lastLevel: string;
        lastPhase: string;
        lastMessage: string;
        startedAt: Date | string;
        finishedAt: Date | string;
        lineCount: number;
        errorCount: number;
      }) => ({
        runId: r.runId,
        callDate: String(r.callDate).slice(0, 10),
        trigger: r.trigger,
        exportJobId: r.exportJobId == null ? null : Number(r.exportJobId),
        lastLevel: r.lastLevel,
        lastPhase: r.lastPhase,
        lastMessage: r.lastMessage,
        startedAt: new Date(r.startedAt).toISOString(),
        finishedAt: new Date(r.finishedAt).toISOString(),
        lineCount: r.lineCount,
        errorCount: r.errorCount,
      }),
    ),
  };
}

export async function pgCronLogsForRun(runId: string): Promise<CronJobLogDocument[]> {
  const rows = await AppDataSource.getRepository(CronJobLogEntity).find({
    where: { runId },
    order: { createdAt: "ASC" },
  });
  return rows.map(cronLogEntityToDoc);
}
