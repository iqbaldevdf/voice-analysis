"""Tests for F09 Phase 2 bot utterance tagging."""

from app.pipeline.bot_tagging import tag_bot_utterances
from app.schemas import DiarizedUtterance, SpeakerMapping


def _utt(speaker: str, start: float, end: float, text: str) -> DiarizedUtterance:
    return DiarizedUtterance(speaker=speaker, start=start, end=end, text=text)


def test_no_bot_when_flag_absent():
    utterances = [
        _utt("A", 0, 2, "Please hold while we connect you"),
        _utt("B", 2, 4, "Hello?"),
    ]
    mapping = SpeakerMapping(
        mapping={"A": "agent", "B": "customer"},
        agent_speaker="A",
        customer_speaker="B",
        confidence=0.9,
        method="test",
    )
    roles, segment, _ = tag_bot_utterances(utterances, mapping.mapping, mapping, {})
    assert segment.involved is False
    assert roles == ["agent", "customer"]


def test_script_tags_opening_bot_lines():
    utterances = [
        _utt("A", 0, 3, "Please hold while we connect you to an agent"),
        _utt("B", 3, 5, "Okay"),
        _utt("A", 20, 25, "Hi, my name is Surbhi calling from Datafortune"),
        _utt("B", 25, 28, "Hi"),
    ]
    mapping = SpeakerMapping(
        mapping={"A": "agent", "B": "customer"},
        agent_speaker="A",
        customer_speaker="B",
        confidence=0.9,
        method="test",
    )
    roles, segment, _ = tag_bot_utterances(
        utterances,
        mapping.mapping,
        mapping,
        {"botHandling": "bot_transferred", "isBotInvolved": True},
    )
    assert segment.involved is True
    assert roles[0] == "bot"
    assert roles[1] == "customer"
    assert roles[2] == "agent"
    assert segment.handoff_sec == 20.0
    assert segment.tagged_utterance_count >= 1


def test_third_speaker_mapped_to_bot():
    utterances = [
        _utt("C", 0, 4, "Thank you for calling, please wait"),
        _utt("B", 4, 6, "Hello"),
        _utt("A", 10, 14, "Hi this is the agent"),
    ]
    mapping = SpeakerMapping(
        mapping={"A": "agent", "B": "customer", "C": "unknown"},
        agent_speaker="A",
        customer_speaker="B",
        confidence=0.8,
        method="test",
    )
    roles, segment, updated = tag_bot_utterances(
        utterances,
        mapping.mapping,
        mapping,
        {"botHandling": "bot_transferred"},
    )
    assert segment.method == "third_speaker"
    assert updated["C"] == "bot"
    assert roles[0] == "bot"
    assert roles[2] == "agent"
