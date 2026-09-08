import fs from "node:fs/promises";
import path from "node:path";

export type JobStatus = "queued" | "normalizing" | "analyzing" | "completed" | "failed";

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

export type CallQuality = {
  overall_score: number;
  recording_quality_score: number;
  fluency_score: number;
  energy_score: number;
  avg_response_time_sec: number;
  max_response_time_sec: number;
  silence_ratio_pct: number;
  silence_sec: number;
  overlap_or_interrupt_proxy: number;
  interruptions_count: number;
  interruption_events: InterruptEvent[];
  overtalk_sec: number;
  overtalk_pct: number;
  customer_disconnected: boolean;
  disconnect_reason?: string | null;
  disconnect_confidence: number;
};

export type TopicWeight = {
  topic: string;
  weight_pct: number;
};

export type KeyMoment = {
  time_sec: number;
  label: string;
  speaker_role?: "agent" | "customer" | string | null;
};

export type AiExtraction = {
  summary?: string | null;
  key_topics: TopicWeight[];
  action_items: string[];
  agent_coaching_notes: string[];
  customer_intent?: string | null;
  call_outcome?: "Successful" | "Unsuccessful" | "Unclear" | null;
  tags: string[];
  key_moments: KeyMoment[];
  raw_llm_text?: string | null;
  available: boolean;
  note?: string | null;
};

export type LlmSentimentAnalysis = {
  overall?: "POSITIVE" | "NEUTRAL" | "NEGATIVE" | null;
  agent_sentiment?: "POSITIVE" | "NEUTRAL" | "NEGATIVE" | null;
  customer_sentiment?: "POSITIVE" | "NEUTRAL" | "NEGATIVE" | null;
  reasoning?: string | null;
  key_moment_indices?: number[];
  available: boolean;
  note?: string | null;
  raw_llm_text?: string | null;
};

export type CallAnalysisResult = {
  language: string;
  duration_sec: number;
  speakers: string[];
  utterances: DiarizedUtterance[];
  words: DiarizedWord[];
  sentiment_segments: SentimentSegment[];
  sentiment_timeline: SentimentTimelinePoint[];
  llm_sentiment?: LlmSentimentAnalysis;
  speaker_metrics: SpeakerMetrics[];
  call_quality: CallQuality;
  ai_extraction: AiExtraction;
  provider?: string;
  transcript_id?: string | null;
  notes?: string[];
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
};

type JobsFile = {
  jobs: AnalysisJob[];
};

export class JobStore {
  constructor(private readonly filePath: string) {}

  private async ensure(): Promise<JobsFile> {
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      return JSON.parse(raw) as JobsFile;
    } catch {
      const empty: JobsFile = { jobs: [] };
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      await fs.writeFile(this.filePath, JSON.stringify(empty, null, 2), "utf8");
      return empty;
    }
  }

  private async save(data: JobsFile): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, JSON.stringify(data, null, 2), "utf8");
  }

  async list(): Promise<AnalysisJob[]> {
    const data = await this.ensure();
    return data.jobs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async get(id: string): Promise<AnalysisJob | undefined> {
    const data = await this.ensure();
    return data.jobs.find((job) => job.id === id);
  }

  async create(job: AnalysisJob): Promise<AnalysisJob> {
    const data = await this.ensure();
    data.jobs.push(job);
    await this.save(data);
    return job;
  }

  async update(id: string, patch: Partial<AnalysisJob>): Promise<AnalysisJob> {
    const data = await this.ensure();
    const index = data.jobs.findIndex((job) => job.id === id);
    if (index < 0) {
      throw new Error(`Job not found: ${id}`);
    }
    const updated: AnalysisJob = {
      ...data.jobs[index],
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    data.jobs[index] = updated;
    await this.save(data);
    return updated;
  }
}
