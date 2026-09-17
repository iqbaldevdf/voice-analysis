/** Short recordings (greetings, VM drops, no real conversation) — see F06. */
export const VOICEMAIL_MAX_DURATION_SEC = 40;

/**
 * Freshcaller official participant call_status values for voicemail.
 * Source: https://developers.freshcaller.com/api/ (Participants → call_status)
 * - 10: redirected to voicemail
 * - 16: voicemail recording in progress
 *
 * Sync classification lives in `freshcaller/connection.ts` and sets `isVoicemail`
 * from these statuses (and voicemail lifecycle events). Duration ≤40s is a separate
 * non-connect / hide rule, not a substitute for Freshcaller status when status exists.
 */
export const FRESHCALLER_VOICEMAIL_CALL_STATUSES = [10, 16] as const;

/** Agent notes used for voicemail drops and mail-forwarded recordings. */
const FORWARDED_MAIL_NOTES =
  /\b(vm|v\/m|voicemail|voice mail|voice-mail|forwarded mail|forwarding mail|fwd mail|mail forward)\b/i;

export function isForwardedMailCall(doc: {
  isVoicemail?: boolean | null;
  callNotes?: string | null;
}): boolean {
  if (doc.isVoicemail === true) return true;
  const notes = doc.callNotes?.trim() ?? "";
  return notes.length > 0 && FORWARDED_MAIL_NOTES.test(notes);
}

export function isConnectedConversation(doc: {
  isConnected?: boolean | null;
  isVoicemail?: boolean | null;
  callNotes?: string | null;
  durationSec?: number | null;
  botHandling?: string | null;
}): boolean {
  if (isForwardedMailCall(doc)) return false;
  if (doc.isVoicemail === true) return false;
  if (doc.botHandling === "bot_only") return false;
  if (isLikelyVoicemail(doc.durationSec)) return false;
  // Bot → agent transfers count as connects for agent KPIs / dashboard (F09).
  if (doc.botHandling === "bot_transferred") return true;
  if (doc.isConnected === true) return true;
  if (doc.isConnected === false) return false;
  return true;
}

export function isAnsweredCall(doc: {
  isConnected?: boolean | null;
  isVoicemail?: boolean | null;
  callNotes?: string | null;
  durationSec?: number | null;
  botHandling?: string | null;
}): boolean {
  return isConnectedConversation(doc);
}

export function isLikelyVoicemail(durationSec?: number | null): boolean {
  return (
    durationSec != null &&
    Number.isFinite(durationSec) &&
    durationSec > 0 &&
    durationSec <= VOICEMAIL_MAX_DURATION_SEC
  );
}

/** Always drop voicemail, bot-only, and forwarded-mail recordings from call history. */
export function excludeForwardedMailFilter(): Record<string, unknown> {
  return {
    isVoicemail: { $ne: true },
    botHandling: { $ne: "bot_only" },
    callNotes: { $not: FORWARDED_MAIL_NOTES },
  };
}

/** Hide voicemails and short calls (<= VOICEMAIL_MAX_DURATION_SEC). */
export function excludeVoicemailFilter(): Record<string, unknown> {
  return {
    $and: [
      { isVoicemail: { $ne: true } },
      {
        $or: [
          { durationSec: { $gt: VOICEMAIL_MAX_DURATION_SEC } },
          { durationSec: null },
          { durationSec: { $exists: false } },
        ],
      },
    ],
  };
}
