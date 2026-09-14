type SpeakerRole = "agent" | "customer" | "unknown";

type SpeakerMappingShape = {
  mapping?: Record<string, string>;
  agent_speaker?: string | null;
  customer_speaker?: string | null;
};

export function swapSpeakerOverride(
  mapping: Record<string, string> | undefined,
): Record<string, SpeakerRole> {
  const swapped: Record<string, SpeakerRole> = {};
  for (const [speaker, role] of Object.entries(mapping ?? {})) {
    if (role === "agent") swapped[speaker] = "customer";
    else if (role === "customer") swapped[speaker] = "agent";
    else swapped[speaker] = "unknown";
  }
  return swapped;
}

export function resolveSpeakerOverride(
  existing: SpeakerMappingShape | undefined,
  options: {
    swapSpeakers?: boolean;
    speakerOverride?: Record<string, string>;
  },
): Record<string, SpeakerRole> | undefined {
  if (options.speakerOverride && Object.keys(options.speakerOverride).length > 0) {
    const normalized: Record<string, SpeakerRole> = {};
    for (const [speaker, role] of Object.entries(options.speakerOverride)) {
      if (role === "agent" || role === "customer" || role === "unknown") {
        normalized[speaker] = role;
      }
    }
    return normalized;
  }
  if (options.swapSpeakers) {
    return swapSpeakerOverride(existing?.mapping);
  }
  return undefined;
}

export function storedAnalysisForRemap(result: unknown): {
  utterances: unknown[];
  words: unknown[];
  duration_sec: number;
  transcript_id: string | null;
  language: string;
} | null {
  if (!result || typeof result !== "object") return null;
  const doc = result as Record<string, unknown>;
  const utterances = Array.isArray(doc.utterances) ? doc.utterances : null;
  if (!utterances || utterances.length === 0) return null;
  const words = Array.isArray(doc.words) ? doc.words : [];
  const duration =
    typeof doc.duration_sec === "number"
      ? doc.duration_sec
      : typeof doc.durationSec === "number"
        ? doc.durationSec
        : 0;
  const transcript_id =
    typeof doc.transcript_id === "string" && doc.transcript_id.trim()
      ? doc.transcript_id
      : null;
  const language = typeof doc.language === "string" ? doc.language : "unknown";
  return {
    utterances,
    words,
    duration_sec: duration,
    transcript_id,
    language,
  };
}
