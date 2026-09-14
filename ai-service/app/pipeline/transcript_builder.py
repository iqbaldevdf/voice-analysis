"""Build role-aware transcripts for LLM prompts and UI."""

from __future__ import annotations

from app.schemas import DiarizedUtterance, TranscriptDisplayLine


def role_label(speaker: str, role_map: dict[str, str]) -> str:
    return role_map.get(speaker, speaker)


def build_llm_transcript(
    utterances: list[DiarizedUtterance],
    role_map: dict[str, str],
    *,
    include_timestamps: bool = True,
) -> str:
    lines: list[str] = []
    for idx, utterance in enumerate(utterances):
        role = role_label(utterance.speaker, role_map)
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
) -> str:
    role_line = ", ".join(f"{speaker}={role}" for speaker, role in sorted(role_map.items()))
    body = "\n".join(
        f"{role_label(u.speaker, role_map)}: {u.text}" for u in utterances if u.text.strip()
    )
    return f"Speaker roles: {role_line}\n\n{body}"


def build_transcript_display(
    utterances: list[DiarizedUtterance],
    role_map: dict[str, str],
    names: dict[str, str] | None = None,
) -> list[TranscriptDisplayLine]:
    names = names or {}
    display: list[TranscriptDisplayLine] = []
    for utterance in utterances:
        role = role_map.get(utterance.speaker, "unknown")
        display.append(
            TranscriptDisplayLine(
                speaker=utterance.speaker,
                role=role,
                display_name=names.get(role) or None,
                start=utterance.start,
                end=utterance.end,
                text=utterance.text,
            )
        )
    return display
