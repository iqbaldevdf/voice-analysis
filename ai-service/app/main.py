from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from app.participant_performance import run_participant_performance
from app.pipeline.dual_stt import dual_stt_enabled, run_dual_transcribe
from app.providers.assemblyai import AssemblyAIProvider
from app.introduction_script import score_introduction_script
from app.schemas import (
    CallAnalysisResult,
    DiarizedUtterance,
    DiarizedWord,
    DualTranscribeResponse,
    IntroductionScriptScore,
    ParticipantPerformanceAnalysis,
    TranscriptReviewData,
)

load_dotenv()

app = FastAPI(title="Voice Analysis AI Service", version="2.0.0")


class AnalyzeRequest(BaseModel):
    audio_path: str = Field(..., description="Absolute path to normalized WAV")
    language: str | None = None
    participant_context: dict | None = None


class ScorePerformanceRequest(BaseModel):
    utterances: list[DiarizedUtterance]
    role_hints: dict[str, str] = Field(default_factory=dict)
    participants: list[dict] = Field(default_factory=list)
    direction: str | None = None
    call_notes: str | None = None


class ScoreIntroductionScriptRequest(BaseModel):
    utterances: list[DiarizedUtterance]
    role_hints: dict[str, str] = Field(default_factory=dict)


class RemapSpeakersRequest(BaseModel):
    utterances: list[DiarizedUtterance]
    words: list[DiarizedWord] = Field(default_factory=list)
    duration_sec: float
    transcript_id: str | None = None
    language: str | None = None
    participant_context: dict | None = None
    speaker_override: dict[str, str] | None = None


class FinalizeTranscriptRequest(BaseModel):
    utterances: list[DiarizedUtterance]
    words: list[DiarizedWord] = Field(default_factory=list)
    duration_sec: float
    transcript_id: str | None = None
    language: str | None = None
    participant_context: dict | None = None
    chosen_source: str | None = None
    transcript_review: TranscriptReviewData | None = None
    audio_path: str | None = None


@lru_cache(maxsize=1)
def get_provider() -> AssemblyAIProvider:
    return AssemblyAIProvider()


@app.get("/health")
def health() -> dict:
    key = (os.getenv("ASSEMBLYAI_API_KEY") or "").strip()
    key_configured = bool(key) and key not in {"YOUR_ASSEMBLYAI_API_KEY", "changeme"}
    return {
        "ok": True,
        "provider": "assemblyai",
        "api_key_configured": key_configured,
        "speech_model": os.getenv("ASSEMBLYAI_SPEECH_MODEL", "universal-2"),
        "llm_enabled": os.getenv("ASSEMBLYAI_ENABLE_LLM", "true").lower() in {"1", "true", "yes"},
        "llm_model": os.getenv("ASSEMBLYAI_LLM_MODEL", "qwen3.5-4b-32k-fast"),
        "llm_gateway": os.getenv(
            "ASSEMBLYAI_LLM_GATEWAY_URL",
            "https://llm-gateway.assemblyai.com/v1/chat/completions",
        ),
        "dual_stt_enabled": dual_stt_enabled(),
        "whisper_model": os.getenv("WHISPER_MODEL", "small.en"),
        "audio_speaker_validation": os.getenv("AUDIO_SPEAKER_VALIDATION", "false").lower()
        in {"1", "true", "yes"},
    }


@app.post("/score-introduction-script", response_model=IntroductionScriptScore)
def score_introduction_script_endpoint(
    request: ScoreIntroductionScriptRequest,
) -> IntroductionScriptScore:
    if not request.utterances:
        raise HTTPException(status_code=400, detail="utterances are required")
    try:
        return score_introduction_script(
            utterances=request.utterances,
            role_hints=request.role_hints,
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/score-performance", response_model=list[ParticipantPerformanceAnalysis])
def score_performance(request: ScorePerformanceRequest) -> list[ParticipantPerformanceAnalysis]:
    provider = get_provider()
    try:
        return run_participant_performance(
            utterances=request.utterances,
            role_hints=request.role_hints,
            named_roles=request.participants,
            direction=request.direction,
            call_notes=request.call_notes,
            chat=provider.llm_gateway_chat if provider.enable_llm else None,
            llm_enabled=provider.enable_llm,
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/remap-speakers", response_model=CallAnalysisResult)
def remap_speakers(request: RemapSpeakersRequest) -> CallAnalysisResult:
    if not request.utterances:
        raise HTTPException(status_code=400, detail="utterances are required for remap")

    try:
        provider = get_provider()
        return provider.remap_analysis(
            utterances=request.utterances,
            words=request.words,
            duration_sec=request.duration_sec,
            transcript_id=request.transcript_id,
            language=request.language or "unknown",
            participant_context=request.participant_context,
            speaker_override=request.speaker_override,
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/transcribe-dual", response_model=DualTranscribeResponse)
def transcribe_dual(request: AnalyzeRequest) -> DualTranscribeResponse:
    audio_path = Path(request.audio_path)
    if not audio_path.exists():
        raise HTTPException(status_code=404, detail=f"Audio not found: {request.audio_path}")
    if not audio_path.is_file():
        raise HTTPException(status_code=400, detail="audio_path must be a file")
    try:
        return run_dual_transcribe(str(audio_path.resolve()), language=request.language)
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/finalize-transcript", response_model=CallAnalysisResult)
def finalize_transcript(request: FinalizeTranscriptRequest) -> CallAnalysisResult:
    if not request.utterances:
        raise HTTPException(status_code=400, detail="utterances are required")
    try:
        provider = get_provider()
        review = request.transcript_review
        if review and request.chosen_source:
            review = review.model_copy(
                update={
                    "status": "user_confirmed",
                    "chosen_source": request.chosen_source,
                }
            )
        return provider.finalize_from_utterances(
            utterances=request.utterances,
            words=request.words,
            duration_sec=request.duration_sec,
            transcript_id=request.transcript_id,
            language=request.language or "unknown",
            participant_context=request.participant_context,
            chosen_source=request.chosen_source,
            transcript_review=review,
            audio_path=request.audio_path,
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/analyze", response_model=CallAnalysisResult)
def analyze(request: AnalyzeRequest) -> CallAnalysisResult:
    audio_path = Path(request.audio_path)
    if not audio_path.exists():
        raise HTTPException(status_code=404, detail=f"Audio not found: {request.audio_path}")
    if not audio_path.is_file():
        raise HTTPException(status_code=400, detail="audio_path must be a file")

    try:
        provider = get_provider()
        return provider.analyze(
            str(audio_path.resolve()),
            language=request.language,
            participant_context=request.participant_context,
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(exc)) from exc


if __name__ == "__main__":
    import uvicorn

    host = os.getenv("HOST", "127.0.0.1")
    port = int(os.getenv("PORT", "8001"))
    uvicorn.run("app.main:app", host=host, port=port, reload=False)
