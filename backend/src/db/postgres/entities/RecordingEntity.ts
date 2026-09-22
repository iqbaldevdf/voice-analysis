import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from "typeorm";

export type PgAnalysisStatus =
  | "none"
  | "queued"
  | "transcribing"
  | "running"
  | "awaiting_transcript_review"
  | "completed"
  | "failed";

export type PgSalesDisposition =
  | "hung_up"
  | "not_interested"
  | "appointment"
  | "follow_up"
  | "dnc";

export type PgBotHandling = "none" | "bot_only" | "bot_transferred";

@Entity({ name: "recordings" })
@Index("idx_recordings_analysis_status", ["analysisStatus"])
@Index("idx_recordings_created_time", ["createdTime"])
@Index("idx_recordings_call_date", ["callDate"])
@Index("idx_recordings_agent_created", ["agentId", "createdTime"])
@Index("idx_recordings_voicemail_created", ["isVoicemail", "createdTime"])
export class RecordingEntity {
  @PrimaryColumn({ name: "call_id", type: "bigint" })
  callId!: string;

  @PrimaryColumn({ name: "recording_id", type: "bigint" })
  recordingId!: string;

  @Column({ name: "export_job_id", type: "bigint", nullable: true })
  exportJobId!: string | null;

  @Column({ name: "source_file", type: "text", nullable: true })
  sourceFile!: string | null;

  @Column({ type: "text", nullable: true })
  direction!: string | null;

  @Column({ name: "created_time", type: "timestamptz", nullable: true })
  createdTime!: Date | null;

  @Column({ name: "agent_id", type: "text", nullable: true })
  agentId!: string | null;

  @Column({ name: "agent_name", type: "text", nullable: true })
  agentName!: string | null;

  @Column({ name: "phone_number", type: "text", nullable: true })
  phoneNumber!: string | null;

  @Column({ name: "call_notes", type: "text", nullable: true })
  callNotes!: string | null;

  @Column({ type: "jsonb", default: () => "'[]'::jsonb" })
  participants!: unknown[];

  @Column({ name: "recording_url", type: "text" })
  recordingUrl!: string;

  @Column({ name: "duration_sec", type: "integer", nullable: true })
  durationSec!: number | null;

  /** IST calendar day YYYY-MM-DD */
  @Column({ name: "call_date", type: "date", nullable: true })
  callDate!: string | null;

  @Column({ name: "is_voicemail", type: "boolean", default: false })
  isVoicemail!: boolean;

  @Column({ name: "is_connected", type: "boolean", nullable: true })
  isConnected!: boolean | null;

  @Column({ name: "call_status", type: "integer", nullable: true })
  callStatus!: number | null;

  @Column({ name: "bot_handling", type: "text", default: "none" })
  botHandling!: PgBotHandling;

  @Column({ name: "is_bot_involved", type: "boolean", default: false })
  isBotInvolved!: boolean;

  @Column({ type: "text", nullable: true })
  disposition!: PgSalesDisposition | null;

  @Column({ name: "local_path", type: "text", nullable: true })
  localPath!: string | null;

  @Column({ name: "local_file_name", type: "text", nullable: true })
  localFileName!: string | null;

  @Column({ name: "s3_bucket", type: "text", nullable: true })
  s3Bucket!: string | null;

  @Column({ name: "s3_key", type: "text", nullable: true })
  s3Key!: string | null;

  @Column({ name: "analysis_status", type: "text", default: "none" })
  analysisStatus!: PgAnalysisStatus;

  @Column({ name: "analysis_error", type: "text", nullable: true })
  analysisError!: string | null;

  @Column({ name: "analyzed_at", type: "timestamptz", nullable: true })
  analyzedAt!: Date | null;

  @Column({ name: "analysis_result", type: "jsonb", nullable: true })
  analysisResult!: unknown | null;

  @Column({ name: "analysis_corrections", type: "jsonb", default: () => "'[]'::jsonb" })
  analysisCorrections!: unknown[];

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;
}
