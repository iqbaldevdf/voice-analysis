import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fetchAgents, type AgentSummary } from "../api";
import { SearchField } from "../components/ui/Fields";

type Props = {
  onError: (message: string | null) => void;
};

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

function coverage(agent: AgentSummary): number {
  if (!agent.recordingCount) return 0;
  return Math.round((agent.analyzedCount / agent.recordingCount) * 100);
}

function scoreTone(score: number | null): string {
  if (score == null) return "muted";
  if (score >= 75) return "ok";
  if (score >= 55) return "warn";
  return "danger";
}

function formatWhen(iso?: string | null): string {
  if (!iso) return "No calls yet";
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function AgentsListView({ onError }: Props) {
  const navigate = useNavigate();
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void fetchAgents({ q: query || undefined, limit: 50 })
      .then((data) => {
        if (!cancelled) {
          setAgents(data.agents);
          setTotal(data.total);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setLoading(false);
          onError(err instanceof Error ? err.message : String(err));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [query, onError]);

  const roster = useMemo(() => {
    const recordings = agents.reduce((sum, agent) => sum + agent.recordingCount, 0);
    const analyzed = agents.reduce((sum, agent) => sum + agent.analyzedCount, 0);
    const scored = agents.filter((agent) => agent.averageScore != null);
    const average =
      scored.length > 0
        ? scored.reduce((sum, agent) => sum + (agent.averageScore ?? 0), 0) / scored.length
        : null;
    return { recordings, analyzed, average };
  }, [agents]);

  return (
    <div className="agents-page">
      <header className="viewport-header">
        <div>
          <h1>Agents</h1>
        </div>
      </header>

      <section className="kpi-row agent-kpi">
        <article className="kpi-card">
          <span>Agents on roster</span>
          <strong>{total}</strong>
          <em>Customers are excluded</em>
        </article>
        <article className="kpi-card">
          <span>Recordings held</span>
          <strong>{roster.recordings}</strong>
          <em>{roster.analyzed} analyzed</em>
        </article>
        <article className="kpi-card">
          <span>Average performance</span>
          <strong>{roster.average != null ? roster.average.toFixed(1) : "—"}</strong>
          <em>Across agents with scores</em>
        </article>
      </section>

      <div className="filter-panel">
        <SearchField
          id="agent-search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by agent name…"
        />
      </div>

      {loading ? (
        <p className="empty soft">Loading agents…</p>
      ) : agents.length === 0 ? (
        <div className="empty-state">
          <h3>No agents yet</h3>
          <p>Agents appear when a recording is synced with an assigned agent name.</p>
        </div>
      ) : (
        <section className="agent-roster">
          {agents.map((agent) => {
            const covered = coverage(agent);
            const pending = Math.max(0, agent.recordingCount - agent.analyzedCount);
            return (
              <button
                key={agent.agentId}
                type="button"
                className="agent-card"
                onClick={() => navigate(`/agents/${encodeURIComponent(agent.agentId)}`)}
              >
                <div className="agent-card-top">
                  <span className="avatar agent">{initials(agent.name)}</span>
                  <div className="agent-identity">
                    <strong>{agent.name}</strong>
                    <span>{agent.teamName || "No team assigned"}</span>
                  </div>
                  <span className={`badge ${scoreTone(agent.averageScore)}`}>
                    {agent.averageScore != null ? agent.averageScore.toFixed(0) : "No score"}
                  </span>
                </div>

                <dl className="agent-card-stats">
                  <div>
                    <dt>Calls</dt>
                    <dd>{agent.callCount}</dd>
                  </div>
                  <div>
                    <dt>Recordings</dt>
                    <dd>{agent.recordingCount}</dd>
                  </div>
                  <div>
                    <dt>Pending</dt>
                    <dd>{pending}</dd>
                  </div>
                </dl>

                <div className="agent-coverage">
                  <span>Analysis coverage</span>
                  <strong>{covered}%</strong>
                </div>
                <div className="perf-bar" aria-hidden>
                  <i style={{ width: `${covered}%` }} />
                </div>
                <p className="agent-card-foot">Last call {formatWhen(agent.lastCallAt)}</p>
              </button>
            );
          })}
        </section>
      )}
    </div>
  );
}
