import { useState } from "react";
import {
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
} from "recharts";
import type { ParticipantPerformance } from "../api";
import { formatDurationLong, formatTime } from "../api";

const LABELS: Record<string, string> = {
  communicationEffectiveness: "Communication",
  responseRelevance: "Relevance",
  activeListening: "Listening",
  turnTaking: "Turn taking",
  engagement: "Engagement",
  conversationBalance: "Balance",
  efficiency: "Efficiency",
};

type Props = {
  items: ParticipantPerformance[];
  onSeek: (seconds: number) => void;
};

export function ParticipantPerformancePanel({ items, onSeek }: Props) {
  const [openSpeaker, setOpenSpeaker] = useState<string | null>(items[0]?.speaker ?? null);
  if (!items.length) return null;

  const talkData = items.map((item) => ({
    name: item.displayName || item.speaker,
    talk: item.talkPercentage,
  }));

  return (
    <section className="panel performance-panel">
      <div className="panel-head">
        <div>
          <h2 className="panel-title">Participant analysis</h2>
          <p className="panel-sub">
            Agent rows are performance scores. Customer rows are interaction analysis, not employee scoring.
          </p>
        </div>
      </div>

      <div className="perf-talk-row">
        {talkData.map((item) => (
          <div key={item.name} className="perf-talk-item">
            <span>{item.name}</span>
            <strong>{item.talk.toFixed(0)}%</strong>
            <div className="perf-bar">
              <i style={{ width: `${Math.min(100, item.talk)}%` }} />
            </div>
          </div>
        ))}
      </div>

      <div className="perf-grid">
        {items.map((item) => {
          const radar = Object.entries(LABELS).map(([key, label]) => ({
            label,
            score: item.scores?.[key]?.score ?? 0,
          }));
          const open = openSpeaker === item.speaker;
          return (
            <article key={item.speaker} className="perf-card">
              <header className="perf-card-head">
                <div>
                  <strong>{item.displayName || item.speaker}</strong>
                  <span className={`badge ${item.presentation === "performance" ? "ok" : "muted"}`}>
                    {item.presentation === "performance" ? "Performance" : "Interaction"}
                  </span>
                </div>
                <em>{item.overallScore != null ? item.overallScore.toFixed(0) : "—"}</em>
              </header>

              <div className="perf-radar">
                <ResponsiveContainer width="100%" height={180}>
                  <RadarChart data={radar}>
                    <PolarGrid />
                    <PolarAngleAxis dataKey="label" tick={{ fontSize: 10 }} />
                    <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
                    <Radar dataKey="score" stroke="#5b5fc7" fill="#5b5fc7" fillOpacity={0.25} />
                  </RadarChart>
                </ResponsiveContainer>
              </div>

              <dl className="perf-stats">
                <div><dt>Talk time</dt><dd>{formatDurationLong(item.totalTalkDuration)}</dd></div>
                <div><dt>Turns</dt><dd>{item.speakingTurnCount}</dd></div>
                <div><dt>Avg turn</dt><dd>{formatDurationLong(item.averageTurnDuration)}</dd></div>
                <div><dt>Longest</dt><dd>{formatDurationLong(item.longestTurnDuration)}</dd></div>
                <div><dt>Interruptions</dt><dd>{item.interruptionCount}</dd></div>
                <div><dt>Response</dt><dd>{item.averageResponseTime != null ? `${item.averageResponseTime.toFixed(1)}s` : "—"}</dd></div>
                <div><dt>Questions</dt><dd>{item.questionCount}</dd></div>
              </dl>

              <button
                type="button"
                className="btn ghost compact"
                onClick={() => setOpenSpeaker(open ? null : item.speaker)}
              >
                {open ? "Hide scores" : "Why these scores"}
              </button>

              {open && (
                <div className="perf-explain">
                  {Object.entries(LABELS).map(([key, label]) => {
                    const score = item.scores?.[key];
                    if (!score) return null;
                    return (
                      <div key={key} className="perf-score-row">
                        <div className="perf-score-label">
                          <span>{label}</span>
                          <strong>{score.score.toFixed(0)}</strong>
                        </div>
                        <div className="perf-bar">
                          <i style={{ width: `${Math.min(100, score.score)}%` }} />
                        </div>
                        <p>{score.explanation}</p>
                        {(score.evidence ?? []).map((ev, idx) => (
                          <button
                            key={`${ev.start}-${idx}`}
                            type="button"
                            className="evidence-chip"
                            onClick={() => onSeek(ev.start)}
                          >
                            {formatTime(ev.start)} {ev.quote ? `· ${ev.quote}` : ""}
                          </button>
                        ))}
                      </div>
                    );
                  })}
                  {item.strengths.length > 0 && (
                    <div>
                      <h3 className="subhead">Strengths</h3>
                      <ul className="checklist">{item.strengths.map((line) => <li key={line}>{line}</li>)}</ul>
                    </div>
                  )}
                  {item.improvements.length > 0 && (
                    <div>
                      <h3 className="subhead">Areas for improvement</h3>
                      <ul className="checklist">{item.improvements.map((line) => <li key={line}>{line}</li>)}</ul>
                    </div>
                  )}
                  {item.recommendations.length > 0 && (
                    <div>
                      <h3 className="subhead">Coaching</h3>
                      <ul className="checklist">{item.recommendations.map((line) => <li key={line}>{line}</li>)}</ul>
                    </div>
                  )}
                  {!item.available && item.note && <p className="phase-msg">{item.note}</p>}
                </div>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
