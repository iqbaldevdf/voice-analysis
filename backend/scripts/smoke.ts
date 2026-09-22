/**
 * Live smoke tests for VoiceIQ local stack (F12 + core APIs).
 *
 * Usage (from backend/):
 *   npm run smoke
 *   BACKEND_URL=http://127.0.0.1:5050 npm run smoke
 */
import "dotenv/config";

const BACKEND = (process.env.BACKEND_URL ?? "http://127.0.0.1:5050").replace(/\/$/, "");
const AI = (process.env.AI_SERVICE_URL ?? "http://127.0.0.1:8001").replace(/\/$/, "");
const FE = (process.env.FRONTEND_URL ?? "http://127.0.0.1:5173").replace(/\/$/, "");

type Result = { name: string; ok: boolean; detail: string };

const results: Result[] = [];

function pass(name: string, detail: string) {
  results.push({ name, ok: true, detail });
  console.log(`  PASS  ${name} — ${detail}`);
}

function fail(name: string, detail: string) {
  results.push({ name, ok: false, detail });
  console.log(`  FAIL  ${name} — ${detail}`);
}

async function getJson(url: string): Promise<{ status: number; body: unknown }> {
  const res = await fetch(url);
  const text = await res.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    // keep text
  }
  return { status: res.status, body };
}

async function getStatus(url: string): Promise<number> {
  const res = await fetch(url);
  return res.status;
}

async function main() {
  console.log(`Smoke against backend=${BACKEND} ai=${AI} frontend=${FE}\n`);

  // 1) Frontend
  try {
    const status = await getStatus(`${FE}/`);
    if (status === 200) pass("frontend.home", `HTTP ${status}`);
    else fail("frontend.home", `HTTP ${status}`);
  } catch (e) {
    fail("frontend.home", e instanceof Error ? e.message : String(e));
  }

  // 2) AI
  try {
    const status = await getStatus(`${AI}/docs`);
    if (status === 200) pass("ai.docs", `HTTP ${status}`);
    else fail("ai.docs", `HTTP ${status}`);
  } catch (e) {
    fail("ai.docs", e instanceof Error ? e.message : String(e));
  }

  // 3) Health
  try {
    const { status, body } = await getJson(`${BACKEND}/health`);
    const h = body as {
      ok?: boolean;
      mongo?: { connected?: boolean };
      postgres?: { connected?: boolean; configured?: boolean; readsEnabled?: boolean };
    };
    if (status === 200 && h.ok === true) pass("health.ok", "ok=true");
    else fail("health.ok", `status=${status} body=${JSON.stringify(body).slice(0, 120)}`);

    if (h.mongo?.connected) pass("health.mongo", "connected");
    else fail("health.mongo", "not connected");

    if (h.postgres?.configured) {
      if (h.postgres.connected) pass("health.postgres", `connected readsEnabled=${h.postgres.readsEnabled}`);
      else fail("health.postgres", "configured but not connected");
    } else {
      pass("health.postgres", "not configured (Mongo-only) — skipped");
    }
  } catch (e) {
    fail("health", e instanceof Error ? e.message : String(e));
  }

  // 4) Recordings listings (prefer PG when backfilled)
  let sampleCallId: number | null = null;
  let sampleRecordingId: number | null = null;
  try {
    const { status, body } = await getJson(
      `${BACKEND}/recordings/db/listings?limit=5&excludeVoicemail=true`,
    );
    const data = body as {
      total?: number;
      recordings?: Array<{ callId: number; recordingId: number }>;
      source?: string;
    };
    if (status === 200 && typeof data.total === "number" && data.total > 0) {
      pass(
        "recordings.listings",
        `total=${data.total} source=${data.source ?? "?"} page=${data.recordings?.length ?? 0}`,
      );
      sampleCallId = data.recordings?.[0]?.callId ?? null;
      sampleRecordingId = data.recordings?.[0]?.recordingId ?? null;
    } else if (status === 200 && data.total === 0) {
      fail("recordings.listings", "empty list (sync/backfill needed)");
    } else {
      fail("recordings.listings", `HTTP ${status}`);
    }
  } catch (e) {
    fail("recordings.listings", e instanceof Error ? e.message : String(e));
  }

  // 5) Recordings primary list
  try {
    const { status, body } = await getJson(`${BACKEND}/recordings/db?limit=3`);
    const data = body as { total?: number; source?: string };
    if (status === 200 && typeof data.total === "number") {
      pass("recordings.list", `total=${data.total} source=${data.source ?? "?"}`);
    } else {
      fail("recordings.list", `HTTP ${status}`);
    }
  } catch (e) {
    fail("recordings.list", e instanceof Error ? e.message : String(e));
  }

  // 6) Call detail
  if (sampleCallId != null && sampleRecordingId != null) {
    try {
      const { status, body } = await getJson(
        `${BACKEND}/recordings/db/${sampleCallId}?recordingId=${sampleRecordingId}&includeAnalysis=true`,
      );
      const data = body as { recording?: { callId?: number; analysisStatus?: string } };
      if (status === 200 && data.recording?.callId === sampleCallId) {
        pass(
          "recordings.detail",
          `callId=${sampleCallId} status=${data.recording.analysisStatus ?? "?"}`,
        );
      } else {
        fail("recordings.detail", `HTTP ${status}`);
      }
    } catch (e) {
      fail("recordings.detail", e instanceof Error ? e.message : String(e));
    }
  } else {
    fail("recordings.detail", "skipped — no sample call from listings");
  }

  // 7) Agents
  let sampleAgentId: string | null = null;
  try {
    const { status, body } = await getJson(`${BACKEND}/agents?limit=5`);
    const data = body as {
      total?: number;
      agents?: Array<{ agentId: string; name?: string }>;
      source?: string;
    };
    if (status === 200 && typeof data.total === "number" && data.total > 0) {
      pass("agents.list", `total=${data.total} source=${data.source ?? "?"}`);
      sampleAgentId = data.agents?.[0]?.agentId ?? null;
    } else if (status === 200) {
      fail("agents.list", "empty agents");
    } else {
      fail("agents.list", `HTTP ${status}`);
    }
  } catch (e) {
    fail("agents.list", e instanceof Error ? e.message : String(e));
  }

  if (sampleAgentId) {
    try {
      const { status, body } = await getJson(
        `${BACKEND}/agents/${encodeURIComponent(sampleAgentId)}?limit=5`,
      );
      const data = body as {
        agent?: { agentId?: string };
        summary?: { connects?: number };
        source?: string;
        recordings?: unknown[];
      };
      if (status === 200 && data.agent?.agentId === sampleAgentId) {
        pass(
          "agents.detail",
          `connects=${data.summary?.connects ?? "?"} rows=${data.recordings?.length ?? 0} source=${data.source ?? "?"}`,
        );
      } else {
        fail("agents.detail", `HTTP ${status}`);
      }
    } catch (e) {
      fail("agents.detail", e instanceof Error ? e.message : String(e));
    }
  } else {
    fail("agents.detail", "skipped — no agent");
  }

  // 8) Sync dashboard
  try {
    const { status, body } = await getJson(`${BACKEND}/freshcaller/sync/status`);
    const data = body as { previousCallDate?: string; source?: string; cron?: { enabled?: boolean } };
    if (status === 200 && data.previousCallDate) {
      pass(
        "sync.status",
        `prev=${data.previousCallDate} cron=${data.cron?.enabled} source=${data.source ?? "?"}`,
      );
    } else {
      fail("sync.status", `HTTP ${status}`);
    }
  } catch (e) {
    fail("sync.status", e instanceof Error ? e.message : String(e));
  }

  try {
    const { status, body } = await getJson(`${BACKEND}/freshcaller/sync/jobs?limit=3`);
    const data = body as { total?: number; source?: string };
    if (status === 200 && typeof data.total === "number") {
      pass("sync.jobs", `total=${data.total} source=${data.source ?? "?"}`);
    } else {
      fail("sync.jobs", `HTTP ${status}`);
    }
  } catch (e) {
    fail("sync.jobs", e instanceof Error ? e.message : String(e));
  }

  try {
    const { status, body } = await getJson(`${BACKEND}/freshcaller/sync/logs/runs?limit=3`);
    const data = body as { total?: number; source?: string };
    if (status === 200 && typeof data.total === "number") {
      pass("sync.cronRuns", `total=${data.total} source=${data.source ?? "?"}`);
    } else {
      fail("sync.cronRuns", `HTTP ${status}`);
    }
  } catch (e) {
    fail("sync.cronRuns", e instanceof Error ? e.message : String(e));
  }

  // 9) Postgres read path expectation when enabled
  try {
    const { body } = await getJson(`${BACKEND}/health`);
    const h = body as { postgres?: { readsEnabled?: boolean; connected?: boolean } };
    if (h.postgres?.connected && h.postgres.readsEnabled) {
      const listings = await getJson(`${BACKEND}/recordings/db/listings?limit=1`);
      const data = listings.body as { source?: string; total?: number };
      if (data.source === "postgres" && (data.total ?? 0) > 0) {
        pass("postgres.reads", "listings served from postgres");
      } else if ((data.total ?? 0) === 0) {
        fail("postgres.reads", "PG connected but listings empty — run npm run backfill:postgres");
      } else {
        fail(
          "postgres.reads",
          `expected source=postgres got source=${data.source ?? "?"} (fallback to mongo?)`,
        );
      }
    } else {
      pass("postgres.reads", "PG reads not enabled — skipped");
    }
  } catch (e) {
    fail("postgres.reads", e instanceof Error ? e.message : String(e));
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) {
    console.log("Failed:");
    for (const f of failed) console.log(`  - ${f.name}: ${f.detail}`);
    process.exit(1);
  }
  console.log("ok — smoke suite green");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
