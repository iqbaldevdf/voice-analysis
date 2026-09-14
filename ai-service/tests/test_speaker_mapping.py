from app.pipeline.speaker_mapping import map_speakers
from app.schemas import DiarizedUtterance


def test_outgoing_call_customer_answers_first_agent_pitches():
    """Regression: call 9053016 — customer (A) answers, agent (B) verifies name and pitches."""
    utterances = [
        DiarizedUtterance(speaker="A", start=0.8, end=4.64, text="Oh. Hello?"),
        DiarizedUtterance(speaker="B", start=5.36, end=5.84, text="Hello."),
        DiarizedUtterance(speaker="A", start=7.2, end=8.16, text="Hi. How's it going?"),
        DiarizedUtterance(speaker="B", start=9.2, end=12.48, text="Hi. I'm good. Is this Mr. Oliver Morsi?"),
        DiarizedUtterance(speaker="A", start=14.08, end=15.68, text="Yeah, it is. How's it going?"),
        DiarizedUtterance(
            speaker="A",
            start=21.28,
            end=26.96,
            text="Great. Yeah. Is there. So what's. What's the call in regards to?",
        ),
        DiarizedUtterance(
            speaker="B",
            start=27.54,
            end=39.06,
            text="Yeah, yeah. Actually, Oliver, I was just looking into your company.",
        ),
        DiarizedUtterance(
            speaker="A",
            start=40.66,
            end=48.9,
            text="Yeah, yeah, yeah. Listen, I. I'm super busy right now. I don't think I can take this call.",
        ),
    ]
    context = {
        "direction": "outgoing",
        "agentName": "Surbhi Pradhan",
        "participants": [
            {"role": "Customer", "name": "Olivier Morissette"},
            {"role": "Agent", "name": None},
        ],
    }
    result = map_speakers(utterances, context)
    assert result.mapping["A"] == "customer"
    assert result.mapping["B"] == "agent"
    assert result.agent_speaker == "B"
    assert result.customer_speaker == "A"


def test_screening_prompt_then_agent_pitch_customer_answers():
    """Regression: call 9040058 — Google screening on A, agent Surbhi pitches, customer Jaydon."""
    utterances = [
        DiarizedUtterance(
            speaker="A",
            start=0.08,
            end=15.6,
            text=(
                "If you record your name and reason for calling, I'll see if this person is available. "
                "My name is Serbi. Thanks. Please stay on the line."
            ),
        ),
        DiarizedUtterance(speaker="B", start=19.92, end=20.88, text="Exordium started."),
        DiarizedUtterance(
            speaker="A",
            start=22.32,
            end=27.55,
            text="Hi Jaden, this is Survey calling you from Data Fortune. How are you today?",
        ),
        DiarizedUtterance(speaker="B", start=28.59, end=30.19, text="I'm doing fine, how are you?"),
        DiarizedUtterance(
            speaker="A",
            start=31.15,
            end=40.11,
            text="I'm good, I'm good. Jaden, actually I spoke with you on Monday.",
        ),
        DiarizedUtterance(
            speaker="B",
            start=40.43,
            end=45.31,
            text="Yeah, I did. Sorry, I haven't had time to check it out.",
        ),
    ]
    context = {
        "direction": "outgoing",
        "agentName": "Surbhi Pradhan",
        "participants": [
            {"role": "Customer", "name": "Jaydon Alvarez"},
            {"role": "Agent", "name": None},
        ],
    }
    result = map_speakers(utterances, context)
    assert result.mapping["A"] == "agent"
    assert result.mapping["B"] == "customer"
    assert result.agent_speaker == "A"
    assert result.customer_speaker == "B"


def test_customer_says_this_is_name_agent_introduces_self():
    """Regression: call 9051938 — Corey answers 'This is Corey', agent Shaurya introduces."""
    utterances = [
        DiarizedUtterance(speaker="A", start=2.32, end=2.92, text="This is Corey."),
        DiarizedUtterance(
            speaker="B",
            start=2.92,
            end=7.52,
            text="Hello? Hey, good morning, Corey. Hi, it's Shaurya. How's your day going?",
        ),
        DiarizedUtterance(
            speaker="A",
            start=8.48,
            end=10.8,
            text="Good. Where are you calling from, brother? I'm busy at work.",
        ),
        DiarizedUtterance(
            speaker="B",
            start=11.68,
            end=36.72,
            text="I understand that, Corey. Well, I'm calling in regards to your company.",
        ),
    ]
    context = {
        "direction": "outgoing",
        "agentName": "Shourya Anand",
        "participants": [
            {"role": "Customer", "name": "Corey Gray"},
            {"role": "Agent", "name": None},
        ],
    }
    result = map_speakers(utterances, context)
    assert result.mapping["A"] == "customer"
    assert result.mapping["B"] == "agent"


def test_user_override_skips_heuristics():
    utterances = [
        DiarizedUtterance(speaker="A", start=0.0, end=1.0, text="Hi there"),
        DiarizedUtterance(speaker="B", start=1.0, end=2.0, text="Hello"),
    ]
    result = map_speakers(
        utterances,
        {"direction": "outgoing"},
        speaker_override={"A": "agent", "B": "customer"},
    )
    assert result.method == "user_override"
    assert result.mapping["A"] == "agent"
    assert result.mapping["B"] == "customer"
    assert result.mapping_uncertain is False
