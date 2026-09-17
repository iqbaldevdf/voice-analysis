"""Build canonical utterances from dual STT passes."""

from __future__ import annotations

from app.schemas import DiarizedUtterance


def utterances_full_text(utterances: list[DiarizedUtterance]) -> str:
    return " ".join(u.text.strip() for u in utterances if u.text.strip())


def merge_whisper_text_into_diarization(
    assembly_utterances: list[DiarizedUtterance],
    whisper_utterances: list[DiarizedUtterance],
) -> list[DiarizedUtterance]:
    """
    Keep AssemblyAI speaker/time boundaries; replace text with overlapping Whisper segments.
    Falls back to AssemblyAI text when no Whisper overlap.
    """
    if not assembly_utterances:
        return list(whisper_utterances)
    if not whisper_utterances:
        return list(assembly_utterances)

    merged: list[DiarizedUtterance] = []
    for utt in assembly_utterances:
        overlapping = [
            w
            for w in whisper_utterances
            if w.end > utt.start and w.start < utt.end
        ]
        if overlapping:
            text = " ".join(w.text.strip() for w in overlapping if w.text.strip())
            confidence = sum(w.confidence or 0.0 for w in overlapping) / max(len(overlapping), 1)
        else:
            text = utt.text
            confidence = utt.confidence
        merged.append(
            DiarizedUtterance(
                speaker=utt.speaker,
                start=utt.start,
                end=utt.end,
                text=text or utt.text,
                confidence=confidence,
            )
        )
    return merged
