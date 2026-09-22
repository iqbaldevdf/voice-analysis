import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  analyzeDbRecording,
  clearDbRecordingAnalysis,
  confirmDbTranscript,
  fetchJob,
  formatDurationLong,
  formatTime,
  jobAudioUrl,
  normalizeTopics,
  updateRecordingDisposition,
  type AnalysisJob,
  type DiarizedUtterance,
  type SalesDisposition,
  type SpeakerMapping,
  type SpeakerMetrics,
} from "../api";
import { jobFromDbRecording, loadDbRecordingJob } from "../lib/recordingJob";
import { CallMetricsKpiRow } from "../components/CallMetricsKpiRow";
import { IntroductionScriptPanel } from "../components/IntroductionScriptPanel";
import { ParticipantPerformancePanel } from "../components/ParticipantPerformancePanel";
import { SearchField, SelectField } from "../components/ui/Fields";
import { callQualityParts } from "../lib/callQuality";
import {
  flagFromConfidences,
  isUnclearAudio,
  reasonLabel,
  resolveSpeakerAudioClarity,
  speakerClarityName,
  utteranceWordParts,
  worseAudioFlag,
  type AudioClarityFlag,
} from "../lib/audioClarity";
import { agentDisplayName } from "../lib/agentInitials";
import { DISPOSITION_OPTIONS, dispositionClass, dispositionLabel } from "../lib/disposition";

const AGENT_COLOR = "#2f6f5e";
const CUSTOMER_COLOR = "#5c4d7a";
const BOT_COLOR = "#b45309"; // keep in sync with --bot / .badge.bot in index.css
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

function pickRole(metrics: SpeakerMetrics[], role: "agent" | "customer"): SpeakerMetrics | undefined {
  return metrics.find((m) => m.role_guess === role) ?? (role === "agent" ? metrics[0] : metrics[1]);
}

function utteranceDisplayRole(
  utt: DiarizedUtterance,
  mapping?: SpeakerMapping | null,
  agentSpeaker?: string,
  displayRole?: string | null,
): "agent" | "customer" | "bot" {
  if (displayRole === "bot") return "bot";
  if (displayRole === "agent") return "agent";
  if (displayRole === "customer") return "customer";
  const mapped = mapping?.mapping?.[utt.speaker];
  if (mapped === "bot") return "bot";
  if (mapped === "agent") return "agent";
  if (mapped === "customer") return "customer";
  return agentSpeaker && utt.speaker === agentSpeaker ? "agent" : "customer";
}

function roleColor(role: "agent" | "customer" | "bot"): string {
  if (role === "bot") return BOT_COLOR;
  if (role === "agent") return AGENT_COLOR;
  return CUSTOMER_COLOR;
}

function botHandlingLabel(handling?: string | null, involved?: boolean): string | null {
  if (handling === "bot_transferred") return "Bot → Agent";
  if (handling === "bot_only") return "Bot handled";
  if (involved) return "Bot involved";
  return null;
}

function speakerAssignmentSummary(
  mapping: SpeakerMapping | null | undefined,
  agentName: string,
  customerName: string,
) {
  if (!mapping?.agent_speaker || !mapping.customer_speaker) return null;
  return {
    agentSpeaker: mapping.agent_speaker,
    customerSpeaker: mapping.customer_speaker,
    agentName,
    customerName,
  };
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
  const [reanalyzing, setReanalyzing] = useState(false);
  const [clearingAnalysis, setClearingAnalysis] = useState(false);
  const [confirmingTranscript, setConfirmingTranscript] = useState(false);
  const [transcriptPick, setTranscriptPick] = useState<"assemblyai" | "whisper">("assemblyai");
  const [swapConfirmOpen, setSwapConfirmOpen] = useState(false);
  const [swapConfirmChecked, setSwapConfirmChecked] = useState(false);
  const audioSrc = audioUrlOverride ?? jobAudioUrl(job.id);
  const isDbJob = job.id.startsWith("db-");
  const canReanalyze = isDbJob && job.freshcallerCallId != null && job.recordingId != null;
  const canClearAnalysis =
    canReanalyze &&
    (job.dbAnalysisStatus === "completed" ||
      job.dbAnalysisStatus === "failed" ||
      job.dbAnalysisStatus === "awaiting_transcript_review" ||
      Boolean(job.result));

  useEffect(() => {
    setDisposition(job.disposition ?? "");
  }, [job.id, job.disposition]);

  useEffect(() => {
    if (!isDbJob) {
      if (job.status === "completed" || job.status === "failed") return;
    } else if (
      job.dbAnalysisStatus === "completed" ||
      job.dbAnalysisStatus === "failed" ||
      job.dbAnalysisStatus === "awaiting_transcript_review" ||
      job.dbAnalysisStatus === "none"
    ) {
      return;
    }
    const timer = window.setInterval(async () => {
      if (isDbJob && job.freshcallerCallId != null && job.recordingId != null) {
        try {
          const data = await loadDbRecordingJob(job.freshcallerCallId, job.recordingId);
          onJobUpdate(data.job);
        } catch (err) {
          onError(err instanceof Error ? err.message : String(err));
        }
        return;
      }
      try {
        const data = await fetchJob(job.id);
        onJobUpdate(data.job);
      } catch (err) {
        onError(err instanceof Error ? err.message : String(err));
      }
    }, 1500);
    return () => window.clearInterval(timer);
  }, [
    job.id,
    job.status,
    job.dbAnalysisStatus,
    job.freshcallerCallId,
    job.recordingId,
    isDbJob,
    onJobUpdate,
    onError,
  ]);

  const result = job.result;
  const meta = job.callMeta;
  const cq = result?.call_quality;
  const extraction = result?.ai_extraction;
  const sentiment = result?.llm_sentiment;

  const agentMetrics = useMemo(
    () => (result?.speaker_metrics ? pickRole(result.speaker_metrics, "agent") : undefined),
    [result],
  );
  const customerMetrics = useMemo(
    () => (result?.speaker_metrics ? pickRole(result.speaker_metrics, "customer") : undefined),
    [result],
  );

  const agentParticipant = meta?.participants.find((p) => p.role.toLowerCase() === "agent");
  const customerParticipant = meta?.participants.find((p) => p.role.toLowerCase() === "customer");
  const agentName = agentDisplayName(agentParticipant?.name || meta?.agentName);
  const customerName = customerParticipant?.name || "Customer";

  const analysisDuration = result?.duration_sec ?? job.durationSec ?? 0;
  const topics = useMemo(() => normalizeTopics(extraction?.key_topics ?? []), [extraction]);
  const utterances = result?.utterances ?? [];
  const speakerMapping = result?.speaker_mapping;
  const speakerClarity = useMemo(
    () => resolveSpeakerAudioClarity(cq?.speaker_audio_clarity, result?.words, speakerMapping),
    [cq?.speaker_audio_clarity, result?.words, speakerMapping],
  );
  const transcriptQualityFlag = useMemo((): AudioClarityFlag => {
    const stored = cq?.audio_clarity_flag;
    const fromSpeakers = worseAudioFlag(...speakerClarity.map((row) => row.flag));
    if (stored === "ok" || stored === "caution" || stored === "poor") {
      return worseAudioFlag(stored, fromSpeakers);
    }
    const confs = (result?.words ?? [])
      .map((word) => word.confidence)
      .filter((value): value is number => value != null);
    return worseAudioFlag(fromSpeakers, flagFromConfidences(confs));
  }, [cq?.audio_clarity_flag, speakerClarity, result?.words]);
  const speakerAssignment = speakerAssignmentSummary(speakerMapping, agentName, customerName);
  const labelsLookUncertain = Boolean(speakerMapping?.mapping_uncertain);
  const transcriptDisplayByKey = useMemo(() => {
    const map = new Map<string, { role: string; display_name?: string | null }>();
    for (const line of result?.transcript_display ?? []) {
      map.set(`${line.start}-${line.speaker}`, line);
    }
    return map;
  }, [result?.transcript_display]);
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

  const reloadJob = useCallback(async () => {
    const callId = job.freshcallerCallId;
    const recordingId = job.recordingId;
    if (!callId || !recordingId) return;
    const data = await loadDbRecordingJob(callId, recordingId);
    onJobUpdate(data.job);
  }, [job.freshcallerCallId, job.recordingId, onJobUpdate]);

  const runReanalyze = useCallback(
    async (mode: "full" | "remap" | "swap") => {
      const callId = job.freshcallerCallId;
      const recordingId = job.recordingId;
      if (!callId || !recordingId || reanalyzing) return;

      setReanalyzing(true);
      onError(null);
      try {
        if (mode === "full") {
          await analyzeDbRecording(callId, recordingId, { force: true });
        } else if (mode === "swap") {
          await analyzeDbRecording(callId, recordingId, {
            remapOnly: true,
            swapSpeakers: true,
            correctionReason: "speakers_swapped",
          });
        } else {
          await analyzeDbRecording(callId, recordingId, {
            remapOnly: true,
            correctionReason: "remap_heuristics",
          });
        }
        setSwapConfirmOpen(false);
        setSwapConfirmChecked(false);
        await reloadJob();
      } catch (err) {
        onError(err instanceof Error ? err.message : String(err));
      } finally {
        setReanalyzing(false);
      }
    },
    [job.freshcallerCallId, job.recordingId, reanalyzing, onError, reloadJob],
  );

  const handleFullReanalyze = useCallback(() => {
    const freshAnalyze = job.dbAnalysisStatus === "none" || !job.result;
    if (
      !window.confirm(
        freshAnalyze
          ? "Analyze this call from audio? This creates a new transcript and scores."
          : "Re-analyze this call from audio? The transcript, speaker labels, and scores will be replaced.",
      )
    ) {
      return;
    }
    void runReanalyze("full");
  }, [runReanalyze, job.dbAnalysisStatus, job.result]);

  const handleClearAnalysis = useCallback(async () => {
    const callId = job.freshcallerCallId;
    const recordingId = job.recordingId;
    if (!callId || !recordingId || clearingAnalysis || reanalyzing) return;
    if (
      !window.confirm(
        "Clear analysis only? This removes the transcript and scores. The call record, audio, and metadata stay. You can Analyze again afterward.",
      )
    ) {
      return;
    }

    setClearingAnalysis(true);
    onError(null);
    try {
      const { recording } = await clearDbRecordingAnalysis(callId, recordingId);
      onJobUpdate(jobFromDbRecording(recording));
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setClearingAnalysis(false);
    }
  }, [
    job.freshcallerCallId,
    job.recordingId,
    clearingAnalysis,
    reanalyzing,
    onError,
    onJobUpdate,
  ]);

  const handleRemapLabels = useCallback(() => {
    if (
      !window.confirm(
        "Re-apply automatic speaker mapping on the existing transcript? Use this if labels look wrong after a pipeline update.",
      )
    ) {
      return;
    }
    void runReanalyze("remap");
  }, [runReanalyze]);

  const handleConfirmSwap = useCallback(() => {
    if (!swapConfirmChecked) return;
    void runReanalyze("swap");
  }, [runReanalyze, swapConfirmChecked]);

  const awaitingTranscriptReview =
    job.dbAnalysisStatus === "awaiting_transcript_review" ||
    result?.transcript_review?.status === "pending";

  const handleConfirmTranscript = useCallback(async () => {
    const callId = job.freshcallerCallId;
    const recordingId = job.recordingId;
    if (!callId || !recordingId || confirmingTranscript) return;
    setConfirmingTranscript(true);
    onError(null);
    try {
      const { recording } = await confirmDbTranscript(callId, recordingId, transcriptPick);
      onJobUpdate(jobFromDbRecording(recording));
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setConfirmingTranscript(false);
    }
  }, [
    job.freshcallerCallId,
    job.recordingId,
    confirmingTranscript,
    transcriptPick,
    onError,
    onJobUpdate,
  ]);

  if (awaitingTranscriptReview && result) {
    const review = result.transcript_review;
    const passA = review?.pass_a?.utterances ?? result.utterances ?? [];
    const passB = review?.pass_b?.utterances ?? [];
    const werPct = review?.wer != null ? Math.round(review.wer * 100) : null;
    const simPct = review?.similarity != null ? Math.round(review.similarity * 100) : null;

    return (
      <div className="details-page call-details-mock">
        <button type="button" className="back-link" onClick={onBack}>
          ← Back to Calls
        </button>
        <article className="panel transcript-review-panel">
          <h1>Transcription needs your review</h1>
          <p className="panel-sub">
            AssemblyAI and Whisper produced different text. Pick the transcript that matches the
            recording, then confirm to run sentiment and call scores.
          </p>
          {werPct != null && simPct != null ? (
            <p className="meta-line">
              Similarity <strong>{simPct}%</strong> · estimated WER <strong>{werPct}%</strong>
            </p>
          ) : null}
          <audio
            ref={audioRef}
            src={audioSrc}
            preload="metadata"
            onTimeUpdate={() => setCurrentTime(audioRef.current?.currentTime ?? 0)}
            onLoadedMetadata={() => setMediaDuration(audioRef.current?.duration ?? 0)}
          />
          <div className="transcript-review-pick">
            <label className="transcript-review-option">
              <input
                type="radio"
                name="transcript-pick"
                checked={transcriptPick === "assemblyai"}
                onChange={() => setTranscriptPick("assemblyai")}
              />
              Use AssemblyAI (speaker labels)
            </label>
            <label className="transcript-review-option">
              <input
                type="radio"
                name="transcript-pick"
                checked={transcriptPick === "whisper"}
                onChange={() => setTranscriptPick("whisper")}
              />
              Use Whisper text (merged into AssemblyAI timing)
            </label>
          </div>
          <div className="transcript-review-columns">
            <div>
              <h2 className="panel-title">AssemblyAI</h2>
              <div className="transcript-list compact">
                {passA.map((utt, i) => (
                  <button
                    key={`a-${i}`}
                    type="button"
                    className="transcript-row"
                    onClick={() => seekTo(utt.start)}
                  >
                    <span className="transcript-time">{formatTime(utt.start)}</span>
                    <span className="transcript-text">{utt.text}</span>
                  </button>
                ))}
              </div>
            </div>
            <div>
              <h2 className="panel-title">Whisper</h2>
              <div className="transcript-list compact">
                {passB.map((utt, i) => (
                  <button
                    key={`b-${i}`}
                    type="button"
                    className="transcript-row"
                    onClick={() => seekTo(utt.start)}
                  >
                    <span className="transcript-time">{formatTime(utt.start)}</span>
                    <span className="transcript-text">{utt.text}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="transcript-review-actions">
            <button
              type="button"
              className="btn primary"
              disabled={confirmingTranscript}
              onClick={() => void handleConfirmTranscript()}
            >
              {confirmingTranscript ? "Running analysis…" : "Confirm transcript & analyze"}
            </button>
          </div>
        </article>
      </div>
    );
  }

  if (job.dbAnalysisStatus === "awaiting_transcript_review" && !result) {
    return (
      <div className="details-page call-details-mock">
        <button type="button" className="back-link" onClick={onBack}>
          ← Back to Calls
        </button>
        <div className="panel status-panel">
          <h1>Transcription needs your review</h1>
          <p className="panel-sub">
            Dual STT finished but transcript data did not load. Refresh this page or open the call
            again from the list.
          </p>
        </div>
      </div>
    );
  }

  if (job.status !== "completed" || !result || !cq) {
    const dbStatus = job.dbAnalysisStatus;
    const needsAnalysis = dbStatus === "none" || (dbStatus == null && !result && job.status === "queued");
    const inProgress =
      !needsAnalysis &&
      (dbStatus === "running" || dbStatus === "transcribing" || dbStatus === "queued");
    const durationSec = job.durationSec ?? mediaDuration ?? 0;
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
          </div>
        </div>

        <header className="call-brief">
          <div className="call-brief-id">
            <h1>{callIdLabel}</h1>
            <span className="status-pill">
              {needsAnalysis ? "No analysis" : inProgress ? "Analyzing" : statusLabel(job.status)}
            </span>
            {botHandlingLabel(job.botHandling, job.isBotInvolved) ? (
              <span className="status-pill bot" title="Bot involvement">
                {botHandlingLabel(job.botHandling, job.isBotInvolved)}
              </span>
            ) : null}
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
              <dd>{durationSec > 0 ? formatDurationLong(durationSec) : "—"}</dd>
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
            <div>
              <dt>Bot</dt>
              <dd>
                {botHandlingLabel(job.botHandling, job.isBotInvolved) ?? "No bot"}
              </dd>
            </div>
          </dl>
        </header>

        {job.botHandling === "bot_transferred" || job.botHandling === "bot_only" ? (
          <div className="bot-callout" role="status">
            {job.botHandling === "bot_transferred"
              ? "A bot spoke on this call before the live agent joined. After analysis, bot lines are tagged in the transcript."
              : "Freshcaller marked this call as bot-handled with no human agent connect."}
          </div>
        ) : null}

        <section className="recording-workspace">
          <article className="panel player-card" aria-label="Call recording">
            <div className="player-head">
              <h2 className="panel-title">Call recording</h2>
            </div>
            <div className="player-block">
              <audio
                ref={audioRef}
                controls
                src={audioSrc}
                onLoadedMetadata={(e) => {
                  const audio = e.currentTarget;
                  if (Number.isFinite(audio.duration)) setMediaDuration(audio.duration);
                }}
              />
            </div>
          </article>

          <article className="panel status-panel">
            <h2 className="panel-title">
              {needsAnalysis
                ? "No analysis yet"
                : inProgress
                  ? dbStatus === "transcribing"
                    ? "Transcribing…"
                    : "Analysis in progress"
                  : "Analysis"}
            </h2>
            {needsAnalysis ? (
              <p className="panel-sub">
                Call record and audio are kept. Run Analyze to create a transcript and scores.
              </p>
            ) : null}
            {inProgress ? (
              <p className="panel-sub">
                This can take several minutes for long calls. Keep this page open or return later.
              </p>
            ) : null}
            {job.error && <p className="error-banner">{job.error}</p>}
            {canReanalyze && (needsAnalysis || job.status === "failed") ? (
              <button
                type="button"
                className="btn primary"
                disabled={reanalyzing || clearingAnalysis}
                onClick={() => void handleFullReanalyze()}
              >
                {reanalyzing ? "Analyzing…" : needsAnalysis ? "Analyze call" : "Re-analyze"}
              </button>
            ) : null}
            {inProgress && !reanalyzing ? <div className="pulse" aria-hidden /> : null}
            {reanalyzing && <p className="panel-sub">Analyzing call… this may take a few minutes.</p>}
          </article>
        </section>
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
  const botLabel =
    botHandlingLabel(job.botHandling, job.isBotInvolved) ||
    botHandlingLabel(result?.bot_segment?.handling, result?.bot_segment?.involved);
  const botHandoffSec = result?.bot_segment?.handoff_sec;
  const botTaggedCount = result?.bot_segment?.tagged_utterance_count ?? 0;

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
          {botLabel ? (
            <span className="status-pill bot" title="Bot involvement">
              {botLabel}
            </span>
          ) : null}
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
          <div>
            <dt>Bot</dt>
            <dd>{botLabel ?? "No bot"}</dd>
          </div>
        </dl>
      </header>

      {botLabel ? (
        <div className="bot-callout" role="status">
          {job.botHandling === "bot_transferred" || result?.bot_segment?.handling === "bot_transferred"
            ? `A bot spoke before the live agent${
                botHandoffSec != null ? ` (handoff ≈ ${formatTime(botHandoffSec)})` : ""
              }.${botTaggedCount > 0 ? ` ${botTaggedCount} transcript line(s) tagged as Bot.` : ""}`
            : job.botHandling === "bot_only"
              ? "Freshcaller marked this call as bot-handled with no human agent connect."
              : result?.bot_segment?.handling === "bot_only"
                ? `This recording looks like an automated / IVR bot (not ${agentName}).${
                    botTaggedCount > 0 ? ` ${botTaggedCount} transcript line(s) tagged as Bot.` : ""
                  }`
                : "Bot involvement detected on this call. Bot lines are tagged in the transcript."}
        </div>
      ) : null}

      <CallMetricsKpiRow
        overallScore={quality.callQualityScore}
        talkYou={talkYou}
        talkCustomer={talkCustomer}
        introductionScriptScore={result?.introduction_script?.score ?? null}
        avgResponseTimeSec={cq.avg_response_time_sec}
        silenceRatioPct={cq.silence_ratio_pct}
        silenceSec={silenceSec}
        interruptions={interruptions}
        speechWordsPerSec={speechWordsPerSec}
        speechRateScore={quality.speechRateScore}
        showSpeechRateScore={false}
      />

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
              <div className="sent-bar-row">
                <span className="sent-bar-label">Positive</span>
                <div className="mini-bar">
                  <i className="pos" style={{ width: `${sentimentBreakdown.pos}%` }} />
                </div>
                <b className="sent-bar-value">{sentimentBreakdown.pos}%</b>
              </div>
              <div className="sent-bar-row">
                <span className="sent-bar-label">Neutral</span>
                <div className="mini-bar">
                  <i className="neu" style={{ width: `${sentimentBreakdown.neu}%` }} />
                </div>
                <b className="sent-bar-value">{sentimentBreakdown.neu}%</b>
              </div>
              <div className="sent-bar-row">
                <span className="sent-bar-label">Negative</span>
                <div className="mini-bar">
                  <i className="neg" style={{ width: `${sentimentBreakdown.neg}%` }} />
                </div>
                <b className="sent-bar-value">{sentimentBreakdown.neg}%</b>
              </div>
            </div>
          </div>
        </article>

        <article className="panel chart-panel">
          <div className="outcome-box">
            <dl className="outcome-fields">
              <div className="outcome-row">
                <dt>Call Outcome</dt>
                <dd>
                  <span
                    className={`outcome-badge outcome-${(extraction?.call_outcome || "unclear").toLowerCase()}`}
                  >
                    {extraction?.call_outcome || "Unclear"}
                  </span>
                </dd>
              </div>
              <div className="outcome-row">
                <dt>Disposition</dt>
                <dd>
                  {canSetDisposition ? (
                    <SelectField
                      id="sales-disposition"
                      className="outcome-select"
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
                  ) : (
                    <span className={dispositionClass(disposition || null)}>
                      {dispositionLabel(disposition || null)}
                    </span>
                  )}
                </dd>
              </div>
            </dl>
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
                const displayLine = transcriptDisplayByKey.get(`${utt.start}-${utt.speaker}`);
                const role = utteranceDisplayRole(
                  utt,
                  speakerMapping,
                  agentMetrics?.speaker,
                  displayLine?.role,
                );
                return (
                  <span
                    key={`${utt.start}-${idx}`}
                    className="talk-seg"
                    style={{
                      left: `${left}%`,
                      width: `${Math.max(width, 0.35)}%`,
                      background: roleColor(role),
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
              {job.isBotInvolved || result?.bot_segment?.involved ? (
                <span>
                  <i style={{ background: BOT_COLOR }} /> Bot
                </span>
              ) : null}
            </div>
          </div>
        </article>

        <article className="panel transcript-panel">
          <div className="transcript-head">
            <div className="transcript-head-title">
              <h2 className="panel-title">Transcript</h2>
              <div className="transcript-head-actions">
                {canClearAnalysis ? (
                  <button
                    type="button"
                    className="btn ghost compact danger-text"
                    disabled={clearingAnalysis || reanalyzing}
                    onClick={() => void handleClearAnalysis()}
                    title="Remove transcript and scores only — call record and audio stay"
                  >
                    {clearingAnalysis ? "Clearing…" : "Clear analysis"}
                  </button>
                ) : null}
                {canReanalyze ? (
                  <button
                    type="button"
                    className="btn secondary compact"
                    disabled={reanalyzing || clearingAnalysis}
                    onClick={() => void handleFullReanalyze()}
                    title="Re-transcribe from audio and replace all analysis"
                  >
                    {reanalyzing ? "Re-analyzing…" : "Re-analyze"}
                  </button>
                ) : null}
              </div>
            </div>
            {isUnclearAudio(transcriptQualityFlag) ? (
              <div
                className={`audio-clarity-banner ${transcriptQualityFlag}`}
                role="status"
                title="Recording reliability — not agent performance"
              >
                <p className="audio-clarity-banner-title">
                  Audio quality was not good — transcription may mismatch
                </p>
                <div className="audio-clarity-reasons">
                  {speakerClarity.map((row) => (
                    <span
                      key={row.speaker}
                      className={`audio-clarity-chip ${row.flag}`}
                      title={
                        row.avg_asr_confidence != null
                          ? `${Math.round(row.avg_asr_confidence * 100)}% ASR confidence`
                          : "Speaker audio quality"
                      }
                    >
                      {speakerClarityName(row, agentName, customerName)}:{" "}
                      {row.flag === "ok" ? "OK" : row.flag === "poor" ? "Poor" : "Caution"}
                    </span>
                  ))}
                  {(cq?.audio_clarity_reasons ?? []).map((code) => (
                    <span key={code} className="audio-clarity-chip">
                      {reasonLabel(code)}
                    </span>
                  ))}
                </div>
              </div>
            ) : speakerClarity.length > 0 ? (
              <div className="audio-clarity-reasons transcript-quality-tags" role="status">
                {speakerClarity.map((row) => (
                  <span key={row.speaker} className={`audio-clarity-chip ${row.flag}`}>
                    {speakerClarityName(row, agentName, customerName)}:{" "}
                    {row.flag === "ok" ? "OK" : row.flag === "poor" ? "Poor" : "Caution"}
                  </span>
                ))}
              </div>
            ) : null}
            {canReanalyze && labelsLookUncertain && speakerAssignment ? (
              <div className="speaker-fix-callout" role="region" aria-label="Speaker label review">
                <p className="speaker-fix-callout-title">
                  Speaker labels need review ({Math.round((speakerMapping?.confidence ?? 0) * 100)}%
                  confidence)
                </p>
                <p className="speaker-fix-callout-copy soft">
                  Current assignment: Speaker {speakerAssignment.agentSpeaker} → Agent (
                  {speakerAssignment.agentName}), Speaker {speakerAssignment.customerSpeaker} → Customer (
                  {speakerAssignment.customerName}). Only change labels if the transcript attribution looks
                  wrong.
                </p>
                <div className="speaker-fix-actions">
                  <button
                    type="button"
                    className="btn secondary compact"
                    disabled={reanalyzing}
                    onClick={() => void handleRemapLabels()}
                  >
                    {reanalyzing ? "Working…" : "Try auto-fix labels"}
                  </button>
                  {!swapConfirmOpen ? (
                    <button
                      type="button"
                      className="btn secondary compact"
                      disabled={reanalyzing}
                      onClick={() => {
                        setSwapConfirmOpen(true);
                        setSwapConfirmChecked(false);
                      }}
                    >
                      Agent & customer reversed?
                    </button>
                  ) : null}
                </div>
                {swapConfirmOpen && speakerAssignment ? (
                  <div className="speaker-swap-confirm">
                    <p className="speaker-swap-confirm-title">Confirm speaker swap</p>
                    <ul className="speaker-swap-confirm-list">
                      <li>
                        Speaker {speakerAssignment.agentSpeaker}: Agent ({speakerAssignment.agentName}) →
                        Customer
                      </li>
                      <li>
                        Speaker {speakerAssignment.customerSpeaker}: Customer (
                        {speakerAssignment.customerName}) → Agent
                      </li>
                    </ul>
                    <p className="soft">
                      Transcript text stays the same. Scores and sentiment will be recalculated. Do not
                      continue if labels already look correct.
                    </p>
                    <label className="speaker-swap-ack">
                      <input
                        type="checkbox"
                        checked={swapConfirmChecked}
                        onChange={(e) => setSwapConfirmChecked(e.target.checked)}
                      />
                      I checked the transcript and the agent/customer names are reversed
                    </label>
                    <div className="speaker-fix-actions">
                      <button
                        type="button"
                        className="btn secondary compact"
                        disabled={reanalyzing}
                        onClick={() => {
                          setSwapConfirmOpen(false);
                          setSwapConfirmChecked(false);
                        }}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        className="btn compact"
                        disabled={reanalyzing || !swapConfirmChecked}
                        onClick={() => void handleConfirmSwap()}
                      >
                        {reanalyzing ? "Swapping…" : "Swap labels"}
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
            {canReanalyze ? (
              <details className="speaker-fix-advanced">
                <summary>Transcript troubleshooting</summary>
                <p className="soft">
                  Use only when something looks wrong. If labels are already correct, leave them unchanged.
                </p>
                {speakerAssignment ? (
                  <p className="speaker-fix-current soft">
                    Current: Speaker {speakerAssignment.agentSpeaker} = Agent ({speakerAssignment.agentName}
                    ), Speaker {speakerAssignment.customerSpeaker} = Customer ({speakerAssignment.customerName})
                  </p>
                ) : null}
                <div className="speaker-fix-actions">
                  {!labelsLookUncertain ? (
                    <button
                      type="button"
                      className="btn secondary compact"
                      disabled={reanalyzing || swapConfirmOpen}
                      onClick={() => {
                        setSwapConfirmOpen(true);
                        setSwapConfirmChecked(false);
                      }}
                    >
                      Agent & customer reversed?
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="btn secondary compact"
                    disabled={reanalyzing}
                    onClick={() => void handleRemapLabels()}
                  >
                    Re-apply auto labels
                  </button>
                  <button
                    type="button"
                    className="btn secondary compact"
                    disabled={reanalyzing}
                    onClick={() => void handleFullReanalyze()}
                  >
                    Full re-analyze from audio
                  </button>
                </div>
                {!labelsLookUncertain && swapConfirmOpen && speakerAssignment ? (
                  <div className="speaker-swap-confirm">
                    <p className="speaker-swap-confirm-title">Confirm speaker swap</p>
                    <ul className="speaker-swap-confirm-list">
                      <li>
                        Speaker {speakerAssignment.agentSpeaker}: Agent ({speakerAssignment.agentName}) →
                        Customer
                      </li>
                      <li>
                        Speaker {speakerAssignment.customerSpeaker}: Customer (
                        {speakerAssignment.customerName}) → Agent
                      </li>
                    </ul>
                    <label className="speaker-swap-ack">
                      <input
                        type="checkbox"
                        checked={swapConfirmChecked}
                        onChange={(e) => setSwapConfirmChecked(e.target.checked)}
                      />
                      I checked the transcript and the agent/customer names are reversed
                    </label>
                    <div className="speaker-fix-actions">
                      <button
                        type="button"
                        className="btn secondary compact"
                        disabled={reanalyzing}
                        onClick={() => {
                          setSwapConfirmOpen(false);
                          setSwapConfirmChecked(false);
                        }}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        className="btn compact"
                        disabled={reanalyzing || !swapConfirmChecked}
                        onClick={() => void handleConfirmSwap()}
                      >
                        {reanalyzing ? "Swapping…" : "Swap labels"}
                      </button>
                    </div>
                  </div>
                ) : null}
              </details>
            ) : null}
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
              const displayLine = transcriptDisplayByKey.get(`${utt.start}-${utt.speaker}`);
              const role = utteranceDisplayRole(
                utt,
                speakerMapping,
                agentMetrics?.speaker,
                displayLine?.role,
              );
              const label =
                displayLine?.display_name ||
                (role === "bot" ? "Bot" : role === "agent" ? agentName : customerName);
              const isActive = currentTime >= utt.start && currentTime < utt.end + 0.05;
              return (
                <button
                  key={`${utt.start}-${idx}`}
                  type="button"
                  className={`transcript-row ${role}${isActive ? " active" : ""}`}
                  onClick={() => seekTo(utt.start)}
                >
                  <div className="transcript-meta">
                    <time>{formatTime(utt.start)}</time>
                    <span className="speaker" style={{ color: roleColor(role) }}>
                      {label}
                    </span>
                    {role === "bot" ? (
                      <span className="badge muted" title="Automated / IVR — not the live agent">
                        Bot asked this
                      </span>
                    ) : null}
                    <span className="sent-icon" title={utt.sentiment || "NEUTRAL"}>
                      {sentimentEmoji(utt.sentiment)}
                    </span>
                  </div>
                  <p className="bubble">
                    {utteranceWordParts(
                      utt,
                      result?.words,
                      cq?.low_confidence_spans,
                    ).map((part, partIdx) => (
                      <Fragment key={`${utt.start}-${partIdx}`}>
                        {partIdx > 0 ? " " : null}
                        {part.low ? (
                          <mark
                            className="low-confidence-word"
                            title="Low ASR confidence — this word may be wrong"
                          >
                            {part.text}
                          </mark>
                        ) : (
                          part.text
                        )}
                      </Fragment>
                    ))}
                  </p>
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
