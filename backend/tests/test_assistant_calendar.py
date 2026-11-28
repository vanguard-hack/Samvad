"""The voice assistant's calendar access: the schedule in the request and the show_appointment page tool."""

import pytest
from pydantic import ValidationError

from app.core.exceptions import ToolError
from app.schemas.assistant import AssistantIn
from app.services.assistant_tools import PAGES, TOOLS, UI_TOOLS, ui_action

ENTRY = {
    "id": "APT-2001",
    "date": "2026-11-28",
    "start": "09:00",
    "end": "09:30",
    "patient": "Lakshmi Narayan",
    "patient_id": "SMV-1001",
    "doctor": "Dr. Farah Siddiqui",
    "department": "endocrinology",
    "status": "needsReview",
}


def test_show_appointment_is_a_page_tool():
    assert "show_appointment" in UI_TOOLS
    assert any(t["name"] == "show_appointment" for t in TOOLS)
    assert {"consultations", "samvad-assistant"} <= set(PAGES)


def test_show_appointment_becomes_a_browser_action():
    action, result = ui_action("show_appointment", {"appointment_id": " apt-2001 "})
    assert action == {"type": "show_appointment", "appointment_id": "APT-2001"}
    assert "calendar" in result


@pytest.mark.parametrize("bad", ["", "2001", "SMV-1001", "APT-", "APT-12; drop"])
def test_show_appointment_rejects_other_ids(bad):
    with pytest.raises(ToolError):
        ui_action("show_appointment", {"appointment_id": bad})


def test_request_carries_the_calendar():
    body = AssistantIn(text="show Lakshmi's appointment", calendar=[ENTRY])
    assert body.calendar[0].patient == "Lakshmi Narayan"
    assert AssistantIn(text="hi").calendar == []


def test_calendar_entries_are_validated():
    with pytest.raises(ValidationError):
        AssistantIn(text="hi", calendar=[{**ENTRY, "id": "<script>"}])
    with pytest.raises(ValidationError):
        AssistantIn(text="hi", calendar=[{**ENTRY, "date": "28 Nov"}])
