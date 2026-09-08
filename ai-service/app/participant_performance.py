from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from typing import Any, Callable

from app.participant_metrics import compute_participant_facts
from app.performance_weights import ANALYSIS_VERSION, load_weights, weighted_overall
from app.schemas import (
    DiarizedUtterance,
    EvidenceRef,
    ParticipantPerformanceAnalysis,
    ScoreExplanation,
)

ChatFn = Callable[..., str]

SCORE_KEYS = (
    "communicationEffectiveness",
    "responseRelevance",
    "activeListening",
    "turnTaking",
    "engagement",
    "conversationBalance",
    "efficiency",
)


def _extract_json(text: str) -> dict[str, Any] | None:
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned)
        cleaned = re.sub(r"\s*```$", "", cleaned)
    try:
        parsed = json.loads(cleaned)
        return parsed if isinstance(parsed, dict) else None
    except json.JSONDecodeError:
        match = re.search(r"\{[\s\S]*\}", cleaned)
        if not match:
            return None
        try:
            parsed = json.loads(match.group(0))
            return parsed if isinstance(parsed, dict) else None
        except json.JSONDecodeError:
            return None


def _clamp_score(value: Any) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return 0.0
    return round(max(0.0, min(100.0, number)), 1)


def _score_block(raw: Any) -> ScoreExplanation:
    if not isinstance(raw, dict):
        return ScoreExplanation(score=0.0, explanation="Not evaluated.")
    evidence: list[EvidenceRef] = []
    for item in raw.get("evidence") or []:
        if not isinstance(item, dict):
            continue
        try:
            start = float(item.get("start", 0))
            end = float(item.get("end", start))
        except (TypeError, ValueError):
            continue
        evidence.append(
            EvidenceRef(
                start=start,
                end=end,
                quote=str(item.get("quote") or "")[:240],
                note=item.get("note"),
            )
        )
    return ScoreExplanation(
        score=_clamp_score(raw.get("score")),
        explanation=str(raw.get("explanation") or "No explanation provided.")[:500],
        evidence=evidence[:4],
    )


def _strings(value: Any, limit: int = 5) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(item).strip() for item in value if str(item).strip()][:limit]


def _from_facts(
    facts: list[dict[str, Any]],
    note: str,
    available: bool = False,
) -> list[ParticipantPerformanceAnalysis]:
    now = datetime.now(timezone.utc).isoformat()
    weights = load_weights()
    rows: list[ParticipantPerformanceAnalysis] = []
    for fact in facts:
        role = str(fact.get("participantRole") or "unknown")
        rows.append(
            ParticipantPerformanceAnalysis(
                speaker=str(fact.get("speaker")),
                participantRole=role,
                presentation="performance" if role == "agent" else "interaction",
                displayName=fact.get("displayName"),
                available=available,
                note=note,
                analysisVersion=ANALYSIS_VERSION,
                weights=dict(weights),
                createdAt=now,
                updatedAt=now,
                totalTalkDuration=float(fact.get("totalTalkDuration") or 0),
                talkPercentage=float(fact.get("talkPercentage") or 0),
                speakingTurnCount=int(fact.get("speakingTurnCount") or 0),
                averageTurnDuration=float(fact.get("averageTurnDuration") or 0),
                longestTurnDuration=float(fact.get("longestTurnDuration") or 0),
                shortResponseCount=int(fact.get("shortResponseCount") or 0),
                longMonologueCount=int(fact.get("longMonologueCount") or 0),
                questionCount=int(fact.get("questionCount") or 0),
                averageResponseTime=fact.get("averageResponseTime"),
                interruptionCount=int(fact.get("interruptionCount") or 0),
                interruptedByOthersCount=int(fact.get("interruptedByOthersCount") or 0),
                repeatedQuestions=int(fact.get("repeatedQuestions") or 0),
                repeatedStatements=int(fact.get("repeatedStatements") or 0),
            )
        )
    return rows


def run_participant_performance(
    *,
    utterances: list[DiarizedUtterance],
    role_hints: dict[str, str],
    named_roles: list[dict[str, Any]] | None,
    direction: str | None,
    call_notes: str | None,
    chat: ChatFn | None,
    llm_enabled: bool,
    transcript_id: str | None = None,
) -> list[ParticipantPerformanceAnalysis]:
    facts = compute_participant_facts(utterances)
    name_by_role = {
        str(item.get("role") or "").lower(): item.get("name")
        for item in (named_roles or [])
        if item.get("role")
    }
    for fact in facts:
        role = role_hints.get(str(fact["speaker"]), "unknown")
        fact["participantRole"] = role
        fact["displayName"] = name_by_role.get(role) or None

    if not facts:
        return []
    if not llm_enabled or chat is None:
        return _from_facts(facts, "LLM disabled; factual metrics only.")

    numbered = "\n".join(
        f"{index}. [{utt.speaker}] ({utt.start:.1f}-{utt.end:.1f}s) {utt.text}"
        for index, utt in enumerate(utterances[:180])
    )
    role_line = ", ".join(f"{speaker}={role}" for speaker, role in role_hints.items()) or "unknown"
    names = ", ".join(
        f"{item.get('role')}={item.get('name')}" for item in (named_roles or []) if item.get("name")
    ) or "not provided"
    prompt = f"""
You evaluate individual communication behaviour. Do not restate call-level sentiment.
Do not treat talk percentage alone as good or bad.
An agent may speak more while explaining a solution. A customer may speak more while explaining a problem.

Direction: {direction or "unknown"}
Notes: {(call_notes or "none")[:400]}
Speaker roles: {role_line}
Known names: {names}
Factual metrics JSON:
{json.dumps(facts, ensure_ascii=False)}

Transcript:
{numbered}

Return ONLY JSON:
{{
  "participants": [
    {{
      "speaker": "A",
      "communicationEffectiveness": {{"score": 0, "explanation": "", "evidence": [{{"start": 0, "end": 0, "quote": "", "note": ""}}]}},
      "responseRelevance": {{"score": 0, "explanation": "", "evidence": []}},
      "activeListening": {{"score": 0, "explanation": "", "evidence": []}},
      "turnTaking": {{"score": 0, "explanation": "", "evidence": []}},
      "engagement": {{"score": 0, "explanation": "", "evidence": []}},
      "conversationBalance": {{"score": 0, "explanation": "", "evidence": []}},
      "efficiency": {{"score": 0, "explanation": "", "evidence": []}},
      "strengths": ["specific behaviour"],
      "improvements": ["specific behaviour"],
      "recommendations": ["practical next conversation advice"],
      "evidence": [{{"start": 0, "end": 0, "quote": "", "note": ""}}]
    }}
  ]
}}

Include every speaker from the factual metrics. Scores are 0-100.
""".strip()

    try:
        content = chat(
            [{"role": "user", "content": prompt}],
            transcript_id=transcript_id,
            max_tokens=2200,
        )
        parsed = _extract_json(content) or {}
        by_speaker = {
            str(item.get("speaker")): item
            for item in (parsed.get("participants") or [])
            if isinstance(item, dict)
        }
    except Exception as exc:  # noqa: BLE001
        return _from_facts(facts, f"Performance LLM failed: {exc}")

    now = datetime.now(timezone.utc).isoformat()
    weights = load_weights()
    rows: list[ParticipantPerformanceAnalysis] = []
    for fact in facts:
        raw = by_speaker.get(str(fact["speaker"]), {})
        score_map = {key: _score_block(raw.get(key)) for key in SCORE_KEYS}
        numeric = {key: score_map[key].score for key in SCORE_KEYS}
        role = str(fact.get("participantRole") or "unknown")
        rows.append(
            ParticipantPerformanceAnalysis(
                speaker=str(fact["speaker"]),
                participantRole=role,
                presentation="performance" if role == "agent" else "interaction",
                displayName=fact.get("displayName"),
                available=bool(raw),
                note=None if raw else "No model output for this speaker.",
                overallScore=weighted_overall(numeric, weights) if raw else None,
                scores=score_map if raw else {},
                strengths=_strings(raw.get("strengths")),
                improvements=_strings(raw.get("improvements")),
                recommendations=_strings(raw.get("recommendations")),
                evidence=_score_block({"evidence": raw.get("evidence")}).evidence,
                analysisVersion=ANALYSIS_VERSION,
                weights=dict(weights),
                createdAt=now,
                updatedAt=now,
                totalTalkDuration=float(fact.get("totalTalkDuration") or 0),
                talkPercentage=float(fact.get("talkPercentage") or 0),
                speakingTurnCount=int(fact.get("speakingTurnCount") or 0),
                averageTurnDuration=float(fact.get("averageTurnDuration") or 0),
                longestTurnDuration=float(fact.get("longestTurnDuration") or 0),
                shortResponseCount=int(fact.get("shortResponseCount") or 0),
                longMonologueCount=int(fact.get("longMonologueCount") or 0),
                questionCount=int(fact.get("questionCount") or 0),
                averageResponseTime=fact.get("averageResponseTime"),
                interruptionCount=int(fact.get("interruptionCount") or 0),
                interruptedByOthersCount=int(fact.get("interruptedByOthersCount") or 0),
                repeatedQuestions=int(fact.get("repeatedQuestions") or 0),
                repeatedStatements=int(fact.get("repeatedStatements") or 0),
            )
        )
    return rows
