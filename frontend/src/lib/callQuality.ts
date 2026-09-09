import type { CallQuality, SpeakerMetrics } from "../api";

export type CallQualityParts = {
  clarityScore: number | null;
  speechRateScore: number | null;
  callQualityScore: number | null;
  wordsPerSecond: number | null;
};

function speechRateScore(wordsPerSecond: number | null): number | null {
  if (wordsPerSecond == null || !Number.isFinite(wordsPerSecond) || wordsPerSecond < 0) return null;
  if (wordsPerSecond >= 2 && wordsPerSecond <= 3.2) return 100;
  const distance = wordsPerSecond < 2 ? 2 - wordsPerSecond : wordsPerSecond - 3.2;
  return Math.max(0, Math.round((100 - (distance / 0.5) * 25) * 10) / 10);
}

export function wordsPerSecondFromMetrics(agent?: SpeakerMetrics): number | null {
  if (!agent) return null;
  if (agent.talk_time_sec > 0) return Math.round((agent.words_spoken / agent.talk_time_sec) * 10) / 10;
  return Math.round((agent.words_per_minute / 60) * 10) / 10;
}

export function callQualityParts(quality: CallQuality | undefined, agent?: SpeakerMetrics): CallQualityParts {
  const clarityScore = quality?.clarity_score ?? quality?.recording_quality_score ?? null;
  const wordsPerSecond = wordsPerSecondFromMetrics(agent);
  const rateScore = quality?.speech_rate_score ?? speechRateScore(wordsPerSecond);
  const parts = [clarityScore, rateScore].filter((value): value is number => value != null);
  return {
    clarityScore,
    speechRateScore: rateScore,
    callQualityScore: parts.length > 0 ? Math.round((parts.reduce((sum, value) => sum + value, 0) / parts.length) * 10) / 10 : null,
    wordsPerSecond,
  };
}
