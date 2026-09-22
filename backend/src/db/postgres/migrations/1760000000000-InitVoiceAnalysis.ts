import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * F12 Phase 1 — initial VoiceIQ Postgres schema (mirrors Mongo collections).
 */
export class InitVoiceAnalysis1760000000000 implements MigrationInterface {
  name = "InitVoiceAnalysis1760000000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS agents (
        agent_id TEXT PRIMARY KEY,
        freshcaller_agent_id INTEGER,
        name TEXT NOT NULL,
        team_name TEXT,
        call_count INTEGER NOT NULL DEFAULT 0,
        recording_count INTEGER NOT NULL DEFAULT 0,
        analyzed_count INTEGER NOT NULL DEFAULT 0,
        appointment_count INTEGER NOT NULL DEFAULT 0,
        average_score DOUBLE PRECISION,
        first_call_at TIMESTAMPTZ,
        last_call_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_agents_name ON agents (name)`);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_agents_last_call_at ON agents (last_call_at DESC NULLS LAST)`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS recordings (
        call_id BIGINT NOT NULL,
        recording_id BIGINT NOT NULL,
        export_job_id BIGINT,
        source_file TEXT,
        direction TEXT,
        created_time TIMESTAMPTZ,
        agent_id TEXT,
        agent_name TEXT,
        phone_number TEXT,
        call_notes TEXT,
        participants JSONB NOT NULL DEFAULT '[]'::jsonb,
        recording_url TEXT NOT NULL,
        duration_sec INTEGER,
        call_date DATE,
        is_voicemail BOOLEAN NOT NULL DEFAULT false,
        is_connected BOOLEAN,
        call_status INTEGER,
        bot_handling TEXT NOT NULL DEFAULT 'none',
        is_bot_involved BOOLEAN NOT NULL DEFAULT false,
        disposition TEXT,
        local_path TEXT,
        local_file_name TEXT,
        s3_bucket TEXT,
        s3_key TEXT,
        analysis_status TEXT NOT NULL DEFAULT 'none',
        analysis_error TEXT,
        analyzed_at TIMESTAMPTZ,
        analysis_result JSONB,
        analysis_corrections JSONB NOT NULL DEFAULT '[]'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (call_id, recording_id),
        CONSTRAINT recordings_bot_handling_check
          CHECK (bot_handling IN ('none', 'bot_only', 'bot_transferred')),
        CONSTRAINT recordings_disposition_check
          CHECK (
            disposition IS NULL OR disposition IN (
              'hung_up', 'not_interested', 'appointment', 'follow_up', 'dnc'
            )
          )
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_recordings_analysis_status ON recordings (analysis_status)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_recordings_created_time ON recordings (created_time DESC NULLS LAST)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_recordings_call_date ON recordings (call_date DESC NULLS LAST)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_recordings_agent_created ON recordings (agent_id, created_time DESC NULLS LAST)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_recordings_voicemail_created ON recordings (is_voicemail, created_time DESC NULLS LAST)`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS recording_listings (
        call_id BIGINT NOT NULL,
        recording_id BIGINT NOT NULL,
        export_job_id BIGINT,
        source_file TEXT,
        direction TEXT,
        created_time TIMESTAMPTZ,
        agent_id TEXT,
        agent_name TEXT,
        phone_number TEXT,
        customer_name TEXT,
        call_notes TEXT,
        participants JSONB NOT NULL DEFAULT '[]'::jsonb,
        recording_url TEXT NOT NULL,
        duration_sec INTEGER,
        call_date DATE,
        is_voicemail BOOLEAN NOT NULL DEFAULT false,
        is_connected BOOLEAN,
        call_status INTEGER,
        bot_handling TEXT NOT NULL DEFAULT 'none',
        is_bot_involved BOOLEAN NOT NULL DEFAULT false,
        disposition TEXT,
        local_file_name TEXT,
        has_local_audio BOOLEAN NOT NULL DEFAULT false,
        analysis_status TEXT NOT NULL DEFAULT 'none',
        analysis_error TEXT,
        analyzed_at TIMESTAMPTZ,
        audio_clarity_flag TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (call_id, recording_id),
        CONSTRAINT listing_bot_handling_check
          CHECK (bot_handling IN ('none', 'bot_only', 'bot_transferred')),
        CONSTRAINT listing_disposition_check
          CHECK (
            disposition IS NULL OR disposition IN (
              'hung_up', 'not_interested', 'appointment', 'follow_up', 'dnc'
            )
          )
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_listing_created_time ON recording_listings (created_time DESC NULLS LAST)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_listing_call_date ON recording_listings (call_date DESC NULLS LAST)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_listing_agent_created ON recording_listings (agent_id, created_time DESC NULLS LAST)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_listing_voicemail ON recording_listings (is_voicemail)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_listing_connected_created ON recording_listings (is_connected, created_time DESC NULLS LAST)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_listing_bot_created ON recording_listings (bot_handling, created_time DESC NULLS LAST)`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS export_jobs (
        call_date DATE PRIMARY KEY,
        job_id BIGINT,
        run_id TEXT NOT NULL,
        start_date TEXT NOT NULL,
        end_date TEXT NOT NULL,
        status TEXT NOT NULL,
        phase TEXT NOT NULL,
        phase_message TEXT,
        trigger TEXT NOT NULL,
        download_path TEXT,
        call_count INTEGER NOT NULL DEFAULT 0,
        calls_with_recording INTEGER NOT NULL DEFAULT 0,
        voicemail_skipped INTEGER NOT NULL DEFAULT 0,
        audio_downloaded INTEGER NOT NULL DEFAULT 0,
        audio_failed INTEGER NOT NULL DEFAULT 0,
        calls_indexed INTEGER NOT NULL DEFAULT 0,
        error TEXT,
        started_at TIMESTAMPTZ NOT NULL,
        finished_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT export_jobs_run_id_unique UNIQUE (run_id)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_export_jobs_job_id ON export_jobs (job_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_export_jobs_started_at ON export_jobs (started_at DESC)`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS cron_job_logs (
        id BIGSERIAL PRIMARY KEY,
        run_id TEXT NOT NULL,
        export_job_id BIGINT,
        call_date DATE NOT NULL,
        trigger TEXT NOT NULL,
        level TEXT NOT NULL,
        phase TEXT NOT NULL,
        message TEXT NOT NULL,
        meta JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_cron_logs_run_created ON cron_job_logs (run_id, created_at)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_cron_logs_date_created ON cron_job_logs (call_date DESC, created_at DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_cron_logs_level_created ON cron_job_logs (level, created_at DESC)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS cron_job_logs`);
    await queryRunner.query(`DROP TABLE IF EXISTS export_jobs`);
    await queryRunner.query(`DROP TABLE IF EXISTS recording_listings`);
    await queryRunner.query(`DROP TABLE IF EXISTS recordings`);
    await queryRunner.query(`DROP TABLE IF EXISTS agents`);
  }
}
