from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field


class DiarizedWord(BaseModel):
    speaker: str
    start: float
    end: float
    word: str
    confidence: Optional[float] = None


class DiarizedUtterance(BaseModel):
    speaker: str
    start: float
    end: float
    text: str
    confidence: Optional[float] = None
    sentiment: Optional[Literal["POSITIVE", "NEUTRAL", "NEGATIVE"]] = None
    sentiment_confidence: Optional[float] = None


class SentimentSegment(BaseModel):
    speaker: Optional[str] = None
    start: float
    end: float
    text: str
    sentiment: Literal["POSITIVE", "NEUTRAL", "NEGATIVE"]
    confidence: float


class SpeakerMetrics(BaseModel):
    speaker: str
    role_guess: Optional[str] = None
    talk_time_sec: float
    talk_ratio_pct: float
    words_spoken: int
    words_per_minute: float
    avg_response_time_sec: Optional[float] = None
    filler_word_count: int
    fluency_score: float
    energy_score: float
    sentiment_positive_pct: float
    sentiment_neutral_pct: float
    sentiment_negative_pct: float


class InterruptEvent(BaseModel):
    start: float
    end: float
    speakers: list[str] = Field(default_factory=list)


class SentimentTimelinePoint(BaseModel):
    t: float
    score: float
    label: Literal["POSITIVE", "NEUTRAL", "NEGATIVE"]


class CallQuality(BaseModel):
    overall_score: float = Field(..., description="0-100 composite call quality")
    recording_quality_score: float = Field(..., description="0-100 from ASR confidence / clarity proxy")
    clarity_score: Optional[float] = Field(None, description="0-100 clarity used by the agent score page")
    speech_rate_score: Optional[float] = Field(None, description="0-100 agent speech-rate score, full marks 2.0-3.2 words/s")
    fluency_score: float
    energy_score: float
    avg_response_time_sec: float
    max_response_time_sec: float
    silence_ratio_pct: float
    silence_sec: float = 0.0
    overlap_or_interrupt_proxy: float
    interruptions_count: int = 0
    interruption_events: list[InterruptEvent] = Field(default_factory=list)
    overtalk_sec: float = 0.0
    overtalk_pct: float = 0.0
    customer_disconnected: bool
    disconnect_reason: Optional[str] = None
    disconnect_confidence: float = 0.0


class TopicWeight(BaseModel):
    topic: str
    weight_pct: float = 0.0


class KeyMoment(BaseModel):
    time_sec: float
    label: str
    speaker_role: Optional[str] = None


class AiExtraction(BaseModel):
    summary: Optional[str] = None
    key_topics: list[TopicWeight] = Field(default_factory=list)
    action_items: list[str] = Field(default_factory=list)
    agent_coaching_notes: list[str] = Field(default_factory=list)
    customer_intent: Optional[str] = None
    call_outcome: Optional[Literal["Successful", "Unsuccessful", "Unclear"]] = None
    tags: list[str] = Field(default_factory=list)
    key_moments: list[KeyMoment] = Field(default_factory=list)
    raw_llm_text: Optional[str] = None
    available: bool = False
    note: Optional[str] = None


class SentimentEmotion(BaseModel):
    label: str
    intensity: float = 0.0


class SentimentShift(BaseModel):
    at_sec: float
    from_label: Literal["POSITIVE", "NEUTRAL", "NEGATIVE"]
    to_label: Literal["POSITIVE", "NEUTRAL", "NEGATIVE"]
    note: Optional[str] = None


class SentimentHighlight(BaseModel):
    time_sec: float
    speaker: str
    text: str
    sentiment: Literal["POSITIVE", "NEUTRAL", "NEGATIVE"]
    reason: Optional[str] = None


class LlmSentimentAnalysis(BaseModel):
    overall: Optional[Literal["POSITIVE", "NEUTRAL", "NEGATIVE"]] = None
    agent_sentiment: Optional[Literal["POSITIVE", "NEUTRAL", "NEGATIVE"]] = None
    customer_sentiment: Optional[Literal["POSITIVE", "NEUTRAL", "NEGATIVE"]] = None
    opening_sentiment: Optional[Literal["POSITIVE", "NEUTRAL", "NEGATIVE"]] = None
    closing_sentiment: Optional[Literal["POSITIVE", "NEUTRAL", "NEGATIVE"]] = None
    overall_score: Optional[float] = None  # -100 .. 100
    polarity_confidence: Optional[float] = None  # 0 .. 1
    estimated_csat: Optional[float] = None  # 1 .. 5
    trajectory: Optional[Literal["improving", "declining", "stable", "volatile"]] = None
    emotions: list[SentimentEmotion] = Field(default_factory=list)
    shifts: list[SentimentShift] = Field(default_factory=list)
    risk_flags: list[str] = Field(default_factory=list)
    highlights: list[SentimentHighlight] = Field(default_factory=list)
    agent_empathy_score: Optional[float] = None  # 0 .. 100
    customer_frustration_score: Optional[float] = None  # 0 .. 100
    reasoning: Optional[str] = None
    key_moment_indices: list[int] = Field(default_factory=list)
    available: bool = False
    note: Optional[str] = None
    raw_llm_text: Optional[str] = None


class EvidenceRef(BaseModel):
    start: float = 0.0
    end: float = 0.0
    quote: str = ""
    note: Optional[str] = None


class ScoreExplanation(BaseModel):
    score: float = 0.0
    explanation: str = ""
    evidence: list[EvidenceRef] = Field(default_factory=list)


class IntroductionThemeResult(BaseModel):
    id: str
    label: str
    matched: bool = False
    matchedPhrase: Optional[str] = None
    quote: Optional[str] = None
    start: Optional[float] = None
    end: Optional[float] = None


class IntroductionScriptScore(BaseModel):
    score: float = 0.0
    rank: str = "Needs work"
    themesTotal: int = 0
    themesMatched: int = 0
    openingDurationSec: float = 0.0
    agentTurnsReviewed: int = 0
    themes: list[IntroductionThemeResult] = Field(default_factory=list)
    missedThemes: list[str] = Field(default_factory=list)
    evidence: list[EvidenceRef] = Field(default_factory=list)
    note: Optional[str] = None


class SpeakerMappingSignal(BaseModel):
    signal: str
    winner: str
    weight: float = 0.0
    detail: Optional[str] = None


class SpeakerMapping(BaseModel):
    mapping: dict[str, str] = Field(default_factory=dict)
    confidence: float = 0.0
    method: str = "unknown"
    mapping_uncertain: bool = False
    agent_speaker: Optional[str] = None
    customer_speaker: Optional[str] = None
    signals: list[SpeakerMappingSignal] = Field(default_factory=list)


class TranscriptDisplayLine(BaseModel):
    speaker: str
    role: str
    display_name: Optional[str] = None
    start: float
    end: float
    text: str


class ParticipantPerformanceAnalysis(BaseModel):
    speaker: str
    participantRole: str = "unknown"
    presentation: Literal["performance", "interaction"] = "interaction"
    displayName: Optional[str] = None
    available: bool = False
    note: Optional[str] = None
    overallScore: Optional[float] = None
    scores: dict[str, ScoreExplanation] = Field(default_factory=dict)
    strengths: list[str] = Field(default_factory=list)
    improvements: list[str] = Field(default_factory=list)
    recommendations: list[str] = Field(default_factory=list)
    evidence: list[EvidenceRef] = Field(default_factory=list)
    analysisVersion: str = "1"
    weights: dict[str, float] = Field(default_factory=dict)
    createdAt: Optional[str] = None
    updatedAt: Optional[str] = None
    totalTalkDuration: float = 0.0
    talkPercentage: float = 0.0
    speakingTurnCount: int = 0
    averageTurnDuration: float = 0.0
    longestTurnDuration: float = 0.0
    shortResponseCount: int = 0
    longMonologueCount: int = 0
    questionCount: int = 0
    averageResponseTime: Optional[float] = None
    interruptionCount: int = 0
    interruptedByOthersCount: int = 0
    repeatedQuestions: int = 0
    repeatedStatements: int = 0


class CallAnalysisResult(BaseModel):
    language: str
    duration_sec: float
    speakers: list[str] = Field(default_factory=list)
    speaker_mapping: SpeakerMapping = Field(default_factory=SpeakerMapping)
    transcript_display: list[TranscriptDisplayLine] = Field(default_factory=list)
    utterances: list[DiarizedUtterance] = Field(default_factory=list)
    words: list[DiarizedWord] = Field(default_factory=list)
    sentiment_segments: list[SentimentSegment] = Field(default_factory=list)
    sentiment_timeline: list[SentimentTimelinePoint] = Field(default_factory=list)
    llm_sentiment: LlmSentimentAnalysis = Field(default_factory=LlmSentimentAnalysis)
    speaker_metrics: list[SpeakerMetrics] = Field(default_factory=list)
    call_quality: CallQuality
    ai_extraction: AiExtraction
    participant_performance: list[ParticipantPerformanceAnalysis] = Field(default_factory=list)
    introduction_script: IntroductionScriptScore = Field(default_factory=IntroductionScriptScore)
    provider: str = "assemblyai"
    transcript_id: Optional[str] = None
    notes: list[str] = Field(default_factory=list)
