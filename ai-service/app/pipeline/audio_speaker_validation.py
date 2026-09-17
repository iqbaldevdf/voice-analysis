"""Audio-based speaker validation for AssemblyAI A/B diarization (mono telephony).

Phase 2: temporal islands + ECAPA scoring.
Phase 3: robust outlier-filtered profiles, boundary validation, optional long-turn
candidate detection, embedding cache.

Runs AFTER AssemblyAI STT + word/utterance diarization and BEFORE map_speakers.
Does NOT assign agent/customer roles. Prefer UNCERTAIN over wrong auto-correction.
"""

from __future__ import annotations

import logging
import os
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Callable, Literal, Optional, Sequence

import numpy as np

from app.pipeline.speaker_embeddings import (
    SpeakerEncoder,
    cosine_similarity,
    ecapa_available,
    get_ecapa_encoder,
    load_wav_mono,
    resample_linear,
    slice_sec,
)
from app.schemas import (
    DiarizedUtterance,
    DiarizedWord,
    SpeakerProfileQuality,
    SpeakerValidationSummary,
    WordSpeakerValidation,
)

logger = logging.getLogger(__name__)

ValidationStatus = Literal[
    "confirmed",
    "corrected",
    "uncertain",
    "insufficient_audio",
    "skipped",
    "overlap_preserved",
]

ProfileStatus = Literal["usable", "weak", "insufficient"]
EmbedFn = Callable[[float, float], np.ndarray]


def audio_speaker_validation_enabled() -> bool:
    return os.getenv("AUDIO_SPEAKER_VALIDATION", "false").lower() in {"1", "true", "yes"}


def _bool_env(name: str, default: bool) -> bool:
    raw = (os.getenv(name) or "").strip().lower()
    if not raw:
        return default
    return raw in {"1", "true", "yes"}


def _fenv(name: str, default: float) -> float:
    raw = (os.getenv(name) or "").strip()
    if not raw:
        return default
    try:
        return float(raw)
    except ValueError:
        return default


def _ienv(name: str, default: int) -> int:
    raw = (os.getenv(name) or "").strip()
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError:
        return default


@dataclass
class ValidationConfig:
    min_profile_sec: float = field(default_factory=lambda: _fenv("AUDIO_SV_MIN_PROFILE_SEC", 1.5))
    min_speech_sec: float = field(default_factory=lambda: _fenv("AUDIO_SV_MIN_SPEECH_SEC", 1.0))
    island_max_sec: float = field(default_factory=lambda: _fenv("AUDIO_SV_ISLAND_MAX_SEC", 3.0))
    confirm_margin: float = field(default_factory=lambda: _fenv("AUDIO_SV_CONFIRM_MARGIN", 0.08))
    correct_margin: float = field(default_factory=lambda: _fenv("AUDIO_SV_CORRECT_MARGIN", 0.15))
    # Phase 3
    outlier_sim_min: float = field(default_factory=lambda: _fenv("AUDIO_SV_OUTLIER_SIM_MIN", 0.35))
    usable_min_segments: int = field(default_factory=lambda: _ienv("AUDIO_SV_USABLE_MIN_SEGMENTS", 2))
    usable_min_speech_sec: float = field(default_factory=lambda: _fenv("AUDIO_SV_USABLE_MIN_SPEECH_SEC", 3.0))
    usable_min_within_sim: float = field(default_factory=lambda: _fenv("AUDIO_SV_USABLE_MIN_WITHIN_SIM", 0.40))
    # If cosine(profile_A, profile_B) >= this, separation is too weak for auto-correct.
    weak_separation_cosine: float = field(
        default_factory=lambda: _fenv("AUDIO_SV_WEAK_SEPARATION_COSINE", 0.55)
    )
    boundary_validation: bool = field(
        default_factory=lambda: _bool_env("AUDIO_SV_BOUNDARY_VALIDATION", True)
    )
    boundary_window_sec: float = field(default_factory=lambda: _fenv("AUDIO_SV_BOUNDARY_WINDOW_SEC", 2.0))
    long_turn_validation: bool = field(
        default_factory=lambda: _bool_env("AUDIO_SV_LONG_TURN_VALIDATION", False)
    )
    long_turn_scan: bool = field(
        default_factory=lambda: _bool_env("AUDIO_SV_LONG_TURN_SCAN", False)
    )
    long_turn_min_sec: float = field(default_factory=lambda: _fenv("AUDIO_SV_LONG_TURN_MIN_SEC", 8.0))
    long_turn_window_sec: float = field(default_factory=lambda: _fenv("AUDIO_SV_LONG_TURN_WINDOW_SEC", 1.5))
    long_turn_hop_sec: float = field(default_factory=lambda: _fenv("AUDIO_SV_LONG_TURN_HOP_SEC", 0.75))
    long_turn_min_windows: int = field(default_factory=lambda: _ienv("AUDIO_SV_LONG_TURN_MIN_WINDOWS", 3))
    edge_trim_sec: float = 0.05
    target_sr: int = 16000
    unstable_boundary_pad_sec: float = 0.35


@dataclass
class ValidatedSegment:
    index: int
    start: float
    end: float
    text: str
    original_speaker: str
    validated_speaker: str
    status: ValidationStatus
    source: str
    reason: str
    similarity_score: Optional[float]
    margin: Optional[float]
    scores: dict[str, float] = field(default_factory=dict)


@dataclass
class SpeakerProfileBuild:
    speaker: str
    embedding: Optional[np.ndarray]
    quality: SpeakerProfileQuality


class EmbeddingCache:
    """Reuse ECAPA embeddings for identical (start,end) windows within one call."""

    def __init__(self, embed_fn: EmbedFn) -> None:
        self._fn = embed_fn
        self._cache: dict[tuple[int, int], np.ndarray] = {}
        self.hits = 0
        self.misses = 0

    def __call__(self, start: float, end: float) -> np.ndarray:
        key = (int(round(start * 1000)), int(round(end * 1000)))
        hit = self._cache.get(key)
        if hit is not None:
            self.hits += 1
            return hit
        self.misses += 1
        emb = self._fn(start, end)
        self._cache[key] = emb
        return emb


def find_speaker_islands(
    speakers: Sequence[str],
    starts: Sequence[float],
    ends: Sequence[float],
    *,
    max_dur: float,
) -> list[dict]:
    """Detect A…B…A (or B…A…B) islands with duration <= max_dur."""
    islands: list[dict] = []
    n = len(speakers)
    for i in range(1, n - 1):
        prev_s, cur_s, next_s = speakers[i - 1], speakers[i], speakers[i + 1]
        if prev_s == next_s and cur_s != prev_s:
            dur = float(ends[i]) - float(starts[i])
            if 0 < dur <= max_dur:
                islands.append(
                    {
                        "index": i,
                        "neighbor": prev_s,
                        "dur": dur,
                        "start": float(starts[i]),
                        "end": float(ends[i]),
                    }
                )
    return islands


def find_speaker_boundaries(
    speakers: Sequence[str],
    starts: Sequence[float],
    ends: Sequence[float],
) -> list[dict]:
    """Utterance-level A→B / B→A transitions (not islands)."""
    out: list[dict] = []
    for i in range(len(speakers) - 1):
        if speakers[i] == speakers[i + 1]:
            continue
        boundary_t = float(ends[i])  # nominal switch time
        out.append(
            {
                "left_index": i,
                "right_index": i + 1,
                "left_speaker": speakers[i],
                "right_speaker": speakers[i + 1],
                "boundary_t": boundary_t,
                "left_start": float(starts[i]),
                "left_end": float(ends[i]),
                "right_start": float(starts[i + 1]),
                "right_end": float(ends[i + 1]),
            }
        )
    return out


def _mean_unit(vectors: list[np.ndarray]) -> Optional[np.ndarray]:
    if not vectors:
        return None
    v = np.mean(np.stack(vectors, axis=0), axis=0)
    n = float(np.linalg.norm(v)) + 1e-8
    return (v / n).astype(np.float32)


def _mean_pairwise_sim(vectors: list[np.ndarray]) -> Optional[float]:
    if len(vectors) < 2:
        return 1.0 if len(vectors) == 1 else None
    sims: list[float] = []
    for i in range(len(vectors)):
        for j in range(i + 1, len(vectors)):
            sims.append(cosine_similarity(vectors[i], vectors[j]))
    return float(sum(sims) / len(sims)) if sims else None


def _filter_outliers(
    vectors: list[np.ndarray],
    durs: list[float],
    *,
    outlier_sim_min: float,
) -> tuple[list[np.ndarray], list[float], list[int], list[int]]:
    """Leave-one-out centroid filter. Returns accepted vecs/durs + accepted/rejected indices."""
    n = len(vectors)
    if n == 0:
        return [], [], [], []
    if n == 1:
        return vectors, durs, [0], []
    if n == 2:
        sim = cosine_similarity(vectors[0], vectors[1])
        if sim < outlier_sim_min:
            # Disagreeing pair: keep the longer segment only (less likely a short glitch).
            if durs[0] >= durs[1]:
                return [vectors[0]], [durs[0]], [0], [1]
            return [vectors[1]], [durs[1]], [1], [0]
        return vectors, durs, [0, 1], []
    accepted_idx: list[int] = []
    rejected_idx: list[int] = []
    for i in range(n):
        others = [vectors[j] for j in range(n) if j != i]
        centroid = _mean_unit(others)
        if centroid is None:
            accepted_idx.append(i)
            continue
        sim = cosine_similarity(vectors[i], centroid)
        if sim < outlier_sim_min:
            rejected_idx.append(i)
        else:
            accepted_idx.append(i)

    # If filtering wiped the profile, fall back to all candidates (conservative keep).
    if not accepted_idx:
        return vectors, durs, list(range(n)), []

    return (
        [vectors[i] for i in accepted_idx],
        [durs[i] for i in accepted_idx],
        accepted_idx,
        rejected_idx,
    )


def _classify_profile_status(
    *,
    accepted: int,
    speech_sec: float,
    within_sim: Optional[float],
    cfg: ValidationConfig,
) -> ProfileStatus:
    if accepted <= 0 or speech_sec <= 0:
        return "insufficient"
    within_ok = within_sim is None or within_sim >= cfg.usable_min_within_sim
    if accepted >= cfg.usable_min_segments and speech_sec >= cfg.usable_min_speech_sec and within_ok:
        return "usable"
    return "weak"


def build_robust_speaker_profiles(
    speakers: Sequence[str],
    starts: Sequence[float],
    ends: Sequence[float],
    texts: Sequence[str],
    embed: EmbedFn,
    *,
    cfg: ValidationConfig,
    exclude_indices: set[int],
    unstable_boundary_times: Sequence[float] | None = None,
) -> dict[str, SpeakerProfileBuild]:
    """Outlier-filtered mean profiles with quality stats (not probabilities)."""
    unstable = list(unstable_boundary_times or [])
    by_sp_vecs: dict[str, list[np.ndarray]] = {}
    by_sp_durs: dict[str, list[float]] = {}
    by_sp_cand: dict[str, int] = {}

    for i, sp in enumerate(speakers):
        if i in exclude_indices:
            continue
        dur = float(ends[i]) - float(starts[i])
        if dur < cfg.min_profile_sec:
            continue
        # Skip near highly unstable boundaries (rapid flips)
        mid = (float(starts[i]) + float(ends[i])) / 2.0
        if any(abs(mid - bt) < cfg.unstable_boundary_pad_sec for bt in unstable):
            continue
        a = float(starts[i]) + cfg.edge_trim_sec
        b = float(ends[i]) - cfg.edge_trim_sec
        if b - a < 0.2:
            continue
        emb = embed(a, b)
        if emb is None or emb.size == 0 or float(np.linalg.norm(emb)) < 1e-8:
            continue
        key = str(sp)
        by_sp_cand[key] = by_sp_cand.get(key, 0) + 1
        by_sp_vecs.setdefault(key, []).append(emb)
        by_sp_durs.setdefault(key, []).append(dur)

    builds: dict[str, SpeakerProfileBuild] = {}
    for sp, vecs in by_sp_vecs.items():
        durs = by_sp_durs[sp]
        accepted_vecs, accepted_durs, _acc_i, rej_i = _filter_outliers(
            vecs, durs, outlier_sim_min=cfg.outlier_sim_min
        )
        within = _mean_pairwise_sim(accepted_vecs)
        speech = float(sum(accepted_durs))
        status = _classify_profile_status(
            accepted=len(accepted_vecs),
            speech_sec=speech,
            within_sim=within,
            cfg=cfg,
        )
        # Duration-weighted mean among accepted (still L2-normalized).
        if accepted_vecs:
            weights = np.asarray(accepted_durs, dtype=np.float32)
            weights = weights / (weights.sum() + 1e-8)
            stacked = np.stack(accepted_vecs, axis=0)
            centroid = (stacked * weights[:, None]).sum(axis=0)
            emb = (centroid / (np.linalg.norm(centroid) + 1e-8)).astype(np.float32)
        else:
            emb = None
        quality = SpeakerProfileQuality(
            speaker=sp,
            candidate_segments=by_sp_cand.get(sp, 0),
            accepted_segments=len(accepted_vecs),
            rejected_segments=len(rej_i),
            accepted_speech_seconds=round(speech, 3),
            within_speaker_similarity=None if within is None else round(within, 4),
            profile_status=status,
        )
        builds[sp] = SpeakerProfileBuild(speaker=sp, embedding=emb, quality=quality)
    return builds


def build_speaker_profiles(
    speakers: Sequence[str],
    starts: Sequence[float],
    ends: Sequence[float],
    embed: EmbedFn,
    *,
    min_sec: float,
    exclude_indices: set[int],
    edge_trim_sec: float,
) -> dict[str, np.ndarray]:
    """Backward-compatible wrapper → robust profiles (embeddings only)."""
    cfg = ValidationConfig(min_profile_sec=min_sec, edge_trim_sec=edge_trim_sec)
    texts = [""] * len(speakers)
    builds = build_robust_speaker_profiles(
        speakers,
        starts,
        ends,
        texts,
        embed,
        cfg=cfg,
        exclude_indices=exclude_indices,
    )
    return {sp: b.embedding for sp, b in builds.items() if b.embedding is not None}


def score_against_profiles(emb: np.ndarray, profiles: dict[str, np.ndarray]) -> tuple[dict[str, float], Optional[str], float]:
    scores = {sp: cosine_similarity(emb, profiles[sp]) for sp in profiles}
    if not scores:
        return {}, None, 0.0
    best = max(scores, key=scores.get)
    ordered = sorted(scores.values(), reverse=True)
    margin = ordered[0] - ordered[1] if len(ordered) >= 2 else ordered[0]
    return scores, best, float(margin)


def decide_validation(
    *,
    original: str,
    neighbor: Optional[str],
    best: Optional[str],
    margin: float,
    dur: float,
    scores: dict[str, float],
    cfg: ValidationConfig,
    allow_correction: bool = True,
) -> tuple[str, ValidationStatus, str, Optional[float]]:
    """Return validated_speaker, status, reason, similarity_score (not a probability)."""
    if dur < cfg.min_speech_sec:
        return original, "insufficient_audio", "short_utterance", scores.get(original)

    if best is None or len(scores) < 2:
        return original, "uncertain", "missing_profiles", None

    sim_best = scores.get(best)
    if best == original and margin >= cfg.confirm_margin:
        return original, "confirmed", "acoustic_match", sim_best

    if (
        allow_correction
        and best != original
        and margin >= cfg.correct_margin
        and neighbor is not None
        and best == neighbor
    ):
        return best, "corrected", "acoustic_similarity", sim_best

    if best == original:
        return original, "confirmed", "acoustic_match_weak_margin", sim_best

    if not allow_correction and best != original:
        return original, "uncertain", "profiles_not_usable_for_correction", sim_best

    return original, "uncertain", "weak_or_conflicting_evidence", sim_best


def rebuild_utterances_from_words(
    words: list[DiarizedWord],
    *,
    speaker_attr: str = "speaker",
) -> list[DiarizedUtterance]:
    """Group consecutive words by speaker into utterances; preserve timestamps."""
    if not words:
        return []
    out: list[DiarizedUtterance] = []
    cur_speaker = getattr(words[0], speaker_attr)
    cur_start = words[0].start
    cur_end = words[0].end
    parts: list[str] = [words[0].word]
    confidences: list[float] = []
    if words[0].confidence is not None:
        confidences.append(float(words[0].confidence))

    def flush() -> None:
        text = " ".join(parts).strip()
        if not text:
            return
        mean_conf = sum(confidences) / len(confidences) if confidences else None
        out.append(
            DiarizedUtterance(
                speaker=str(cur_speaker),
                start=float(cur_start),
                end=float(cur_end),
                text=text,
                confidence=mean_conf,
            )
        )

    for w in words[1:]:
        sp = getattr(w, speaker_attr)
        if sp == cur_speaker:
            cur_end = w.end
            parts.append(w.word)
            if w.confidence is not None:
                confidences.append(float(w.confidence))
        else:
            flush()
            cur_speaker = sp
            cur_start = w.start
            cur_end = w.end
            parts = [w.word]
            confidences = [float(w.confidence)] if w.confidence is not None else []
    flush()
    return out


def _make_embed_fn(audio16: np.ndarray, sr: int, encoder: SpeakerEncoder) -> EmbedFn:
    def embed(start: float, end: float) -> np.ndarray:
        seg = slice_sec(audio16, sr, start, end)
        return encoder.encode(seg, sr)

    return embed


def _profiles_allow_correction(
    builds: dict[str, SpeakerProfileBuild],
    cfg: ValidationConfig,
) -> tuple[bool, Optional[float], Literal["ok", "weak", "unknown"], list[str]]:
    notes: list[str] = []
    keys = sorted(builds.keys())
    if len(keys) < 2:
        return False, None, "unknown", ["Fewer than two speaker profiles."]
    statuses = {k: builds[k].quality.profile_status for k in keys}
    if any(statuses[k] == "insufficient" for k in keys):
        notes.append("At least one speaker profile is insufficient.")
        return False, None, "unknown", notes
    if any(statuses[k] != "usable" for k in keys):
        notes.append("Speaker profiles not both usable; auto-correction disabled.")
        # still compute separation for diagnostics
    embs = {k: builds[k].embedding for k in keys if builds[k].embedding is not None}
    if len(embs) < 2:
        return False, None, "unknown", notes
    k0, k1 = keys[0], keys[1]
    sep = cosine_similarity(embs[k0], embs[k1])
    sep_status: Literal["ok", "weak", "unknown"] = (
        "weak" if sep >= cfg.weak_separation_cosine else "ok"
    )
    if sep_status == "weak":
        notes.append(
            f"Profile separation weak (cosine={sep:.3f} >= {cfg.weak_separation_cosine}); "
            "auto-correction disabled."
        )
        return False, sep, sep_status, notes
    both_usable = all(statuses[k] == "usable" for k in keys)
    if not both_usable:
        return False, sep, sep_status, notes
    return True, sep, sep_status, notes


def _group_words_by_duration(
    words: list[DiarizedWord],
    *,
    min_sec: float,
    from_start: bool,
) -> list[list[DiarizedWord]]:
    """Chunk words into groups of roughly min_sec speech."""
    if not words:
        return []
    ordered = list(words) if from_start else list(reversed(words))
    groups: list[list[DiarizedWord]] = []
    cur: list[DiarizedWord] = []
    dur = 0.0
    for w in ordered:
        cur.append(w)
        dur += max(0.0, float(w.end) - float(w.start))
        if dur >= min_sec:
            groups.append(cur if from_start else list(reversed(cur)))
            cur = []
            dur = 0.0
    # Do not use leftover short group for correction (insufficient_audio).
    return groups


def _validate_boundary_words(
    *,
    words: list[DiarizedWord],
    boundary: dict,
    profiles: dict[str, np.ndarray],
    embed: EmbedFn,
    cfg: ValidationConfig,
    allow_correction: bool,
    recording_id: str | None,
) -> tuple[list[DiarizedWord], int, int]:
    """Conservative early/late boundary word reassignment. Returns (words, corrections, uncertain)."""
    if not words or not allow_correction:
        return words, 0, 0

    t = float(boundary["boundary_t"])
    left_sp = str(boundary["left_speaker"])
    right_sp = str(boundary["right_speaker"])
    win = cfg.boundary_window_sec
    corrections = 0
    uncertain = 0

    # Working copy of speakers for this pass
    speakers = [w.speaker for w in words]
    metas: list[WordSpeakerValidation | None] = [w.speaker_validation for w in words]

    def reassign(idxs: list[int], new_sp: str, scores: dict[str, float], margin: float, reason: str) -> None:
        nonlocal corrections
        for i in idxs:
            original = speakers[i]
            if original == new_sp:
                continue
            speakers[i] = new_sp
            corrections += 1
            metas[i] = WordSpeakerValidation(
                original_speaker=original,
                validated_speaker=new_sp,
                speaker_validation_status="corrected",
                speaker_validation_source="audio_embedding_boundary",
                speaker_validation_reason=reason,
                speaker_validation_score=scores.get(new_sp),
                speaker_validation_margin=margin,
                similarity_original=scores.get(original),
                similarity_validated=scores.get(new_sp),
                similarity_to_a=scores.get("A"),
                similarity_to_b=scores.get("B"),
                boundary_shift=True,
            )
            logger.info(
                "[AUDIO_DIARIZATION] recordingId=%s region=%.2f-%.2f originalSpeaker=%s "
                "validatedSpeaker=%s score=%s margin=%s status=corrected reason=%s",
                recording_id or "-",
                words[i].start,
                words[i].end,
                original,
                new_sp,
                f"{scores.get(new_sp, 0):.3f}",
                f"{margin:.3f}",
                reason,
            )

    # Early boundary: leading right-side words actually sound like left speaker
    right_idxs = [
        i
        for i, w in enumerate(words)
        if speakers[i] == right_sp and t <= float(w.start) < t + win
    ]
    right_words = [words[i] for i in right_idxs]
    for group in _group_words_by_duration(right_words, min_sec=cfg.min_speech_sec, from_start=True):
        g_start = float(group[0].start)
        g_end = float(group[-1].end)
        emb = embed(g_start, g_end)
        scores, best, margin = score_against_profiles(emb, profiles)
        if best == left_sp and margin >= cfg.correct_margin:
            g_idxs = [
                i
                for i, w in enumerate(words)
                if any(abs(w.start - gw.start) < 1e-6 and abs(w.end - gw.end) < 1e-6 for gw in group)
            ]
            reassign(g_idxs, left_sp, scores, margin, "boundary_early_acoustic_mismatch")
        else:
            if best != right_sp and margin < cfg.correct_margin:
                uncertain += 1
            break  # stop walking further from boundary

    # Late boundary: trailing left-side words actually sound like right speaker
    left_idxs = [
        i
        for i, w in enumerate(words)
        if speakers[i] == left_sp and t - win < float(w.end) <= t
    ]
    left_words = [words[i] for i in left_idxs]
    for group in _group_words_by_duration(left_words, min_sec=cfg.min_speech_sec, from_start=False):
        g_start = float(group[0].start)
        g_end = float(group[-1].end)
        emb = embed(g_start, g_end)
        scores, best, margin = score_against_profiles(emb, profiles)
        if best == right_sp and margin >= cfg.correct_margin:
            g_idxs = [
                i
                for i, w in enumerate(words)
                if any(abs(w.start - gw.start) < 1e-6 and abs(w.end - gw.end) < 1e-6 for gw in group)
            ]
            reassign(g_idxs, right_sp, scores, margin, "boundary_late_acoustic_mismatch")
        else:
            if best != left_sp and margin < cfg.correct_margin:
                uncertain += 1
            break

    out_words: list[DiarizedWord] = []
    for i, w in enumerate(words):
        meta = metas[i]
        out_words.append(
            w.model_copy(
                update={
                    "speaker": speakers[i],
                    "speaker_raw": w.speaker_raw or w.speaker,
                    "speaker_validation": meta
                    if meta is not None
                    else w.speaker_validation,
                }
            )
        )
    return out_words, corrections, uncertain


def _scan_long_turns(
    *,
    units: list[DiarizedUtterance],
    profiles: dict[str, np.ndarray],
    embed: EmbedFn,
    cfg: ValidationConfig,
    allow_correction: bool,
    recording_id: str | None,
) -> tuple[int, int, list[tuple[int, str]]]:
    """Return (candidates, corrections, list of (unit_index, opposite_speaker) for diagnostics).

    Auto-correction only when AUDIO_SV_LONG_TURN_VALIDATION=true and streak is strong.
    A single anomalous window never creates a switch.
    """
    speakers = list(profiles.keys())
    if len(speakers) < 2:
        return 0, 0, []
    candidates = 0
    corrections = 0
    flagged: list[tuple[int, str]] = []

    for i, u in enumerate(units):
        dur = float(u.end) - float(u.start)
        if dur < cfg.long_turn_min_sec:
            continue
        original = u.speaker
        opposite = next((s for s in speakers if s != original), None)
        if opposite is None:
            continue

        best_streak = 0
        cur_streak = 0
        streak_start: float | None = None
        streak_end: float | None = None
        best_range: tuple[float, float] | None = None

        t = float(u.start)
        while t + cfg.long_turn_window_sec <= float(u.end) + 1e-6:
            w_end = t + cfg.long_turn_window_sec
            emb = embed(t, w_end)
            scores, best, margin = score_against_profiles(emb, profiles)
            if best == opposite and margin >= cfg.correct_margin:
                if cur_streak == 0:
                    streak_start = t
                streak_end = w_end
                cur_streak += 1
                if cur_streak > best_streak:
                    best_streak = cur_streak
                    best_range = (streak_start or t, streak_end or w_end)
            else:
                cur_streak = 0
                streak_start = None
                streak_end = None
            t += cfg.long_turn_hop_sec

        if best_streak >= cfg.long_turn_min_windows and best_range is not None:
            candidates += 1
            flagged.append((i, opposite))
            logger.info(
                "[AUDIO_DIARIZATION] recordingId=%s long_turn=%.2f-%.2f originalSpeaker=%s "
                "candidateOpposite=%s streak=%s status=missed_boundary_candidate",
                recording_id or "-",
                u.start,
                u.end,
                original,
                opposite,
                best_streak,
            )
            # Auto-correct disabled by default; only mark candidate unless flag on.
            # Even when enabled, we do NOT rewrite the whole turn — too aggressive.
            # Phase 3 only records candidates unless future eval supports safe splits.
            _ = allow_correction and cfg.long_turn_validation

    return candidates, corrections, flagged


def validate_speakers_audio(
    *,
    audio_path: str,
    utterances: list[DiarizedUtterance],
    words: list[DiarizedWord],
    encoder: SpeakerEncoder | None = None,
    embed_fn: EmbedFn | None = None,
    cfg: ValidationConfig | None = None,
    recording_id: str | None = None,
) -> tuple[list[DiarizedUtterance], list[DiarizedWord], SpeakerValidationSummary]:
    """Validate islands + optional boundaries using robust ECAPA profiles."""
    cfg = cfg or ValidationConfig()
    now = datetime.now(timezone.utc).isoformat()
    timing: dict[str, float] = {}

    if not utterances and not words:
        return utterances, words, SpeakerValidationSummary(enabled=True, status="skipped", method=None)

    units: list[DiarizedUtterance] = list(utterances) if utterances else rebuild_utterances_from_words(words)
    speakers = [u.speaker for u in units]
    starts = [u.start for u in units]
    ends = [u.end for u in units]
    texts = [u.text for u in units]

    islands = find_speaker_islands(speakers, starts, ends, max_dur=cfg.island_max_sec)
    exclude = {int(i["index"]) for i in islands}
    boundaries = find_speaker_boundaries(speakers, starts, ends)
    # Unstable = boundaries that are also part of islands (rapid flip zones)
    unstable_times = [float(i["start"]) for i in islands] + [float(i["end"]) for i in islands]

    t0 = time.perf_counter()
    if embed_fn is None:
        if encoder is None:
            encoder = get_ecapa_encoder()
        audio, sr = load_wav_mono(audio_path)
        audio16 = resample_linear(audio, sr, cfg.target_sr)
        raw_embed = _make_embed_fn(audio16, cfg.target_sr, encoder)
        method = encoder.name
    else:
        raw_embed = embed_fn
        method = getattr(encoder, "name", "injected_embed")
    embed = EmbeddingCache(raw_embed)
    timing["model_or_embed_setup_ms"] = (time.perf_counter() - t0) * 1000.0

    t1 = time.perf_counter()
    builds = build_robust_speaker_profiles(
        speakers,
        starts,
        ends,
        texts,
        embed,
        cfg=cfg,
        exclude_indices=exclude,
        unstable_boundary_times=unstable_times,
    )
    timing["profile_embedding_ms"] = (time.perf_counter() - t1) * 1000.0

    profiles = {sp: b.embedding for sp, b in builds.items() if b.embedding is not None}
    allow_correction, sep, sep_status, prof_notes = _profiles_allow_correction(builds, cfg)
    profile_status_map = {sp: b.quality.profile_status for sp, b in builds.items()}
    quality_list = [b.quality for b in builds.values()]

    if len(profiles) < 2:
        summary = SpeakerValidationSummary(
            enabled=True,
            status="completed",
            method=method,
            validated_at=now,
            corrections_count=0,
            suspicious_regions_count=len(islands),
            uncertain_regions_count=0,
            notes=prof_notes or ["Fewer than two speaker profiles; no acoustic corrections applied."],
            profile_status=profile_status_map,
            profile_quality=quality_list,
            profile_separation=sep,
            profile_separation_status=sep_status,
            islands_checked=len(islands),
            embedding_cache_hits=embed.hits,
            embedding_cache_misses=embed.misses,
            timing_ms={k: round(v, 2) for k, v in timing.items()},
        )
        return utterances, words, summary

    island_corrections = 0
    boundary_corrections = 0
    long_turn_corrections = 0
    uncertain = 0
    validated_units: list[DiarizedUtterance] = []
    island_by_idx = {int(i["index"]): i for i in islands}

    t2 = time.perf_counter()
    for i, u in enumerate(units):
        original = u.speaker
        validated = original
        status: ValidationStatus = "skipped"
        source = "assemblyai"
        reason = "not_suspicious"
        sim: Optional[float] = None
        margin: Optional[float] = None
        sim_orig: Optional[float] = None
        sim_val: Optional[float] = None
        scores: dict[str, float] = {}

        if i in island_by_idx:
            info = island_by_idx[i]
            dur = float(info["dur"])
            emb = embed(float(u.start), float(u.end))
            scores, best, margin_v = score_against_profiles(emb, profiles)
            margin = margin_v
            validated, status, reason, sim = decide_validation(
                original=original,
                neighbor=str(info["neighbor"]),
                best=best,
                margin=margin_v,
                dur=dur,
                scores=scores,
                cfg=cfg,
                allow_correction=allow_correction,
            )
            source = "audio_embedding_island"
            sim_orig = scores.get(original)
            sim_val = scores.get(validated)
            if status == "corrected":
                island_corrections += 1
            elif status in {"uncertain", "insufficient_audio"}:
                uncertain += 1

            logger.info(
                "[AUDIO_DIARIZATION] recordingId=%s region=%.2f-%.2f originalSpeaker=%s "
                "validatedSpeaker=%s score=%s margin=%s status=%s reason=%s",
                recording_id or "-",
                u.start,
                u.end,
                original,
                validated,
                f"{sim:.3f}" if sim is not None else "-",
                f"{margin:.3f}" if margin is not None else "-",
                status,
                reason,
            )

        meta = WordSpeakerValidation(
            original_speaker=original,
            validated_speaker=validated,
            speaker_validation_status=status,
            speaker_validation_source=source,
            speaker_validation_reason=reason,
            speaker_validation_score=sim,
            speaker_validation_margin=margin,
            similarity_original=sim_orig,
            similarity_validated=sim_val,
            similarity_to_a=scores.get("A") if scores else None,
            similarity_to_b=scores.get("B") if scores else None,
        )
        validated_units.append(
            u.model_copy(
                update={
                    "speaker": validated,
                    "speaker_raw": u.speaker_raw or original,
                    "speaker_validation": meta,
                }
            )
        )
    timing["island_validation_ms"] = (time.perf_counter() - t2) * 1000.0

    new_words = _apply_validation_to_words(words, validated_units)

    # Boundary validation (word-level when words exist)
    t3 = time.perf_counter()
    boundaries_checked = 0
    if cfg.boundary_validation and not words:
        logger.info(
            "[AUDIO_DIARIZATION] recordingId=%s boundary_validation=skipped reason=no_words",
            recording_id or "-",
        )
    if cfg.boundary_validation and new_words:
        # Refresh boundaries from post-island speakers on units
        post_speakers = [u.speaker for u in validated_units]
        post_starts = [u.start for u in validated_units]
        post_ends = [u.end for u in validated_units]
        post_boundaries = find_speaker_boundaries(post_speakers, post_starts, post_ends)
        boundaries_checked = len(post_boundaries)
        for b in post_boundaries:
            new_words, b_corr, b_unc = _validate_boundary_words(
                words=new_words,
                boundary=b,
                profiles=profiles,
                embed=embed,
                cfg=cfg,
                allow_correction=allow_correction,
                recording_id=recording_id,
            )
            boundary_corrections += b_corr
            uncertain += b_unc
    timing["boundary_validation_ms"] = (time.perf_counter() - t3) * 1000.0

    # Long-turn missed-boundary scan (CPU-heavy; off by default)
    t4 = time.perf_counter()
    missed_candidates = 0
    if cfg.long_turn_scan or cfg.long_turn_validation:
        missed_candidates, long_turn_corrections, _ = _scan_long_turns(
            units=validated_units,
            profiles=profiles,
            embed=embed,
            cfg=cfg,
            allow_correction=allow_correction and cfg.long_turn_validation,
            recording_id=recording_id,
        )
    timing["long_turn_validation_ms"] = (time.perf_counter() - t4) * 1000.0

    total_corrections = island_corrections + boundary_corrections + long_turn_corrections
    if total_corrections > 0 and new_words:
        rebuilt = rebuild_utterances_from_words(new_words)
        validated_units = _merge_utterance_meta(rebuilt, validated_units)

    timing["total_ms"] = sum(timing.values())
    notes = list(prof_notes)
    if not allow_correction:
        notes.append("Auto-correction gated by profile quality/separation.")

    summary = SpeakerValidationSummary(
        enabled=True,
        status="completed",
        method=method,
        validated_at=now,
        corrections_count=total_corrections,
        suspicious_regions_count=len(islands) + (missed_candidates if missed_candidates else 0),
        uncertain_regions_count=uncertain,
        notes=notes,
        profile_status=profile_status_map,
        profile_quality=quality_list,
        profile_separation=None if sep is None else round(sep, 4),
        profile_separation_status=sep_status,
        islands_checked=len(islands),
        island_corrections=island_corrections,
        boundaries_checked=boundaries_checked,
        boundary_corrections=boundary_corrections,
        missed_boundary_candidates=missed_candidates,
        long_turn_corrections=long_turn_corrections,
        embedding_cache_hits=embed.hits,
        embedding_cache_misses=embed.misses,
        timing_ms={k: round(v, 2) for k, v in timing.items()},
    )
    return validated_units, new_words, summary


def _apply_validation_to_words(
    words: list[DiarizedWord],
    validated_units: list[DiarizedUtterance],
) -> list[DiarizedWord]:
    if not words:
        return words
    out: list[DiarizedWord] = []
    for w in words:
        mid = (float(w.start) + float(w.end)) / 2.0
        match: DiarizedUtterance | None = None
        for u in validated_units:
            if float(u.start) - 1e-3 <= mid <= float(u.end) + 1e-3:
                match = u
                break
        if match is None:
            out.append(
                w.model_copy(
                    update={
                        "speaker_raw": w.speaker_raw or w.speaker,
                        "speaker_validation": WordSpeakerValidation(
                            original_speaker=w.speaker,
                            validated_speaker=w.speaker,
                            speaker_validation_status="skipped",
                            speaker_validation_source="assemblyai",
                            speaker_validation_reason="no_matching_utterance",
                        ),
                    }
                )
            )
            continue
        meta = match.speaker_validation or WordSpeakerValidation(
            original_speaker=match.speaker_raw or match.speaker,
            validated_speaker=match.speaker,
            speaker_validation_status="skipped",
        )
        out.append(
            w.model_copy(
                update={
                    "speaker": match.speaker,
                    "speaker_raw": w.speaker_raw or w.speaker,
                    "speaker_validation": meta,
                }
            )
        )
    return out


def _merge_utterance_meta(
    rebuilt: list[DiarizedUtterance],
    validated_units: list[DiarizedUtterance],
) -> list[DiarizedUtterance]:
    out: list[DiarizedUtterance] = []
    for u in rebuilt:
        mid = (u.start + u.end) / 2.0
        meta = None
        raw = u.speaker
        for v in validated_units:
            if float(v.start) - 1e-3 <= mid <= float(v.end) + 1e-3:
                meta = v.speaker_validation
                raw = v.speaker_raw or v.speaker
                break
        out.append(
            u.model_copy(
                update={
                    "speaker_raw": raw if meta is None else (meta.original_speaker if meta else raw),
                    "speaker_validation": meta,
                }
            )
        )
    return out


def maybe_validate_speakers(
    *,
    audio_path: str | None,
    utterances: list[DiarizedUtterance],
    words: list[DiarizedWord],
    skip: bool = False,
    recording_id: str | None = None,
    encoder: SpeakerEncoder | None = None,
    embed_fn: EmbedFn | None = None,
) -> tuple[list[DiarizedUtterance], list[DiarizedWord], SpeakerValidationSummary]:
    """Feature-flagged entry point. Safe no-op when disabled or unavailable."""
    if skip or not audio_speaker_validation_enabled():
        return (
            utterances,
            words,
            SpeakerValidationSummary(enabled=False, status="disabled"),
        )
    if not audio_path:
        return (
            utterances,
            words,
            SpeakerValidationSummary(
                enabled=True,
                status="skipped",
                notes=["No audio_path; acoustic validation skipped."],
            ),
        )
    if embed_fn is None and encoder is None and not ecapa_available():
        return (
            utterances,
            words,
            SpeakerValidationSummary(
                enabled=True,
                status="skipped",
                notes=["ECAPA dependencies/checkpoint unavailable; acoustic validation skipped."],
            ),
        )
    try:
        return validate_speakers_audio(
            audio_path=audio_path,
            utterances=utterances,
            words=words,
            encoder=encoder,
            embed_fn=embed_fn,
            recording_id=recording_id,
        )
    except Exception as exc:  # noqa: BLE001 — never fail the analyze pipeline
        logger.exception("[AUDIO_DIARIZATION] validation failed: %s", exc)
        return (
            utterances,
            words,
            SpeakerValidationSummary(
                enabled=True,
                status="failed",
                notes=[f"Acoustic validation failed: {exc}"],
            ),
        )
