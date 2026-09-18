"""Tag bot / IVR turns (F09 Phase 2 Freshcaller + Phase 3 script inference)."""

from __future__ import annotations

import re
from typing import Any, Literal

from app.schemas import BotSegment, DiarizedUtterance, SpeakerMapping

# Conservative IVR / auto-attendant / AI-assistant style phrases.
_BOT_PHRASE_RE = re.compile(
    r"\b("
    r"please hold|"
    r"please wait|"
    r"hold the line|"
    r"connecting you|"
    r"transferring (you|your call)|"
    r"your call is important|"
    r"press \d|"
    r"press (one|two|three|four|five|six|seven|eight|nine|zero|star|start)|"
    r"for (sales|support|billing|all others)|"
    r"leave a message|"
    r"after the (tone|beep)|"
    r"automated (message|assistant|system)|"
    r"virtual assistant|"
    r"this (call|conversation) may be (monitored|recorded)|"
    r"calls? may be (monitored|recorded)|"
    r"monitored or recorded|"
    r"quality and training|"
    r"thank you for calling|"
    r"thank you for your call|"
    r"debt collector|"
    r"record your name|"
    r"reason for calling|"
    r"this person is available|"
    r"previous menu|"
    r"main menu|"
    r"para espanol|"
    r"visit our website|"
    r"unable to verify|"
    r"press pound|"
    r"enter your (account|phone|pin)"
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
Handling = Literal["none", "bot_only", "bot_transferred"]


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


def _handling(context: dict[str, Any]) -> Handling:
    handling = str(context.get("botHandling") or "none").lower()
    if handling in {"bot_only", "bot_transferred"}:
        return handling  # type: ignore[return-value]
    if _bot_involved(context):
        return "bot_transferred"
    return "none"


def looks_like_bot_text(text: str) -> bool:
    return bool(_BOT_PHRASE_RE.search(text or ""))


def bot_phrase_hit_count(text: str) -> int:
    return len(_BOT_PHRASE_RE.findall(text or ""))


def looks_like_agent_handoff(text: str) -> bool:
    return bool(_AGENT_HANDOFF_RE.search(text or ""))


def script_suggests_bot(utterances: list[DiarizedUtterance]) -> bool:
    """True when transcript looks like IVR / automated assistant (no Freshcaller required)."""
    if not utterances:
        return False
    hits = [(u, bot_phrase_hit_count(u.text or "")) for u in utterances]
    total_hits = sum(n for _, n in hits)
    if total_hits <= 0:
        return False
    # Dense IVR monologue (e.g. menu tree on one speaker).
    if len(utterances) == 1 and hits[0][1] >= 2:
        return True
    if total_hits >= 2:
        return True
    # Single strong cue in the opening window.
    for utterance, n in hits:
        if n >= 1 and utterance.start <= _OPENING_WINDOW_SEC:
            return True
    return False


def _apply_script_tags(
    utterances: list[DiarizedUtterance],
    base_roles: list[str],
) -> tuple[list[str], int, float | None]:
    roles = list(base_roles)
    tagged = 0
    last_bot_end: float | None = None

    for idx, utterance in enumerate(utterances):
        role = roles[idx]
        text = utterance.text or ""
        in_opening = utterance.start <= _OPENING_WINDOW_SEC
        if role == "customer":
            continue
        if looks_like_bot_text(text) and (in_opening or role == "agent" or role == "unknown"):
            roles[idx] = "bot"
            tagged += 1
            last_bot_end = utterance.end
            continue
        # Early agent turns before handoff cue, still in opening, short IVR-ish.
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

    # Single-speaker IVR: if the only voice is bot-like, tag the whole block.
    speakers = {u.speaker for u in utterances}
    if len(speakers) == 1 and tagged == 0 and script_suggests_bot(utterances):
        roles = ["bot"] * len(utterances)
        tagged = len(utterances)
        last_bot_end = utterances[-1].end
    elif len(speakers) == 1 and tagged >= 1 and all(
        looks_like_bot_text(u.text or "") or roles[i] == "bot" for i, u in enumerate(utterances)
    ):
        # Monologue already matched; ensure every turn is bot.
        roles = ["bot"] * len(utterances)
        tagged = len(utterances)
        last_bot_end = utterances[-1].end

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

    return roles, tagged, handoff_sec


def _infer_handling(
    *,
    freshcaller: Handling,
    roles: list[str],
    handoff_sec: float | None,
    tagged: int,
) -> Handling:
    if freshcaller != "none":
        return freshcaller
    if tagged <= 0:
        return "none"
    if handoff_sec is not None and any(r == "agent" for r in roles):
        return "bot_transferred"
    if tagged == len(roles) or not any(r == "agent" for r in roles):
        return "bot_only"
    return "bot_transferred"


def tag_bot_utterances(
    utterances: list[DiarizedUtterance],
    role_map: dict[str, str],
    speaker_mapping: SpeakerMapping,
    context: dict[str, Any] | None = None,
) -> tuple[list[str], BotSegment, dict[str, str]]:
    """
    Return per-utterance roles, bot_segment summary, and updated speaker role_map.

    Freshcaller bot flags still preferred. When absent, Phase 3 may tag from IVR/script cues.
    """
    context = context or {}
    base_roles = [role_map.get(u.speaker, "unknown") for u in utterances]
    updated_map = dict(role_map)
    freshcaller = _handling(context)
    freshcaller_bot = freshcaller != "none" or _bot_involved(context)

    if not utterances:
        return (
            base_roles,
            BotSegment(involved=False, handling="none", method="none"),
            updated_map,
        )

    agent_speaker = speaker_mapping.agent_speaker
    customer_speaker = speaker_mapping.customer_speaker
    speakers = sorted({u.speaker for u in utterances})

    # Path 1: third diarization speaker — only when Freshcaller says bot involved.
    if freshcaller_bot and len(speakers) >= 3 and agent_speaker and customer_speaker:
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
                    handling=freshcaller if freshcaller != "none" else "bot_transferred",
                    handoff_sec=handoff,
                    confidence=0.75,
                    method="third_speaker",
                    bot_speaker=bot_speaker,
                    tagged_utterance_count=sum(1 for r in roles if r == "bot"),
                ),
                updated_map,
            )

    # Path 2: script + opening window (Freshcaller bot OR script-inferred IVR/AI).
    if not freshcaller_bot and not script_suggests_bot(utterances):
        return (
            base_roles,
            BotSegment(involved=False, handling="none", method="none"),
            updated_map,
        )

    roles, tagged, handoff_sec = _apply_script_tags(utterances, base_roles)
    handling = _infer_handling(
        freshcaller=freshcaller if freshcaller_bot else "none",
        roles=roles,
        handoff_sec=handoff_sec,
        tagged=tagged,
    )

    if tagged <= 0 and freshcaller_bot:
        return (
            base_roles,
            BotSegment(
                involved=True,
                handling=handling,
                handoff_sec=None,
                confidence=0.4,
                method="bot_flag_only",
                bot_speaker=None,
                tagged_utterance_count=0,
            ),
            updated_map,
        )

    if tagged <= 0:
        return (
            base_roles,
            BotSegment(involved=False, handling="none", method="none"),
            updated_map,
        )

    # Single-speaker bot: update role map so remap/UI treat speaker as bot.
    if agent_speaker and all(r == "bot" for r in roles):
        updated_map[agent_speaker] = "bot"

    method = "script_plus_handoff" if freshcaller_bot else "script_inferred"
    confidence = 0.7 if not freshcaller_bot else (0.65 if tagged else 0.4)
    if len(utterances) == 1 and bot_phrase_hit_count(utterances[0].text or "") >= 3:
        confidence = max(confidence, 0.85)

    return (
        roles,
        BotSegment(
            involved=True,
            handling=handling,
            handoff_sec=handoff_sec,
            confidence=confidence,
            method=method,
            bot_speaker=agent_speaker if all(r == "bot" for r in roles) else None,
            tagged_utterance_count=tagged,
        ),
        updated_map,
    )
