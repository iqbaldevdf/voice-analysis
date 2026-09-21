export type AudioClarityFlag = "ok" | "caution" | "poor";

export function audioClarityFlagFromResult(result: unknown): AudioClarityFlag | null {
  if (!result || typeof result !== "object") return null;
  const quality = (result as { call_quality?: { audio_clarity_flag?: unknown } }).call_quality;
  const flag = quality?.audio_clarity_flag;
  if (flag === "ok" || flag === "caution" || flag === "poor") return flag;
  return null;
}
