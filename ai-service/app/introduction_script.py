"""Score how well the agent covers the Datafortune customer introduction script."""

from __future__ import annotations

import re
from dataclasses import dataclass

from app.schemas import DiarizedUtterance, EvidenceRef, IntroductionScriptScore, IntroductionThemeResult

# How much of the call start counts as the "introduction".
OPENING_MAX_SEC = float(__import__("os").getenv("INTRO_OPENING_MAX_SEC", "120"))
MAX_AGENT_TURNS = int(__import__("os").getenv("INTRO_MAX_AGENT_TURNS", "10"))


@dataclass(frozen=True)
class _Theme:
    id: str
    label: str
    phrases: tuple[str, ...]


# Similar-word groups — substring match on normalized agent speech (not exact script reading).
INTRO_THEMES: tuple[_Theme, ...] = (
    _Theme(
        "company_brand",
        "Datafortune & AI-first positioning",
        (
            "datafortune",
            "data fortune",
            "ai-first",
            "ai first",
            "ai enabled",
            "ai-enabled",
            "engineering solutions",
            "engineering company",
            "engineering partner",
            "competitive advantage",
            "technology advantage",
            "turn technology",
            "technology into",
        ),
    ),
    _Theme(
        "core_expertise",
        "Application, product, data & BI expertise",
        (
            "application engineering",
            "product engineering",
            "application and product",
            "app engineering",
            "data management",
            "business intelligence",
            "data platform",
            "data engineering",
            "analytics",
            "better outcomes",
        ),
    ),
    _Theme(
        "engagement_model",
        "Flexible engagement & scaling capacity",
        (
            "flexible engagement",
            "engagement model",
            "engagement models",
            "scale engineering",
            "scale capacity",
            "engineering capacity",
            "dedicated engineer",
            "dedicated team",
            "extend your team",
            "staff augmentation",
        ),
    ),
    _Theme(
        "delivery_ownership",
        "End-to-end ownership & delivery",
        (
            "end to end",
            "end-to-end",
            "take ownership",
            "full ownership",
            "solution engineering",
            "through delivery",
            "delivery and execution",
            "from design to delivery",
            "own the initiative",
            "defined initiatives",
        ),
    ),
)


def _normalize(text: str) -> str:
    lowered = text.lower()
    cleaned = re.sub(r"[^\w\s-]", " ", lowered)
    cleaned = cleaned.replace("-", " ")
    return re.sub(r"\s+", " ", cleaned).strip()


def _rank_label(score: float) -> str:
    if score >= 80:
        return "Excellent"
    if score >= 60:
        return "Good"
    if score >= 40:
        return "Fair"
    return "Needs work"


def _agent_opening_text(
    utterances: list[DiarizedUtterance],
    agent_speakers: set[str],
) -> tuple[str, list[DiarizedUtterance], float]:
    if not agent_speakers:
        return "", [], 0.0

    selected: list[DiarizedUtterance] = []
    for utt in utterances:
        if utt.speaker not in agent_speakers:
            continue
        if selected and utt.start > OPENING_MAX_SEC:
            break
        if len(selected) >= MAX_AGENT_TURNS:
            break
        if utt.text.strip():
            selected.append(utt)

    if not selected:
        return "", [], 0.0

    combined = " ".join(utt.text for utt in selected)
    opening_end = max(utt.end for utt in selected)
    return _normalize(combined), selected, opening_end


def _match_theme(theme: _Theme, text: str, utterances: list[DiarizedUtterance]) -> IntroductionThemeResult:
    for phrase in theme.phrases:
        needle = _normalize(phrase)
        if not needle or needle not in text:
            continue
        for utt in utterances:
            if needle in _normalize(utt.text):
                return IntroductionThemeResult(
                    id=theme.id,
                    label=theme.label,
                    matched=True,
                    matchedPhrase=phrase,
                    quote=utt.text.strip()[:240],
                    start=utt.start,
                    end=utt.end,
                )
        return IntroductionThemeResult(
            id=theme.id,
            label=theme.label,
            matched=True,
            matchedPhrase=phrase,
        )
    return IntroductionThemeResult(id=theme.id, label=theme.label, matched=False)


def score_introduction_script(
    utterances: list[DiarizedUtterance],
    role_hints: dict[str, str],
) -> IntroductionScriptScore:
    agent_speakers = {speaker for speaker, role in role_hints.items() if role == "agent"}
    text, opening_utts, opening_end = _agent_opening_text(utterances, agent_speakers)

    if not agent_speakers:
        return IntroductionScriptScore(
            score=0.0,
            rank="Needs work",
            themesTotal=len(INTRO_THEMES),
            note="Agent speaker could not be identified.",
        )
    if not text:
        return IntroductionScriptScore(
            score=0.0,
            rank="Needs work",
            themesTotal=len(INTRO_THEMES),
            openingDurationSec=0.0,
            agentTurnsReviewed=0,
            note="No agent speech found in the opening window.",
        )

    themes = [_match_theme(theme, text, opening_utts) for theme in INTRO_THEMES]
    matched = [theme for theme in themes if theme.matched]
    total = len(themes)
    score = round((len(matched) / total) * 100, 1) if total else 0.0
    missed = [theme.label for theme in themes if not theme.matched]

    evidence = [
        EvidenceRef(start=theme.start or 0.0, end=theme.end or theme.start or 0.0, quote=theme.quote or "", note=theme.label)
        for theme in matched
        if theme.quote
    ]

    return IntroductionScriptScore(
        score=score,
        rank=_rank_label(score),
        themesTotal=total,
        themesMatched=len(matched),
        openingDurationSec=round(opening_end, 1),
        agentTurnsReviewed=len(opening_utts),
        themes=themes,
        missedThemes=missed,
        evidence=evidence[:8],
    )
