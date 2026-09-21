export type DiarizedWord = {
  speaker: string;
  start: number;
  end: number;
  word: string;
  confidence?: number;
};

export type DiarizedUtterance = {
  speaker: string;
  start: number;
  end: number;
  text: string;
  confidence?: number;
  sentiment?: "POSITIVE" | "NEUTRAL" | "NEGATIVE";
  sentiment_confidence?: number;
};

export type SentimentSegment = {
  speaker?: string | null;
  start: number;
  end: number;
  text: string;
  sentiment: "POSITIVE" | "NEUTRAL" | "NEGATIVE";
  confidence: number;
};

export type SpeakerMappingSignal = {
  signal: string;
  winner: string;
  weight: number;
  detail?: string | null;
};

export type SpeakerMapping = {
  mapping: Record<string, string>;
  confidence: number;
  method: string;
  mapping_uncertain?: boolean;
  agent_speaker?: string | null;
  customer_speaker?: string | null;
  signals?: SpeakerMappingSignal[];
};

export type TranscriptDisplayLine = {
  speaker: string;
  role: string;
  display_name?: string | null;
  start: number;
  end: number;
  text: string;
};

export type BotSegment = {
  involved?: boolean;
  handling?: "none" | "bot_only" | "bot_transferred";
  handoff_sec?: number | null;
  confidence?: number;
  method?: string;
  bot_speaker?: string | null;
  tagged_utterance_count?: number;
};

export type SpeakerMetrics = {
  speaker: string;
  role_guess?: string | null;
  talk_time_sec: number;
  talk_ratio_pct: number;
  words_spoken: number;
  words_per_minute: number;
  avg_response_time_sec?: number | null;
  filler_word_count: number;
  fluency_score: number;
  energy_score: number;
  sentiment_positive_pct: number;
  sentiment_neutral_pct: number;
  sentiment_negative_pct: number;
};

export type InterruptEvent = {
  start: number;
  end: number;
  speakers: string[];
};

export type SentimentTimelinePoint = {
  t: number;
  score: number;
  label: "POSITIVE" | "NEUTRAL" | "NEGATIVE";
};

export type SalesDisposition = "hung_up" | "not_interested" | "appointment" | "follow_up" | "dnc";

export type LowConfidenceSpan = {
  start: number;
  end: number;
  word: string;
  confidence?: number | null;
  speaker?: string | null;
};

export type SpeakerAudioClarity = {
  speaker: string;
  role?: string | null;
  flag: "ok" | "caution" | "poor";
  reasons: string[];
  avg_asr_confidence?: number | null;
  low_confidence_word_pct?: number | null;
  clipping_pct?: number | null;
  rms?: number | null;
};

export type CallQuality = {
  overall_score: number;
  recording_quality_score: number;
  clarity_score?: number | null;
  speech_rate_score?: number | null;
  fluency_score: number;
  energy_score: number;
  avg_response_time_sec: number;
  max_response_time_sec: number;
  silence_ratio_pct: number;
  silence_sec?: number;
  overlap_or_interrupt_proxy: number;
  interruptions_count?: number;
  interruption_events?: InterruptEvent[];
  overtalk_sec?: number;
  overtalk_pct?: number;
  customer_disconnected: boolean;
  disconnect_reason?: string | null;
  disconnect_confidence: number;
  audio_clarity_flag?: "ok" | "caution" | "poor" | null;
  audio_clarity_reasons?: string[];
  avg_asr_confidence?: number | null;
  p10_asr_confidence?: number | null;
  low_confidence_word_pct?: number | null;
  clipping_pct?: number | null;
  rms?: number | null;
  low_confidence_spans?: LowConfidenceSpan[];
  speaker_audio_clarity?: SpeakerAudioClarity[];
};

export type TopicWeight = {
  topic: string;
  weight_pct: number;
};

export type KeyMoment = {
  time_sec: number;
  label: string;
  speaker_role?: string | null;
};

export type AiExtraction = {
  summary?: string | null;
  key_topics: Array<string | TopicWeight>;
  action_items: string[];
  agent_coaching_notes: string[];
  customer_intent?: string | null;
  call_outcome?: "Successful" | "Unsuccessful" | "Unclear" | null;
  tags?: string[];
  key_moments?: KeyMoment[];
  raw_llm_text?: string | null;
  available: boolean;
  note?: string | null;
};

export type LlmSentimentAnalysis = {
  overall?: "POSITIVE" | "NEUTRAL" | "NEGATIVE" | null;
  agent_sentiment?: "POSITIVE" | "NEUTRAL" | "NEGATIVE" | null;
  customer_sentiment?: "POSITIVE" | "NEUTRAL" | "NEGATIVE" | null;
  opening_sentiment?: "POSITIVE" | "NEUTRAL" | "NEGATIVE" | null;
  closing_sentiment?: "POSITIVE" | "NEUTRAL" | "NEGATIVE" | null;
  overall_score?: number | null;
  polarity_confidence?: number | null;
  estimated_csat?: number | null;
  trajectory?: "improving" | "declining" | "stable" | "volatile" | null;
  emotions?: Array<{ label: string; intensity: number }>;
  shifts?: Array<{
    at_sec: number;
    from_label: "POSITIVE" | "NEUTRAL" | "NEGATIVE";
    to_label: "POSITIVE" | "NEUTRAL" | "NEGATIVE";
    note?: string | null;
  }>;
  risk_flags?: string[];
  highlights?: Array<{
    time_sec: number;
    speaker: string;
    text: string;
    sentiment: "POSITIVE" | "NEUTRAL" | "NEGATIVE";
    reason?: string | null;
  }>;
  agent_empathy_score?: number | null;
  customer_frustration_score?: number | null;
  reasoning?: string | null;
  key_moment_indices?: number[];
  available: boolean;
  note?: string | null;
  raw_llm_text?: string | null;
};

export type EvidenceRef = {
  start: number;
  end: number;
  quote: string;
  note?: string | null;
};

export type ScoreExplanation = {
  score: number;
  explanation: string;
  evidence: EvidenceRef[];
};

export type IntroductionThemeResult = {
  id: string;
  label: string;
  matched: boolean;
  matchedPhrase?: string | null;
  quote?: string | null;
  start?: number | null;
  end?: number | null;
};

export type IntroductionScriptScore = {
  score: number;
  rank: string;
  themesTotal: number;
  themesMatched: number;
  openingDurationSec: number;
  agentTurnsReviewed: number;
  themes: IntroductionThemeResult[];
  missedThemes: string[];
  evidence: EvidenceRef[];
  note?: string | null;
};

export type ParticipantPerformance = {
  speaker: string;
  participantRole: string;
  presentation: "performance" | "interaction";
  displayName?: string | null;
  available: boolean;
  note?: string | null;
  overallScore?: number | null;
  scores: Record<string, ScoreExplanation>;
  strengths: string[];
  improvements: string[];
  recommendations: string[];
  evidence: EvidenceRef[];
  analysisVersion: string;
  weights: Record<string, number>;
  totalTalkDuration: number;
  talkPercentage: number;
  speakingTurnCount: number;
  averageTurnDuration: number;
  longestTurnDuration: number;
  shortResponseCount: number;
  longMonologueCount: number;
  questionCount: number;
  averageResponseTime?: number | null;
  interruptionCount: number;
  interruptedByOthersCount: number;
  repeatedQuestions: number;
  repeatedStatements: number;
};

export type TranscriptPassSnapshot = {
  engine: string;
  model?: string | null;
  transcript_id?: string | null;
  utterances: DiarizedUtterance[];
  full_text?: string;
};

export type TranscriptReviewData = {
  status: "auto_accepted" | "pending" | "user_confirmed";
  wer?: number;
  similarity?: number;
  threshold_wer_max?: number;
  threshold_similarity_min?: number;
  pass_a?: TranscriptPassSnapshot;
  pass_b?: TranscriptPassSnapshot;
  diff_summary?: Record<string, unknown>;
  chosen_source?: "assemblyai" | "whisper" | "user_edit" | null;
  confirmed_at?: string | null;
  confirmed_by?: string | null;
};

export type CallAnalysisResult = {
  language?: string;
  duration_sec?: number;
  speakers?: string[];
  speaker_mapping?: SpeakerMapping;
  bot_segment?: BotSegment;
  transcript_display?: TranscriptDisplayLine[];
  utterances: DiarizedUtterance[];
  words?: DiarizedWord[];
  sentiment_segments?: SentimentSegment[];
  sentiment_timeline?: SentimentTimelinePoint[];
  llm_sentiment?: LlmSentimentAnalysis;
  speaker_metrics?: SpeakerMetrics[];
  call_quality?: CallQuality;
  ai_extraction?: AiExtraction;
  participant_performance?: ParticipantPerformance[];
  introduction_script?: IntroductionScriptScore;
  provider?: string;
  transcript_id?: string | null;
  notes?: string[];
  processing_version?: string;
  transcript_review?: TranscriptReviewData;
};

export type CallParticipantMeta = {
  role: string;
  name?: string | null;
  phone?: string | null;
  email?: string | null;
};

export type CallMeta = {
  callId: number;
  direction?: string;
  createdTime?: string;
  phoneNumber?: string | null;
  agentName?: string | null;
  billDuration?: number | null;
  participants: CallParticipantMeta[];
};

export type JobStatus = "queued" | "normalizing" | "analyzing" | "completed" | "failed";

export type AnalysisJob = {
  id: string;
  sourceName: string;
  sourcePath: string;
  normalizedPath?: string;
  status: JobStatus;
  createdAt: string;
  updatedAt: string;
  durationSec?: number;
  error?: string;
  result?: CallAnalysisResult;
  callMeta?: CallMeta;
  freshcallerCallId?: number;
  recordingId?: number;
  disposition?: SalesDisposition | null;
  answered?: boolean;
  botHandling?: "none" | "bot_only" | "bot_transferred";
  isBotInvolved?: boolean;
  dbAnalysisStatus?: DbAnalysisStatus;
};

export type RecordingInfo = {
  name: string;
  sizeBytes: number;
  modifiedAt: string;
  source?: "recordings" | "uploads";
};

export type FreshcallerParticipant = {
  id: number;
  call_id: number;
  caller_number?: string | null;
  caller_name?: string | null;
  participant_type: string;
  duration?: number;
};

export type FreshcallerRecording = {
  id: number;
  url: string;
  duration?: number;
  duration_unit?: string;
};

export type FreshcallerCall = {
  id: number;
  direction: string;
  phone_number?: string | null;
  assigned_agent_name?: string | null;
  bill_duration?: number | null;
  created_time: string;
  recording: FreshcallerRecording | null;
  participants: FreshcallerParticipant[];
  localRecordingName?: string;
};

export type ExportJobRecord = {
  id: number;
  status: string;
  message?: string;
  createdAt: string;
  updatedAt: string;
  downloadPath?: string;
  error?: string;
  callCount?: number;
  callsWithRecording?: number;
  startDate?: string;
  endDate?: string;
};

const API_BASE = "/api";

function readApiError(body: string, status: number): string {
  const trimmed = body.trim();
  if (!trimmed) return `Request failed (${status})`;
  try {
    const parsed = JSON.parse(trimmed) as { error?: unknown; message?: string };
    if (typeof parsed.error === "string" && parsed.error.trim()) return parsed.error;
    if (typeof parsed.message === "string" && parsed.message.trim()) return parsed.message;
  } catch {
    return trimmed;
  }
  return trimmed;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    ...init,
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(readApiError(body, response.status));
  }

  return response.json() as Promise<T>;
}

export function fetchRecordings() {
  return request<{ recordings: RecordingInfo[] }>("/recordings");
}

export function createJob(sourceName: string, source?: "recordings" | "uploads") {
  return request<{ job: AnalysisJob }>("/jobs", {
    method: "POST",
    body: JSON.stringify({ sourceName, source }),
  });
}

export async function uploadAndAnalyze(file: File) {
  const form = new FormData();
  form.append("audio", file);

  const response = await fetch(`${API_BASE}/jobs/upload`, {
    method: "POST",
    body: form,
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(body || `Upload failed (${response.status})`);
  }

  return response.json() as Promise<{
    job: AnalysisJob;
    uploaded: {
      name: string;
      originalName: string;
      sizeBytes: number;
      source: "uploads";
    };
  }>;
}

export function fetchJob(id: string) {
  return request<{ job: AnalysisJob }>(`/jobs/${id}`);
}

export function jobAudioUrl(id: string) {
  return `${API_BASE}/jobs/${id}/audio`;
}

export function startFreshcallerExport(startDate: string, endDate: string) {
  return request<{ export: ExportJobRecord }>("/freshcaller/exports", {
    method: "POST",
    body: JSON.stringify({ start_date: startDate, end_date: endDate }),
  });
}

export function fetchFreshcallerExport(id: number) {
  return request<{ export: ExportJobRecord }>(`/freshcaller/exports/${id}`);
}

export function fetchFreshcallerCalls(withRecording = true) {
  return request<{ calls: FreshcallerCall[]; count: number }>(
    `/freshcaller/calls?withRecording=${withRecording ? "true" : "false"}`,
  );
}

export function fetchFreshcallerCall(id: number) {
  return request<{ call: FreshcallerCall }>(`/freshcaller/calls/${id}`);
}

export function analyzeFreshcallerCall(callId: number) {
  return request<{ job: AnalysisJob; call: FreshcallerCall }>("/jobs/freshcaller", {
    method: "POST",
    body: JSON.stringify({ callId }),
  });
}

export type DbAnalysisStatus =
  | "none"
  | "queued"
  | "transcribing"
  | "running"
  | "awaiting_transcript_review"
  | "completed"
  | "failed";

export type DbRecordingListItem = {
  callId: number;
  recordingId: number;
  exportJobId?: number | null;
  sourceFile?: string | null;
  direction?: string;
  createdTime?: string;
  agentName?: string | null;
  phoneNumber?: string | null;
  callNotes?: string | null;
  customerName?: string | null;
  participants: Array<{ role: string; name?: string | null; phone?: string | null }>;
  recordingUrl: string;
  durationSec?: number | null;
  isVoicemail?: boolean;
  isConnected?: boolean;
  answered?: boolean;
  callStatus?: number | null;
  botHandling?: "none" | "bot_only" | "bot_transferred";
  isBotInvolved?: boolean;
  localFileName?: string | null;
  hasLocalAudio: boolean;
  analysisStatus: DbAnalysisStatus;
  disposition?: SalesDisposition | null;
  analysisError?: string | null;
  analyzedAt?: string | null;
  audioClarityFlag?: "ok" | "caution" | "poor" | null;
  createdAt: string;
  updatedAt: string;
};

export type DbRecordingDetail = DbRecordingListItem & {
  localPath?: string | null;
  analysisResult?: CallAnalysisResult | null;
};

export type DbRecordingsQuery = {
  status?: string;
  hasAudio?: boolean;
  q?: string;
  limit?: number;
  skip?: number;
  page?: number;
  dateFrom?: string;
  dateTo?: string;
  minDuration?: number;
  maxDuration?: number;
  sortBy?: string;
  sortDir?: "asc" | "desc";
  excludeVoicemail?: boolean;
};

export type DbRecordingsResponse = {
  recordings: DbRecordingListItem[];
  total: number;
  limit: number;
  skip: number;
  page: number;
  totalPages: number;
  sortBy: string;
  sortDir: "asc" | "desc";
  excludeVoicemail: boolean;
  voicemailMaxSec: number;
  filters: {
    dateFrom: string | null;
    dateTo: string | null;
    minDuration: number | null;
    maxDuration: number | null;
  };
};

function recordingsQueryString(params?: DbRecordingsQuery) {
  const search = new URLSearchParams();
  if (params?.status) search.set("status", params.status);
  if (params?.hasAudio != null) search.set("hasAudio", String(params.hasAudio));
  if (params?.q) search.set("q", params.q);
  if (params?.limit != null) search.set("limit", String(params.limit));
  if (params?.skip != null) search.set("skip", String(params.skip));
  if (params?.page != null) search.set("page", String(params.page));
  if (params?.dateFrom) search.set("dateFrom", params.dateFrom);
  if (params?.dateTo) search.set("dateTo", params.dateTo);
  if (params?.minDuration != null) search.set("minDuration", String(params.minDuration));
  if (params?.maxDuration != null) search.set("maxDuration", String(params.maxDuration));
  if (params?.sortBy) search.set("sortBy", params.sortBy);
  if (params?.sortDir) search.set("sortDir", params.sortDir);
  if (params?.excludeVoicemail != null) {
    search.set("excludeVoicemail", String(params.excludeVoicemail));
  }
  return search.toString();
}

export function fetchDbRecordings(params?: DbRecordingsQuery) {
  const qs = recordingsQueryString(params);
  return request<DbRecordingsResponse>(`/recordings/db${qs ? `?${qs}` : ""}`);
}

/** Separate listing table (metadata only). */
export function fetchRecordingListings(params?: DbRecordingsQuery) {
  const qs = recordingsQueryString(params);
  return request<DbRecordingsResponse>(`/recordings/db/listings${qs ? `?${qs}` : ""}`);
}

export function updateRecordingDisposition(
  callId: number,
  recordingId: number,
  disposition: SalesDisposition | null,
) {
  return request<{ recording: DbRecordingDetail }>(`/recordings/db/${callId}`, {
    method: "PATCH",
    body: JSON.stringify({ recordingId, disposition }),
  });
}

export function fetchDbRecording(callId: number, options?: { recordingId?: number; includeAnalysis?: boolean }) {
  const search = new URLSearchParams();
  if (options?.recordingId != null) search.set("recordingId", String(options.recordingId));
  if (options?.includeAnalysis === false) search.set("includeAnalysis", "false");
  const qs = search.toString();
  return request<{ recording: DbRecordingDetail }>(
    `/recordings/db/${callId}${qs ? `?${qs}` : ""}`,
  );
}

export function dbRecordingAudioUrl(callId: number, recordingId?: number) {
  const qs = recordingId != null ? `?recordingId=${recordingId}` : "";
  return `${API_BASE}/recordings/db/${callId}/audio${qs}`;
}

export type AnalyzeRecordingOptions = {
  force?: boolean;
  remapOnly?: boolean;
  swapSpeakers?: boolean;
  speakerOverride?: Record<string, string>;
  correctionReason?: string;
};

export function analyzeDbRecording(
  callId: number,
  recordingId?: number,
  options?: AnalyzeRecordingOptions,
) {
  return request<{
    reused: boolean;
    recording: DbRecordingDetail;
  }>(`/recordings/db/${callId}/analyze`, {
    method: "POST",
    body: JSON.stringify({
      ...(recordingId != null ? { recordingId } : {}),
      ...(options?.force ? { force: true } : {}),
      ...(options?.remapOnly ? { remapOnly: true } : {}),
      ...(options?.swapSpeakers ? { swapSpeakers: true } : {}),
      ...(options?.speakerOverride ? { speakerOverride: options.speakerOverride } : {}),
      ...(options?.correctionReason ? { correctionReason: options.correctionReason } : {}),
    }),
  });
}

export function confirmDbTranscript(
  callId: number,
  recordingId: number,
  chosenSource: "assemblyai" | "whisper",
) {
  return request<{ recording: DbRecordingDetail }>(`/recordings/db/${callId}/confirm-transcript`, {
    method: "POST",
    body: JSON.stringify({ recordingId, chosenSource }),
  });
}

export function clearDbRecordingAnalysis(callId: number, recordingId?: number) {
  return request<{
    cleared: boolean;
    recording: DbRecordingDetail;
  }>(`/recordings/db/${callId}/clear-analysis`, {
    method: "POST",
    body: JSON.stringify({
      ...(recordingId != null ? { recordingId } : {}),
    }),
  });
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export function formatDurationLong(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  if (mins <= 0) return `${secs}s`;
  return `${mins}m ${secs.toString().padStart(2, "0")}s`;
}

export function scoreTone(score: number): string {
  if (score >= 80) return "good";
  if (score >= 60) return "ok";
  return "poor";
}

export function normalizeTopics(topics: AiExtraction["key_topics"]): TopicWeight[] {
  return (topics ?? []).map((item) => {
    if (typeof item === "string") {
      return { topic: item, weight_pct: 0 };
    }
    return {
      topic: item.topic,
      weight_pct: Number(item.weight_pct) || 0,
    };
  });
}

export type SyncJob = {
  jobId: number | null;
  runId: string;
  callDate: string;
  startDate: string;
  endDate: string;
  status: string;
  phase: string;
  phaseMessage?: string | null;
  trigger: "cron" | "manual" | "cli";
  downloadPath?: string | null;
  callCount: number;
  callsWithRecording: number;
  voicemailSkipped: number;
  audioDownloaded: number;
  audioFailed: number;
  callsIndexed: number;
  error?: string | null;
  startedAt: string;
  finishedAt?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SyncStatusResponse = {
  cron: {
    enabled: boolean;
    scheduled?: boolean;
    expression: string;
    timezone: string;
    nextHint: string;
    nextRunAt?: string | null;
    lastTickAt?: string | null;
    lastTickError?: string | null;
    lastHeartbeatAt?: string | null;
    note?: string | null;
  };
  running: boolean;
  runningCallDate?: string | null;
  previousCallDate: string;
  lastJob: SyncJob | null;
  lastCronJob?: SyncJob | null;
};

export type CronLogLine = {
  runId: string;
  exportJobId?: number | null;
  callDate: string;
  trigger: string;
  level: "info" | "warn" | "error";
  phase: string;
  message: string;
  meta?: Record<string, unknown>;
  createdAt: string;
};

export type CronLogRun = {
  runId: string;
  callDate: string;
  trigger: string;
  exportJobId?: number | null;
  lastLevel: string;
  lastPhase: string;
  lastMessage: string;
  startedAt: string;
  finishedAt: string;
  lineCount: number;
  errorCount: number;
};

export function fetchSyncStatus() {
  return request<SyncStatusResponse>("/freshcaller/sync/status");
}

export function fetchSyncJobs(params?: { page?: number; limit?: number }) {
  const search = new URLSearchParams();
  if (params?.page != null) search.set("page", String(params.page));
  if (params?.limit != null) search.set("limit", String(params.limit));
  const qs = search.toString();
  return request<{
    jobs: SyncJob[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }>(`/freshcaller/sync/jobs${qs ? `?${qs}` : ""}`);
}

export function fetchSyncJob(callDate: string) {
  return request<{ job: SyncJob }>(`/freshcaller/sync/jobs/${encodeURIComponent(callDate)}`);
}

export function runDailySync(body?: { date?: string; force?: boolean }) {
  return request<{
    runId: string;
    callDate: string;
    status: string;
    jobId: number | null;
    skipped?: boolean;
    message?: string;
  }>("/freshcaller/sync/daily", {
    method: "POST",
    body: JSON.stringify(body ?? {}),
  });
}

export function fetchCronLogRuns(params?: { page?: number; limit?: number }) {
  const search = new URLSearchParams();
  if (params?.page != null) search.set("page", String(params.page));
  if (params?.limit != null) search.set("limit", String(params.limit));
  const qs = search.toString();
  return request<{
    runs: CronLogRun[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }>(`/freshcaller/sync/logs/runs${qs ? `?${qs}` : ""}`);
}

export function fetchCronLogs(params?: {
  page?: number;
  limit?: number;
  runId?: string;
  callDate?: string;
  level?: string;
  trigger?: string;
  phase?: string;
  dateFrom?: string;
  dateTo?: string;
}) {
  const search = new URLSearchParams();
  if (params?.page != null) search.set("page", String(params.page));
  if (params?.limit != null) search.set("limit", String(params.limit));
  if (params?.runId) search.set("runId", params.runId);
  if (params?.callDate) search.set("callDate", params.callDate);
  if (params?.level) search.set("level", params.level);
  if (params?.trigger) search.set("trigger", params.trigger);
  if (params?.phase) search.set("phase", params.phase);
  if (params?.dateFrom) search.set("dateFrom", params.dateFrom);
  if (params?.dateTo) search.set("dateTo", params.dateTo);
  const qs = search.toString();
  return request<{
    logs: CronLogLine[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }>(`/freshcaller/sync/logs${qs ? `?${qs}` : ""}`);
}

export function fetchCronLogRun(runId: string) {
  return request<{ runId: string; logs: CronLogLine[] }>(
    `/freshcaller/sync/logs/runs/${encodeURIComponent(runId)}`,
  );
}

export type AgentSummary = {
  agentId: string;
  freshcallerAgentId?: number | null;
  name: string;
  teamName?: string | null;
  callCount: number;
  recordingCount: number;
  analyzedCount: number;
  appointmentCount: number;
  averageScore: number | null;
  firstCallAt?: string | null;
  lastCallAt?: string | null;
};

export type AgentRecordingRow = {
  callId: number;
  recordingId: number;
  createdTime?: string | null;
  callDate?: string | null;
  durationSec?: number | null;
  direction?: string | null;
  phoneNumber?: string | null;
  customerName?: string | null;
  customerPhone?: string | null;
  analysisStatus: string;
  disposition?: SalesDisposition | null;
  answered?: boolean;
  overallScore?: number | null;
  callQualityScore?: number | null;
  scoreNote?: string | null;
  clarityScore?: number | null;
  speechRateScore?: number | null;
  wordsPerSecond?: number | null;
  talkPercentage?: number | null;
  talkDurationSec?: number | null;
  interruptionCount?: number | null;
  questionCount?: number | null;
  highlight?: string | null;
  categoryScores?: Record<string, number | null> | null;
  introductionScore?: number | null;
  introductionRank?: string | null;
  botHandling?: "none" | "bot_only" | "bot_transferred";
  isBotInvolved?: boolean;
  audioClarityFlag?: "ok" | "caution" | "poor" | null;
};

export type QuarterWindow = {
  id: string;
  label: string;
  fromDate: string;
  toDate: string;
};

export type AgentDetailSummary = {
  connects: number;
  analyzedConnects: number;
  scoredConnects: number;
  qualityScoredConnects?: number;
  averagePerformance: number | null;
  averageCallQuality: number | null;
  averageClarity: number | null;
  averageSpeechRateScore: number | null;
  inbound: number;
  outbound: number;
  pendingAnalysis: number;
  totalDurationSec: number;
  talkDurationSec: number;
  averageWordsPerSecond: number | null;
  averageOverallScore: number | null;
  averageAgentTalkRatioPct: number | null;
  averageCustomerTalkRatioPct: number | null;
  averageResponseTimeSec: number | null;
  averageSilenceRatioPct: number | null;
  averageSilenceSec: number | null;
  averageInterruptions: number | null;
  averageIntroductionScore: number | null;
  introductionScoredConnects: number;
  categoryAverages: Record<string, number>;
};

export type AgentRecordingsQuery = DbRecordingsQuery & {
  quarter?: string;
  appointmentOnly?: boolean;
};

export function fetchAgents(params?: { page?: number; limit?: number; q?: string; quarter?: string }) {
  const search = new URLSearchParams();
  if (params?.page != null) search.set("page", String(params.page));
  if (params?.limit != null) search.set("limit", String(params.limit));
  if (params?.q) search.set("q", params.q);
  if (params?.quarter) search.set("quarter", params.quarter);
  const qs = search.toString();
  return request<{
    agents: AgentSummary[];
    quarter: QuarterWindow;
    availableQuarters: QuarterWindow[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }>(`/agents${qs ? `?${qs}` : ""}`);
}

export function fetchAgent(agentId: string, params?: AgentRecordingsQuery) {
  const search = new URLSearchParams(recordingsQueryString(params));
  if (params?.quarter) search.set("quarter", params.quarter);
  if (params?.appointmentOnly) search.set("appointmentOnly", "true");
  const qs = search.toString();
  return request<{
    agent: AgentSummary;
    quarter: QuarterWindow;
    availableQuarters: QuarterWindow[];
    appointmentOnly: boolean;
    summary: AgentDetailSummary;
    recordings: AgentRecordingRow[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    excludeVoicemail: boolean;
    voicemailMaxSec: number;
  }>(`/agents/${encodeURIComponent(agentId)}${qs ? `?${qs}` : ""}`);
}
