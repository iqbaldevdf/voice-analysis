import type { FreshcallerCall } from "./types.js";
import { isLikelyVoicemail } from "../voicemail.js";

/**
 * Freshcaller participant `call_status` values.
 * Source: https://developers.freshcaller.com/api/ (Participants → call_status)
 *
 * Voicemail (official):
 * - 10: The call was redirected to a voicemail.
 * - 16: The voicemail recording was in progress.
 *
 * Bot (official):
 * - 19: The call is handled by a bot.
 *
 * Connected / completed (used for connect classification):
 * - 1: Answered/Completed
 * - 15: The call interaction was completed recently.
 */
export const FRESHCALLER_CONNECTED_STATUSES = new Set([1, 15]);
export const FRESHCALLER_VOICEMAIL_STATUSES = new Set([10, 16]);
export const FRESHCALLER_BOT_STATUSES = new Set([19]);

/** How a bot participated in the call (F09). */
export type BotHandling = "none" | "bot_only" | "bot_transferred";

export type CallConnection = {
  isConnected: boolean;
  /** True only from Freshcaller voicemail signals (status 10/16 or voicemail lifecycle). */
  isVoicemail: boolean;
  callStatus: number | null;
  /** Bot involvement from status 19 / bot participant / bot lifecycle. */
  botHandling: BotHandling;
  isBotInvolved: boolean;
};

function normalizeCallStatus(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** True when Freshcaller marks the participant as voicemail (status 10 or 16). */
export function isFreshcallerVoicemailStatus(status: unknown): boolean {
  const n = normalizeCallStatus(status);
  return n != null && FRESHCALLER_VOICEMAIL_STATUSES.has(n);
}

/** True when Freshcaller marks the participant as bot-handled (status 19). */
export function isFreshcallerBotStatus(status: unknown): boolean {
  const n = normalizeCallStatus(status);
  return n != null && FRESHCALLER_BOT_STATUSES.has(n);
}

/** True when lifecycle event types indicate voicemail (e.g. voicemail_initiated). */
export function hasFreshcallerVoicemailLifecycle(
  lifeCycle: Array<{ type?: string }> | null | undefined,
): boolean {
  return (lifeCycle ?? []).some((event) =>
    String(event.type ?? "")
      .toLowerCase()
      .includes("voicemail"),
  );
}

function hasBotParticipantType(
  participants: Array<{ participant_type?: string }> | null | undefined,
): boolean {
  return (participants ?? []).some((p) =>
    String(p.participant_type ?? "")
      .toLowerCase()
      .includes("bot"),
  );
}

/** Human agent / rep participant (not bot), used to detect bot → agent transfer. */
function hasHumanAgentParticipant(
  participants: Array<{ participant_type?: string }> | null | undefined,
): boolean {
  return (participants ?? []).some((p) => {
    const role = String(p.participant_type ?? "").toLowerCase();
    if (!role || role.includes("bot")) return false;
    return (
      role.includes("agent") ||
      role === "user" ||
      role.includes("executive") ||
      role.includes("rep")
    );
  });
}

function hasBotLifecycle(lifeCycle: Array<{ type?: string }> | null | undefined): boolean {
  return (lifeCycle ?? []).some((event) =>
    String(event.type ?? "")
      .toLowerCase()
      .includes("bot"),
  );
}

function pickCallStatus(statuses: number[], botSignal: boolean): number | null {
  const connected = statuses.find((status) => FRESHCALLER_CONNECTED_STATUSES.has(status));
  if (connected != null) return connected;
  if (botSignal) {
    const bot = statuses.find((status) => FRESHCALLER_BOT_STATUSES.has(status));
    if (bot != null) return bot;
  }
  return statuses[0] ?? null;
}

/**
 * Classify connect vs Freshcaller voicemail / bot using official call_status + lifecycle.
 *
 * - `isVoicemail` follows Freshcaller status 10/16 (or voicemail lifecycle) only.
 * - `botHandling` follows status 19 / bot participant type / bot lifecycle (F09).
 * - Short duration (≤40s) is a separate non-connect rule (F06), not a fake voicemail flag
 *   when Freshcaller status is present.
 */
export function classifyFreshcallerCall(
  call: Pick<FreshcallerCall, "participants" | "life_cycle" | "bill_duration">,
  durationSec?: number | null,
): CallConnection {
  const participants = call.participants ?? [];
  const statuses = participants
    .map((participant) => normalizeCallStatus(participant.call_status))
    .filter((status): status is number => status != null);
  const lifecycle = call.life_cycle ?? [];
  const hasSignal = statuses.length > 0 || lifecycle.length > 0 || hasBotParticipantType(participants);

  const duration = durationSec ?? call.bill_duration ?? null;
  const short = isLikelyVoicemail(duration);

  const voicemailFromStatus = statuses.some((status) => FRESHCALLER_VOICEMAIL_STATUSES.has(status));
  const voicemailFromLifecycle = hasFreshcallerVoicemailLifecycle(lifecycle);
  const isVoicemail = voicemailFromStatus || voicemailFromLifecycle;

  const botFromStatus = statuses.some((status) => FRESHCALLER_BOT_STATUSES.has(status));
  const botSignal = botFromStatus || hasBotParticipantType(participants) || hasBotLifecycle(lifecycle);

  const answered = lifecycle.some((event) => String(event.type ?? "").toLowerCase() === "answered");
  const connectedStatus = statuses.some((status) => FRESHCALLER_CONNECTED_STATUSES.has(status));
  // Bot→agent transfers often keep status 19 while an Agent participant is present.
  const humanAgentPresent = hasHumanAgentParticipant(participants);
  const humanConnected = answered || connectedStatus || humanAgentPresent;

  let botHandling: BotHandling = "none";
  if (botSignal) {
    botHandling = humanConnected ? "bot_transferred" : "bot_only";
  }

  const empty: CallConnection = {
    isConnected: !short,
    isVoicemail: false,
    callStatus: null,
    botHandling: "none",
    isBotInvolved: false,
  };

  if (!hasSignal && !botSignal) {
    // No Freshcaller status/lifecycle: cannot claim official voicemail/bot; use duration only for connect.
    return empty;
  }

  // Bot-only is never an agent connect (F09). Voicemail / short still win as non-connect.
  const isConnected =
    !isVoicemail && !short && humanConnected && botHandling !== "bot_only";

  return {
    isConnected,
    isVoicemail,
    callStatus: pickCallStatus(statuses, botSignal),
    botHandling,
    isBotInvolved: botHandling !== "none",
  };
}
