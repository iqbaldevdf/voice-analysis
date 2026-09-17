"""Map AssemblyAI diarization labels (A/B/…) to agent and customer roles."""

from __future__ import annotations

import os
import re
from typing import Any

from app.schemas import DiarizedUtterance, SpeakerMapping, SpeakerMappingSignal

MIN_CONFIDENCE = float(os.getenv("SPEAKER_MAP_MIN_CONFIDENCE", "0.6"))

_INTRO_PHRASES = (
    "datafortune",
    "data fortune",
    "ai-first",
    "ai first",
    "calling from",
    "my name is",
    "engineering solutions",
)

# "This is [name]" at answer is usually the callee identifying themselves — not an agent opener.
_CUSTOMER_SELF_ID_RE = re.compile(
    r"\b(this is|speaking|it'?s)\s+[a-z]",
    re.IGNORECASE,
)

_AGENT_VERIFY_RE = re.compile(
    r"\b("
    r"is this (mr|ms|mrs|miss)|"
    r"am i speaking with|"
    r"may i speak with|"
    r"hello,? is this|"
    r"hi,? is this"
    r")\b",
    re.IGNORECASE,
)

_AGENT_OUTREACH_RE = re.compile(
    r"\b("
    r"looking into your company|"
    r"reaching out|"
    r"i was (just )?calling|"
    r"i'?m calling (from|about|in regards)|"
    r"calling in regards|"
    r"wanted to (talk|discuss|share|reach)|"
    r"quick call about|"
    r"reason for my call"
    r")\b",
    re.IGNORECASE,
)

_CUSTOMER_DEFLECTION_RE = re.compile(
    r"\b("
    r"what'?s (this|the call) (about|regarding)|"
    r"what is this (about|regarding)|"
    r"where are you calling from|"
    r"super busy|"
    r"busy at work|"
    r"i'?m busy|"
    r"can'?t take (this|the) call|"
    r"don'?t have time|"
    r"not interested|"
    r"not really looking|"
    r"one man show|"
    r"call me back"
    r")\b",
    re.IGNORECASE,
)

_AGENT_SELF_INTRO_RE = re.compile(
    r"\b(it'?s|i'?m|i am|my name is)\s+[a-z]",
    re.IGNORECASE,
)

# Words after "I'm / it's" that are not personal names (avoids "I'm doing fine" → agent).
_NON_NAME_INTRO_WORDS = frozenset(
    {
        "a",
        "an",
        "at",
        "being",
        "busy",
        "calling",
        "doing",
        "fine",
        "good",
        "great",
        "here",
        "just",
        "looking",
        "not",
        "okay",
        "ok",
        "really",
        "sorry",
        "sure",
        "the",
        "trying",
        "well",
        "working",
    }
)

_CALL_SCREENING_RE = re.compile(
    r"\b("
    r"record your name|"
    r"reason for calling|"
    r"see if this person is available|"
    r"please stay on the line|"
    r"person is not available|"
    r"leave a message after the tone"
    r")\b",
    re.IGNORECASE,
)

_AGENT_CALLING_FROM_RE = re.compile(
    r"\b(calling you from|calling from|i'?m calling you from)\b",
    re.IGNORECASE,
)

_AGENT_ROLE_HINTS = ("agent", "user", "rep", "representative", "executive")
_CUSTOMER_ROLE_HINTS = ("customer", "client", "caller", "contact")


def _talk_seconds(utterances: list[DiarizedUtterance]) -> dict[str, float]:
    totals: dict[str, float] = {}
    for utterance in utterances:
        totals[utterance.speaker] = totals.get(utterance.speaker, 0.0) + max(
            0.0, utterance.end - utterance.start
        )
    return totals


def _normalize_name(value: str) -> str:
    return re.sub(r"\s+", " ", value.strip().lower())


def _is_screening_utterance(text: str) -> bool:
    return bool(_CALL_SCREENING_RE.search(text))


def _mapping_utterances(utterances: list[DiarizedUtterance]) -> list[DiarizedUtterance]:
    """Drop automated call-screening / voicemail prompts from role heuristics."""
    return [u for u in utterances if not _is_screening_utterance(u.text)]


def _first_substantive_speaker(utterances: list[DiarizedUtterance], min_words: int = 2) -> str | None:
    for utterance in _mapping_utterances(utterances):
        if len(utterance.text.split()) >= min_words:
            return utterance.speaker
    return utterances[0].speaker if utterances else None


def _similar_first_name(spoken: str, expected: str) -> bool:
    spoken = _normalize_name(spoken)
    expected = _normalize_name(expected)
    if not spoken or not expected:
        return False
    if spoken == expected or spoken in expected or expected in spoken:
        return True
    if len(spoken) >= 3 and len(expected) >= 3 and spoken[:3] == expected[:3]:
        return True
    return len(spoken) >= 2 and len(expected) >= 2 and spoken[:2] == expected[:2]


def _score_agent_greets_customer(
    utterances: list[DiarizedUtterance],
    customer_names: list[str],
    window_sec: float = 120.0,
) -> dict[str, float]:
    """Outbound agent often opens with 'Hi Jaydon, …'."""
    scores: dict[str, float] = {}
    customer_first = _first_names(customer_names)
    if not customer_first:
        return scores
    greet_re = re.compile(r"\bhi,?\s+([a-z][a-z'-]+)", re.IGNORECASE)
    for utterance in utterances:
        if utterance.start > window_sec:
            break
        match = greet_re.search(utterance.text)
        if not match:
            continue
        spoken = match.group(1).lower()
        if any(_similar_first_name(spoken, first) for first in customer_first):
            scores[utterance.speaker] = scores.get(utterance.speaker, 0.0) + 0.55
    return scores


def _first_names(names: list[str]) -> list[str]:
    result: list[str] = []
    for name in names:
        normalized = _normalize_name(name)
        if not normalized:
            continue
        first = normalized.split()[0]
        if len(first) >= 3:
            result.append(first)
    return result


def _score_name_mentions(
    utterances: list[DiarizedUtterance],
    names: list[str],
    window_sec: float = 120.0,
) -> dict[str, float]:
    scores: dict[str, float] = {}
    normalized_names = [_normalize_name(name) for name in names if name and name.strip()]
    if not normalized_names:
        return scores
    for utterance in utterances:
        if utterance.start > window_sec:
            break
        text = _normalize_name(utterance.text)
        for name in normalized_names:
            if not name:
                continue
            if name in text:
                scores[utterance.speaker] = scores.get(utterance.speaker, 0.0) + 1.0
            first = name.split()[0]
            if len(first) >= 4 and first in text:
                scores[utterance.speaker] = scores.get(utterance.speaker, 0.0) + 0.5
    return scores


def _name_in_customer_list(name: str, customer_first: list[str]) -> bool:
    lowered = _normalize_name(name)
    if not lowered:
        return False
    return any(
        lowered == first or lowered in first or first in lowered
        for first in customer_first
    )


def _score_self_identification(
    utterances: list[DiarizedUtterance],
    *,
    customer_names: list[str],
    agent_names: list[str],
    window_sec: float = 90.0,
) -> tuple[dict[str, float], dict[str, float]]:
    """Detect 'This is Corey' (customer) vs 'It's Shaurya' (agent)."""
    agent_scores: dict[str, float] = {}
    customer_scores: dict[str, float] = {}
    customer_first = _first_names(customer_names)
    agent_first = _first_names(agent_names)

    for utterance in utterances:
        if utterance.start > window_sec:
            break
        text = _normalize_name(utterance.text)

        this_is = re.search(r"\bthis is\s+([a-z][a-z'-]+)", text)
        if this_is and _name_in_customer_list(this_is.group(1), customer_first):
            customer_scores[utterance.speaker] = customer_scores.get(utterance.speaker, 0.0) + 0.5

        intro = re.search(r"\b(it'?s|i'?m|i am)\s+([a-z][a-z'-]+)", text)
        if intro:
            intro_name = intro.group(2)
            if intro_name in _NON_NAME_INTRO_WORDS:
                continue
            if _name_in_customer_list(intro_name, customer_first):
                continue
            if any(
                intro_name == first or intro_name in first or first in intro_name
                for first in agent_first
            ):
                agent_scores[utterance.speaker] = agent_scores.get(utterance.speaker, 0.0) + 0.45
            elif len(intro_name) >= 3 and not _name_in_customer_list(intro_name, customer_first):
                # Transcript spelling may differ from CRM name (Shaurya vs Shourya).
                agent_scores[utterance.speaker] = agent_scores.get(utterance.speaker, 0.0) + 0.35

    return agent_scores, customer_scores


def _score_intro_phrases(utterances: list[DiarizedUtterance], window_sec: float = 150.0) -> dict[str, float]:
    scores: dict[str, float] = {}
    for utterance in utterances:
        if utterance.start > window_sec:
            break
        text = _normalize_name(utterance.text)
        hits = sum(1 for phrase in _INTRO_PHRASES if phrase in text)
        if hits:
            scores[utterance.speaker] = scores.get(utterance.speaker, 0.0) + float(hits)
    return scores


def _score_pattern(
    utterances: list[DiarizedUtterance],
    pattern: re.Pattern[str],
    window_sec: float = 180.0,
) -> dict[str, float]:
    scores: dict[str, float] = {}
    for utterance in utterances:
        if utterance.start > window_sec:
            break
        if pattern.search(utterance.text):
            scores[utterance.speaker] = scores.get(utterance.speaker, 0.0) + 1.0
    return scores


def _participant_name_hints(participants: list[dict[str, Any]]) -> tuple[list[str], list[str]]:
    agent_names: list[str] = []
    customer_names: list[str] = []
    for participant in participants:
        role = str(participant.get("role") or "").lower()
        name = str(participant.get("name") or "").strip()
        if not name:
            continue
        if any(hint in role for hint in _AGENT_ROLE_HINTS):
            agent_names.append(name)
        elif any(hint in role for hint in _CUSTOMER_ROLE_HINTS):
            customer_names.append(name)
    return agent_names, customer_names


def map_speakers(
    utterances: list[DiarizedUtterance],
    context: dict[str, Any] | None = None,
    speaker_override: dict[str, str] | None = None,
) -> SpeakerMapping:
    """Return agent/customer mapping for diarization speaker ids."""
    context = context or {}
    speakers = sorted({u.speaker for u in utterances})
    if not speakers:
        return SpeakerMapping(
            mapping={},
            confidence=0.0,
            method="none",
            mapping_uncertain=True,
            agent_speaker=None,
            customer_speaker=None,
        )

    if len(speakers) == 1:
        return SpeakerMapping(
            mapping={speakers[0]: "agent"},
            confidence=0.5,
            method="single_speaker",
            mapping_uncertain=True,
            agent_speaker=speakers[0],
            customer_speaker=None,
            signals=[],
        )

    if speaker_override:
        normalized: dict[str, str] = {}
        for speaker in speakers:
            role = str(speaker_override.get(speaker, "unknown")).lower()
            if role not in {"agent", "customer", "unknown", "bot"}:
                role = "unknown"
            normalized[speaker] = role
        agent_speaker = next((s for s, r in normalized.items() if r == "agent"), None)
        customer_speaker = next((s for s, r in normalized.items() if r == "customer"), None)
        return SpeakerMapping(
            mapping=normalized,
            confidence=1.0,
            method="user_override",
            mapping_uncertain=False,
            agent_speaker=agent_speaker,
            customer_speaker=customer_speaker,
            signals=[
                SpeakerMappingSignal(
                    signal="user_override",
                    winner=agent_speaker or "",
                    weight=1.0,
                    detail="manual speaker role assignment",
                )
            ],
        )

    mapping_utterances = _mapping_utterances(utterances)
    scoring_utterances = mapping_utterances if mapping_utterances else utterances

    talk = _talk_seconds(utterances)
    ordered = sorted(speakers, key=lambda speaker: talk.get(speaker, 0.0), reverse=True)
    customer_candidate = ordered[1] if len(ordered) > 1 else ordered[0]

    agent_scores: dict[str, float] = {speaker: 0.0 for speaker in speakers}
    customer_scores: dict[str, float] = {speaker: 0.0 for speaker in speakers}
    signals: list[SpeakerMappingSignal] = []

    # Talk-time is a weak tie-breaker only (customers often talk more on cold calls).
    talk_winner = max(talk, key=talk.get)
    agent_scores[talk_winner] += 0.1
    signals.append(
        SpeakerMappingSignal(signal="talk_time", winner=talk_winner, weight=0.1, detail="more talk time")
    )

    direction = str(context.get("direction") or "").lower()
    first_speaker = _first_substantive_speaker(utterances)
    if first_speaker and mapping_utterances:
        if direction == "outgoing":
            # Outbound: callee usually answers first ("Hello?").
            customer_scores[first_speaker] += 0.35
            signals.append(
                SpeakerMappingSignal(
                    signal="direction_outgoing_answer",
                    winner=first_speaker,
                    weight=0.35,
                    detail="outgoing call — first speaker often customer answering",
                )
            )
        elif direction == "incoming":
            customer_scores[first_speaker] += 0.25
            signals.append(
                SpeakerMappingSignal(
                    signal="direction_incoming_caller",
                    winner=first_speaker,
                    weight=0.25,
                    detail="incoming call — first speaker often customer",
                )
            )

    participants = context.get("participants") if isinstance(context.get("participants"), list) else []
    agent_names, customer_names = _participant_name_hints(participants)
    agent_name = str(context.get("agentName") or "").strip()
    if agent_name:
        agent_names.append(agent_name)

    # Self-identification: "This is Corey" vs "It's Shaurya from …".
    self_agent, self_customer = _score_self_identification(
        scoring_utterances,
        customer_names=customer_names,
        agent_names=agent_names,
    )
    if self_customer:
        winner = max(self_customer, key=self_customer.get)
        customer_scores[winner] += self_customer[winner]
        signals.append(
            SpeakerMappingSignal(
                signal="customer_self_identification",
                winner=winner,
                weight=self_customer[winner],
                detail="customer introduced themselves by name",
            )
        )
    if self_agent:
        winner = max(self_agent, key=self_agent.get)
        agent_scores[winner] += self_agent[winner]
        signals.append(
            SpeakerMappingSignal(
                signal="agent_self_introduction",
                winner=winner,
                weight=self_agent[winner],
                detail="agent introduced themselves by name",
            )
        )

    # Agent company / scripted opener (excludes bare "this is").
    intro_hits = _score_intro_phrases(scoring_utterances)
    if intro_hits:
        intro_winner = max(intro_hits, key=intro_hits.get)
        agent_scores[intro_winner] += 0.35
        signals.append(
            SpeakerMappingSignal(
                signal="scripted_opener",
                winner=intro_winner,
                weight=0.35,
                detail="company intro phrases",
            )
        )

    calling_from_hits = _score_pattern(scoring_utterances, _AGENT_CALLING_FROM_RE)
    if calling_from_hits:
        calling_winner = max(calling_from_hits, key=calling_from_hits.get)
        agent_scores[calling_winner] += 0.55
        signals.append(
            SpeakerMappingSignal(
                signal="calling_from_company",
                winner=calling_winner,
                weight=0.55,
                detail="calling you from [company]",
            )
        )

    greet_hits = _score_agent_greets_customer(scoring_utterances, customer_names)
    if greet_hits:
        greet_winner = max(greet_hits, key=greet_hits.get)
        agent_scores[greet_winner] += greet_hits[greet_winner]
        signals.append(
            SpeakerMappingSignal(
                signal="agent_greets_customer",
                winner=greet_winner,
                weight=greet_hits[greet_winner],
                detail="opened with customer first name",
            )
        )

    # Agent asks to verify customer identity ("Is this Mr. Olivier?").
    verify_hits = _score_pattern(scoring_utterances, _AGENT_VERIFY_RE)
    if verify_hits:
        verify_winner = max(verify_hits, key=verify_hits.get)
        agent_scores[verify_winner] += 0.45
        signals.append(
            SpeakerMappingSignal(
                signal="identity_verification",
                winner=verify_winner,
                weight=0.45,
                detail="asks to verify customer name",
            )
        )

    # Customer name mentioned in opening — speaker asking is usually agent.
    customer_name_hits = _score_name_mentions(scoring_utterances, customer_names)
    if customer_name_hits:
        name_winner = max(customer_name_hits, key=customer_name_hits.get)
        agent_scores[name_winner] += 0.3
        signals.append(
            SpeakerMappingSignal(
                signal="customer_name_in_question",
                winner=name_winner,
                weight=0.3,
                detail="customer name used in opening turns",
            )
        )

    # Agent outreach / pitch language.
    outreach_hits = _score_pattern(scoring_utterances, _AGENT_OUTREACH_RE)
    if outreach_hits:
        outreach_winner = max(outreach_hits, key=outreach_hits.get)
        agent_scores[outreach_winner] += 0.35
        signals.append(
            SpeakerMappingSignal(
                signal="sales_outreach",
                winner=outreach_winner,
                weight=0.35,
                detail="outreach or pitch phrasing",
            )
        )

    # Customer pushback / deflection.
    deflection_hits = _score_pattern(scoring_utterances, _CUSTOMER_DEFLECTION_RE)
    if deflection_hits:
        deflection_winner = max(deflection_hits, key=deflection_hits.get)
        customer_scores[deflection_winner] += 0.35
        signals.append(
            SpeakerMappingSignal(
                signal="customer_deflection",
                winner=deflection_winner,
                weight=0.35,
                detail="busy / what's this about / not interested",
            )
        )

    # Agent name mentioned by someone else (weak customer signal on that speaker).
    agent_name_hits = _score_name_mentions(scoring_utterances, agent_names)
    if agent_name_hits:
        for speaker, hits in agent_name_hits.items():
            customer_scores[speaker] += hits * 0.1

    agent_speaker = max(agent_scores, key=agent_scores.get)
    remaining = [speaker for speaker in speakers if speaker != agent_speaker]
    customer_speaker = (
        max(remaining, key=lambda speaker: customer_scores.get(speaker, 0.0))
        if remaining
        else customer_candidate
    )

    # If customer evidence strongly favors the current agent pick, swap.
    if (
        customer_scores.get(agent_speaker, 0.0) > agent_scores.get(agent_speaker, 0.0)
        and customer_scores.get(customer_speaker, 0.0) >= agent_scores.get(customer_speaker, 0.0)
    ):
        agent_speaker, customer_speaker = customer_speaker, agent_speaker
        signals.append(
            SpeakerMappingSignal(
                signal="role_swap",
                winner=agent_speaker,
                weight=0.0,
                detail="customer signals dominated prior agent pick",
            )
        )

    mapping = {agent_speaker: "agent", customer_speaker: "customer"}
    for speaker in speakers:
        if speaker not in mapping:
            mapping[speaker] = "unknown"

    confidence = min(
        1.0,
        max(agent_scores[agent_speaker], customer_scores.get(customer_speaker, 0.0)),
    )
    uncertain = confidence < MIN_CONFIDENCE or len(speakers) > 2

    return SpeakerMapping(
        mapping=mapping,
        confidence=round(confidence, 2),
        method="weighted_signals",
        mapping_uncertain=uncertain,
        agent_speaker=agent_speaker,
        customer_speaker=customer_speaker,
        signals=signals,
    )
