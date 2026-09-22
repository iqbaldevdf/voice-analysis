import "reflect-metadata";
import { AppDataSource, getDatabaseUrl, isPostgresConfigured } from "./data-source.js";

export { AppDataSource, getDatabaseUrl, isPostgresConfigured } from "./data-source.js";
export * from "./entities/index.js";

let connected = false;

export function isPostgresConnected(): boolean {
  return connected && AppDataSource.isInitialized;
}

/**
 * Connect when DATABASE_URL is set. No-op when unset (Mongo/Atlas-only deploys).
 * Runs pending TypeORM migrations on connect (local-first Phase 1).
 */
export async function connectPostgres(): Promise<boolean> {
  if (!isPostgresConfigured()) {
    connected = false;
    return false;
  }
  if (AppDataSource.isInitialized) {
    connected = true;
    return true;
  }

  await AppDataSource.initialize();
  await AppDataSource.runMigrations({ transaction: "each" });
  connected = true;
  return true;
}

export async function pingPostgres(): Promise<boolean> {
  if (!isPostgresConfigured()) return false;
  try {
    if (!AppDataSource.isInitialized) {
      await connectPostgres();
    }
    if (!AppDataSource.isInitialized) return false;
    await AppDataSource.query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}

export async function closePostgres(): Promise<void> {
  if (AppDataSource.isInitialized) {
    await AppDataSource.destroy();
  }
  connected = false;
}

/** Redact credentials for logs / health. */
export function getDatabaseUrlForLog(): string | null {
  const url = getDatabaseUrl();
  if (!url) return null;
  return url.replace(/\/\/([^@/]+)@/, "//***@");
}
