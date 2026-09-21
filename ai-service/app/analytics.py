from __future__ import annotations

import json
import re
from collections import defaultdict
from typing import Any

from app.pipeline.audio_clarity import assess_audio_clarity, assess_speakers_audio_clarity, worse_flag
from app.schemas import (
    AiExtraction,
    CallQuality,
    DiarizedUtterance,
    DiarizedWord,
    InterruptEvent,
    KeyMoment,
    SentimentSegment,
    SentimentTimelinePoint,
    SpeakerMetrics,
    TopicWeight,
)

FILLER_WORDS = {
    "um",
    "uh",
    "erm",
    "ah",
    "like",
    "you know",
    "i mean",
    "sort of",
    "kind of",
    "basically",
}

DISCONNECT_PATTERNS = [
    r"\b(hello\??\s*){2,}",
    r"\bare you (there|still there)\b",
    r"\bcan you hear me\b",
    r"\b(line|call) (got )?(cut|dropped|disconnected)\b",
    r"\bhang(?:ing)? up\b",
    r"\bbye+\b",
]

SENTIMENT_SCORE = {"POSITIVE": 1.0, "NEUTRAL": 0.0, "NEGATIVE": -1.0}


def _clamp(value: float, low: float = 0.0, high: float = 100.0) -> float:
    return max(low, min(high, value))


def _speech_rate_score(words_per_sec: float | None) -> float | None:
    if words_per_sec is None:
        return None
    if 2.0 <= words_per_sec <= 3.2:
        return 100.0
    distance = (2.0 - words_per_sec) if words_per_sec < 2.0 else words_per_sec - 3.2
    return round(_clamp(100.0 - (distance / 0.5) * 25.0), 1)


def _word_count(text: str) -> int:
    return len(re.findall(r"[A-Za-z0-9']+", text))


def _filler_count(text: str) -> int:
    lowered = text.lower()
    count = 0
    for filler in FILLER_WORDS:
        count += len(re.findall(rf"\b{re.escape(filler)}\b", lowered))
    return count


def _sentiment_breakdown(segments: list[SentimentSegment], speaker: str | None = None) -> tuple[float, float, float]:
    filtered = [s for s in segments if speaker is None or s.speaker == speaker]
    if not filtered:
        return 0.0, 100.0, 0.0
    pos = sum(1 for s in filtered if s.sentiment == "POSITIVE")
    neu = sum(1 for s in filtered if s.sentiment == "NEUTRAL")
    neg = sum(1 for s in filtered if s.sentiment == "NEGATIVE")
    total = len(filtered)
    return (pos / total) * 100, (neu / total) * 100, (neg / total) * 100


def detect_customer_disconnect(
    utterances: list[DiarizedUtterance],
    duration_sec: float,
    agent_speaker: str | None,
    customer_speaker: str | None,
) -> tuple[bool, str | None, float]:
    if not utterances or duration_sec <= 0:
        return False, None, 0.0

    last = utterances[-1]
    trailing_silence = max(0.0, duration_sec - last.end)
    last_text = last.text.lower()

    reasons: list[str] = []
    score = 0.0

    if trailing_silence >= 8:
        reasons.append(f"Long silence after last speech ({trailing_silence:.1f}s)")
        score += 0.35

    if agent_speaker and last.speaker == agent_speaker and trailing_silence >= 4:
        reasons.append("Agent spoke last, then silence (possible customer drop)")
        score += 0.25

    if customer_speaker and last.speaker == customer_speaker and _word_count(last.text) <= 2:
        reasons.append("Customer ended on a very short utterance")
        score += 0.15

    for pattern in DISCONNECT_PATTERNS:
        if re.search(pattern, last_text, flags=re.IGNORECASE):
            reasons.append("Disconnect / dead-air phrasing detected near end")
            score += 0.3
            break

    if last.confidence is not None and last.confidence < 0.55 and trailing_silence < 1:
        reasons.append("Low-confidence abrupt ending")
        score += 0.15

    disconnected = score >= 0.45
    return disconnected, ("; ".join(reasons) if disconnected else None), min(1.0, score)


def compute_overlap_metrics(
    utterances: list[DiarizedUtterance],
    duration_sec: float,
) -> tuple[int, list[InterruptEvent], float, float]:
    events: list[InterruptEvent] = []
    overtalk_sec = 0.0

    for previous, current in zip(utterances, utterances[1:]):
        if previous.speaker == current.speaker:
            continue
        overlap = previous.end - current.start
        if overlap > 0.05:
            overtalk_sec += overlap
            events.append(
                InterruptEvent(
                    start=round(current.start, 2),
                    end=round(min(previous.end, current.end), 2),
                    speakers=[previous.speaker, current.speaker],
                )
            )
        elif current.start < previous.end + 0.15:
            # Near-cut / barge-in without measurable overlap
            events.append(
                InterruptEvent(
                    start=round(current.start, 2),
                    end=round(current.start + 0.1, 2),
                    speakers=[previous.speaker, current.speaker],
                )
            )

    overtalk_pct = (overtalk_sec / duration_sec * 100) if duration_sec > 0 else 0.0
    return len(events), events, round(overtalk_sec, 2), round(overtalk_pct, 1)


def build_sentiment_timeline(
    segments: list[SentimentSegment],
    utterances: list[DiarizedUtterance],
    duration_sec: float,
    bucket_sec: float = 15.0,
) -> list[SentimentTimelinePoint]:
    source: list[tuple[float, float, str]] = []
    if segments:
        for seg in segments:
            mid = (seg.start + seg.end) / 2.0
            source.append((mid, SENTIMENT_SCORE.get(seg.sentiment, 0.0), seg.sentiment))
    else:
        for utt in utterances:
            if not utt.sentiment:
                continue
            mid = (utt.start + utt.end) / 2.0
            source.append((mid, SENTIMENT_SCORE.get(utt.sentiment, 0.0), utt.sentiment))

    if duration_sec <= 0:
        return []

    bucket = max(5.0, bucket_sec)
    points: list[SentimentTimelinePoint] = []
    t = 0.0
    while t <= duration_sec + 0.01:
        window_start = t
        window_end = t + bucket
        in_window = [s for s in source if window_start <= s[0] < window_end]
        if in_window:
            avg = sum(s[1] for s in in_window) / len(in_window)
        else:
            avg = 0.0
        if avg > 0.2:
            label: str = "POSITIVE"
        elif avg < -0.2:
            label = "NEGATIVE"
        else:
            label = "NEUTRAL"
        points.append(
            SentimentTimelinePoint(
                t=round(t, 1),
                score=round(avg * 100, 1),
                label=label,  # type: ignore[arg-type]
            )
        )
        t += bucket
    return points


def build_call_analytics(
    *,
    duration_sec: float,
    utterances: list[DiarizedUtterance],
    words: list[DiarizedWord],
    sentiment_segments: list[SentimentSegment],
    avg_asr_confidence: float | None,
    role_hints: dict[str, str] | None = None,
    audio_path: str | None = None,
) -> tuple[list[SpeakerMetrics], CallQuality, list[SentimentTimelinePoint]]:
    speakers = sorted({u.speaker for u in utterances}) or ["A"]

    talk_time: dict[str, float] = defaultdict(float)
    words_by_speaker: dict[str, int] = defaultdict(int)
    fillers: dict[str, int] = defaultdict(int)
    response_gaps: dict[str, list[float]] = defaultdict(list)

    for utterance in utterances:
        talk_time[utterance.speaker] += max(0.0, utterance.end - utterance.start)
        words_by_speaker[utterance.speaker] += _word_count(utterance.text)
        fillers[utterance.speaker] += _filler_count(utterance.text)

    for previous, current in zip(utterances, utterances[1:]):
        if previous.speaker != current.speaker:
            gap = max(0.0, current.start - previous.end)
            response_gaps[current.speaker].append(gap)

    total_talk = sum(talk_time.values()) or 1.0
    silence_sec = max(0.0, duration_sec - sum(talk_time.values()))
    silence_ratio = (silence_sec / duration_sec * 100) if duration_sec > 0 else 0.0

    if role_hints:
        agent_speaker = next((speaker for speaker, role in role_hints.items() if role == "agent"), None)
        customer_speaker = next(
            (speaker for speaker, role in role_hints.items() if role == "customer"),
            None,
        )
    else:
        ordered_by_talk = sorted(speakers, key=lambda s: talk_time[s], reverse=True)
        agent_speaker = ordered_by_talk[0] if ordered_by_talk else None
        customer_speaker = ordered_by_talk[1] if len(ordered_by_talk) > 1 else None

    speaker_metrics: list[SpeakerMetrics] = []
    fluency_scores: list[float] = []
    energy_scores: list[float] = []
    all_gaps: list[float] = []

    for speaker in speakers:
        talk_sec = talk_time[speaker]
        wcount = words_by_speaker[speaker]
        wpm = (wcount / talk_sec * 60.0) if talk_sec > 0 else 0.0
        filler = fillers[speaker]
        filler_rate = (filler / max(wcount, 1)) * 100

        fluency = 100.0
        fluency -= min(40.0, filler_rate * 4.0)
        if wpm < 90:
            fluency -= min(25.0, (90 - wpm) * 0.4)
        elif wpm > 180:
            fluency -= min(25.0, (wpm - 180) * 0.35)
        fluency = _clamp(fluency)
        fluency_scores.append(fluency)

        density = (talk_sec / duration_sec) if duration_sec > 0 else 0.0
        energy = _clamp(density * 55 + min(wpm, 160) / 160 * 45)

        _, _, neg_pct = _sentiment_breakdown(sentiment_segments, speaker)
        energy = _clamp(energy - neg_pct * 0.15)
        energy_scores.append(energy)

        gaps = response_gaps.get(speaker, [])
        all_gaps.extend(gaps)
        avg_gap = sum(gaps) / len(gaps) if gaps else None

        pos, neu, neg = _sentiment_breakdown(sentiment_segments, speaker)
        role = None
        if speaker == agent_speaker:
            role = "agent"
        elif speaker == customer_speaker:
            role = "customer"

        speaker_metrics.append(
            SpeakerMetrics(
                speaker=speaker,
                role_guess=role,
                talk_time_sec=round(talk_sec, 2),
                talk_ratio_pct=round((talk_sec / total_talk) * 100, 1),
                words_spoken=wcount,
                words_per_minute=round(wpm, 1),
                avg_response_time_sec=round(avg_gap, 2) if avg_gap is not None else None,
                filler_word_count=filler,
                fluency_score=round(fluency, 1),
                energy_score=round(energy, 1),
                sentiment_positive_pct=round(pos, 1),
                sentiment_neutral_pct=round(neu, 1),
                sentiment_negative_pct=round(neg, 1),
            )
        )

    avg_response = sum(all_gaps) / len(all_gaps) if all_gaps else 0.0
    max_response = max(all_gaps) if all_gaps else 0.0
    fluency_score = sum(fluency_scores) / len(fluency_scores) if fluency_scores else 0.0
    energy_score = sum(energy_scores) / len(energy_scores) if energy_scores else 0.0

    recording_quality = 70.0
    if avg_asr_confidence is not None:
        recording_quality = _clamp(avg_asr_confidence * 100)
    recording_quality = _clamp(recording_quality - max(0.0, silence_ratio - 35) * 0.6)

    interruptions_count, interruption_events, overtalk_sec, overtalk_pct = compute_overlap_metrics(
        utterances, duration_sec
    )
    interrupt_proxy = _clamp(interruptions_count * 8)

    disconnected, disconnect_reason, disconnect_confidence = detect_customer_disconnect(
        utterances, duration_sec, agent_speaker, customer_speaker
    )

    if avg_response <= 0:
        response_score = 70.0
    elif 0.4 <= avg_response <= 2.5:
        response_score = 95.0
    elif avg_response < 0.4:
        response_score = 80.0
    else:
        response_score = _clamp(95.0 - (avg_response - 2.5) * 12)

    overall = _clamp(
        recording_quality * 0.25
        + fluency_score * 0.25
        + energy_score * 0.15
        + response_score * 0.2
        + (35.0 if disconnected else 100.0) * 0.15
    )

    agent_metric = next((item for item in speaker_metrics if item.role_guess == "agent"), None)
    agent_wps = None
    if agent_metric is not None and agent_metric.talk_time_sec > 0:
        agent_wps = agent_metric.words_spoken / agent_metric.talk_time_sec
    elif agent_metric is not None:
        agent_wps = agent_metric.words_per_minute / 60

    speaker_clarity = assess_speakers_audio_clarity(
        words=words,
        utterances=utterances,
        role_hints=role_hints,
        audio_path=audio_path,
    )
    clarity = assess_audio_clarity(
        words=words,
        utterances=utterances,
        avg_asr_confidence=avg_asr_confidence,
        silence_ratio_pct=silence_ratio,
        audio_path=audio_path,
        include_rms=False,
    )
    call_flag = worse_flag(clarity.flag, *(item.flag for item in speaker_clarity))
    call_reasons = list(clarity.reasons)
    if call_flag != "ok":
        for item in speaker_clarity:
            for code in item.reasons:
                if code not in call_reasons:
                    call_reasons.append(code)
    if call_flag == "ok":
        call_reasons = []

    call_quality = CallQuality(
        overall_score=round(overall, 1),
        recording_quality_score=round(recording_quality, 1),
        clarity_score=round(recording_quality, 1),
        speech_rate_score=_speech_rate_score(agent_wps),
        fluency_score=round(fluency_score, 1),
        energy_score=round(energy_score, 1),
        avg_response_time_sec=round(avg_response, 2),
        max_response_time_sec=round(max_response, 2),
        silence_ratio_pct=round(silence_ratio, 1),
        silence_sec=round(silence_sec, 2),
        overlap_or_interrupt_proxy=round(interrupt_proxy, 1),
        interruptions_count=interruptions_count,
        interruption_events=interruption_events[:40],
        overtalk_sec=overtalk_sec,
        overtalk_pct=overtalk_pct,
        customer_disconnected=disconnected,
        disconnect_reason=disconnect_reason,
        disconnect_confidence=round(disconnect_confidence, 2),
        audio_clarity_flag=call_flag,
        audio_clarity_reasons=call_reasons,
        avg_asr_confidence=clarity.avg_asr_confidence,
        p10_asr_confidence=clarity.p10_asr_confidence,
        low_confidence_word_pct=clarity.low_confidence_word_pct,
        clipping_pct=clarity.clipping_pct,
        rms=clarity.rms,
        low_confidence_spans=clarity.low_confidence_spans,
        speaker_audio_clarity=speaker_clarity,
    )

    timeline = build_sentiment_timeline(sentiment_segments, utterances, duration_sec)
    return speaker_metrics, call_quality, timeline


def empty_ai_extraction(note: str) -> AiExtraction:
    return AiExtraction(available=False, note=note)


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


def _normalize_outcome(value: Any) -> str | None:
    text = str(value or "").strip()
    lowered = text.lower()
    if lowered in {"successful", "success", "won"}:
        return "Successful"
    if lowered in {"unsuccessful", "failed", "failure", "lost"}:
        return "Unsuccessful"
    if lowered in {"unclear", "unknown", "n/a", "na"}:
        return "Unclear"
    if text in {"Successful", "Unsuccessful", "Unclear"}:
        return text
    return None


def parse_llm_extraction(text: str) -> AiExtraction:
    """Parse LLM extraction — prefers strict JSON, falls back to prose headers."""
    parsed = _extract_json_object(text)
    if parsed:
        topics_raw = parsed.get("key_topics") or []
        topics: list[TopicWeight] = []
        if isinstance(topics_raw, list):
            for item in topics_raw:
                if isinstance(item, dict):
                    topic = str(item.get("topic") or "").strip()
                    if not topic:
                        continue
                    try:
                        weight = float(item.get("weight_pct") or 0)
                    except (TypeError, ValueError):
                        weight = 0.0
                    topics.append(TopicWeight(topic=topic, weight_pct=_clamp(weight)))
                elif isinstance(item, str) and item.strip():
                    topics.append(TopicWeight(topic=item.strip(), weight_pct=0.0))

        moments_raw = parsed.get("key_moments") or []
        moments: list[KeyMoment] = []
        if isinstance(moments_raw, list):
            for item in moments_raw:
                if not isinstance(item, dict):
                    continue
                label = str(item.get("label") or "").strip()
                if not label:
                    continue
                try:
                    time_sec = float(item.get("time_sec") or 0)
                except (TypeError, ValueError):
                    time_sec = 0.0
                role = item.get("speaker_role")
                moments.append(
                    KeyMoment(
                        time_sec=max(0.0, time_sec),
                        label=label,
                        speaker_role=str(role).strip() if role else None,
                    )
                )

        tags = [str(t).strip() for t in (parsed.get("tags") or []) if str(t).strip()]
        actions = [str(a).strip() for a in (parsed.get("action_items") or []) if str(a).strip()]
        coaching = [
            str(c).strip() for c in (parsed.get("agent_coaching_notes") or []) if str(c).strip()
        ]

        return AiExtraction(
            summary=str(parsed.get("summary") or "").strip() or None,
            key_topics=topics[:12],
            action_items=actions[:8],
            agent_coaching_notes=coaching[:8],
            customer_intent=str(parsed.get("customer_intent") or "").strip() or None,
            call_outcome=_normalize_outcome(parsed.get("call_outcome")),  # type: ignore[arg-type]
            tags=tags[:12],
            key_moments=moments[:20],
            raw_llm_text=text,
            available=True,
        )

    # Prose fallback
    lines = [line.strip(" -*\t") for line in text.splitlines() if line.strip()]
    summary = None
    topics: list[TopicWeight] = []
    actions: list[str] = []
    coaching: list[str] = []
    intent = None

    section = "summary"
    for line in lines:
        lower = line.lower()
        if "topic" in lower and ":" in line:
            section = "topics"
            continue
        if "action" in lower:
            section = "actions"
            continue
        if "coach" in lower or ("agent" in lower and "note" in lower):
            section = "coaching"
            continue
        if "intent" in lower:
            section = "intent"
            after = line.split(":", 1)[-1].strip() if ":" in line else ""
            if after:
                intent = after
            continue
        if "summary" in lower:
            section = "summary"
            after = line.split(":", 1)[-1].strip() if ":" in line else ""
            if after:
                summary = after
            continue

        if section == "summary" and summary is None:
            summary = line
        elif section == "topics":
            topics.append(TopicWeight(topic=line, weight_pct=0.0))
        elif section == "actions":
            actions.append(line)
        elif section == "coaching":
            coaching.append(line)
        elif section == "intent" and intent is None:
            intent = line

    return AiExtraction(
        summary=summary,
        key_topics=topics[:8],
        action_items=actions[:8],
        agent_coaching_notes=coaching[:8],
        customer_intent=intent,
        call_outcome="Unclear",
        tags=[],
        key_moments=[],
        raw_llm_text=text,
        available=True,
        note="Parsed from prose fallback (JSON preferred)",
    )


def attach_sentiment_to_utterances(
    utterances: list[DiarizedUtterance],
    sentiment_segments: list[SentimentSegment],
) -> list[DiarizedUtterance]:
    enriched: list[DiarizedUtterance] = []
    for utterance in utterances:
        best: SentimentSegment | None = None
        best_overlap = -1.0
        for segment in sentiment_segments:
            overlap = max(0.0, min(utterance.end, segment.end) - max(utterance.start, segment.start))
            if overlap > best_overlap:
                best_overlap = overlap
                best = segment
        if best and best_overlap > 0:
            enriched.append(
                utterance.model_copy(
                    update={
                        "sentiment": best.sentiment,
                        "sentiment_confidence": best.confidence,
                    }
                )
            )
        else:
            enriched.append(utterance)
    return enriched


def mean_or_none(values: list[float]) -> float | None:
    if not values:
        return None
    return float(sum(values) / len(values))
