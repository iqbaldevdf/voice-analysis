export type MetricHelpScope = "call" | "quarter";

const CALL: Record<string, string> = {
  overallScore:
    "Call quality: 50% clarity + 50% speech-rate score. Clarity uses STT confidence (penalized if silence > 35%). Speech rate scores 100 at 120–192 wpm.",
  talkListen:
    "Agent vs customer talk-time % from speaker diarization. Script analysis score (when shown) rates the opening pitch themes (F07).",
  avgResponseTime: "Average pause before the other person speaks. Good: 2.5s or less.",
  silence: "Share of the call with no speech (total duration minus talk time).",
  interruptions: "Times one speaker talked over the other. Good: 2 or fewer.",
  speechRate: "Agent words per minute. Target: 120–192 wpm (2.0–3.2 words/s).",
  categoryBreakup:
    "Six behaviour scores in two groups of three (quarter averages). Turn taking is scored on calls but not shown here.",
  overallCalls: "Connected calls this quarter (IST). Voicemail and missed calls excluded.",
  callsAnalyzed: "Analyzed connects divided by total connects this quarter.",
  rosterOverallScore: "Average call-quality score across agents with at least one scored call.",
  appointments: "Calls with disposition set to Appointment this quarter.",
  agentCallsAnalyzed: "This agent’s analyzed connects ÷ total connects this quarter.",
  agentOverallScore: "This agent’s average call-quality score this quarter.",
  agentAppointments: "This agent’s calls marked Appointment this quarter.",
};

const QUARTER_PREFIX = "Quarter average across analyzed connects. ";

const QUARTER: Record<string, string> = {
  overallScore: `${QUARTER_PREFIX}${CALL.overallScore}`,
  talkListen: `${QUARTER_PREFIX}${CALL.talkListen}`,
  avgResponseTime: `${QUARTER_PREFIX}${CALL.avgResponseTime}`,
  silence: `${QUARTER_PREFIX}${CALL.silence}`,
  interruptions: `${QUARTER_PREFIX}${CALL.interruptions}`,
  speechRate: `${QUARTER_PREFIX}${CALL.speechRate}`,
};

const CATEGORY_HELP: Record<string, string> = {
  communicationEffectiveness: "Clear, understandable speech. 20% of call score. Shown as quarter average.",
  responseRelevance: "Answers match the customer’s question. 20% weight. Quarter average.",
  activeListening: "Acknowledges and follows what the customer said. 15% weight. Quarter average.",
  turnTaking: "Smooth handovers, minimal overlap or long gaps. 15% weight. Quarter average.",
  engagement: "Stays attentive and keeps momentum. 10% weight. Quarter average.",
  conversationBalance: "Neither side dominates the call. 10% weight. Quarter average.",
  efficiency: "Progresses toward an outcome without wasted back-and-forth. 10% weight. Quarter average.",
};

export function metricHelp(id: string, scope: MetricHelpScope = "call"): string {
  if (scope === "quarter" && QUARTER[id]) return QUARTER[id];
  if (CATEGORY_HELP[id]) return CATEGORY_HELP[id];
  return CALL[id] ?? "See Call-and-Agent-Performance.md for the formula.";
}
