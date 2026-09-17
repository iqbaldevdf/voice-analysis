"""Tag bot / IVR turns on bot-involved calls (F09 Phase 2)."""

from __future__ import annotations

import re
from typing import Any

from app.schemas import BotSegment, DiarizedUtterance, SpeakerMapping

# Conservative IVR / auto-attendant style phrases (Freshcaller bot / queue).
_BOT_PHRASE_RE = re.compile(
    r"\b("
    r"please hold|"
    r"please wait|"
    r"hold the line|"
    r"connecting you|"
    r"transferring (you|your call)|"
    r"your call is important|"
    r"press \d|"
    r"press one|"
    r"press two|"
    r"for (sales|support|billing)|"
    r"leave a message|"
    r"after the (tone|beep)|"
    r"automated (message|assistant)|"
    r"virtual assistant|"
    r"this (call|conversation) may be recorded|"
    r"thank you for calling"
    r")\b",
    re.IGNORECASE,
)

# Human agent cues used to mark handoff out of the bot/IVR block.
_AGENT_HANDOFF_RE = re.compile(
    r"\b("
    r"my name is|"
    r"this is \w+ (from|calling)|"
    r"calling from|"
    r"how (can|may) i help|"
    r"how are you|"
    r"am i speaking with|"
    r"is this (mr|ms|mrs)|"
    r"reaching out|"
    r"reason for (my|the) call"
    r")\b",
    re.IGNORECASE,
)

_OPENING_WINDOW_SEC = 90.0


def _bot_involved(context: dict[str, Any]) -> bool:
    handling = str(context.get("botHandling") or "none").lower()
    if handling in {"bot_only", "bot_transferred"}:
        return True
    if context.get("isBotInvolved") is True:
        return True
    participants = context.get("participants") if isinstance(context.get("participants"), list) else []
    for participant in participants:
        if not isinstance(participant, dict):
            continue
        role = str(participant.get("role") or "").lower()
        if "bot" in role:
            return True
    return False


def _handling(context: dict[str, Any]) -> str:
    handling = str(context.get("botHandling") or "none").lower()
    if handling in {"bot_only", "bot_transferred"}:
        return handling
    if _bot_involved(context):
        return "bot_transferred"
    return "none"


def looks_like_bot_text(text: str) -> bool:
    return bool(_BOT_PHRASE_RE.search(text or ""))


def looks_like_agent_handoff(text: str) -> bool:
    return bool(_AGENT_HANDOFF_RE.search(text or ""))


def tag_bot_utterances(
    utterances: list[DiarizedUtterance],
    role_map: dict[str, str],
    speaker_mapping: SpeakerMapping,
    context: dict[str, Any] | None = None,
) -> tuple[list[str], BotSegment, dict[str, str]]:
    """
    Return per-utterance roles, bot_segment summary, and updated speaker role_map.

    When the call is not bot-involved, roles follow role_map unchanged.
    """
    context = context or {}
    base_roles = [role_map.get(u.speaker, "unknown") for u in utterances]
    updated_map = dict(role_map)

    if not utterances or not _bot_involved(context):
        return (
            base_roles,
            BotSegment(involved=False, handling="none", method="none"),
            updated_map,
        )

    handling = _handling(context)
    agent_speaker = speaker_mapping.agent_speaker
    customer_speaker = speaker_mapping.customer_speaker
    speakers = sorted({u.speaker for u in utterances})

    # Path 1: third (or more) diarization speaker → map leftover speaker(s) to bot.
    if len(speakers) >= 3 and agent_speaker and customer_speaker:
        extras = [s for s in speakers if s not in {agent_speaker, customer_speaker}]
        if extras:
            bot_speaker = extras[0]
            updated_map[bot_speaker] = "bot"
            for extra in extras[1:]:
                updated_map.setdefault(extra, "unknown")
            roles = [updated_map.get(u.speaker, "unknown") for u in utterances]
            bot_ends = [u.end for u, role in zip(utterances, roles) if role == "bot"]
            handoff = None
            for u, role in zip(utterances, roles):
                if role == "agent" and bot_ends and u.start >= max(bot_ends):
                    handoff = round(u.start, 2)
                    break
            return (
                roles,
                BotSegment(
                    involved=True,
                    handling=handling,  # type: ignore[arg-type]
                    handoff_sec=handoff,
                    confidence=0.75,
                    method="third_speaker",
                    bot_speaker=bot_speaker,
                    tagged_utterance_count=sum(1 for r in roles if r == "bot"),
                ),
                updated_map,
            )

    # Path 2: script + opening window (typical bot→agent with A/B only).
    roles = list(base_roles)
    tagged = 0
    last_bot_end: float | None = None

    for idx, utterance in enumerate(utterances):
        role = roles[idx]
        text = utterance.text or ""
        in_opening = utterance.start <= _OPENING_WINDOW_SEC
        if role == "customer":
            continue
        if looks_like_bot_text(text) and (in_opening or role == "agent"):
            roles[idx] = "bot"
            tagged += 1
            last_bot_end = utterance.end
            continue
        # Early agent turns before any handoff cue, still in opening, short IVR-ish.
        if (
            in_opening
            and role == "agent"
            and last_bot_end is not None
            and utterance.start <= (last_bot_end + 8.0)
            and len(text.split()) <= 18
            and not looks_like_agent_handoff(text)
        ):
            roles[idx] = "bot"
            tagged += 1
            last_bot_end = utterance.end

    handoff_sec = None
    for utterance, role in zip(utterances, roles):
        if role == "agent" and looks_like_agent_handoff(utterance.text or ""):
            handoff_sec = round(utterance.start, 2)
            break
    if handoff_sec is None and last_bot_end is not None:
        for utterance, role in zip(utterances, roles):
            if role == "agent" and utterance.start >= last_bot_end:
                handoff_sec = round(utterance.start, 2)
                break

    # If we tagged opening agent lines as bot, mark mapping uncertain note via method.
    confidence = 0.65 if tagged else 0.4
    method = "script_plus_handoff" if tagged else "bot_flag_only"

    return (
        roles,
        BotSegment(
            involved=True,
            handling=handling,  # type: ignore[arg-type]
            handoff_sec=handoff_sec,
            confidence=confidence,
            method=method,
            bot_speaker=None,
            tagged_utterance_count=tagged,
        ),
        updated_map,
    )
