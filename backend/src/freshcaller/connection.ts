import type { FreshcallerCall } from "./types.js";
import { isLikelyVoicemail } from "../voicemail.js";

/** Freshcaller participant call_status values that mean a live conversation. */
const CONNECTED_STATUSES = new Set([1, 15]);
/** Redirected to voicemail, or voicemail recording in progress. */
const VOICEMAIL_STATUSES = new Set([10, 16]);

export type CallConnection = {
  isConnected: boolean;
  isVoicemail: boolean;
  callStatus: number | null;
};

export function classifyFreshcallerCall(
  call: Pick<FreshcallerCall, "participants" | "life_cycle" | "bill_duration">,
  durationSec?: number | null,
): CallConnection {
  const statuses = (call.participants ?? [])
    .map((participant) => participant.call_status)
    .filter((status): status is number => typeof status === "number");
  const lifecycle = (call.life_cycle ?? []).map((event) => event.type.toLowerCase());
  const hasSignal = statuses.length > 0 || lifecycle.length > 0;

  const voicemail =
    lifecycle.some((type) => type.includes("voicemail")) ||
    statuses.some((status) => VOICEMAIL_STATUSES.has(status));
  const answered = lifecycle.includes("answered");
  const connectedStatus = statuses.some((status) => CONNECTED_STATUSES.has(status));

  if (!hasSignal) {
    const short = isLikelyVoicemail(durationSec ?? call.bill_duration ?? null);
    return { isConnected: !short, isVoicemail: short, callStatus: null };
  }

  return {
    isConnected: !voicemail && (answered || connectedStatus),
    isVoicemail: voicemail,
    callStatus: statuses.find((status) => status === 1) ?? statuses[0] ?? null,
  };
}
