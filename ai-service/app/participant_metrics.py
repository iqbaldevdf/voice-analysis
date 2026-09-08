from __future__ import annotations

import re
from typing import Any

from app.performance_weights import LONG_MONOLOGUE_SEC, SHORT_TURN_SEC
from app.schemas import DiarizedUtterance

QUESTION_START = re.compile(
    r"^(what|why|how|when|where|who|which|can|could|would|will|do|does|did|is|are|was|were)\b",
    re.I,
)


def _tokens(text: str) -> set[str]:
    return {token for token in re.findall(r"[a-z0-9']+", text.lower()) if len(token) > 2}


def _similar(left_text: str, right_text: str) -> bool:
    left, right = _tokens(left_text), _tokens(right_text)
    if not left or not right:
        return False
    overlap = len(left & right) / max(1, min(len(left), len(right)))
    return overlap >= 0.72


def _is_question(text: str) -> bool:
    stripped = text.strip()
    return "?" in stripped or bool(QUESTION_START.match(stripped))


def compute_participant_facts(utterances: list[DiarizedUtterance]) -> list[dict[str, Any]]:
    """Deterministic conversation metrics. Does not judge quality from talk percentage."""
    if not utterances:
        return []

    ordered = sorted(utterances, key=lambda item: (item.start, item.end))
    speakers: list[str] = []
    for utterance in ordered:
        if utterance.speaker not in speakers:
            speakers.append(utterance.speaker)

    turns: dict[str, list[dict[str, Any]]] = {speaker: [] for speaker in speakers}
    response_gaps: dict[str, list[float]] = {speaker: [] for speaker in speakers}
    interruptions_made = {speaker: 0 for speaker in speakers}
    interrupted_by = {speaker: 0 for speaker in speakers}

    for index, utterance in enumerate(ordered):
        duration = max(0.0, utterance.end - utterance.start)
        turns[utterance.speaker].append(
            {
                "duration": duration,
                "text": utterance.text,
                "question": _is_question(utterance.text),
            }
        )
        if index == 0:
            continue
        previous = ordered[index - 1]
        if previous.speaker == utterance.speaker:
            continue
        overlap = previous.end - utterance.start
        if overlap > 0.05:
            interruptions_made[utterance.speaker] += 1
            interrupted_by[previous.speaker] += 1
        else:
            gap = utterance.start - previous.end
            if gap >= 0:
                response_gaps[utterance.speaker].append(gap)

    total_talk = sum(max(0.0, item.end - item.start) for item in ordered) or 1.0
    facts: list[dict[str, Any]] = []

    for speaker in speakers:
        own = turns[speaker]
        durations = [turn["duration"] for turn in own]
        talk = sum(durations)
        repeated_questions = 0
        repeated_statements = 0
        for index in range(1, len(own)):
            same = _similar(own[index]["text"], own[index - 1]["text"])
            if not same:
                continue
            if own[index]["question"] and own[index - 1]["question"]:
                repeated_questions += 1
            elif not own[index]["question"]:
                repeated_statements += 1

        gaps = response_gaps[speaker]
        facts.append(
            {
                "speaker": speaker,
                "totalTalkDuration": round(talk, 2),
                "talkPercentage": round(100.0 * talk / total_talk, 1),
                "speakingTurnCount": len(own),
                "averageTurnDuration": round(talk / len(own), 2) if own else 0.0,
                "longestTurnDuration": round(max(durations) if durations else 0.0, 2),
                "shortResponseCount": sum(1 for duration in durations if duration < SHORT_TURN_SEC),
                "longMonologueCount": sum(1 for duration in durations if duration >= LONG_MONOLOGUE_SEC),
                "questionCount": sum(1 for turn in own if turn["question"]),
                "averageResponseTime": round(sum(gaps) / len(gaps), 2) if gaps else None,
                "interruptionCount": interruptions_made[speaker],
                "interruptedByOthersCount": interrupted_by[speaker],
                "repeatedQuestions": repeated_questions,
                "repeatedStatements": repeated_statements,
            }
        )
    return facts
