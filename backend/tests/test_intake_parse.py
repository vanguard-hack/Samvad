from app.services.intake_parser import parse, parse_number, yes_no


def test_age():
    assert parse("age", "45", "45") == "45"
    assert parse("age", "पैंतालीस", "forty five years") == "45"
    assert parse("age", "x", "two hundred") is None


def test_sex():
    assert parse("sex", "", "I am a woman") == "F"
    assert parse("sex", "", "Male") == "M"
    assert parse("sex", "", "not sure") is None


def test_phone():
    assert parse("phone", "98765 43210", "") == "9876543210"
    assert parse("phone", "", "+91 98765 43210") == "9876543210"
    assert parse("phone", "nahi", "No") == ""
    assert parse("phone", "123", "one two three") is None


def test_lists_and_yes_no():
    assert parse("conditions", "", "I have sugar and BP") == ["diabetes", "hypertension"]
    assert parse("conditions", "", "No") == []
    assert parse("allergies", "", "No.") == ""
    assert parse("allergies", "", "Penicillin") == "Penicillin"
    assert parse("consent", "", "Yes, okay") == "given"
    assert parse("consent", "", "No, I don't want") == "declined"
    assert parse("confirm", "", "yes that is correct") == "yes"
    assert yes_no("maybe") is None
    assert parse_number("sixty two") == 62


def test_claude_value_normalising():
    from app.intake import normalise

    assert normalise("consent", "ok", "yes") == "given"
    assert normalise("consent", "ok", "declined") == "declined"
    assert normalise("age", "ok", "45") == "45" and normalise("age", "ok", "200") is None
    assert normalise("phone", "ok", "+91 98765 43210") == "9876543210"
    assert normalise("phone", "none", "") == ""
    assert normalise("conditions", "ok", "diabetes, BP") == ["diabetes", "hypertension"]
    assert normalise("conditions", "none", "") == []
    assert normalise("medicines", "ok", "Dolo 650") == "Dolo 650"
    assert normalise("name", "unclear", "") is None
