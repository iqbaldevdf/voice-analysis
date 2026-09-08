import { useCallback, useEffect, useState } from "react";
import {
  fetchCronLogRun,
  fetchCronLogRuns,
  type CronLogLine,
  type CronLogRun,
} from "../api";
import { CheckboxField, SelectField } from "../components/ui/Fields";

type Props = {
  initialRunId?: string | null;
  onError: (message: string | null) => void;
  onGoSync: () => void;
};

function statusTone(run: CronLogRun): string {
  if (run.errorCount > 0 || run.lastPhase === "failed") return "danger";
  if (["complete", "completed"].includes(run.lastPhase)) return "ok";
  return "warn";
}

function formatWhen(iso?: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function CronLogsView({ initialRunId, onError, onGoSync }: Props) {
  const [runs, setRuns] = useState<CronLogRun[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(initialRunId ?? null);
  const [logs, setLogs] = useState<CronLogLine[]>([]);
  const [level, setLevel] = useState("all");
  const [trigger, setTrigger] = useState("all");
  const [autoScroll, setAutoScroll] = useState(true);
  const [loadingRuns, setLoadingRuns] = useState(true);
  const [loadingLogs, setLoadingLogs] = useState(false);

  const refreshRuns = useCallback(async () => {
    const data = await fetchCronLogRuns({ page, limit: 10 });
    setRuns(data.runs);
    setTotalPages(data.totalPages);
    setLoadingRuns(false);
    if (!selectedRunId && data.runs[0]) {
      setSelectedRunId(data.runs[0].runId);
    }
  }, [page, selectedRunId]);

  const refreshLogs = useCallback(
    async (runId: string) => {
      setLoadingLogs(true);
      try {
        const data = await fetchCronLogRun(runId);
        let lines = data.logs;
        if (level !== "all") lines = lines.filter((l) => l.level === level);
        if (trigger !== "all") lines = lines.filter((l) => l.trigger === trigger);
        setLogs(lines);
      } finally {
        setLoadingLogs(false);
      }
    },
    [level, trigger],
  );

  useEffect(() => {
    if (initialRunId) setSelectedRunId(initialRunId);
  }, [initialRunId]);

  useEffect(() => {
    void refreshRuns().catch((err) => {
      setLoadingRuns(false);
      onError(err instanceof Error ? err.message : String(err));
    });
  }, [refreshRuns, onError]);

  useEffect(() => {
    if (!selectedRunId) return;
    void refreshLogs(selectedRunId).catch((err) =>
      onError(err instanceof Error ? err.message : String(err)),
    );
  }, [selectedRunId, refreshLogs, onError]);

  useEffect(() => {
    if (!selectedRunId) return;
    const selected = runs.find((r) => r.runId === selectedRunId);
    const live = selected && !["complete", "failed", "completed"].includes(selected.lastPhase);
    if (!live) return;
    const timer = window.setInterval(() => {
      void refreshLogs(selectedRunId).catch(() => undefined);
      void refreshRuns().catch(() => undefined);
    }, 2500);
    return () => window.clearInterval(timer);
  }, [selectedRunId, runs, refreshLogs, refreshRuns]);

  useEffect(() => {
    if (!autoScroll) return;
    const el = document.getElementById("cron-log-stream");
    if (el) el.scrollTop = el.scrollHeight;
  }, [logs, autoScroll]);

  function downloadTxt() {
    const text = logs
      .map(
        (l) =>
          `${l.createdAt}\t${l.level.toUpperCase()}\t${l.phase}\t${l.message}${
            l.meta ? `\t${JSON.stringify(l.meta)}` : ""
          }`,
      )
      .join("\n");
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `cron-logs-${selectedRunId ?? "export"}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const selected = runs.find((r) => r.runId === selectedRunId) ?? null;

  return (
    <div className="logs-page">
      <header className="viewport-header">
        <div>
          <h1>Cron Logs</h1>
        </div>
        <div className="viewport-actions">
          <button type="button" className="btn ghost" onClick={onGoSync}>
            Open Sync
          </button>
        </div>
      </header>

      <form
        className="filter-panel filter-panel-compact"
        onSubmit={(e) => {
          e.preventDefault();
          if (selectedRunId) void refreshLogs(selectedRunId);
        }}
      >
        <div className="filter-panel-grid filter-panel-grid-compact">
          <SelectField
            id="logs-level"
            label="Level"
            value={level}
            onChange={(e) => setLevel(e.target.value)}
          >
            <option value="all">All levels</option>
            <option value="info">Info</option>
            <option value="warn">Warn</option>
            <option value="error">Error</option>
          </SelectField>
          <SelectField
            id="logs-trigger"
            label="Trigger"
            value={trigger}
            onChange={(e) => setTrigger(e.target.value)}
          >
            <option value="all">All triggers</option>
            <option value="cron">Cron</option>
            <option value="manual">Manual</option>
            <option value="cli">CLI</option>
          </SelectField>
          <CheckboxField
            id="logs-autoscroll"
            label="Auto-scroll"
            checked={autoScroll}
            onChange={(e) => setAutoScroll(e.target.checked)}
            className="filter-check-align"
          />
          <div className="filter-actions">
            <button type="submit" className="btn secondary">
              Apply
            </button>
            {selectedRunId && (
              <button type="button" className="btn ghost" onClick={downloadTxt}>
                Download .txt
              </button>
            )}
          </div>
        </div>
      </form>

      <div className="logs-layout">
        <aside className="runs-list panel">
          <div className="panel-head">
            <h2 className="panel-title">Runs</h2>
            <button type="button" className="btn ghost compact" onClick={() => void refreshRuns()}>
              Refresh
            </button>
          </div>
          {loadingRuns ? (
            <p className="empty soft">Loading runs…</p>
          ) : runs.length === 0 ? (
            <div className="empty-state compact">
              <h3>No cron logs yet</h3>
              <p>Run a sync from the Sync page to generate an audit trail.</p>
              <button type="button" className="btn primary compact" onClick={onGoSync}>
                Go to Sync
              </button>
            </div>
          ) : (
            <ul className="run-cards">
              {runs.map((run) => (
                <li key={run.runId}>
                  <button
                    type="button"
                    className={`run-card ${selectedRunId === run.runId ? "active" : ""}`}
                    onClick={() => setSelectedRunId(run.runId)}
                  >
                    <div className="run-card-top">
                      <strong>{run.callDate}</strong>
                      <span className={`badge ${statusTone(run)}`}>{run.lastPhase}</span>
                    </div>
                    <span className="run-meta">
                      {run.trigger} · {run.lineCount} lines
                      {run.errorCount ? ` · ${run.errorCount} errors` : ""}
                    </span>
                    <em className="run-id mono">{run.runId.slice(0, 10)}…</em>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="pagination-bar">
            <button
              type="button"
              className="btn ghost compact"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Prev
            </button>
            <span>
              {page}/{totalPages}
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
        </aside>

        <section className="panel log-stream-panel">
          <div className="panel-head">
            <div>
              <h2 className="panel-title">Log stream</h2>
              {selected && (
                <p className="panel-sub">
                  {selected.callDate} · started {formatWhen(selected.startedAt)} · {selected.trigger}
                </p>
              )}
            </div>
            {selectedRunId && (
              <button
                type="button"
                className="btn ghost compact"
                onClick={() => void navigator.clipboard?.writeText(selectedRunId)}
              >
                Copy run ID
              </button>
            )}
          </div>
          <div id="cron-log-stream" className="log-stream">
            {loadingLogs ? (
              <p className="empty soft">Loading logs…</p>
            ) : logs.length === 0 ? (
              <div className="empty-state compact">
                <h3>Select a run</h3>
                <p>Choose a run on the left to inspect phase-level log lines.</p>
              </div>
            ) : (
              logs.map((line, idx) => (
                <div key={`${line.createdAt}-${idx}`} className={`log-line level-${line.level}`}>
                  <time>{new Date(line.createdAt).toLocaleTimeString()}</time>
                  <span className="log-level">{line.level}</span>
                  <span className="log-phase">{line.phase}</span>
                  <span className="log-msg">{line.message}</span>
                  {line.meta && (
                    <details>
                      <summary>meta</summary>
                      <pre>{JSON.stringify(line.meta, null, 2)}</pre>
                    </details>
                  )}
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
