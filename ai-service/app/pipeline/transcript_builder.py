"""Build role-aware transcripts for LLM prompts and UI."""

from __future__ import annotations

from app.schemas import DiarizedUtterance, TranscriptDisplayLine


def role_label(speaker: str, role_map: dict[str, str]) -> str:
    return role_map.get(speaker, speaker)


def _role_for(
    index: int,
    speaker: str,
    role_map: dict[str, str],
    utterance_roles: list[str] | None,
) -> str:
    if utterance_roles is not None and 0 <= index < len(utterance_roles):
        return utterance_roles[index]
    return role_map.get(speaker, speaker)


def build_llm_transcript(
    utterances: list[DiarizedUtterance],
    role_map: dict[str, str],
    *,
    include_timestamps: bool = True,
    utterance_roles: list[str] | None = None,
) -> str:
    lines: list[str] = []
    for idx, utterance in enumerate(utterances):
        role = _role_for(idx, utterance.speaker, role_map, utterance_roles)
        if include_timestamps:
            lines.append(
                f"{idx}. [{role}] ({utterance.start:.1f}-{utterance.end:.1f}s) {utterance.text}"
            )
        else:
            lines.append(f"{role}: {utterance.text}")
    return "\n".join(lines)


def build_role_transcript_preview(
    utterances: list[DiarizedUtterance],
    role_map: dict[str, str],
    utterance_roles: list[str] | None = None,
) -> str:
    role_line = ", ".join(f"{speaker}={role}" for speaker, role in sorted(role_map.items()))
    body_lines: list[str] = []
    for idx, utterance in enumerate(utterances):
        if not utterance.text.strip():
            continue
        role = _role_for(idx, utterance.speaker, role_map, utterance_roles)
        body_lines.append(f"{role}: {utterance.text}")
    body = "\n".join(body_lines)
    return f"Speaker roles: {role_line}\n\n{body}"


def build_transcript_display(
    utterances: list[DiarizedUtterance],
    role_map: dict[str, str],
    names: dict[str, str] | None = None,
    utterance_roles: list[str] | None = None,
) -> list[TranscriptDisplayLine]:
    names = names or {}
    display: list[TranscriptDisplayLine] = []
    for idx, utterance in enumerate(utterances):
        role = _role_for(idx, utterance.speaker, role_map, utterance_roles)
        display_name = names.get(role)
        if role == "bot" and not display_name:
            display_name = "Bot"
        display.append(
            TranscriptDisplayLine(
                speaker=utterance.speaker,
                role=role,
                display_name=display_name or None,
                start=utterance.start,
                end=utterance.end,
                text=utterance.text,
            )
        )
    return display
