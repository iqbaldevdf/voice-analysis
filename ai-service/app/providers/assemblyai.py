from __future__ import annotations

import json
import os
import re
import time
from pathlib import Path
from typing import Any, Optional

import httpx

from app.introduction_script import score_introduction_script
from app.participant_performance import run_participant_performance
from app.pipeline.speaker_mapping import map_speakers
from app.pipeline.transcript_builder import (
    build_llm_transcript,
    build_role_transcript_preview,
    build_transcript_display,
)
from app.analytics import (
    attach_sentiment_to_utterances,
    build_call_analytics,
    empty_ai_extraction,
    mean_or_none,
    parse_llm_extraction,
)
from app.schemas import (
    CallAnalysisResult,
    DiarizedUtterance,
    DiarizedWord,
    LlmSentimentAnalysis,
    SentimentEmotion,
    SentimentHighlight,
    SentimentSegment,
    SentimentShift,
)

LLM_GATEWAY_URL = "https://llm-gateway.assemblyai.com/v1/chat/completions"


def _normalize_sentiment(value: Any) -> str:
    text = str(value or "NEUTRAL").strip().upper()
    if text not in {"POSITIVE", "NEUTRAL", "NEGATIVE"}:
        return "NEUTRAL"
    return text


def _extract_json_object(text: str) -> dict[str, Any] | None:
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


class AssemblyAIProvider:
    """AssemblyAI pre-recorded STT + diarization + LLM Gateway sentiment/extraction."""

    def __init__(self) -> None:
        self.api_key = (os.getenv("ASSEMBLYAI_API_KEY") or "").strip()
        self.base_url = os.getenv("ASSEMBLYAI_BASE_URL", "https://api.assemblyai.com").rstrip("/")
        self.poll_interval_sec = float(os.getenv("ASSEMBLYAI_POLL_INTERVAL_SEC", "3"))
        self.enable_llm = os.getenv("ASSEMBLYAI_ENABLE_LLM", "true").lower() in {"1", "true", "yes"}
        self.speakers_expected = os.getenv("ASSEMBLYAI_SPEAKERS_EXPECTED")
        self.speech_model = os.getenv("ASSEMBLYAI_SPEECH_MODEL", "universal-2")
        self.llm_model = os.getenv("ASSEMBLYAI_LLM_MODEL", "qwen3.5-4b-32k-fast")
        self.llm_gateway_url = os.getenv("ASSEMBLYAI_LLM_GATEWAY_URL", LLM_GATEWAY_URL)

    def _headers(self) -> dict[str, str]:
        if not self.api_key or self.api_key in {"YOUR_ASSEMBLYAI_API_KEY", "changeme"}:
            raise RuntimeError(
                "ASSEMBLYAI_API_KEY is not set. Add your key to ai-service/.env and restart the AI service."
            )
        return {"authorization": self.api_key}

    def upload_file(self, audio_path: str) -> str:
        path = Path(audio_path)
        with path.open("rb") as handle, httpx.Client(timeout=120.0) as client:
            response = client.post(
                f"{self.base_url}/v2/upload",
                headers=self._headers(),
                content=handle,
            )
            response.raise_for_status()
            upload_url = response.json().get("upload_url")
            if not upload_url:
                raise RuntimeError(f"AssemblyAI upload failed: {response.text}")
            return str(upload_url)

    def create_transcript(self, upload_url: str, language: Optional[str] = None) -> str:
        # STT + diarization only; sentiment comes from LLM Gateway (qwen).
        payload: dict[str, Any] = {
            "audio_url": upload_url,
            "speaker_labels": True,
            "speech_models": [self.speech_model],
        }
        if language:
            payload["language_code"] = language
        if self.speakers_expected:
            try:
                payload["speakers_expected"] = int(self.speakers_expected)
            except ValueError:
                pass

        with httpx.Client(timeout=60.0) as client:
            response = client.post(
                f"{self.base_url}/v2/transcript",
                headers={**self._headers(), "content-type": "application/json"},
                json=payload,
            )
            response.raise_for_status()
            transcript_id = response.json().get("id")
            if not transcript_id:
                raise RuntimeError(f"AssemblyAI transcript create failed: {response.text}")
            return str(transcript_id)

    def wait_for_transcript(self, transcript_id: str) -> dict[str, Any]:
        with httpx.Client(timeout=60.0) as client:
            while True:
                response = client.get(
                    f"{self.base_url}/v2/transcript/{transcript_id}",
                    headers=self._headers(),
                )
                response.raise_for_status()
                data = response.json()
                status = data.get("status")
                if status == "completed":
                    return data
                if status == "error":
                    raise RuntimeError(f"AssemblyAI transcription error: {data.get('error')}")
                time.sleep(self.poll_interval_sec)

    def llm_gateway_chat(
        self,
        messages: list[dict[str, str]],
        *,
        transcript_id: str | None = None,
        max_tokens: int = 1200,
    ) -> str:
        """
        AssemblyAI LLM Gateway — same pattern as:
        POST https://llm-gateway.assemblyai.com/v1/chat/completions
        model: qwen3.5-4b-32k-fast
        """
        payload: dict[str, Any] = {
            "model": self.llm_model,
            "messages": messages,
            "max_tokens": max_tokens,
        }
        if transcript_id:
            payload["transcript_id"] = transcript_id

        with httpx.Client(timeout=120.0) as client:
            response = None
            for attempt in range(4):
                response = client.post(
                    self.llm_gateway_url,
                    headers={**self._headers(), "content-type": "application/json"},
                    json=payload,
                )
                if response.status_code != 429:
                    break
                time.sleep(1.5 * (attempt + 1))
            if response is None or response.status_code >= 400:
                status = response.status_code if response is not None else 0
                detail = response.text[:400] if response is not None else "no response"
                raise RuntimeError(f"LLM Gateway error ({status}): {detail}")
            body = response.json()
            content = body.get("choices", [{}])[0].get("message", {}).get("content")
            if not content:
                raise RuntimeError(f"LLM Gateway returned empty content: {body}")
            return str(content)

    def run_llm_sentiment(
        self,
        transcript_id: str,
        utterances: list[DiarizedUtterance],
        *,
        role_hints: dict[str, str] | None = None,
        transcript_llm: str | None = None,
    ) -> tuple[LlmSentimentAnalysis, list[SentimentSegment]]:
        if not self.enable_llm:
            return (
                LlmSentimentAnalysis(available=False, note="LLM disabled via ASSEMBLYAI_ENABLE_LLM=false"),
                [],
            )

        numbered = transcript_llm or build_llm_transcript(utterances, role_hints or {})
        role_block = ""
        if role_hints:
            mapped = ", ".join(f"{spk}={role}" for spk, role in sorted(role_hints.items()))
            role_block = (
                "Speaker roles are mapped. Use agent/customer labels in highlights — not diarization ids.\n"
                f"Mapping: {mapped}.\n"
            )
        else:
            role_block = (
                "Role mapping unknown. Prefer the speaker with more professional/scripted turns as agent; "
                "the other as customer. Do not invent speaker IDs.\n"
            )

        max_index = max(0, len(utterances) - 1)
        prompt = f"""
You are a call-center sentiment analyst. Score ONLY the transcript below.

{role_block}
Return ONLY valid JSON (no markdown) with this exact shape:
{{
  "overall": "POSITIVE" | "NEUTRAL" | "NEGATIVE",
  "overall_score": 0,
  "polarity_confidence": 0.0,
  "estimated_csat": 3.5,
  "opening_sentiment": "POSITIVE" | "NEUTRAL" | "NEGATIVE",
  "closing_sentiment": "POSITIVE" | "NEUTRAL" | "NEGATIVE",
  "agent_sentiment": "POSITIVE" | "NEUTRAL" | "NEGATIVE",
  "customer_sentiment": "POSITIVE" | "NEUTRAL" | "NEGATIVE",
  "trajectory": "improving" | "declining" | "stable" | "volatile",
  "agent_empathy_score": 0,
  "customer_frustration_score": 0,
  "emotions": [{{"label": "frustration", "intensity": 0.0}}],
  "shifts": [{{"at_sec": 0.0, "from_label": "NEUTRAL", "to_label": "NEGATIVE", "note": "short"}}],
  "risk_flags": ["escalation_risk"],
  "highlights": [{{"time_sec": 0.0, "speaker": "agent", "text": "quote", "sentiment": "NEGATIVE", "reason": "why"}}],
  "reasoning": "max 3 short sentences",
  "key_moment_indices": [0],
  "utterances": [
    {{"index": 0, "sentiment": "POSITIVE" | "NEUTRAL" | "NEGATIVE", "confidence": 0.0}}
  ]
}}

Strict rules:
1. Include every utterance index from 0 to {max_index} exactly once in "utterances".
2. Do not invent speakers, indices, or text that is not in the transcript.
3. confidence / polarity_confidence must be numbers between 0 and 1.
4. overall_score is -100 (very negative) to 100 (very positive).
5. estimated_csat is 1.0 to 5.0 (survey-style predicted satisfaction).
6. opening_sentiment = first ~20% of call; closing_sentiment = last ~20%.
7. agent_empathy_score and customer_frustration_score are 0 to 100.
8. emotions: up to 6 labels from [frustration, satisfaction, confusion, urgency, empathy, trust, anger, relief] with intensity 0..1.
9. shifts: up to 5 notable sentiment changes with real timestamps from the transcript.
10. risk_flags: zero or more of [escalation_risk, churn_risk, unresolved_issue, compliance_risk, callback_needed].
11. highlights: up to 6 emotionally or business-critical quotes (use real speaker labels and times).
12. key_moment_indices: up to 8 indices. Empty array if none.
13. agent_sentiment / customer_sentiment must reflect that role's turns only.
14. overall is the call-level customer experience, not agent politeness alone.
15. trajectory describes how sentiment moved across the call.

Transcript:
{numbered[:12000]}
""".strip()

        try:
            content = self.llm_gateway_chat(
                [{"role": "user", "content": prompt}],
                transcript_id=transcript_id,
                max_tokens=3200,
            )
            parsed = _extract_json_object(content)
            if not parsed:
                return (
                    LlmSentimentAnalysis(
                        available=False,
                        note="Could not parse LLM sentiment JSON",
                        raw_llm_text=content,
                    ),
                    [],
                )

            segments: list[SentimentSegment] = []
            for item in parsed.get("utterances") or []:
                try:
                    index = int(item.get("index"))
                except (TypeError, ValueError):
                    continue
                if index < 0 or index >= len(utterances):
                    continue
                utterance = utterances[index]
                confidence = float(item.get("confidence") or 0.75)
                confidence = max(0.0, min(1.0, confidence))
                segments.append(
                    SentimentSegment(
                        speaker=utterance.speaker,
                        start=utterance.start,
                        end=utterance.end,
                        text=utterance.text,
                        sentiment=_normalize_sentiment(item.get("sentiment")),  # type: ignore[arg-type]
                        confidence=confidence,
                    )
                )

            key_indices: list[int] = []
            for raw_idx in parsed.get("key_moment_indices") or []:
                try:
                    idx = int(raw_idx)
                except (TypeError, ValueError):
                    continue
                if 0 <= idx < len(utterances):
                    key_indices.append(idx)

            emotions: list[SentimentEmotion] = []
            for item in (parsed.get("emotions") or [])[:6]:
                label = str(item.get("label") or "").strip().lower()
                if not label:
                    continue
                try:
                    intensity = float(item.get("intensity") or 0)
                except (TypeError, ValueError):
                    intensity = 0.0
                emotions.append(
                    SentimentEmotion(label=label, intensity=max(0.0, min(1.0, intensity)))
                )

            shifts: list[SentimentShift] = []
            for item in (parsed.get("shifts") or [])[:5]:
                try:
                    at_sec = float(item.get("at_sec") or 0)
                except (TypeError, ValueError):
                    continue
                shifts.append(
                    SentimentShift(
                        at_sec=max(0.0, at_sec),
                        from_label=_normalize_sentiment(item.get("from_label")),  # type: ignore[arg-type]
                        to_label=_normalize_sentiment(item.get("to_label")),  # type: ignore[arg-type]
                        note=str(item.get("note") or "").strip() or None,
                    )
                )

            highlights: list[SentimentHighlight] = []
            for item in (parsed.get("highlights") or [])[:6]:
                text = str(item.get("text") or "").strip()
                speaker = str(item.get("speaker") or "").strip()
                if not text or not speaker:
                    continue
                try:
                    time_sec = float(item.get("time_sec") or 0)
                except (TypeError, ValueError):
                    time_sec = 0.0
                highlights.append(
                    SentimentHighlight(
                        time_sec=max(0.0, time_sec),
                        speaker=speaker,
                        text=text[:280],
                        sentiment=_normalize_sentiment(item.get("sentiment")),  # type: ignore[arg-type]
                        reason=str(item.get("reason") or "").strip() or None,
                    )
                )

            risk_flags = [
                str(flag).strip()
                for flag in (parsed.get("risk_flags") or [])
                if str(flag).strip()
            ][:8]

            def _optional_score(key: str, lo: float, hi: float) -> float | None:
                if parsed.get(key) is None:
                    return None
                try:
                    value = float(parsed.get(key))
                except (TypeError, ValueError):
                    return None
                return max(lo, min(hi, value))

            trajectory_raw = str(parsed.get("trajectory") or "").strip().lower()
            trajectory = (
                trajectory_raw
                if trajectory_raw in {"improving", "declining", "stable", "volatile"}
                else None
            )

            analysis = LlmSentimentAnalysis(
                overall=_normalize_sentiment(parsed.get("overall")),  # type: ignore[arg-type]
                agent_sentiment=_normalize_sentiment(parsed.get("agent_sentiment")),  # type: ignore[arg-type]
                customer_sentiment=_normalize_sentiment(parsed.get("customer_sentiment")),  # type: ignore[arg-type]
                opening_sentiment=_normalize_sentiment(parsed.get("opening_sentiment") or "NEUTRAL"),  # type: ignore[arg-type]
                closing_sentiment=_normalize_sentiment(parsed.get("closing_sentiment") or "NEUTRAL"),  # type: ignore[arg-type]
                overall_score=_optional_score("overall_score", -100, 100),
                polarity_confidence=_optional_score("polarity_confidence", 0, 1),
                estimated_csat=_optional_score("estimated_csat", 1, 5),
                trajectory=trajectory,  # type: ignore[arg-type]
                emotions=emotions,
                shifts=shifts,
                risk_flags=risk_flags,
                highlights=highlights,
                agent_empathy_score=_optional_score("agent_empathy_score", 0, 100),
                customer_frustration_score=_optional_score("customer_frustration_score", 0, 100),
                reasoning=str(parsed.get("reasoning") or "").strip() or None,
                key_moment_indices=key_indices[:8],
                available=True,
                raw_llm_text=content,
            )
            return analysis, segments
        except Exception as exc:  # noqa: BLE001
            return (
                LlmSentimentAnalysis(available=False, note=f"LLM sentiment failed: {exc}"),
                [],
            )

    def run_llm_extraction(self, transcript_id: str, transcript_preview: str) -> Any:
        if not self.enable_llm:
            return empty_ai_extraction("LLM extraction disabled via ASSEMBLYAI_ENABLE_LLM=false")

        prompt = f"""
You are a call-center quality analyst. Extract a structured performance report.

Return ONLY valid JSON (no markdown) with this exact shape:
{{
  "summary": "2-4 sentences on what happened and outcome",
  "key_topics": [{{"topic": "Product Discussion", "weight_pct": 31}}],
  "action_items": ["..."],
  "agent_coaching_notes": ["..."],
  "customer_intent": "one short phrase",
  "call_outcome": "Successful" | "Unsuccessful" | "Unclear",
  "tags": ["Demo Scheduled", "Pricing Discussed"],
  "key_moments": [
    {{"time_sec": 128, "label": "Objection Raised", "speaker_role": "customer"}}
  ]
}}

Strict rules:
1. key_topics: 3-8 items; weight_pct values should roughly sum to ~100.
2. tags: short Title Case labels (max 8), evidence-based only.
3. key_moments: max 8; time_sec must match transcript timestamps; speaker_role is agent or customer.
4. call_outcome Successful only if clear next step / commitment; Unsuccessful if rejection/hangup; else Unclear.
5. Do not invent facts not supported by the transcript.
6. Keep coaching notes specific and actionable (max 5).

Transcript excerpt:
{transcript_preview[:8000]}
""".strip()

        try:
            content = self.llm_gateway_chat(
                [{"role": "user", "content": prompt}],
                transcript_id=transcript_id,
                max_tokens=1400,
            )
            return parse_llm_extraction(content)
        except Exception as exc:  # noqa: BLE001
            return empty_ai_extraction(f"LLM extraction failed: {exc}")

    def _parse_stt_payload(
        self,
        raw: dict[str, Any],
        language: Optional[str] = None,
    ) -> tuple[list[DiarizedUtterance], list[DiarizedWord], float, list[float], str]:
        audio_duration = raw.get("audio_duration")
        duration_sec = float(audio_duration) if audio_duration is not None else 0.0
        if duration_sec > 10_000:
            duration_sec = duration_sec / 1000.0

        utterances_raw = raw.get("utterances") or []
        words_raw = raw.get("words") or []

        utterances: list[DiarizedUtterance] = []
        confidences: list[float] = []
        for item in utterances_raw:
            start = float(item.get("start", 0)) / 1000.0
            end = float(item.get("end", 0)) / 1000.0
            confidence = item.get("confidence")
            if confidence is not None:
                confidences.append(float(confidence))
            utterances.append(
                DiarizedUtterance(
                    speaker=str(item.get("speaker", "A")),
                    start=start,
                    end=end,
                    text=str(item.get("text", "")).strip(),
                    confidence=float(confidence) if confidence is not None else None,
                )
            )

        words: list[DiarizedWord] = []
        for item in words_raw:
            confidence = item.get("confidence")
            if confidence is not None:
                confidences.append(float(confidence))
            words.append(
                DiarizedWord(
                    speaker=str(item.get("speaker") or "A"),
                    start=float(item.get("start", 0)) / 1000.0,
                    end=float(item.get("end", 0)) / 1000.0,
                    word=str(item.get("text", "")).strip(),
                    confidence=float(confidence) if confidence is not None else None,
                )
            )

        language_code = str(raw.get("language_code") or language or "unknown")
        return utterances, words, duration_sec, confidences, language_code

    def remap_analysis(
        self,
        utterances: list[DiarizedUtterance],
        words: list[DiarizedWord],
        duration_sec: float,
        *,
        transcript_id: str | None = None,
        language: str = "unknown",
        participant_context: dict[str, Any] | None = None,
        speaker_override: dict[str, str] | None = None,
        avg_asr_confidence: float | None = None,
    ) -> CallAnalysisResult:
        """Re-run mapping, transcript labels, LLM, and scores without re-STT."""
        confidences: list[float] = []
        for utterance in utterances:
            if utterance.confidence is not None:
                confidences.append(float(utterance.confidence))
        for word in words:
            if word.confidence is not None:
                confidences.append(float(word.confidence))

        return self._build_analysis_result(
            utterances=utterances,
            words=words,
            duration_sec=duration_sec,
            confidences=confidences,
            language=language,
            transcript_id=transcript_id,
            participant_context=participant_context,
            speaker_override=speaker_override,
            avg_asr_confidence=avg_asr_confidence,
            notes_prefix=["Remap-only analysis (STT skipped)."],
        )

    def _build_analysis_result(
        self,
        *,
        utterances: list[DiarizedUtterance],
        words: list[DiarizedWord],
        duration_sec: float,
        confidences: list[float],
        language: str,
        transcript_id: str | None,
        participant_context: dict[str, Any] | None,
        speaker_override: dict[str, str] | None = None,
        avg_asr_confidence: float | None = None,
        notes_prefix: list[str] | None = None,
    ) -> CallAnalysisResult:
        notes: list[str] = list(notes_prefix or [])
        context = participant_context or {}
        speaker_mapping = map_speakers(utterances, context, speaker_override=speaker_override)
        role_hints = speaker_mapping.mapping
        if speaker_mapping.mapping_uncertain:
            notes.append(
                f"Speaker mapping uncertain (confidence {speaker_mapping.confidence:.0%}, method={speaker_mapping.method})"
            )

        transcript_llm = build_llm_transcript(utterances, role_hints)
        llm_sentiment, sentiment_segments = self.run_llm_sentiment(
            transcript_id,
            utterances,
            role_hints=role_hints,
            transcript_llm=transcript_llm,
        )
        if llm_sentiment.note:
            notes.append(llm_sentiment.note)

        utterances = attach_sentiment_to_utterances(utterances, sentiment_segments)
        speakers: list[str] = []
        for utterance in utterances:
            if utterance.speaker not in speakers:
                speakers.append(utterance.speaker)

        speaker_metrics, call_quality, sentiment_timeline = build_call_analytics(
            duration_sec=duration_sec,
            utterances=utterances,
            words=words,
            sentiment_segments=sentiment_segments,
            avg_asr_confidence=avg_asr_confidence
            if avg_asr_confidence is not None
            else mean_or_none(confidences),
            role_hints=role_hints,
        )

        transcript_preview = build_role_transcript_preview(utterances, role_hints)
        ai_extraction = self.run_llm_extraction(transcript_id, transcript_preview)

        named_roles = context.get("participants") if isinstance(context.get("participants"), list) else []
        display_names: dict[str, str] = {}
        agent_name = str(context.get("agentName") or "").strip()
        if agent_name:
            display_names["agent"] = agent_name
        for participant in named_roles:
            if not isinstance(participant, dict):
                continue
            role = str(participant.get("role") or "").lower()
            name = str(participant.get("name") or "").strip()
            if not name:
                continue
            if "customer" in role or "caller" in role or "client" in role:
                display_names["customer"] = name
            elif any(hint in role for hint in ("agent", "rep", "user", "executive")):
                display_names.setdefault("agent", name)

        transcript_display = build_transcript_display(utterances, role_hints, display_names)
        participant_performance = run_participant_performance(
            utterances=utterances,
            role_hints=role_hints,
            named_roles=named_roles,
            direction=str(context.get("direction") or "") or None,
            call_notes=str(context.get("callNotes") or "") or None,
            chat=self.llm_gateway_chat if self.enable_llm else None,
            llm_enabled=self.enable_llm,
            transcript_id=transcript_id,
        )
        if any(item.note for item in participant_performance):
            notes.extend(item.note for item in participant_performance if item.note)

        introduction_script = score_introduction_script(
            utterances=utterances,
            role_hints=role_hints,
        )

        if not sentiment_segments and not llm_sentiment.available:
            notes.append("Sentiment analysis unavailable for this file.")

        return CallAnalysisResult(
            language=language,
            duration_sec=round(duration_sec, 2),
            speakers=speakers,
            speaker_mapping=speaker_mapping,
            transcript_display=transcript_display,
            utterances=utterances,
            words=words,
            sentiment_segments=sentiment_segments,
            sentiment_timeline=sentiment_timeline,
            llm_sentiment=llm_sentiment,
            speaker_metrics=speaker_metrics,
            call_quality=call_quality,
            ai_extraction=ai_extraction,
            participant_performance=participant_performance,
            introduction_script=introduction_script,
            provider="assemblyai",
            transcript_id=transcript_id,
            notes=notes,
        )

    def analyze(
        self,
        audio_path: str,
        language: Optional[str] = None,
        *,
        participant_context: dict[str, Any] | None = None,
    ) -> CallAnalysisResult:
        upload_url = self.upload_file(audio_path)
        transcript_id = self.create_transcript(upload_url, language=language)
        raw = self.wait_for_transcript(transcript_id)
        utterances, words, duration_sec, confidences, language_code = self._parse_stt_payload(
            raw, language=language
        )
        return self._build_analysis_result(
            utterances=utterances,
            words=words,
            duration_sec=duration_sec,
            confidences=confidences,
            language=language_code,
            transcript_id=transcript_id,
            participant_context=participant_context,
        )
