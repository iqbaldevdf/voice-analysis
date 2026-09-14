/**
 * Check whether Freshcaller provides a native transcript for a call.
 * Usage: npx tsx scripts/check-fc-transcript.ts <callId>
 */
import "dotenv/config";
import { FreshcallerClient } from "../src/freshcaller/client.js";

const callId = Number(process.argv[2]);
if (!callId) {
  console.error("Usage: npx tsx scripts/check-fc-transcript.ts <callId>");
  process.exit(1);
}

const baseUrl = (process.env.FRESHCALLER_BASE_URL ?? "").replace(/\/$/, "");
const apiAuth = (process.env.FRESHCALLER_API_AUTH ?? "").trim();

async function main() {
  const headers = {
    "X-Api-Auth": apiAuth,
    Accept: "application/json",
  };

  const callRes = await fetch(`${baseUrl}/api/v1/calls/${callId}`, { headers });
  if (!callRes.ok) {
    throw new Error(`GET call failed (${callRes.status}): ${await callRes.text()}`);
  }
  const callData = (await callRes.json()) as Record<string, unknown>;
  const call = callData.call as Record<string, unknown> | undefined;
  const recording = call?.recording as Record<string, unknown> | undefined;

  const summary = {
    callId,
    direction: call?.direction,
    agentName: call?.assigned_agent_name,
    recordingId: recording?.id,
    recordingUrl: recording?.url,
    transcriptionUrl: recording?.transcription_url ?? null,
    duration: recording?.duration,
  };

  let transcriptionPayload: unknown = null;
  const transcriptionUrl = recording?.transcription_url;
  if (typeof transcriptionUrl === "string" && transcriptionUrl.trim()) {
    const txRes = await fetch(transcriptionUrl, {
      headers,
      redirect: "follow",
    });
    const contentType = txRes.headers.get("content-type") ?? "";
    if (contentType.includes("json")) {
      transcriptionPayload = await txRes.json();
    } else {
      transcriptionPayload = (await txRes.text()).slice(0, 4000);
    }
  }

  console.log(JSON.stringify({ summary, transcriptionPayload }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
