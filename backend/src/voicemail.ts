/** Freshcaller voicemails are typically short (~20–30s). */
export const VOICEMAIL_MAX_DURATION_SEC = 30;

export function isLikelyVoicemail(durationSec?: number | null): boolean {
  return (
    durationSec != null &&
    Number.isFinite(durationSec) &&
    durationSec > 0 &&
    durationSec <= VOICEMAIL_MAX_DURATION_SEC
  );
}

/**
 * Keep connected conversations.
 * Prefer Freshcaller connected/voicemail flags; duration is only a fallback for older rows.
 */
export function excludeVoicemailFilter(): Record<string, unknown> {
  return {
    $and: [
      { isVoicemail: { $ne: true } },
      {
        $or: [
          { isConnected: true },
          {
            isConnected: { $exists: false },
            $or: [
              { durationSec: { $gt: VOICEMAIL_MAX_DURATION_SEC } },
              { durationSec: null },
              { durationSec: { $exists: false } },
            ],
          },
        ],
      },
    ],
  };
}
