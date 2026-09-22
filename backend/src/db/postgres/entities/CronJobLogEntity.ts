import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from "typeorm";

@Entity({ name: "cron_job_logs" })
@Index("idx_cron_logs_run_created", ["runId", "createdAt"])
@Index("idx_cron_logs_date_created", ["callDate", "createdAt"])
@Index("idx_cron_logs_level_created", ["level", "createdAt"])
export class CronJobLogEntity {
  @PrimaryGeneratedColumn({ type: "bigint" })
  id!: string;

  @Column({ name: "run_id", type: "text" })
  runId!: string;

  @Column({ name: "export_job_id", type: "bigint", nullable: true })
  exportJobId!: string | null;

  @Column({ name: "call_date", type: "date" })
  callDate!: string;

  @Column({ type: "text" })
  trigger!: "cron" | "manual" | "cli";

  @Column({ type: "text" })
  level!: "info" | "warn" | "error";

  @Column({ type: "text" })
  phase!: string;

  @Column({ type: "text" })
  message!: string;

  @Column({ type: "jsonb", nullable: true })
  meta!: Record<string, unknown> | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;
}
