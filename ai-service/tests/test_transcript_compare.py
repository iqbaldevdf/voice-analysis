from app.pipeline.transcript_compare import compare_transcripts


def test_identical_transcripts_auto_accept():
    text = "Hello, this is a test about payment not received yesterday."
    result = compare_transcripts(text, text)
    assert result.auto_accept is True
    assert result.wer == 0.0


def test_large_difference_not_auto_accept():
    a = "The payment was not received yesterday."
    b = "The payment was received yesterday."
    result = compare_transcripts(a, b)
    assert result.auto_accept is False
    assert result.critical_mismatches


def test_negation_mismatch_blocks_auto_accept_even_if_similar():
    a = "I did not agree to the plan."
    b = "I did agree to the plan."
    result = compare_transcripts(a, b)
    assert result.auto_accept is False
    assert any(m.get("type") == "negation" for m in result.critical_mismatches)
