import "dotenv/config";
import "reflect-metadata";
import { DataSource } from "typeorm";
import {
  AgentEntity,
  CronJobLogEntity,
  ExportJobEntity,
  RecordingEntity,
  RecordingListingEntity,
} from "./entities/index.js";
import { InitVoiceAnalysis1760000000000 } from "./migrations/1760000000000-InitVoiceAnalysis.js";

export function getDatabaseUrl(): string | null {
  const url = (process.env.DATABASE_URL ?? "").trim();
  return url || null;
}

export function isPostgresConfigured(): boolean {
  return getDatabaseUrl() != null;
}

const defaultLocalUrl = "postgres://voiceiq:voiceiq@127.0.0.1:5432/voice_analysis";

/**
 * Shared DataSource for app boot and TypeORM CLI (`migration:run`).
 * `synchronize` is always false — schema changes only via migrations (F12).
 */
export const AppDataSource = new DataSource({
  type: "postgres",
  url: getDatabaseUrl() ?? defaultLocalUrl,
  entities: [RecordingEntity, RecordingListingEntity, AgentEntity, ExportJobEntity, CronJobLogEntity],
  migrations: [InitVoiceAnalysis1760000000000],
  migrationsTableName: "typeorm_migrations",
  synchronize: false,
  logging: process.env.TYPEORM_LOGGING === "true",
});
