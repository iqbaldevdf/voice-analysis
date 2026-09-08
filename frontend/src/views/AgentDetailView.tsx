import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  fetchAgent,
  formatDurationLong,
  type AgentDetailSummary,
  type AgentRecordingRow,
  type AgentSummary,
} from "../api";
import { CheckboxField, SearchField, SelectField, TextField } from "../components/ui/Fields";

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

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

function scoreTone(score: number | null | undefined): string {
  if (score == null) return "muted";
  if (score >= 75) return "ok";
  if (score >= 55) return "warn";
  return "danger";
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
  const [voicemailMaxSec, setVoicemailMaxSec] = useState(30);
  const [page, setPage] = useState(1);
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
        });
        setAgent(data.agent);
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
    [agentId, search, statusFilter, dateFrom, dateTo, minDuration, maxDuration, sortBy, sortDir, excludeVoicemail],
  );

  useEffect(() => {
    void refresh(1).catch((err) => onError(err instanceof Error ? err.message : String(err)));
  }, [agentId, sortBy, sortDir, excludeVoicemail, dateFrom, dateTo]);

  const coverage = agent?.recordingCount
    ? Math.round((agent.analyzedCount / agent.recordingCount) * 100)
    : 0;
  const categories = Object.entries(summary?.categoryAverages ?? {});

  return (
    <div className="agents-page">
      <header className="viewport-header">
        <div className="agent-profile-head">
          <span className="avatar agent lg">{agent ? initials(agent.name) : "?"}</span>
          <div>
            <h1>{agent?.name ?? "Agent"}</h1>
          </div>
        </div>
        <div className="viewport-actions">
          <button type="button" className="btn ghost" onClick={() => navigate("/agents")}>
            All agents
          </button>
        </div>
      </header>

      <section className="kpi-row agent-kpi">
        <article className="kpi-card">
          <span>Average performance</span>
          <strong>{agent?.averageScore != null ? agent.averageScore.toFixed(1) : "—"}</strong>
          <em>{agent?.analyzedCount ?? 0} scored conversations</em>
        </article>
        <article className="kpi-card">
          <span>Calls spoken</span>
          <strong>{agent?.callCount ?? 0}</strong>
          <em>
            {summary?.inbound ?? 0} inbound · {summary?.outbound ?? 0} outbound
          </em>
        </article>
        <article className="kpi-card">
          <span>Recordings</span>
          <strong>{agent?.recordingCount ?? 0}</strong>
          <em>{summary?.pendingAnalysis ?? 0} still need analysis</em>
        </article>
        <article className="kpi-card">
          <span>Time on calls</span>
          <strong>{formatDurationLong(summary?.totalDurationSec ?? 0)}</strong>
          <em>
            {summary?.talkDurationSec
              ? `${formatDurationLong(summary.talkDurationSec)} agent talk`
              : "Talk time appears after analysis"}
          </em>
        </article>
        <article className="kpi-card">
          <span>Speech rate</span>
          <strong>
            {summary?.averageWordsPerSecond != null ? summary.averageWordsPerSecond.toFixed(1) : "—"}
          </strong>
          <em>words / second</em>
        </article>
      </section>

      <section className="agent-meta-row">
        <article className="panel agent-span">
          <h2 className="panel-title">Coverage</h2>
          <p className="panel-sub">
            First call {formatWhen(agent?.firstCallAt)} · last call {formatWhen(agent?.lastCallAt)}
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
          <span className="muted-inline">
            {total} result{total === 1 ? "" : "s"} · page {page} of {totalPages}
          </span>
        </div>
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
                <th>When</th>
                <th>Customer</th>
                <th>Direction</th>
                <th>Duration</th>
                <th>Talk</th>
                <th>Speech rate</th>
                <th>Status</th>
                <th>Score</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8} className="empty soft">Loading recordings…</td>
                </tr>
              ) : recordings.length === 0 ? (
                <tr>
                  <td colSpan={8} className="empty soft">No recordings match these filters.</td>
                </tr>
              ) : (
                recordings.map((rec) => (
                  <tr key={`${rec.callId}-${rec.recordingId}`}>
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
                      <span className={`badge ${rec.analysisStatus === "completed" ? "ok" : "muted"}`}>
                        {rec.analysisStatus === "completed" ? "Analyzed" : "Needs analysis"}
                      </span>
                    </td>
                    <td>
                      <span className={`badge ${scoreTone(rec.overallScore)}`}>
                        {rec.overallScore != null ? rec.overallScore.toFixed(0) : "—"}
                      </span>
                      {rec.highlight ? <div className="agent-note">{rec.highlight}</div> : null}
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
