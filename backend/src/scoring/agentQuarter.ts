import { toIstCallDate } from "../freshcaller/dateUtils.js";

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

export const DISPOSITIONS = [
  "hung_up",
  "not_interested",
  "appointment",
  "follow_up",
  "dnc",
] as const;

export type Disposition = (typeof DISPOSITIONS)[number];

export type QuarterWindow = {
  id: string;
  label: string;
  fromDate: string;
  toDate: string;
  fromIso: string;
  toIso: string;
};

type AgentPerformance = {
  participantRole?: string;
  overallScore?: number | null;
  talkPercentage?: number;
  totalTalkDuration?: number;
  interruptionCount?: number;
  questionCount?: number;
  strengths?: string[];
  improvements?: string[];
  scores?: Record<string, { score?: number }>;
};

type AnalysisShape = {
  call_quality?: {
    recording_quality_score?: number;
    clarity_score?: number | null;
    speech_rate_score?: number | null;
  };
  participant_performance?: AgentPerformance[];
  speaker_metrics?: Array<{
    role_guess?: string | null;
    words_spoken?: number;
    talk_time_sec?: number;
    words_per_minute?: number;
  }>;
};

export type CallQualityParts = {
  clarityScore: number | null;
  speechRateScore: number | null;
  callQualityScore: number | null;
  wordsPerSecond: number | null;
};

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function istParts(now: Date): { year: number; month: number } {
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  return { year: ist.getUTCFullYear(), month: ist.getUTCMonth() + 1 };
}

function quarterIndex(month: number): number {
  return Math.floor((month - 1) / 3) + 1;
}

function lastDay(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function quarterWindow(year: number, quarter: number): QuarterWindow {
  const startMonth = (quarter - 1) * 3 + 1;
  const endMonth = startMonth + 2;
  const fromDate = `${year}-${pad(startMonth)}-01`;
  const toDate = `${year}-${pad(endMonth)}-${pad(lastDay(year, endMonth))}`;
  return {
    id: `${year}-Q${quarter}`,
    label: `Q${quarter} ${year}`,
    fromDate,
    toDate,
    fromIso: `${fromDate}T00:00:00+05:30`,
    toIso: `${toDate}T23:59:59.999+05:30`,
  };
}

export function currentQuarter(now = new Date()): QuarterWindow {
  const { year, month } = istParts(now);
  return quarterWindow(year, quarterIndex(month));
}

export function parseQuarter(value: string | undefined, now = new Date()): QuarterWindow {
  const match = /^(\d{4})-Q([1-4])$/.exec((value ?? "").trim());
  if (!match) return currentQuarter(now);
  return quarterWindow(Number(match[1]), Number(match[2]));
}

export function recentQuarters(count = 5, now = new Date()): QuarterWindow[] {
  const current = currentQuarter(now);
  const match = /^(\d{4})-Q([1-4])$/.exec(current.id);
  let year = match ? Number(match[1]) : istParts(now).year;
  let quarter = match ? Number(match[2]) : 1;
  const windows: QuarterWindow[] = [];
  for (let i = 0; i < count; i += 1) {
    windows.push(quarterWindow(year, quarter));
    quarter -= 1;
    if (quarter < 1) {
      quarter = 4;
      year -= 1;
    }
  }
  return windows;
}

export function isDisposition(value: unknown): value is Disposition {
  return typeof value === "string" && (DISPOSITIONS as readonly string[]).includes(value);
}

export function speechRateScore(wordsPerSecond: number | null | undefined): number | null {
  if (wordsPerSecond == null || !Number.isFinite(wordsPerSecond) || wordsPerSecond < 0) return null;
  if (wordsPerSecond >= 2 && wordsPerSecond <= 3.2) return 100;
  const distance = wordsPerSecond < 2 ? 2 - wordsPerSecond : wordsPerSecond - 3.2;
  return Math.max(0, Math.round((100 - (distance / 0.5) * 25) * 10) / 10);
}

export function wordsPerSecondFromResult(result: unknown): number | null {
  const metrics = (result as AnalysisShape | null)?.speaker_metrics;
  const agent = metrics?.find((item) => item.role_guess === "agent");
  if (!agent) return null;
  if (typeof agent.talk_time_sec === "number" && agent.talk_time_sec > 0 && typeof agent.words_spoken === "number") {
    return Math.round((agent.words_spoken / agent.talk_time_sec) * 10) / 10;
  }
  if (typeof agent.words_per_minute === "number") {
    return Math.round((agent.words_per_minute / 60) * 10) / 10;
  }
  return null;
}

function finiteScore(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function callQualityFromResult(result: unknown): CallQualityParts {
  const quality = (result as AnalysisShape | null)?.call_quality;
  const clarityScore = finiteScore(quality?.clarity_score) ?? finiteScore(quality?.recording_quality_score);
  const wordsPerSecond = wordsPerSecondFromResult(result);
  const rateScore = finiteScore(quality?.speech_rate_score) ?? speechRateScore(wordsPerSecond);
  const parts = [clarityScore, rateScore].filter((value): value is number => value != null);
  return {
    clarityScore,
    speechRateScore: rateScore,
    callQualityScore: parts.length > 0 ? Math.round((parts.reduce((sum, value) => sum + value, 0) / parts.length) * 10) / 10 : null,
    wordsPerSecond,
  };
}

export function mean(values: Array<number | null | undefined>): number | null {
  const scored = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (scored.length === 0) return null;
  return Math.round((scored.reduce((sum, value) => sum + value, 0) / scored.length) * 10) / 10;
}

export function agentPerformance(result: unknown): AgentPerformance | undefined {
  return (result as AnalysisShape | null)?.participant_performance?.find(
    (item) => item.participantRole?.toLowerCase() === "agent",
  );
}

type IntroductionShape = {
  score?: number;
  rank?: string;
};

export function introductionScriptFromResult(result: unknown): IntroductionShape | null {
  const intro = (result as { introduction_script?: IntroductionShape } | null)?.introduction_script;
  if (!intro || typeof intro.score !== "number") return null;
  return intro;
}

export function recordingCallDate(doc: { callDate?: string | null; createdTime?: string | null }): string | null {
  if (doc.callDate && /^\d{4}-\d{2}-\d{2}$/.test(doc.callDate)) return doc.callDate;
  if (!doc.createdTime) return null;
  const parsed = new Date(doc.createdTime);
  if (Number.isNaN(parsed.getTime())) return null;
  return toIstCallDate(parsed);
}

export function inQuarter(callDate: string | null, quarter: QuarterWindow): boolean {
  return callDate != null && callDate >= quarter.fromDate && callDate <= quarter.toDate;
}
