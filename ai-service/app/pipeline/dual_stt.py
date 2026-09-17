"""Orchestrate AssemblyAI + Whisper dual transcription and comparison."""

from __future__ import annotations

import os
from typing import Any

from app.pipeline.audio_probe import probe_audio
from app.pipeline.canonical_transcript import merge_whisper_text_into_diarization, utterances_full_text
from app.pipeline.transcript_compare import compare_transcripts
from app.providers.assemblyai import AssemblyAIProvider
from app.providers.whisper_local import WhisperLocalProvider
from app.schemas import (
    DualTranscribeResponse,
    TranscriptPassSnapshot,
    TranscriptReviewData,
)


def dual_stt_enabled() -> bool:
    return os.getenv("DUAL_STT_ENABLED", "false").lower() in {"1", "true", "yes"}


def run_dual_transcribe(
    audio_path: str,
    *,
    language: str | None = None,
    assembly: AssemblyAIProvider | None = None,
    whisper: WhisperLocalProvider | None = None,
) -> DualTranscribeResponse:
    assembly = assembly or AssemblyAIProvider()
    whisper = whisper or WhisperLocalProvider()
    notes: list[str] = []
    probe = probe_audio(audio_path)

    utterances_a, words, duration_a, _conf_a, lang_a, transcript_id = assembly.transcribe_only(
        audio_path, language=language
    )
    text_a = utterances_full_text(utterances_a)

    try:
        utterances_b, lang_b, duration_b = whisper.transcribe(audio_path, language=language or lang_a)
    except RuntimeError as exc:
        notes.append(str(exc))
        # Whisper unavailable: treat as auto-accept AssemblyAI only
        review = TranscriptReviewData(
            status="auto_accepted",
            wer=0.0,
            similarity=1.0,
            pass_a=TranscriptPassSnapshot(
                engine="assemblyai",
                transcript_id=transcript_id,
                utterances=utterances_a,
                full_text=text_a,
            ),
            pass_b=TranscriptPassSnapshot(
                engine="faster_whisper",
                model=whisper.model_name,
                utterances=[],
                full_text="",
            ),
            diff_summary={"whisper_skipped": True},
            chosen_source="assemblyai",
        )
        return DualTranscribeResponse(
            needs_review=False,
            transcript_review=review,
            utterances=utterances_a,
            words=words,
            duration_sec=duration_a,
            language=lang_a,
            transcript_id=transcript_id,
            audio_probe=probe,
            notes=notes,
        )

    text_b = utterances_full_text(utterances_b)
    cmp = compare_transcripts(text_a, text_b)

    pass_a = TranscriptPassSnapshot(
        engine="assemblyai",
        transcript_id=transcript_id,
        utterances=utterances_a,
        full_text=text_a,
    )
    pass_b = TranscriptPassSnapshot(
        engine="faster_whisper",
        model=whisper.model_name,
        utterances=utterances_b,
        full_text=text_b,
    )

    if cmp.auto_accept:
        review = TranscriptReviewData(
            status="auto_accepted",
            wer=cmp.wer,
            similarity=cmp.similarity,
            threshold_wer_max=cmp.threshold_wer_max,
            threshold_similarity_min=cmp.threshold_similarity_min,
            pass_a=pass_a,
            pass_b=pass_b,
            diff_summary=cmp.to_dict(),
            chosen_source="assemblyai",
        )
        return DualTranscribeResponse(
            needs_review=False,
            transcript_review=review,
            utterances=utterances_a,
            words=words,
            duration_sec=max(duration_a, duration_b),
            language=lang_a,
            transcript_id=transcript_id,
            audio_probe=probe,
            notes=notes,
        )

    review = TranscriptReviewData(
        status="pending",
        wer=cmp.wer,
        similarity=cmp.similarity,
        threshold_wer_max=cmp.threshold_wer_max,
        threshold_similarity_min=cmp.threshold_similarity_min,
        pass_a=pass_a,
        pass_b=pass_b,
        diff_summary=cmp.to_dict(),
    )
    return DualTranscribeResponse(
        needs_review=True,
        transcript_review=review,
        utterances=utterances_a,
        words=words,
        duration_sec=max(duration_a, duration_b),
        language=lang_a,
        transcript_id=transcript_id,
        audio_probe=probe,
        notes=notes,
    )


def utterances_for_chosen_source(
    review: TranscriptReviewData,
    chosen_source: str,
) -> list[Any]:
    if chosen_source == "whisper":
        return merge_whisper_text_into_diarization(
            list(review.pass_a.utterances),
            list(review.pass_b.utterances),
        )
    return list(review.pass_a.utterances)
