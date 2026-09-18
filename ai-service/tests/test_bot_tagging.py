"""Tests for F09 Phase 2 + Phase 3 bot utterance tagging."""

from app.pipeline.bot_tagging import script_suggests_bot, tag_bot_utterances
from app.schemas import DiarizedUtterance, SpeakerMapping


def _utt(speaker: str, start: float, end: float, text: str) -> DiarizedUtterance:
    return DiarizedUtterance(speaker=speaker, start=start, end=end, text=text)


def _map(a: str = "A", b: str | None = "B") -> SpeakerMapping:
    mapping = {a: "agent"}
    if b:
        mapping[b] = "customer"
    return SpeakerMapping(
        mapping=mapping,
        agent_speaker=a,
        customer_speaker=b,
        confidence=0.9,
        method="test",
    )


def test_no_bot_on_normal_human_call():
    utterances = [
        _utt("A", 0, 3, "Hi, this is Shaurya calling from Data Fortune"),
        _utt("B", 3, 5, "Hello"),
        _utt("A", 5, 10, "I was hoping to speak with Logan about IT staffing"),
    ]
    roles, segment, _ = tag_bot_utterances(utterances, _map().mapping, _map(), {})
    assert segment.involved is False
    assert roles == ["agent", "customer", "agent"]


def test_script_tags_opening_bot_lines_with_freshcaller():
    utterances = [
        _utt("A", 0, 3, "Please hold while we connect you to an agent"),
        _utt("B", 3, 5, "Okay"),
        _utt("A", 20, 25, "Hi, my name is Surbhi calling from Datafortune"),
        _utt("B", 25, 28, "Hi"),
    ]
    mapping = _map()
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


def test_script_inferred_ivr_monologue_without_freshcaller():
    """Call 9065328-style: full menu IVR labeled as agent by map_speakers."""
    text = (
        "Like Portfolio Management llc, a debt collector. All calls may be monitored "
        "or recorded for quality and training purposes. If you are a customer, press one "
        "for all others, press two. Thank you for calling Westlake Portfolio Management. "
        "If you need to speak to a representative or virtual assistant, press 7. "
        "To return to the previous menu, press Start."
    )
    utterances = [_utt("A", 0.2, 45.0, text)]
    mapping = SpeakerMapping(
        mapping={"A": "agent"},
        agent_speaker="A",
        customer_speaker=None,
        confidence=0.5,
        method="single_speaker",
        mapping_uncertain=True,
    )
    assert script_suggests_bot(utterances) is True
    roles, segment, updated = tag_bot_utterances(utterances, mapping.mapping, mapping, {})
    assert segment.involved is True
    assert segment.method == "script_inferred"
    assert segment.handling == "bot_only"
    assert roles == ["bot"]
    assert updated["A"] == "bot"
    assert segment.tagged_utterance_count == 1


def test_script_inferred_record_name_ivr():
    utterances = [
        _utt(
            "A",
            0.2,
            41.0,
            "If you record your name and reason for calling, I'll see if this person is available.",
        )
    ]
    mapping = SpeakerMapping(
        mapping={"A": "agent"},
        agent_speaker="A",
        customer_speaker=None,
        confidence=0.5,
        method="single_speaker",
    )
    roles, segment, _ = tag_bot_utterances(utterances, mapping.mapping, mapping, {})
    assert segment.involved is True
    assert roles[0] == "bot"
    assert segment.method == "script_inferred"


def test_script_inferred_bot_then_agent_handoff():
    utterances = [
        _utt("A", 0, 4, "Thank you for calling Foundry Grove. Please hold"),
        _utt("B", 4, 6, "Okay"),
        _utt("A", 20, 26, "Hi, my name is Shaurya calling from Data Fortune"),
    ]
    mapping = _map()
    roles, segment, _ = tag_bot_utterances(utterances, mapping.mapping, mapping, {})
    assert segment.involved is True
    assert roles[0] == "bot"
    assert roles[1] == "customer"
    assert roles[2] == "agent"
    assert segment.handling == "bot_transferred"
    assert segment.method == "script_inferred"


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
