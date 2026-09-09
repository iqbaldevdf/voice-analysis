import { useEffect, useMemo, useRef, useState } from "react";
import {
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  LineChart,
  Line,
  CartesianGrid,
  ReferenceLine,
} from "recharts";
import {
  fetchJob,
  formatDurationLong,
  formatTime,
  jobAudioUrl,
  normalizeTopics,
  scoreTone,
  updateRecordingDisposition,
  type AnalysisJob,
  type SalesDisposition,
  type SpeakerMetrics,
} from "../api";
import { IntroductionScriptPanel } from "../components/IntroductionScriptPanel";
import { ParticipantPerformancePanel } from "../components/ParticipantPerformancePanel";
import { SearchField, SelectField } from "../components/ui/Fields";
import { callQualityParts } from "../lib/callQuality";
import { agentDisplayName } from "../lib/agentInitials";
import { DISPOSITION_OPTIONS, dispositionClass, dispositionLabel } from "../lib/disposition";

const AGENT_COLOR = "#2f6f5e";
const CUSTOMER_COLOR = "#5c4d7a";
const SILENCE_COLOR = "#c5cdc7";

type Props = {
  job: AnalysisJob;
  audioUrlOverride?: string;
  onBack: () => void;
  onJobUpdate: (job: AnalysisJob) => void;
  onError: (message: string | null) => void;
};

function statusLabel(status: AnalysisJob["status"]): string {
  switch (status) {
    case "queued":
      return "Queued";
    case "normalizing":
      return "Normalizing audio";
    case "analyzing":
      return "Generating AI notes";
    case "completed":
      return "Completed";
    case "failed":
      return "Failed";
    default:
      return status;
  }
}

function qualityLabel(score: number): string {
  if (score >= 80) return "Good";
  if (score >= 60) return "Fair";
  return "Needs Improvement";
}

function pickRole(metrics: SpeakerMetrics[], role: "agent" | "customer"): SpeakerMetrics | undefined {
  return metrics.find((m) => m.role_guess === role) ?? (role === "agent" ? metrics[0] : metrics[1]);
}

function sentimentEmoji(sentiment?: string): string {
  if (sentiment === "POSITIVE") return "🙂";
  if (sentiment === "NEGATIVE") return "🙁";
  return "😐";
}

function longestMonologueSec(
  utterances: Array<{ speaker: string; start: number; end: number }>,
  speaker?: string,
): number {
  let best = 0;
  for (const u of utterances) {
    if (speaker && u.speaker !== speaker) continue;
    best = Math.max(best, Math.max(0, u.end - u.start));
  }
  return best;
}

function QualityRing({ score, size = 72 }: { score: number; size?: number }) {
  const clamped = Math.max(0, Math.min(100, score));
  const radius = 34;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (clamped / 100) * circumference;
  const tone = scoreTone(clamped);
  const stroke = tone === "good" ? "#2f6f5e" : tone === "ok" ? "#b7791f" : "#8b3a3a";

  return (
    <div className="quality-ring" style={{ width: size, height: size }} aria-label={`Score ${Math.round(clamped)}`}>
      <svg viewBox="0 0 80 80" width={size} height={size}>
        <circle cx="40" cy="40" r={radius} fill="none" stroke="#e6ece8" strokeWidth="7" />
        <circle
          cx="40"
          cy="40"
          r={radius}
          fill="none"
          stroke={stroke}
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          transform="rotate(-90 40 40)"
        />
      </svg>
      <div className="quality-ring-label">
        <strong className={tone}>{Math.round(clamped)}</strong>
        <span>/100</span>
      </div>
    </div>
  );
}

/** Semi-circle sentiment gauge matching the reference mock. */
function SentimentGauge({
  overall,
  score,
}: {
  overall: string;
  score: number;
}) {
  const clamped = Math.max(-100, Math.min(100, score));
  const pct = (clamped + 100) / 200; // 0..1
  const angle = -90 + pct * 180;
  const label = overall || "NEUTRAL";

  return (
    <div className="sentiment-gauge-visual">
      <svg viewBox="0 0 200 120" className="gauge-svg" aria-hidden>
        <defs>
          <linearGradient id="sentGaugeGrad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#dc2626" />
            <stop offset="45%" stopColor="#d97706" />
            <stop offset="100%" stopColor="#16a34a" />
          </linearGradient>
        </defs>
        <path
          d="M 20 100 A 80 80 0 0 1 180 100"
          fill="none"
          stroke="#eef0f7"
          strokeWidth="14"
          strokeLinecap="round"
        />
        <path
          d="M 20 100 A 80 80 0 0 1 180 100"
          fill="none"
          stroke="url(#sentGaugeGrad)"
          strokeWidth="14"
          strokeLinecap="round"
          strokeDasharray={`${pct * 251} 251`}
        />
        <g transform={`rotate(${angle} 100 100)`}>
          <line x1="100" y1="100" x2="100" y2="35" stroke="#1e2433" strokeWidth="3" strokeLinecap="round" />
          <circle cx="100" cy="100" r="5" fill="#1e2433" />
        </g>
      </svg>
      <div className={`gauge-caption sent-${label.toLowerCase()}`}>
        <strong>{label}</strong>
        <span>Overall Sentiment</span>
      </div>
    </div>
  );
}

export function CallDetailsView({ job, audioUrlOverride, onBack, onJobUpdate, onError }: Props) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const timelineRef = useRef<HTMLDivElement | null>(null);
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const [search, setSearch] = useState("");
  const [playbackRate, setPlaybackRate] = useState(1);
  const [currentTime, setCurrentTime] = useState(0);
  const [mediaDuration, setMediaDuration] = useState(0);
  const [disposition, setDisposition] = useState<SalesDisposition | "">(job.disposition ?? "");
  const [savingDisposition, setSavingDisposition] = useState(false);
  const audioSrc = audioUrlOverride ?? jobAudioUrl(job.id);
  const isDbJob = job.id.startsWith("db-");

  useEffect(() => {
    setDisposition(job.disposition ?? "");
  }, [job.id, job.disposition]);

  useEffect(() => {
    if (isDbJob || job.status === "completed" || job.status === "failed") return;
    const timer = window.setInterval(async () => {
      try {
        const data = await fetchJob(job.id);
        onJobUpdate(data.job);
      } catch (err) {
        onError(err instanceof Error ? err.message : String(err));
      }
    }, 1500);
    return () => window.clearInterval(timer);
  }, [job.id, job.status, isDbJob, onJobUpdate, onError]);

  const result = job.result;
  const meta = job.callMeta;
  const cq = result?.call_quality;
  const extraction = result?.ai_extraction;
  const sentiment = result?.llm_sentiment;

  const agentMetrics = useMemo(
    () => (result ? pickRole(result.speaker_metrics, "agent") : undefined),
    [result],
  );
  const customerMetrics = useMemo(
    () => (result ? pickRole(result.speaker_metrics, "customer") : undefined),
    [result],
  );

  const agentParticipant = meta?.participants.find((p) => p.role.toLowerCase() === "agent");
  const customerParticipant = meta?.participants.find((p) => p.role.toLowerCase() === "customer");
  const agentName = agentDisplayName(agentParticipant?.name || meta?.agentName);
  const customerName = customerParticipant?.name || "Customer";

  const analysisDuration = result?.duration_sec ?? job.durationSec ?? 0;
  const topics = useMemo(() => normalizeTopics(extraction?.key_topics ?? []), [extraction]);
  const utterances = result?.utterances ?? [];
  const lastUtteranceEnd = utterances.reduce((max, utt) => Math.max(max, utt.end || 0), 0);
  const duration = Math.max(analysisDuration, mediaDuration, lastUtteranceEnd);

  const overviewData = useMemo(() => {
    const agentTalk = agentMetrics?.talk_time_sec ?? 0;
    const customerTalk = customerMetrics?.talk_time_sec ?? 0;
    const silence = cq?.silence_sec ?? Math.max(0, duration - agentTalk - customerTalk);
    return [
      { name: "Agent", value: Math.max(0.01, agentTalk), color: AGENT_COLOR },
      { name: "Customer", value: Math.max(0.01, customerTalk), color: CUSTOMER_COLOR },
      { name: "Silence", value: Math.max(0.01, silence), color: SILENCE_COLOR },
    ];
  }, [agentMetrics, customerMetrics, cq, duration]);

  const sentimentBreakdown = useMemo(() => {
    const segs = result?.sentiment_segments ?? [];
    if (segs.length === 0) return { pos: 0, neu: 100, neg: 0 };
    const pos = (segs.filter((s) => s.sentiment === "POSITIVE").length / segs.length) * 100;
    const neg = (segs.filter((s) => s.sentiment === "NEGATIVE").length / segs.length) * 100;
    const neu = 100 - pos - neg;
    return { pos: Math.round(pos), neu: Math.round(neu), neg: Math.round(neg) };
  }, [result]);

  const timeline = result?.sentiment_timeline ?? [];
  const coloredTimeline = useMemo(
    () =>
      timeline.map((p) => ({
        ...p,
        stroke:
          p.label === "POSITIVE" ? "#16a34a" : p.label === "NEGATIVE" ? "#dc2626" : "#d97706",
      })),
    [timeline],
  );

  const filteredUtterances = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return utterances;
    return utterances.filter(
      (u) => u.text.toLowerCase().includes(q) || u.speaker.toLowerCase().includes(q),
    );
  }, [utterances, search]);

  function seekTo(seconds: number) {
    const audio = audioRef.current;
    if (!audio) return;
    const next = Math.max(0, Math.min(seconds, duration || seconds));
    audio.currentTime = next;
    setCurrentTime(next);
    void audio.play();
  }

  function seekFromTimeline(clientX: number) {
    const track = timelineRef.current;
    const audio = audioRef.current;
    if (!track || !audio || duration <= 0) return;
    const rect = track.getBoundingClientRect();
    if (rect.width <= 0) return;
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    seekTo(ratio * duration);
  }

  const activeUtteranceIndex = useMemo(() => {
    const idx = utterances.findIndex((utt) => currentTime >= utt.start && currentTime < utt.end + 0.05);
    return idx;
  }, [utterances, currentTime]);

  useEffect(() => {
    const list = transcriptRef.current;
    if (!list) return;
    const active = list.querySelector<HTMLElement>(".transcript-row.active");
    active?.scrollIntoView({ block: "nearest" });
  }, [activeUtteranceIndex]);

  const callIdLabel = meta?.callId
    ? `FC-${meta.callId}`
    : job.freshcallerCallId
      ? `FC-${job.freshcallerCallId}`
      : job.id.slice(0, 8);

  const created = meta?.createdTime ? new Date(meta.createdTime) : new Date(job.createdAt);

  if (job.status !== "completed" || !result || !cq) {
    return (
      <div className="details-page call-details-mock">
        <button type="button" className="back-link" onClick={onBack}>
          ← Back to Calls
        </button>
        <div className="panel status-panel">
          <h1>Call Details</h1>
          <p className="meta-line">
            Status: <strong>{statusLabel(job.status)}</strong>
          </p>
          {job.error && <p className="error-banner">{job.error}</p>}
          {job.status !== "failed" && <div className="pulse" aria-hidden />}
        </div>
      </div>
    );
  }

  const interruptions = cq.interruptions_count ?? 0;
  const silenceSec = cq.silence_sec ?? (duration * cq.silence_ratio_pct) / 100;
  const quality = callQualityParts(cq, agentMetrics);
  const speechWordsPerSec = quality.wordsPerSecond;
  const canSetDisposition = job.freshcallerCallId != null && job.recordingId != null;
  const talkYou = agentMetrics?.talk_ratio_pct ?? 0;
  const talkCustomer = customerMetrics?.talk_ratio_pct ?? Math.max(0, 100 - talkYou);
  const overallScore =
    sentiment?.overall_score ??
    (sentiment?.overall === "POSITIVE" ? 60 : sentiment?.overall === "NEGATIVE" ? -40 : 0);

  const agentMono = longestMonologueSec(utterances, agentMetrics?.speaker);
  const customerMono = longestMonologueSec(utterances, customerMetrics?.speaker);

  async function copyCallId() {
    try {
      await navigator.clipboard?.writeText(callIdLabel);
    } catch {
      // ignore
    }
  }

  return (
    <div className="details-page call-details-mock">
      <div className="meeting-topbar">
        <button type="button" className="back-link" onClick={onBack}>
          ← Back to Calls
        </button>
        <div className="topbar-actions">
          <a className="btn ghost" href={audioSrc} download>
            Download Audio
          </a>
          <button type="button" className="btn ghost" disabled>
            Add Note
          </button>
          <button type="button" className="btn primary" disabled>
            Share Report
          </button>
        </div>
      </div>

      <header className="call-brief">
        <div className="call-brief-id">
          <h1>{callIdLabel}</h1>
          <button type="button" className="copy-id" onClick={() => void copyCallId()} title="Copy">
            Copy
          </button>
          <span className="status-pill">Completed</span>
        </div>
        <dl className="call-brief-facts">
          <div>
            <dt>When</dt>
            <dd>
              {created.toLocaleDateString(undefined, {
                day: "2-digit",
                month: "short",
                year: "numeric",
              })}{" "}
              · {created.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
            </dd>
          </div>
          <div>
            <dt>Duration</dt>
            <dd>{formatDurationLong(duration)}</dd>
          </div>
          <div>
            <dt>Answered</dt>
            <dd>{job.answered == null ? "—" : job.answered ? "Answered" : "Not answered"}</dd>
          </div>
          <div>
            <dt>Type</dt>
            <dd className="capitalize">{meta?.direction || "Call"}</dd>
          </div>
          <div>
            <dt>Agent</dt>
            <dd>
              {agentName}
              {agentParticipant?.phone || meta?.phoneNumber
                ? ` · ${agentParticipant?.phone || meta?.phoneNumber}`
                : ""}
            </dd>
          </div>
          <div>
            <dt>Customer</dt>
            <dd>
              {customerName}
              {customerParticipant?.phone ? ` · ${customerParticipant.phone}` : ""}
            </dd>
          </div>
        </dl>
      </header>

      {/* KPI strip */}
      <section className="kpi-row">
        <article className="kpi-card kpi-quality">
          <span>Call Quality Score</span>
          {quality.callQualityScore != null ? (
            <QualityRing score={quality.callQualityScore} />
          ) : (
            <strong>—</strong>
          )}
          <em className={quality.callQualityScore != null ? scoreTone(quality.callQualityScore) : "muted"}>
            {quality.callQualityScore != null ? qualityLabel(quality.callQualityScore) : "Not scored"}
          </em>
          <em>
            clarity {quality.clarityScore != null ? quality.clarityScore.toFixed(0) : "—"} · speech rate{" "}
            {quality.speechRateScore != null ? quality.speechRateScore.toFixed(0) : "—"}
          </em>
        </article>
        <article className="kpi-card">
          <span>Talk / Listen Ratio</span>
          <strong>
            {Math.round(talkYou)}% <small>You</small>
          </strong>
          <div className="ratio-bar" aria-hidden>
            <i style={{ width: `${Math.max(4, talkYou)}%` }} />
            <b style={{ width: `${Math.max(4, talkCustomer)}%` }} />
          </div>
          <em>{Math.round(talkCustomer)}% Customer</em>
        </article>
        <article className="kpi-card">
          <span>Avg Response Time</span>
          <strong>{cq.avg_response_time_sec.toFixed(1)}s</strong>
          <em className={cq.avg_response_time_sec <= 2.5 ? "good" : "poor"}>
            {cq.avg_response_time_sec <= 2.5 ? "Good" : "Needs Improvement"}
          </em>
        </article>
        <article className="kpi-card">
          <span>Silence (Total)</span>
          <strong>{Math.round(cq.silence_ratio_pct)}%</strong>
          <em>{formatDurationLong(silenceSec)}</em>
        </article>
        <article className="kpi-card">
          <span>Interruptions</span>
          <strong>{interruptions}</strong>
          <em className={interruptions <= 2 ? "good" : "poor"}>
            {interruptions <= 2 ? "Good" : "Needs Improvement"}
          </em>
        </article>
        <article className="kpi-card">
          <span>Speech rate</span>
          <strong>{speechWordsPerSec != null ? speechWordsPerSec.toFixed(1) : "—"}</strong>
          <em>
            words / second
            {quality.speechRateScore != null ? ` · score ${quality.speechRateScore.toFixed(0)}` : ""}
          </em>
        </article>
      </section>

      <section className="charts-grid three-col">
        <article className="panel chart-panel">
          <h2 className="panel-title">Conversation Overview</h2>
          <div className="chart-box">
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={overviewData} dataKey="value" innerRadius={55} outerRadius={82} paddingAngle={2}>
                  {overviewData.map((entry) => (
                    <Cell key={entry.name} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip formatter={(value) => formatDurationLong(Number(value ?? 0))} />
              </PieChart>
            </ResponsiveContainer>
            <ul className="legend-list">
              {overviewData.map((item) => (
                <li key={item.name}>
                  <i style={{ background: item.color }} />
                  {item.name} · {formatDurationLong(item.value)}
                </li>
              ))}
            </ul>
          </div>
        </article>

        <article className="panel chart-panel">
          <h2 className="panel-title">Sentiment Analysis</h2>
          <div className="sentiment-panel-body">
            <SentimentGauge overall={sentiment?.overall || "NEUTRAL"} score={overallScore} />
            <div className="sent-bars">
              <div>
                <span>Positive</span>
                <div className="mini-bar">
                  <i className="pos" style={{ width: `${sentimentBreakdown.pos}%` }} />
                </div>
                <b>{sentimentBreakdown.pos}%</b>
              </div>
              <div>
                <span>Neutral</span>
                <div className="mini-bar">
                  <i className="neu" style={{ width: `${sentimentBreakdown.neu}%` }} />
                </div>
                <b>{sentimentBreakdown.neu}%</b>
              </div>
              <div>
                <span>Negative</span>
                <div className="mini-bar">
                  <i className="neg" style={{ width: `${sentimentBreakdown.neg}%` }} />
                </div>
                <b>{sentimentBreakdown.neg}%</b>
              </div>
            </div>
          </div>
        </article>

        <article className="panel chart-panel">
          <h2 className="panel-title">Call Outcome</h2>
          <div className="outcome-box">
            <strong className={`outcome-badge outcome-${(extraction?.call_outcome || "unclear").toLowerCase()}`}>
              {extraction?.call_outcome || "Unclear"}
            </strong>
            {canSetDisposition ? (
              <div className="disposition-field">
                <SelectField
                  id="sales-disposition"
                  label="Disposition"
                  value={disposition}
                  disabled={savingDisposition}
                  onChange={(e) => {
                    const next = e.target.value as SalesDisposition | "";
                    const callId = job.freshcallerCallId;
                    const recordingId = job.recordingId;
                    if (callId == null || recordingId == null) return;
                    setDisposition(next);
                    setSavingDisposition(true);
                    void updateRecordingDisposition(callId, recordingId, next || null)
                      .then(() => {
                        onJobUpdate({ ...job, disposition: next || null });
                      })
                      .catch((err) => {
                        setDisposition(job.disposition ?? "");
                        onError(err instanceof Error ? err.message : String(err));
                      })
                      .finally(() => setSavingDisposition(false));
                  }}
                >
                  <option value="">Not set</option>
                  {DISPOSITION_OPTIONS.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </SelectField>
                <span className={dispositionClass(disposition || null)}>{dispositionLabel(disposition || null)}</span>
              </div>
            ) : null}
            {extraction?.customer_intent && <p className="intent">Intent: {extraction.customer_intent}</p>}
            <ul className="checklist">
              {(extraction?.action_items ?? []).slice(0, 5).map((item) => (
                <li key={item}>{item}</li>
              ))}
              {(extraction?.action_items ?? []).length === 0 && (
                <li className="empty soft">No action items extracted</li>
              )}
            </ul>
          </div>
        </article>
      </section>

      <section className="recording-workspace">
        <article className="panel player-card" aria-label="Call recording">
          <div className="player-head">
            <h2 className="panel-title">Call recording</h2>
            <span className="timeline-clock">
              {formatTime(currentTime)} / {formatTime(duration)}
            </span>
          </div>
          <div className="player-block">
            <audio
              ref={audioRef}
              controls
              src={audioSrc}
              onLoadedMetadata={(e) => {
                const audio = e.currentTarget;
                if (Number.isFinite(audio.duration)) setMediaDuration(audio.duration);
                audio.playbackRate = playbackRate;
              }}
              onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
              onSeeked={(e) => setCurrentTime(e.currentTarget.currentTime)}
              onRateChange={(e) => setPlaybackRate(e.currentTarget.playbackRate)}
            />
            <div className="player-controls">
              <button
                type="button"
                className="btn ghost compact"
                onClick={() => seekTo(Math.max(0, currentTime - 10))}
              >
                −10s
              </button>
              <button
                type="button"
                className="btn ghost compact"
                onClick={() => seekTo(Math.min(duration, currentTime + 10))}
              >
                +10s
              </button>
              <SelectField
                id="playback-speed"
                label="Speed"
                className="playback-speed-field"
                value={playbackRate}
                onChange={(e) => {
                  const rate = Number(e.target.value);
                  setPlaybackRate(rate);
                  if (audioRef.current) audioRef.current.playbackRate = rate;
                }}
              >
                {[0.75, 1, 1.25, 1.5, 2].map((rate) => (
                  <option key={rate} value={rate}>
                    {rate}x
                  </option>
                ))}
              </SelectField>
            </div>
            <div
              ref={timelineRef}
              className="talk-timeline"
              role="slider"
              aria-label="Conversation timeline"
              aria-valuemin={0}
              aria-valuemax={Math.round(duration)}
              aria-valuenow={Math.round(currentTime)}
              tabIndex={0}
              onClick={(e) => seekFromTimeline(e.clientX)}
              onKeyDown={(e) => {
                if (e.key === "ArrowRight") seekTo(currentTime + 5);
                if (e.key === "ArrowLeft") seekTo(Math.max(0, currentTime - 5));
              }}
            >
              {utterances.map((utt, idx) => {
                const left = duration > 0 ? (utt.start / duration) * 100 : 0;
                const width = duration > 0 ? ((utt.end - utt.start) / duration) * 100 : 0;
                const isAgent = agentMetrics?.speaker === utt.speaker;
                return (
                  <span
                    key={`${utt.start}-${idx}`}
                    className="talk-seg"
                    style={{
                      left: `${left}%`,
                      width: `${Math.max(width, 0.35)}%`,
                      background: isAgent ? AGENT_COLOR : CUSTOMER_COLOR,
                    }}
                  />
                );
              })}
              <span className="talk-playhead" style={{ left: `${duration > 0 ? (currentTime / duration) * 100 : 0}%` }} />
            </div>
            <div className="timeline-legend">
              <span>
                <i style={{ background: AGENT_COLOR }} /> {agentName}
              </span>
              <span>
                <i style={{ background: CUSTOMER_COLOR }} /> {customerName}
              </span>
            </div>
          </div>
        </article>

        <article className="panel transcript-panel">
          <div className="transcript-head">
            <h2 className="panel-title">Transcript</h2>
            <SearchField
              id="transcript-search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search in transcript…"
              className="transcript-search-field"
            />
          </div>
          <div className="transcript-list" ref={transcriptRef}>
            {filteredUtterances.length === 0 && <p className="empty soft">No transcript yet</p>}
            {filteredUtterances.map((utt, idx) => {
              const isAgent = agentMetrics?.speaker === utt.speaker;
              const isActive = currentTime >= utt.start && currentTime < utt.end + 0.05;
              return (
                <button
                  key={`${utt.start}-${idx}`}
                  type="button"
                  className={`transcript-row ${isAgent ? "agent" : "customer"}${isActive ? " active" : ""}`}
                  onClick={() => seekTo(utt.start)}
                >
                  <div className="transcript-meta">
                    <time>{formatTime(utt.start)}</time>
                    <span className="speaker" style={{ color: isAgent ? AGENT_COLOR : CUSTOMER_COLOR }}>
                      {isAgent ? agentName : customerName}
                    </span>
                    <span className="sent-icon" title={utt.sentiment || "NEUTRAL"}>
                      {sentimentEmoji(utt.sentiment)}
                    </span>
                  </div>
                  <p className="bubble">{utt.text}</p>
                </button>
              );
            })}
          </div>
        </article>
      </section>

      {/* Rich sentiment intelligence (research-backed) */}
      <section className="panel sentiment-intel">
        <h2 className="panel-title">Sentiment intelligence</h2>
        <div className="intel-grid">
          <div className="intel-stat">
            <span>Trajectory</span>
            <strong className="capitalize">{sentiment?.trajectory || "—"}</strong>
          </div>
          <div className="intel-stat">
            <span>Opening → Closing</span>
            <strong>
              {sentiment?.opening_sentiment || "—"} → {sentiment?.closing_sentiment || "—"}
            </strong>
          </div>
          <div className="intel-stat">
            <span>Estimated CSAT</span>
            <strong>
              {sentiment?.estimated_csat != null ? `${sentiment.estimated_csat.toFixed(1)} / 5` : "—"}
            </strong>
          </div>
          <div className="intel-stat">
            <span>Polarity confidence</span>
            <strong>
              {sentiment?.polarity_confidence != null
                ? `${Math.round(sentiment.polarity_confidence * 100)}%`
                : "—"}
            </strong>
          </div>
          <div className="intel-stat">
            <span>Agent empathy</span>
            <strong>
              {sentiment?.agent_empathy_score != null
                ? Math.round(sentiment.agent_empathy_score)
                : "—"}
            </strong>
          </div>
          <div className="intel-stat">
            <span>Customer frustration</span>
            <strong>
              {sentiment?.customer_frustration_score != null
                ? Math.round(sentiment.customer_frustration_score)
                : "—"}
            </strong>
          </div>
        </div>
        <div className="intel-split">
          <div>
            <h3 className="subhead">Emotions</h3>
            <div className="tag-row">
              {(sentiment?.emotions ?? []).length === 0 && <span className="empty soft">Re-analyze for emotions</span>}
              {(sentiment?.emotions ?? []).map((e) => (
                <span key={e.label} className="tag">
                  {e.label}
                  <em>{Math.round(e.intensity * 100)}%</em>
                </span>
              ))}
            </div>
            <h3 className="subhead">Risk flags</h3>
            <div className="tag-row">
              {(sentiment?.risk_flags ?? []).length === 0 && <span className="empty soft">None flagged</span>}
              {(sentiment?.risk_flags ?? []).map((flag) => (
                <span key={flag} className="tag risk">
                  {flag.replace(/_/g, " ")}
                </span>
              ))}
            </div>
          </div>
          <div>
            <h3 className="subhead">Sentiment shifts</h3>
            <ul className="shift-list">
              {(sentiment?.shifts ?? []).length === 0 && <li className="empty soft">No major shifts</li>}
              {(sentiment?.shifts ?? []).map((s, idx) => (
                <li key={`${s.at_sec}-${idx}`}>
                  <button type="button" onClick={() => seekTo(s.at_sec)}>
                    <time>{formatTime(s.at_sec)}</time>
                    <span>
                      {s.from_label} → {s.to_label}
                      {s.note ? ` · ${s.note}` : ""}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <h3 className="subhead">Highlights</h3>
            <ul className="highlight-list">
              {(sentiment?.highlights ?? []).length === 0 && <li className="empty soft">No highlights</li>}
              {(sentiment?.highlights ?? []).map((h, idx) => (
                <li key={`${h.time_sec}-${idx}`}>
                  <button type="button" onClick={() => seekTo(h.time_sec)}>
                    <time>{formatTime(h.time_sec)}</time>
                    <span className={`sent-${h.sentiment.toLowerCase()}`}>{h.sentiment}</span>
                    <p>“{h.text}”</p>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
        {sentiment?.reasoning && <p className="reasoning">{sentiment.reasoning}</p>}
      </section>

      <IntroductionScriptPanel intro={result?.introduction_script} onSeek={seekTo} />

      <ParticipantPerformancePanel
        items={result?.participant_performance ?? []}
        onSeek={seekTo}
      />

      {/* Detailed metrics + topics */}
      <section className="split-row">
        <article className="panel">
          <h2 className="panel-title">Detailed Metrics</h2>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Metric</th>
                  <th>You</th>
                  <th>Customer</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Talk Time</td>
                  <td>{formatDurationLong(agentMetrics?.talk_time_sec ?? 0)}</td>
                  <td>{formatDurationLong(customerMetrics?.talk_time_sec ?? 0)}</td>
                </tr>
                <tr>
                  <td>Talk Ratio</td>
                  <td>{Math.round(talkYou)}%</td>
                  <td>{Math.round(talkCustomer)}%</td>
                </tr>
                <tr>
                  <td>Speaking Rate (WPM)</td>
                  <td>{agentMetrics?.words_per_minute?.toFixed(0) ?? "—"}</td>
                  <td>{customerMetrics?.words_per_minute?.toFixed(0) ?? "—"}</td>
                </tr>
                <tr>
                  <td>Longest Monologue</td>
                  <td>{formatDurationLong(agentMono)}</td>
                  <td>{formatDurationLong(customerMono)}</td>
                </tr>
                <tr>
                  <td>Avg Response</td>
                  <td>
                    {agentMetrics?.avg_response_time_sec != null
                      ? `${agentMetrics.avg_response_time_sec.toFixed(1)}s`
                      : "—"}
                  </td>
                  <td>
                    {customerMetrics?.avg_response_time_sec != null
                      ? `${customerMetrics.avg_response_time_sec.toFixed(1)}s`
                      : "—"}
                  </td>
                </tr>
                <tr>
                  <td>Fluency</td>
                  <td>{agentMetrics?.fluency_score?.toFixed(0) ?? "—"}</td>
                  <td>{customerMetrics?.fluency_score?.toFixed(0) ?? "—"}</td>
                </tr>
                <tr>
                  <td>Energy</td>
                  <td>{agentMetrics?.energy_score?.toFixed(0) ?? "—"}</td>
                  <td>{customerMetrics?.energy_score?.toFixed(0) ?? "—"}</td>
                </tr>
                <tr>
                  <td>Fillers</td>
                  <td>{agentMetrics?.filler_word_count ?? "—"}</td>
                  <td>{customerMetrics?.filler_word_count ?? "—"}</td>
                </tr>
                <tr>
                  <td>Positive sentiment</td>
                  <td>{agentMetrics?.sentiment_positive_pct?.toFixed(0) ?? "—"}%</td>
                  <td>{customerMetrics?.sentiment_positive_pct?.toFixed(0) ?? "—"}%</td>
                </tr>
              </tbody>
            </table>
          </div>
        </article>

        <div className="stack">
          <article className="panel">
            <h2 className="panel-title">Topic Breakdown</h2>
            <div className="chart-box">
              {topics.length === 0 ? (
                <p className="empty soft">No topics extracted</p>
              ) : (
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={topics} layout="vertical" margin={{ left: 8, right: 16, top: 4, bottom: 4 }}>
                    <XAxis type="number" domain={[0, 100]} hide />
                    <YAxis type="category" dataKey="topic" width={110} tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Bar dataKey="weight_pct" fill={AGENT_COLOR} radius={[0, 6, 6, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </article>
          <article className="panel">
            <h2 className="panel-title">Call Tags</h2>
            <div className="tag-row">
              {(extraction?.tags ?? []).length === 0 && <span className="empty soft">No tags</span>}
              {(extraction?.tags ?? []).map((tag) => (
                <span key={tag} className="tag">
                  {tag}
                </span>
              ))}
            </div>
          </article>
        </div>
      </section>

      <section className="split-row">
        <article className="panel chart-panel wide-flex">
          <h2 className="panel-title">Sentiment Over Time</h2>
          <div className="chart-box">
            {coloredTimeline.length === 0 ? (
              <p className="empty soft">No timeline data</p>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={coloredTimeline}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e8ebe9" />
                  <XAxis dataKey="t" tickFormatter={(v) => formatTime(Number(v))} tick={{ fontSize: 11 }} />
                  <YAxis domain={[-100, 100]} tick={{ fontSize: 11 }} />
                  <ReferenceLine y={0} stroke="#c5cdc7" />
                  <Tooltip labelFormatter={(v) => formatTime(Number(v))} />
                  <Line type="monotone" dataKey="score" stroke={AGENT_COLOR} strokeWidth={2.5} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </article>
        <article className="panel">
          <h2 className="panel-title">Key Moments</h2>
          <ul className="moments">
            {(extraction?.key_moments ?? []).length === 0 && <li className="empty soft">No key moments</li>}
            {(extraction?.key_moments ?? []).map((moment) => (
              <li key={`${moment.time_sec}-${moment.label}`}>
                <button type="button" onClick={() => seekTo(moment.time_sec)}>
                  <time>{formatTime(moment.time_sec)}</time>
                  <span>{moment.label}</span>
                </button>
              </li>
            ))}
          </ul>
          {extraction?.summary && (
            <>
              <h3 className="subhead">Summary</h3>
              <p className="summary-text">{extraction.summary}</p>
            </>
          )}
        </article>
      </section>

    </div>
  );
}
