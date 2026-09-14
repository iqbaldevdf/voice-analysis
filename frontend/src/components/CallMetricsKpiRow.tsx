import { formatDurationLong, scoreTone } from "../api";
import { MetricLabel } from "./MetricInfoTip";
import { metricHelp, type MetricHelpScope } from "../lib/metricHelp";
import { wordsPerMinute } from "../lib/callQuality";

export type CallMetricsKpiValues = {
  overallScore: number | null;
  talkYou: number;
  talkCustomer: number;
  avgResponseTimeSec: number | null;
  silenceRatioPct: number | null;
  silenceSec: number | null;
  interruptions: number | null;
  speechWordsPerSec: number | null;
  speechRateScore: number | null;
};

function ScoreSymbol({ score }: { score: number }) {
  const tone = scoreTone(score);
  const filled = Math.min(5, Math.max(1, Math.round(score / 20)));

  return (
    <span className={`score-symbol ${tone}`} role="img" aria-label={`${Math.round(score)} out of 100`}>
      {Array.from({ length: 5 }, (_, index) => (
        <span key={index} className={index < filled ? "score-dot filled" : "score-dot"} />
      ))}
    </span>
  );
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

type Props = CallMetricsKpiValues & {
  subtitle?: string;
  helpScope?: MetricHelpScope;
  showSpeechRateScore?: boolean;
};

export function CallMetricsKpiRow({
  overallScore,
  talkYou,
  talkCustomer,
  avgResponseTimeSec,
  silenceRatioPct,
  silenceSec,
  interruptions,
  speechWordsPerSec,
  speechRateScore,
  subtitle,
  helpScope = "call",
  showSpeechRateScore = true,
}: Props) {
  const talkYouRounded = Math.round(talkYou);
  const talkCustomerRounded = Math.round(talkCustomer);
  const responseSec = avgResponseTimeSec ?? 0;
  const silencePct = silenceRatioPct ?? 0;
  const interruptCount = interruptions ?? 0;
  const speechWpm = wordsPerMinute(speechWordsPerSec);

  return (
    <section className="kpi-row">
      <article className="kpi-card kpi-quality">
        <MetricLabel layout="corner" help={metricHelp("overallScore", helpScope)}>Overall Score</MetricLabel>
        {overallScore != null ? <QualityRing score={overallScore} /> : <strong>—</strong>}
        {overallScore != null ? <ScoreSymbol score={overallScore} /> : <em className="muted">Not scored</em>}
        {subtitle ? <em>{subtitle}</em> : null}
      </article>
      <article className="kpi-card">
        <MetricLabel layout="corner" help={metricHelp("talkListen", helpScope)}>Talk / Listen Ratio</MetricLabel>
        <strong>
          {talkYouRounded}% <small>You</small>
        </strong>
        <div className="ratio-bar" aria-hidden>
          <i style={{ width: `${Math.max(4, talkYouRounded)}%` }} />
          <b style={{ width: `${Math.max(4, talkCustomerRounded)}%` }} />
        </div>
        <em>{talkCustomerRounded}% Customer</em>
      </article>
      <article className="kpi-card">
        <MetricLabel layout="corner" help={metricHelp("avgResponseTime", helpScope)}>Avg Response Time</MetricLabel>
        <strong>{avgResponseTimeSec != null ? `${responseSec.toFixed(1)}s` : "—"}</strong>
        <em className={avgResponseTimeSec != null && responseSec <= 2.5 ? "good" : avgResponseTimeSec != null ? "poor" : "muted"}>
          {avgResponseTimeSec == null ? "Not scored" : responseSec <= 2.5 ? "Good" : "Needs Improvement"}
        </em>
      </article>
      <article className="kpi-card">
        <MetricLabel layout="corner" help={metricHelp("silence", helpScope)}>Silence (Total)</MetricLabel>
        <strong>{silenceRatioPct != null ? `${Math.round(silencePct)}%` : "—"}</strong>
        <em>{silenceSec != null ? formatDurationLong(silenceSec) : "—"}</em>
      </article>
      <article className="kpi-card">
        <MetricLabel layout="corner" help={metricHelp("interruptions", helpScope)}>Interruptions</MetricLabel>
        <strong>{interruptions != null ? interruptCount : "—"}</strong>
        <em className={interruptions != null && interruptCount <= 2 ? "good" : interruptions != null ? "poor" : "muted"}>
          {interruptions == null ? "Not scored" : interruptCount <= 2 ? "Good" : "Needs Improvement"}
        </em>
      </article>
      <article className="kpi-card">
        <MetricLabel layout="corner" help={metricHelp("speechRate", helpScope)}>Speech rate</MetricLabel>
        <strong>{speechWpm != null ? speechWpm : "—"}</strong>
        <em>
          words / minute
          {showSpeechRateScore && speechRateScore != null ? ` · score ${speechRateScore.toFixed(0)}` : ""}
        </em>
      </article>
    </section>
  );
}
