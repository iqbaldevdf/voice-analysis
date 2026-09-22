import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from "typeorm";

export type PgExportJobPhase =
  | "queued"
  | "export"
  | "poll"
  | "zip"
  | "index"
  | "download"
  | "complete"
  | "failed";

export type PgExportJobStatus =
  | "started"
  | "in_progress"
  | "downloading"
  | "indexing"
  | "downloading_audio"
  | "completed"
  | "failed"
  | "skipped";

@Entity({ name: "export_jobs" })
@Index("uq_export_jobs_run_id", ["runId"], { unique: true })
@Index("idx_export_jobs_job_id", ["jobId"])
@Index("idx_export_jobs_started_at", ["startedAt"])
export class ExportJobEntity {
  /** IST call date — unique sync key (same as Mongo). */
  @PrimaryColumn({ name: "call_date", type: "date" })
  callDate!: string;

  @Column({ name: "job_id", type: "bigint", nullable: true })
  jobId!: string | null;

  @Column({ name: "run_id", type: "text" })
  runId!: string;

  @Column({ name: "start_date", type: "text" })
  startDate!: string;

  @Column({ name: "end_date", type: "text" })
  endDate!: string;

  @Column({ type: "text" })
  status!: PgExportJobStatus;

  @Column({ type: "text" })
  phase!: PgExportJobPhase;

  @Column({ name: "phase_message", type: "text", nullable: true })
  phaseMessage!: string | null;

  @Column({ type: "text" })
  trigger!: "cron" | "manual" | "cli";

  @Column({ name: "download_path", type: "text", nullable: true })
  downloadPath!: string | null;

  @Column({ name: "call_count", type: "integer", default: 0 })
  callCount!: number;

  @Column({ name: "calls_with_recording", type: "integer", default: 0 })
  callsWithRecording!: number;

  @Column({ name: "voicemail_skipped", type: "integer", default: 0 })
  voicemailSkipped!: number;

  @Column({ name: "audio_downloaded", type: "integer", default: 0 })
  audioDownloaded!: number;

  @Column({ name: "audio_failed", type: "integer", default: 0 })
  audioFailed!: number;

  @Column({ name: "calls_indexed", type: "integer", default: 0 })
  callsIndexed!: number;

  @Column({ type: "text", nullable: true })
  error!: string | null;

  @Column({ name: "started_at", type: "timestamptz" })
  startedAt!: Date;

  @Column({ name: "finished_at", type: "timestamptz", nullable: true })
  finishedAt!: Date | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;
}
