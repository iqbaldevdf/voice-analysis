import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { fetchAgents, type AgentSummary, type QuarterWindow } from "../api";
import { agentDisplayName, agentInitials } from "../lib/agentInitials";
import { MetricLabel } from "../components/MetricInfoTip";
import { SearchField, SelectField } from "../components/ui/Fields";
import { metricHelp } from "../lib/metricHelp";

type Props = {
  onError: (message: string | null) => void;
};

function scoreTone(score: number | null): string {
  if (score == null) return "muted";
  if (score >= 75) return "ok";
  if (score >= 55) return "warn";
  return "danger";
}

export function AgentsListView({ onError }: Props) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [quarterId, setQuarterId] = useState(searchParams.get("quarter") ?? "");
  const [quarter, setQuarter] = useState<QuarterWindow | null>(null);
  const [availableQuarters, setAvailableQuarters] = useState<QuarterWindow[]>([]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void fetchAgents({ q: query || undefined, limit: 50, quarter: quarterId || undefined })
      .then((data) => {
        if (!cancelled) {
          setAgents(data.agents);
          setQuarter(data.quarter);
          setAvailableQuarters(data.availableQuarters ?? []);
          const resolvedQuarter = data.quarter?.id ?? "";
          if (resolvedQuarter && resolvedQuarter !== quarterId) {
            setQuarterId(resolvedQuarter);
          }
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
  }, [query, quarterId, onError]);

  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    const activeQuarter = quarterId || quarter?.id || "";
    if (activeQuarter) next.set("quarter", activeQuarter);
    else next.delete("quarter");
    if (next.toString() !== searchParams.toString()) {
      setSearchParams(next, { replace: true });
    }
  }, [quarterId, quarter?.id, searchParams, setSearchParams]);

  const roster = useMemo(() => {
    const connects = agents.reduce((sum, agent) => sum + agent.recordingCount, 0);
    const analyzed = agents.reduce((sum, agent) => sum + agent.analyzedCount, 0);
    const appointments = agents.reduce((sum, agent) => sum + (agent.appointmentCount ?? 0), 0);
    const scored = agents.filter((agent) => agent.averageScore != null);
    const average =
      scored.length > 0
        ? scored.reduce((sum, agent) => sum + (agent.averageScore ?? 0), 0) / scored.length
        : null;
    return { connects, analyzed, appointments, average };
  }, [agents]);

  function openAgent(agentId: string) {
    const activeQuarter = quarterId || quarter?.id;
    navigate(
      activeQuarter
        ? `/agents/${encodeURIComponent(agentId)}?quarter=${encodeURIComponent(activeQuarter)}`
        : `/agents/${encodeURIComponent(agentId)}`,
    );
  }

  return (
    <div className="agents-page">
      <header className="viewport-header">
        <div>
          <h1>Agents</h1>
          <p className="panel-sub">{quarter?.label ?? "Current quarter"}</p>
        </div>
        <div className="viewport-actions">
          <SelectField
            id="agents-quarter"
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
        </div>
      </header>

      <section className="kpi-row agent-kpi">
        <article className="kpi-card">
          <MetricLabel layout="corner" help={metricHelp("overallCalls")}>Total calls</MetricLabel>
          <strong>{roster.connects}</strong>
          <em>Connects in {quarter?.label ?? "quarter"}</em>
        </article>
        <article className="kpi-card">
          <MetricLabel layout="corner" help={metricHelp("callsAnalyzed")}>Calls analyzed</MetricLabel>
          <strong>{roster.analyzed} / {roster.connects}</strong>
          <em>
            {roster.connects > 0
              ? `${Math.round((roster.analyzed / roster.connects) * 100)}% analyzed`
              : "No connects in this quarter"}
          </em>
        </article>
        <article className="kpi-card">
          <MetricLabel layout="corner" help={metricHelp("rosterOverallScore")}>Overall score</MetricLabel>
          <strong>{roster.average != null ? roster.average.toFixed(0) : "—"}</strong>
          <em>Average across agents with scores</em>
        </article>
        <article className="kpi-card">
          <MetricLabel layout="corner" help={metricHelp("appointments")}>Appointments</MetricLabel>
          <strong>{roster.appointments}</strong>
          <em>Disposition = Appointment</em>
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
        <section className="panel agents-table-panel">
          <div className="table-wrap">
            <table className="data-table agents-table">
              <thead>
                <tr>
                  <th>Agent</th>
                  <th>
                    <MetricLabel help={metricHelp("agentCallsAnalyzed")}>Calls analyzed</MetricLabel>
                  </th>
                  <th>
                    <MetricLabel help={metricHelp("agentOverallScore")}>Overall score</MetricLabel>
                  </th>
                  <th>
                    <MetricLabel help={metricHelp("agentAppointments")}>Appointments</MetricLabel>
                  </th>
                  <th aria-hidden />
                </tr>
              </thead>
              <tbody>
                {agents.map((agent) => (
                  <tr key={agent.agentId}>
                    <td>
                      <div className="agents-table-agent">
                        <span className="avatar agent sm">{agentInitials(agent.name)}</span>
                        <strong>{agentDisplayName(agent.name)}</strong>
                      </div>
                    </td>
                    <td>
                      {agent.analyzedCount} / {agent.recordingCount}
                    </td>
                    <td>
                      <span className={`badge ${scoreTone(agent.averageScore)}`}>
                        {agent.averageScore != null ? agent.averageScore.toFixed(0) : "—"}
                      </span>
                    </td>
                    <td>{agent.appointmentCount ?? 0}</td>
                    <td>
                      <button
                        type="button"
                        className="btn primary compact"
                        onClick={() => openAgent(agent.agentId)}
                      >
                        Open
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="agents-table-footer">
            <span className="muted-inline">
              {agents.length} agent{agents.length === 1 ? "" : "s"} · {quarter?.label ?? "Current quarter"}
            </span>
          </div>
        </section>
      )}
    </div>
  );
}
