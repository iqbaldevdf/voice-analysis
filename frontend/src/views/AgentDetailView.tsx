import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  analyzeDbRecording,
  fetchAgent,
  formatDurationLong,
  type AgentDetailSummary,
  type AgentRecordingRow,
  type AgentSummary,
  type QuarterWindow,
} from "../api";
import { CheckboxField, SearchField, SelectField, TextField } from "../components/ui/Fields";
import { dispositionClass, dispositionLabel } from "../lib/disposition";
import { agentDisplayName, agentInitials } from "../lib/agentInitials";

type Props = {
  onError: (message: string | null) => void;
};

const CATEGORY_LABELS: Record<string, string> = {
  communicationEffectiveness: "Communication",
  responseRelevance: "Relevance",
  activeListening: "Listening",
  turnTaking: "Turn taking",
  engagement: "Engagement",
  conversationBalance: "Balance",
  efficiency: "Efficiency",
};

function scoreTone(score: number | null | undefined): string {
  if (score == null) return "muted";
  if (score >= 75) return "ok";
  if (score >= 55) return "warn";
  return "danger";
}

function formatScore(score: number | null | undefined, digits = 1): string {
  return score == null ? "—" : score.toFixed(digits);
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

export function AgentDetailView({ onError }: Props) {
  const { agentId = "" } = useParams();
  const navigate = useNavigate();
  const [agent, setAgent] = useState<AgentSummary | null>(null);
  const [summary, setSummary] = useState<AgentDetailSummary | null>(null);
  const [recordings, setRecordings] = useState<AgentRecordingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [minDuration, setMinDuration] = useState("");
  const [maxDuration, setMaxDuration] = useState("");
  const [sortBy, setSortBy] = useState("createdTime");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [excludeVoicemail, setExcludeVoicemail] = useState(true);
  const [appointmentOnly, setAppointmentOnly] = useState(false);
  const [quarterId, setQuarterId] = useState("");
  const [quarter, setQuarter] = useState<QuarterWindow | null>(null);
  const [availableQuarters, setAvailableQuarters] = useState<QuarterWindow[]>([]);
  const [voicemailMaxSec, setVoicemailMaxSec] = useState(30);
  const [page, setPage] = useState(1);
  const [analyzingIds, setAnalyzingIds] = useState<string[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [batchNotice, setBatchNotice] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  const refresh = useCallback(
    async (pageNum = 1) => {
      if (!agentId) return;
      setLoading(true);
      try {
        const data = await fetchAgent(agentId, {
          q: search.trim() || undefined,
          status: statusFilter !== "all" ? statusFilter : undefined,
          dateFrom: dateFrom || undefined,
          dateTo: dateTo || undefined,
          minDuration: minDuration !== "" ? Number(minDuration) : undefined,
          maxDuration: maxDuration !== "" ? Number(maxDuration) : undefined,
          sortBy,
          sortDir,
          page: pageNum,
          limit: 10,
          excludeVoicemail,
          appointmentOnly,
          quarter: quarterId || undefined,
        });
        setAgent(data.agent);
        setQuarter(data.quarter);
        setAvailableQuarters(data.availableQuarters ?? []);
        if (!quarterId && data.quarter?.id) setQuarterId(data.quarter.id);
        setSummary(data.summary);
        setRecordings(data.recordings);
        setTotal(data.total);
        setPage(data.page);
        setTotalPages(data.totalPages);
        setVoicemailMaxSec(data.voicemailMaxSec ?? 30);
      } finally {
        setLoading(false);
      }
    },
    [
      agentId,
      search,
      statusFilter,
      dateFrom,
      dateTo,
      minDuration,
      maxDuration,
      sortBy,
      sortDir,
      excludeVoicemail,
      appointmentOnly,
      quarterId,
    ],
  );

  useEffect(() => {
    void refresh(1).catch((err) => onError(err instanceof Error ? err.message : String(err)));
  }, [agentId, sortBy, sortDir, excludeVoicemail, dateFrom, dateTo, appointmentOnly, quarterId]);

  function rowKey(rec: AgentRecordingRow): string {
    return `${rec.callId}-${rec.recordingId}`;
  }

  function markAnalyzing(ids: string[], active: boolean) {
    setAnalyzingIds((current) => {
      const next = new Set(current);
      for (const id of ids) {
        if (active) next.add(id);
        else next.delete(id);
      }
      return [...next];
    });
  }

  async function analyzeRows(rows: AgentRecordingRow[]) {
    const pending = rows.filter((row) => row.analysisStatus !== "completed");
    if (pending.length === 0) {
      setBatchNotice("Selected calls are already analyzed. Open a row to review the score.");
      return;
    }

    const already = pending.filter((row) => analyzingIds.includes(rowKey(row)));
    const queued = pending.filter((row) => !analyzingIds.includes(rowKey(row)));
    if (queued.length === 0) {
      onError(
        already.length === 1
          ? `Analysis is already running for call ${already[0].callId}. Wait for it to finish.`
          : `Analysis is already running for calls ${already.map((row) => row.callId).join(", ")}. Wait for those to finish.`,
      );
      return;
    }

    onError(null);
    setBatchNotice(
      queued.length === 1
        ? `Analyzing call ${queued[0].callId}…`
        : `Analyzing ${queued.length} calls: ${queued.map((row) => row.callId).join(", ")}.`,
    );
    markAnalyzing(queued.map(rowKey), true);

    const results: Array<{ callId: number; ok: true } | { callId: number; ok: false; message: string }> = [];
    for (const row of queued) {
      try {
        await analyzeDbRecording(row.callId, row.recordingId);
        results.push({ callId: row.callId, ok: true });
      } catch (err) {
        results.push({
          callId: row.callId,
          ok: false,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }

    markAnalyzing(queued.map(rowKey), false);
    setSelectedIds((current) => current.filter((id) => !queued.some((row) => rowKey(row) === id)));
    await refresh(page);

    const failed = results.filter((item) => !item.ok);
    const done = results.filter((item) => item.ok);
    if (failed.length === 0) {
      setBatchNotice(
        done.length === 1
          ? `Call ${done[0].callId} analyzed. The call score is on the row.`
          : `${done.length} calls analyzed. Call scores are on the table.`,
      );
      return;
    }

    const lines = failed.map((item) => `Call ${item.callId}: ${item.message}`);
    if (done.length > 0) {
      setBatchNotice(`${done.length} call${done.length === 1 ? "" : "s"} analyzed.`);
    } else {
      setBatchNotice(null);
    }
    onError(
      failed.length === 1
        ? lines[0]
        : `${failed.length} calls could not be analyzed. ${lines.join(" ")}`,
    );
  }

  async function handleAnalyze(rec: AgentRecordingRow) {
    if (rec.analysisStatus === "completed") {
      navigate(`/recordings/${rec.callId}/${rec.recordingId}`);
      return;
    }
    await analyzeRows([rec]);
  }

  const coverage = summary?.connects
    ? Math.round((summary.analyzedConnects / summary.connects) * 100)
    : 0;
  const categories = Object.entries(summary?.categoryAverages ?? {});

  return (
    <div className="agents-page">
      <header className="viewport-header">
        <div className="agent-profile-head">
          <span className="avatar agent lg">{agent ? agentInitials(agent.name) : "?"}</span>
          <div>
            <h1>{agentDisplayName(agent?.name)}</h1>
            <p className="panel-sub">{quarter?.label ?? "Current quarter"}</p>
          </div>
        </div>
        <div className="viewport-actions">
          <SelectField
            id="agent-quarter"
            className="agent-quarter"
            label="Quarter"
            value={quarter?.id ?? quarterId}
            onChange={(e) => setQuarterId(e.target.value)}
          >
            {(availableQuarters.length > 0 ? availableQuarters : quarter ? [quarter] : []).map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </SelectField>
          <button type="button" className="btn ghost" onClick={() => navigate("/agents")}>
            All agents
          </button>
        </div>
      </header>

      <section className="kpi-row agent-kpi">
        <article className="kpi-card">
          <span>Performance</span>
          <strong>{formatScore(summary?.averagePerformance)}</strong>
          <em>
            {summary?.scoredConnects
              ? `${summary.scoredConnects} scored connects`
              : summary?.analyzedConnects
                ? "Not scored yet. These calls were rate-limited."
                : "0 scored connects"}
          </em>
        </article>
        <article className="kpi-card">
          <span>Call quality</span>
          <strong>{formatScore(summary?.averageCallQuality)}</strong>
          <em>
            clarity {formatScore(summary?.averageClarity, 0)} · speech rate {formatScore(summary?.averageSpeechRateScore, 0)}
          </em>
        </article>
        <article className="kpi-card">
          <span>Calls processed (connects)</span>
          <strong>{summary?.connects ?? 0}</strong>
          <em>{summary?.analyzedConnects ?? 0} analyzed</em>
        </article>
        <article className="kpi-card">
          <span>Speech rate</span>
          <strong>{formatScore(summary?.averageWordsPerSecond)}</strong>
          <em>words / second</em>
        </article>
        <article className="kpi-card">
          <span>Introduction script</span>
          <strong>{formatScore(summary?.averageIntroductionScore, 0)}</strong>
          <em>
            {summary?.introductionScoredConnects
              ? `${summary.introductionScoredConnects} scored · opening pitch themes`
              : "Re-analyze calls for intro score"}
          </em>
        </article>
      </section>

      <section className="agent-meta-row">
        <article className="panel agent-span">
          <h2 className="panel-title">Coverage</h2>
          <p className="panel-sub">
            {quarter?.label ?? "Quarter"} analyzed connects · first call {formatWhen(agent?.firstCallAt)}
          </p>
          <div className="agent-coverage">
            <span>Analyzed</span>
            <strong>{coverage}%</strong>
          </div>
          <div className="perf-bar">
            <i style={{ width: `${coverage}%` }} />
          </div>
        </article>
        <article className="panel">
          <h2 className="panel-title">Category averages</h2>
          <p className="panel-sub">{quarter?.label ?? "Current quarter"}</p>
          {categories.length === 0 ? (
            <p className="empty soft">Scores appear after a call is analyzed.</p>
          ) : (
            <div className="agent-categories">
              {categories.map(([key, score]) => (
                <div key={key}>
                  <div className="perf-score-label">
                    <span>{CATEGORY_LABELS[key] ?? key}</span>
                    <strong>{score.toFixed(0)}</strong>
                  </div>
                  <div className="perf-bar">
                    <i style={{ width: `${Math.min(100, score)}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </article>
      </section>

      <form
        className="filter-panel"
        onSubmit={(e) => {
          e.preventDefault();
          void refresh(1).catch((err) => onError(err instanceof Error ? err.message : String(err)));
        }}
      >
        <div className="filter-panel-grid">
          <SearchField
            id="agent-search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Customer, phone, call ID…"
            className="filter-span-2"
          />
          <SelectField
            id="agent-status"
            label="Status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="all">All statuses</option>
            <option value="none">Needs analysis</option>
            <option value="completed">Notes ready</option>
            <option value="running">Transcribing</option>
            <option value="failed">Failed</option>
          </SelectField>
          <TextField
            id="agent-from"
            label="From"
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
          />
          <TextField
            id="agent-to"
            label="To"
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
          />
          <TextField
            id="agent-min-dur"
            label="Min duration (s)"
            type="number"
            min={0}
            placeholder="60"
            value={minDuration}
            onChange={(e) => setMinDuration(e.target.value)}
          />
          <TextField
            id="agent-max-dur"
            label="Max duration (s)"
            type="number"
            min={0}
            placeholder="600"
            value={maxDuration}
            onChange={(e) => setMaxDuration(e.target.value)}
          />
        </div>
        <div className="filter-panel-footer">
          <CheckboxField
            id="agent-hide-vm"
            label={`Hide voicemails (connected calls only, ≤${voicemailMaxSec}s fallback)`}
            checked={excludeVoicemail}
            onChange={(e) => setExcludeVoicemail(e.target.checked)}
          />
          <CheckboxField
            id="agent-ag"
            label="Appointment generated"
            checked={appointmentOnly}
            onChange={(e) => setAppointmentOnly(e.target.checked)}
          />
          <button type="submit" className="btn secondary">
            Apply filters
          </button>
        </div>
      </form>

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2 className="panel-title">Recordings</h2>
          </div>
          <div className="viewport-actions">
            <button
              type="button"
              className="btn primary compact"
              disabled={selectedIds.length === 0}
              onClick={() => {
                const chosen = recordings.filter((rec) => selectedIds.includes(rowKey(rec)));
                void analyzeRows(chosen);
              }}
            >
              Analyze selected{selectedIds.length > 0 ? ` (${selectedIds.length})` : ""}
            </button>
            <span className="muted-inline">
              {total} result{total === 1 ? "" : "s"} · page {page} of {totalPages}
            </span>
          </div>
        </div>
        {batchNotice ? <p className="panel-sub">{batchNotice}</p> : null}
        <div className="list-meta-row">
          <span />
          <div className="sort-controls">
            <SelectField
              id="agent-sort-by"
              label="Sort by"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
            >
              <option value="createdTime">Date</option>
              <option value="durationSec">Duration</option>
              <option value="analysisStatus">Status</option>
              <option value="callId">Call ID</option>
            </SelectField>
            <SelectField
              id="agent-sort-dir"
              label="Order"
              value={sortDir}
              onChange={(e) => setSortDir(e.target.value as "asc" | "desc")}
            >
              <option value="desc">Descending</option>
              <option value="asc">Ascending</option>
            </SelectField>
          </div>
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>
                  <input
                    type="checkbox"
                    aria-label="Select calls that need analysis"
                    checked={
                      recordings.some((rec) => rec.analysisStatus !== "completed") &&
                      recordings
                        .filter((rec) => rec.analysisStatus !== "completed")
                        .every((rec) => selectedIds.includes(rowKey(rec)))
                    }
                    onChange={(e) => {
                      const pending = recordings
                        .filter((rec) => rec.analysisStatus !== "completed")
                        .map(rowKey);
                      setSelectedIds((current) =>
                        e.target.checked
                          ? [...new Set([...current, ...pending])]
                          : current.filter((id) => !pending.includes(id)),
                      );
                    }}
                  />
                </th>
                <th>When</th>
                <th>Customer</th>
                <th>Answered</th>
                <th>Direction</th>
                <th>Duration</th>
                <th>Talk</th>
                <th>Speech rate</th>
                <th>Disposition</th>
                <th>Status</th>
                <th>Intro</th>
                <th>Call score</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={13} className="empty soft">Loading recordings…</td>
                </tr>
              ) : recordings.length === 0 ? (
                <tr>
                  <td colSpan={13} className="empty soft">No recordings match these filters.</td>
                </tr>
              ) : (
                recordings.map((rec) => (
                  <tr key={rowKey(rec)}>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`Select call ${rec.callId}`}
                        disabled={rec.analysisStatus === "completed"}
                        checked={selectedIds.includes(rowKey(rec))}
                        onChange={(e) => {
                          const id = rowKey(rec);
                          setSelectedIds((current) =>
                            e.target.checked ? [...current, id] : current.filter((item) => item !== id),
                          );
                        }}
                      />
                    </td>
                    <td>
                      <button
                        type="button"
                        className="linkish"
                        onClick={() => navigate(`/recordings/${rec.callId}/${rec.recordingId}`)}
                      >
                        {formatWhen(rec.createdTime) !== "—"
                          ? formatWhen(rec.createdTime)
                          : rec.callDate || "—"}
                      </button>
                      <div className="muted-inline">FC-{rec.callId}</div>
                    </td>
                    <td>
                      <strong>{rec.customerName || "Customer"}</strong>
                      <div className="muted-inline">{rec.customerPhone || rec.phoneNumber || "—"}</div>
                    </td>
                    <td>
                      <span className={`badge ${rec.answered ? "ok" : "muted"}`}>
                        {rec.answered ? "Answered" : "Not answered"}
                      </span>
                    </td>
                    <td className="capitalize">{rec.direction || "—"}</td>
                    <td>{rec.durationSec != null ? formatDurationLong(rec.durationSec) : "—"}</td>
                    <td>
                      {rec.talkPercentage != null ? `${rec.talkPercentage.toFixed(0)}%` : "—"}
                      {rec.interruptionCount != null ? (
                        <div className="muted-inline">{rec.interruptionCount} interruptions</div>
                      ) : null}
                    </td>
                    <td>{rec.wordsPerSecond != null ? `${rec.wordsPerSecond.toFixed(1)} w/s` : "—"}</td>
                    <td>
                      {rec.disposition ? (
                        <span className={dispositionClass(rec.disposition)}>{dispositionLabel(rec.disposition)}</span>
                      ) : (
                        <span className="muted-inline">—</span>
                      )}
                    </td>
                    <td>
                      <span
                        className={`badge ${
                          rec.analysisStatus === "completed"
                            ? "ok"
                            : rec.analysisStatus === "failed"
                              ? "danger"
                              : "muted"
                        }`}
                      >
                        {rec.analysisStatus === "completed"
                          ? "Analyzed"
                          : rec.analysisStatus === "failed"
                            ? "Failed"
                            : rec.analysisStatus === "running" || rec.analysisStatus === "queued"
                              ? "Analyzing"
                              : "Needs analysis"}
                      </span>
                    </td>
                    <td>
                      {rec.introductionScore != null ? (
                        <span className={`badge ${scoreTone(rec.introductionScore)}`} title={rec.introductionRank ?? undefined}>
                          {rec.introductionScore.toFixed(0)}
                        </span>
                      ) : (
                        <span className="muted-inline">—</span>
                      )}
                    </td>
                    <td>
                      <span className={`badge ${scoreTone(rec.callQualityScore ?? rec.overallScore)}`}>
                        {rec.callQualityScore != null
                          ? rec.callQualityScore.toFixed(0)
                          : rec.overallScore != null
                            ? rec.overallScore.toFixed(0)
                            : "—"}
                      </span>
                    </td>
                    <td>
                      <button
                        type="button"
                        className="btn primary compact"
                        disabled={analyzingIds.includes(rowKey(rec))}
                        onClick={() => void handleAnalyze(rec)}
                      >
                        {analyzingIds.includes(rowKey(rec))
                          ? "Analyzing…"
                          : rec.analysisStatus === "completed"
                            ? "Open"
                            : "Analyze"}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="filter-panel-footer">
          <button
            type="button"
            className="btn ghost"
            disabled={page <= 1}
            onClick={() =>
              void refresh(page - 1).catch((err) => onError(err instanceof Error ? err.message : String(err)))
            }
          >
            Previous
          </button>
          <button
            type="button"
            className="btn ghost"
            disabled={page >= totalPages}
            onClick={() =>
              void refresh(page + 1).catch((err) => onError(err instanceof Error ? err.message : String(err)))
            }
          >
            Next
          </button>
        </div>
      </section>
    </div>
  );
}
