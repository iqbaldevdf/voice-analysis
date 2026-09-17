/**
 * Verifies Freshcaller voicemail (10/16) and bot (19) classification.
 * Run: npx tsx src/freshcaller/connection.selftest.ts
 */
import {
  classifyFreshcallerCall,
  isFreshcallerVoicemailStatus,
  isFreshcallerBotStatus,
  hasFreshcallerVoicemailLifecycle,
} from "./connection.js";

function assert(cond: unknown, message: string): void {
  if (!cond) throw new Error(message);
}

assert(isFreshcallerVoicemailStatus(10), "status 10 should be voicemail");
assert(isFreshcallerVoicemailStatus(16), "status 16 should be voicemail");
assert(isFreshcallerVoicemailStatus("10"), "string status 10 should be voicemail");
assert(!isFreshcallerVoicemailStatus(1), "status 1 should not be voicemail");
assert(!isFreshcallerVoicemailStatus(15), "status 15 should not be voicemail");

assert(
  hasFreshcallerVoicemailLifecycle([{ type: "voicemail_initiated" }]),
  "voicemail_initiated lifecycle",
);
assert(!hasFreshcallerVoicemailLifecycle([{ type: "answered" }]), "answered is not voicemail lifecycle");

{
  const r = classifyFreshcallerCall({
    participants: [{ call_status: 10, participant_type: "Customer", id: 1, call_id: 1 }],
    life_cycle: [],
    bill_duration: 90,
  });
  assert(r.isVoicemail === true, "status 10 => isVoicemail");
  assert(r.isConnected === false, "status 10 => not connected");
}

{
  const r = classifyFreshcallerCall({
    participants: [{ call_status: 16, participant_type: "Customer", id: 1, call_id: 1 }],
    life_cycle: [],
    bill_duration: 120,
  });
  assert(r.isVoicemail === true, "status 16 => isVoicemail");
  assert(r.isConnected === false, "status 16 => not connected");
}

{
  const r = classifyFreshcallerCall({
    participants: [{ call_status: 1, participant_type: "Agent", id: 1, call_id: 1 }],
    life_cycle: [{ type: "answered", time_stamp: "2026-01-01T00:00:00Z" }],
    bill_duration: 120,
  });
  assert(r.isVoicemail === false, "answered connect is not voicemail");
  assert(r.isConnected === true, "answered + status 1 + long => connected");
}

{
  // Short duration alone must NOT set isVoicemail when Freshcaller status is connected.
  const r = classifyFreshcallerCall(
    {
      participants: [{ call_status: 1, participant_type: "Agent", id: 1, call_id: 1 }],
      life_cycle: [{ type: "answered", time_stamp: "2026-01-01T00:00:00Z" }],
      bill_duration: 20,
    },
    20,
  );
  assert(r.isVoicemail === false, "short answered call is not Freshcaller voicemail");
  assert(r.isConnected === false, "short call is not a connect (F06 duration rule)");
}

{
  // No status/lifecycle: do not invent isVoicemail from duration.
  const r = classifyFreshcallerCall({ participants: [], life_cycle: [], bill_duration: 15 }, 15);
  assert(r.isVoicemail === false, "no Freshcaller signal => isVoicemail false");
  assert(r.isConnected === false, "short with no signal => not connected");
}

{
  const r = classifyFreshcallerCall({
    participants: [{ call_status: 1, participant_type: "Agent", id: 1, call_id: 1 }],
    life_cycle: [{ type: "voicemail_initiated", time_stamp: "2026-01-01T00:00:00Z" }],
    bill_duration: 60,
  });
  assert(r.isVoicemail === true, "lifecycle voicemail_initiated => isVoicemail");
  assert(r.isConnected === false, "lifecycle voicemail => not connected");
}

assert(isFreshcallerBotStatus(19), "status 19 should be bot");
assert(isFreshcallerBotStatus("19"), "string status 19 should be bot");
assert(!isFreshcallerBotStatus(1), "status 1 should not be bot");

{
  const r = classifyFreshcallerCall({
    participants: [{ call_status: 19, participant_type: "Bot", id: 1, call_id: 1 }],
    life_cycle: [],
    bill_duration: 90,
  });
  assert(r.botHandling === "bot_only", "status 19 alone => bot_only");
  assert(r.isBotInvolved === true, "bot_only => isBotInvolved");
  assert(r.isConnected === false, "bot_only => not connected");
  assert(r.callStatus === 19, "bot_only callStatus prefers 19");
}

{
  const r = classifyFreshcallerCall({
    participants: [
      { call_status: 19, participant_type: "Bot", id: 1, call_id: 1 },
      { call_status: 1, participant_type: "Agent", id: 2, call_id: 1 },
    ],
    life_cycle: [{ type: "answered", time_stamp: "2026-01-01T00:00:00Z" }],
    bill_duration: 180,
  });
  assert(r.botHandling === "bot_transferred", "bot + agent answered => bot_transferred");
  assert(r.isBotInvolved === true, "bot_transferred => isBotInvolved");
  assert(r.isConnected === true, "bot_transferred long answered => connected");
  assert(r.callStatus === 1, "bot_transferred prefers human connected status");
}

{
  const r = classifyFreshcallerCall({
    participants: [
      { call_status: 1, participant_type: "Bot Assistant", id: 1, call_id: 1 },
      { call_status: 1, participant_type: "Agent", id: 2, call_id: 1 },
    ],
    life_cycle: [{ type: "answered", time_stamp: "2026-01-01T00:00:00Z" }],
    bill_duration: 120,
  });
  assert(r.botHandling === "bot_transferred", "bot participant_type + agent => transferred");
}

{
  const r = classifyFreshcallerCall({
    participants: [{ call_status: 1, participant_type: "Agent", id: 1, call_id: 1 }],
    life_cycle: [{ type: "answered", time_stamp: "2026-01-01T00:00:00Z" }],
    bill_duration: 120,
  });
  assert(r.botHandling === "none", "normal connect => botHandling none");
  assert(r.isBotInvolved === false, "normal connect => not bot involved");
}

{
  // Status 19 + Agent participant (no status 1) still counts as bot → agent transfer.
  const r = classifyFreshcallerCall({
    participants: [
      { call_status: 19, participant_type: "Bot", id: 1, call_id: 1 },
      { call_status: 19, participant_type: "Agent", id: 2, call_id: 1 },
    ],
    life_cycle: [],
    bill_duration: 180,
  });
  assert(r.botHandling === "bot_transferred", "bot+agent participants => transferred even without status 1");
  assert(r.isConnected === true, "bot_transferred with agent participant => connected");
}

console.log("connection.selftest: all assertions passed");
