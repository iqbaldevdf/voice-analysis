/** Freshcaller voicemails are typically short (~20–30s). */
export const VOICEMAIL_MAX_DURATION_SEC = 30;

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
}): boolean {
  if (isForwardedMailCall(doc)) return false;
  if (doc.isVoicemail === true) return false;
  if (isLikelyVoicemail(doc.durationSec)) return false;
  if (doc.isConnected === true) return true;
  if (doc.isConnected === false) return false;
  return true;
}

export function isAnsweredCall(doc: {
  isConnected?: boolean | null;
  isVoicemail?: boolean | null;
  callNotes?: string | null;
  durationSec?: number | null;
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

/** Always drop voicemail and forwarded-mail recordings from call history. */
export function excludeForwardedMailFilter(): Record<string, unknown> {
  return {
    isVoicemail: { $ne: true },
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
