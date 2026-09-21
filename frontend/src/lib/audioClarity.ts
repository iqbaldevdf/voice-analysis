import type {
  DiarizedUtterance,
  DiarizedWord,
  LowConfidenceSpan,
  SpeakerAudioClarity,
  SpeakerMapping,
} from "../api";

export type AudioClarityFlag = "ok" | "caution" | "poor";

export const AUDIO_CLARITY_REASON_LABEL: Record<string, string> = {
  low_asr_confidence: "Low ASR confidence",
  many_uncertain_words: "Many uncertain words",
  clipping: "Clipping",
  too_quiet: "Too quiet",
  high_silence: "High silence",
};

const MEAN_POOR = 0.5;
const MEAN_CAUTION = 0.7;
const LOW_WORD = 0.4;
const LOW_PCT_POOR = 0.3;
const LOW_PCT_CAUTION = 0.15;

export function isUnclearAudio(flag?: AudioClarityFlag | string | null): boolean {
  return flag === "caution" || flag === "poor";
}

export function worseAudioFlag(...flags: Array<AudioClarityFlag | string | null | undefined>): AudioClarityFlag {
  const rank: Record<string, number> = { ok: 0, caution: 1, poor: 2 };
  let best: AudioClarityFlag = "ok";
  for (const flag of flags) {
    if (flag && (rank[flag] ?? 0) > rank[best]) {
      best = flag as AudioClarityFlag;
    }
  }
  return best;
}

export function flagFromConfidences(confs: number[]): AudioClarityFlag {
  if (confs.length === 0) return "ok";
  const mean = confs.reduce((sum, value) => sum + value, 0) / confs.length;
  const lowPct = confs.filter((value) => value < LOW_WORD).length / confs.length;
  if (mean < MEAN_POOR || lowPct >= LOW_PCT_POOR) return "poor";
  if (mean < MEAN_CAUTION || lowPct >= LOW_PCT_CAUTION) return "caution";
  return "ok";
}

export function resolveSpeakerAudioClarity(
  stored: SpeakerAudioClarity[] | undefined,
  words: DiarizedWord[] | undefined,
  mapping?: SpeakerMapping | null,
): SpeakerAudioClarity[] {
  if (stored && stored.length > 0) {
    return stored.filter((row) => row.role !== "bot");
  }
  if (!words?.length) return [];
  const bySpeaker = new Map<string, number[]>();
  for (const word of words) {
    if (word.confidence == null) continue;
    const list = bySpeaker.get(word.speaker) ?? [];
    list.push(word.confidence);
    bySpeaker.set(word.speaker, list);
  }
  const roles = mapping?.mapping ?? {};
  const rows: SpeakerAudioClarity[] = [];
  for (const [speaker, confs] of bySpeaker) {
    const role = roles[speaker];
    if (role === "bot") continue;
    rows.push({
      speaker,
      role,
      flag: flagFromConfidences(confs),
      reasons: [],
      avg_asr_confidence: confs.reduce((sum, value) => sum + value, 0) / confs.length,
      low_confidence_word_pct: (confs.filter((value) => value < LOW_WORD).length / confs.length) * 100,
    });
  }
  const order: Record<string, number> = { agent: 0, customer: 1 };
  return rows.sort(
    (a, b) => (order[a.role ?? ""] ?? 9) - (order[b.role ?? ""] ?? 9) || a.speaker.localeCompare(b.speaker),
  );
}

export function speakerClarityName(
  row: SpeakerAudioClarity,
  agentName: string,
  customerName: string,
): string {
  if (row.role === "agent") return agentName || "Agent";
  if (row.role === "customer") return customerName || "Customer";
  return `Speaker ${row.speaker}`;
}

export function audioClarityTitle(flag: AudioClarityFlag): string {
  if (flag === "poor" || flag === "caution") {
    return "Audio quality was not good — transcription may mismatch";
  }
  return "Audio quality: OK";
}

export function reasonLabel(code: string): string {
  return AUDIO_CLARITY_REASON_LABEL[code] ?? code.replace(/_/g, " ");
}

export function isLowConfidenceWord(
  word: Pick<DiarizedWord, "start" | "end" | "confidence">,
  spans?: LowConfidenceSpan[] | null,
  threshold = 0.4,
): boolean {
  if (word.confidence != null && word.confidence < threshold) return true;
  return Boolean(spans?.some((span) => span.start < word.end && span.end > word.start));
}

export function utteranceWordParts(
  utterance: DiarizedUtterance,
  words: DiarizedWord[] | undefined,
  spans?: LowConfidenceSpan[] | null,
): Array<{ text: string; low: boolean }> {
  const inUtterance = (words ?? []).filter(
    (word) => word.end > utterance.start && word.start < utterance.end,
  );
  if (inUtterance.length === 0) {
    return [{ text: utterance.text, low: false }];
  }
  return inUtterance.map((word) => ({
    text: word.word,
    low: isLowConfidenceWord(word, spans),
  }));
}
