import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from "typeorm";
import type { PgAnalysisStatus, PgBotHandling, PgSalesDisposition } from "./RecordingEntity.js";

@Entity({ name: "recording_listings" })
@Index("idx_listing_created_time", ["createdTime"])
@Index("idx_listing_call_date", ["callDate"])
@Index("idx_listing_agent_created", ["agentId", "createdTime"])
@Index("idx_listing_voicemail", ["isVoicemail"])
@Index("idx_listing_connected_created", ["isConnected", "createdTime"])
@Index("idx_listing_bot_created", ["botHandling", "createdTime"])
export class RecordingListingEntity {
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

  @Column({ name: "customer_name", type: "text", nullable: true })
  customerName!: string | null;

  @Column({ name: "call_notes", type: "text", nullable: true })
  callNotes!: string | null;

  @Column({ type: "jsonb", default: () => "'[]'::jsonb" })
  participants!: unknown[];

  @Column({ name: "recording_url", type: "text" })
  recordingUrl!: string;

  @Column({ name: "duration_sec", type: "integer", nullable: true })
  durationSec!: number | null;

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

  @Column({ name: "local_file_name", type: "text", nullable: true })
  localFileName!: string | null;

  @Column({ name: "has_local_audio", type: "boolean", default: false })
  hasLocalAudio!: boolean;

  @Column({ name: "analysis_status", type: "text", default: "none" })
  analysisStatus!: PgAnalysisStatus;

  @Column({ name: "analysis_error", type: "text", nullable: true })
  analysisError!: string | null;

  @Column({ name: "analyzed_at", type: "timestamptz", nullable: true })
  analyzedAt!: Date | null;

  @Column({ name: "audio_clarity_flag", type: "text", nullable: true })
  audioClarityFlag!: string | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;
}
