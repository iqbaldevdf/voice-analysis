import { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchSyncJob,
  fetchSyncJobs,
  fetchSyncStatus,
  runDailySync,
  type SyncJob,
  type SyncStatusResponse,
} from "../api";
import { CheckboxField, TextField } from "../components/ui/Fields";

type Props = {
  onError: (message: string | null) => void;
  onOpenLogs: (runId: string) => void;
  onOpenRecordingsForDate: (callDate: string) => void;
};

const PHASES = ["export", "poll", "zip", "index", "download", "complete"] as const;

function statusClass(status: string): string {
  if (status === "completed") return "ok";
  if (status === "failed") return "danger";
  if (status === "skipped") return "muted";
  return "warn";
}

function phaseIndex(phase: string): number {
  if (phase === "failed") return -1;
  if (phase === "queued") return 0;
  const idx = PHASES.indexOf(phase as (typeof PHASES)[number]);
  return idx >= 0 ? idx : 0;
}

function formatWhen(iso?: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function SyncDashboardView({ onError, onOpenLogs, onOpenRecordingsForDate }: Props) {
  const [status, setStatus] = useState<SyncStatusResponse | null>(null);
  const [jobs, setJobs] = useState<SyncJob[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [date, setDate] = useState("");
  const [force, setForce] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [activeCallDate, setActiveCallDate] = useState<string | null>(null);
  const [activeJob, setActiveJob] = useState<SyncJob | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [st, list] = await Promise.all([
      fetchSyncStatus(),
      fetchSyncJobs({ page, limit: 10 }),
    ]);
    setStatus(st);
    setJobs(list.jobs);
    setTotalPages(list.totalPages);
    if (!date && st.previousCallDate) setDate(st.previousCallDate);
    setLoading(false);
  }, [page, date]);

  useEffect(() => {
    void refresh().catch((err) => {
      setLoading(false);
      onError(err instanceof Error ? err.message : String(err));
    });
  }, [refresh, onError]);

  useEffect(() => {
    if (!activeCallDate) return;
    const tick = window.setInterval(() => {
      void fetchSyncJob(activeCallDate)
        .then((data) => {
          setActiveJob(data.job);
          const terminal = ["completed", "failed", "skipped"].includes(data.job.status);
          if (terminal) {
            setBusy(false);
            void refresh().catch(() => undefined);
          }
        })
        .catch(() => undefined);
    }, 2500);
    return () => window.clearInterval(tick);
  }, [activeCallDate, refresh]);

  const watching = activeJob ?? status?.lastJob ?? null;
  const currentPhaseIdx = useMemo(
    () => (watching ? phaseIndex(watching.phase) : -1),
    [watching],
  );

  async function handleRun() {
    try {
      onError(null);
      setNotice(null);
      setBusy(true);
      const result = await runDailySync({
        date: date || undefined,
        force,
      });
      setActiveCallDate(result.callDate);
      if (result.skipped) {
        setBusy(false);
        setNotice(result.message ?? "Already completed for this date");
      } else {
        setNotice(`Sync started for ${result.callDate}`);
      }
      await refresh();
      const job = await fetchSyncJob(result.callDate);
      setActiveJob(job.job);
    } catch (err) {
      setBusy(false);
      onError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="sync-page">
      <header className="viewport-header">
        <div>
          <h1>Freshcaller Sync</h1>
        </div>
        <div className="viewport-actions cron-meta">
          <span className={`badge ${status?.cron.enabled && status.cron.scheduled !== false ? "ok" : "muted"}`}>
            Cron {status?.cron.enabled ? "armed" : "off"}
          </span>
          <div className="cron-meta-text">
            <strong>{status?.cron.expression ?? "—"}</strong>
            <span>
              {status?.cron.nextRunAt
                ? `Next ${new Date(status.cron.nextRunAt).toLocaleString()}`
                : status?.cron.timezone ?? "Asia/Kolkata"}
            </span>
          </div>
        </div>
      </header>

      {status?.cron.lastTickError && (
        <div className="error-banner" role="alert">
          <span>Cron error: {status.cron.lastTickError}</span>
        </div>
      )}

      {status?.cron.note && (
        <div className="info-banner" role="status">
          <span>{status.cron.note}</span>
        </div>
      )}

      {notice && (
        <div className="info-banner" role="status">
          <span>{notice}</span>
          <button type="button" className="btn ghost compact" onClick={() => setNotice(null)}>
            Dismiss
          </button>
        </div>
      )}

      <section className="kpi-row sync-kpi">
        <article className="kpi-card">
          <span>Last sync day</span>
          <strong>{status?.lastJob?.callDate ?? "—"}</strong>
          <em className={statusClass(status?.lastJob?.status ?? "")}>
            {status?.lastJob?.status ?? (loading ? "Loading…" : "No runs yet")}
          </em>
        </article>
        <article className="kpi-card">
          <span>Freshcaller job</span>
          <strong className="mono">{watching?.jobId ?? "—"}</strong>
          <em>{watching?.phase ?? "idle"}</em>
        </article>
        <article className="kpi-card">
          <span>Calls indexed</span>
          <strong>{watching?.callsIndexed ?? 0}</strong>
          <em>
            {watching?.callsWithRecording ?? 0} with recording · {watching?.voicemailSkipped ?? 0}{" "}
            voicemail
          </em>
        </article>
        <article className="kpi-card">
          <span>Audio downloaded</span>
          <strong>{watching?.audioDownloaded ?? 0}</strong>
          <em>{watching?.audioFailed ? `${watching.audioFailed} failed` : "Ready for analysis"}</em>
        </article>
      </section>

      <section className="panel run-panel">
        <div className="panel-head">
          <h2 className="panel-title">Run sync</h2>
          {status?.running || busy ? <span className="badge warn">In progress</span> : null}
        </div>
        <div className="run-controls">
          <TextField
            id="sync-call-date"
            label="Call date (IST)"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
          <CheckboxField
            id="sync-force"
            label="Force re-run · overwrite a completed day"
            checked={force}
            onChange={(e) => setForce(e.target.checked)}
            className="run-force-check"
          />
          <button type="button" className="btn primary" disabled={busy} onClick={() => void handleRun()}>
            {busy ? "Running…" : "Run sync now"}
          </button>
        </div>

        <ol className="sync-stepper" aria-label="Sync progress">
          {PHASES.map((phase, idx) => {
            const active = watching && currentPhaseIdx === idx && watching.status !== "completed";
            const done =
              watching &&
              (watching.status === "completed" ||
                (currentPhaseIdx > idx && watching.phase !== "failed"));
            return (
              <li key={phase} className={`${done ? "done" : ""} ${active ? "active" : ""}`}>
                <span className="step-dot" />
                <span className="step-label">{phase}</span>
              </li>
            );
          })}
        </ol>
        {watching?.phaseMessage && <p className="phase-msg">{watching.phaseMessage}</p>}
        {watching?.error && <p className="error-banner">{watching.error}</p>}
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2 className="panel-title">Job history</h2>
          <button type="button" className="btn ghost compact" onClick={() => void refresh()}>
            Refresh
          </button>
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Call date</th>
                <th>Job ID</th>
                <th>Status</th>
                <th>Indexed</th>
                <th>Audio</th>
                <th>Started</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="empty soft">
                    Loading jobs…
                  </td>
                </tr>
              ) : jobs.length === 0 ? (
                <tr>
                  <td colSpan={7}>
                    <div className="empty-state compact">
                      <h3>No sync jobs yet</h3>
                      <p>Run a manual sync above, or wait for the 01:00 IST cron.</p>
                    </div>
                  </td>
                </tr>
              ) : (
                jobs.map((job) => (
                  <tr key={job.runId}>
                    <td>
                      <strong>{job.callDate}</strong>
                    </td>
                    <td className="mono">{job.jobId ?? "—"}</td>
                    <td>
                      <span className={`badge ${statusClass(job.status)}`}>{job.status}</span>
                    </td>
                    <td>
                      {job.callsIndexed}
                      <span className="muted-inline"> · vm {job.voicemailSkipped}</span>
                    </td>
                    <td>
                      {job.audioDownloaded}
                      {job.audioFailed ? (
                        <span className="muted-inline"> · {job.audioFailed} fail</span>
                      ) : null}
                    </td>
                    <td>{formatWhen(job.startedAt)}</td>
                    <td className="row-actions">
                      <button
                        type="button"
                        className="btn ghost compact"
                        onClick={() => onOpenRecordingsForDate(job.callDate)}
                      >
                        Recordings
                      </button>
                      <button
                        type="button"
                        className="btn secondary compact"
                        onClick={() => onOpenLogs(job.runId)}
                      >
                        Logs
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="pagination-bar">
          <button
            type="button"
            className="btn ghost compact"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            Previous
          </button>
          <span>
            Page {page} / {totalPages}
          </span>
          <button
            type="button"
            className="btn ghost compact"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </button>
        </div>
      </section>
    </div>
  );
}
