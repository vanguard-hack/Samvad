from pydantic import BaseModel, Field


class Turn(BaseModel):
    role: str = Field(pattern="^(user|assistant)$")
    text: str = Field(max_length=4000)


class CalendarEntry(BaseModel):
    """One appointment on the doctor's Consultations calendar (sent by the browser, which holds the schedule)."""

    id: str = Field(pattern=r"^APT-\d{1,6}$")
    date: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    start: str = Field(pattern=r"^\d{2}:\d{2}$")
    end: str = Field(pattern=r"^\d{2}:\d{2}$")
    patient: str = Field(max_length=80)
    patient_id: str = Field(max_length=20)
    doctor: str = Field(max_length=80)
    department: str = Field(max_length=40)
    status: str = Field(max_length=20)


class AssistantIn(BaseModel):
    text: str = Field(min_length=1, max_length=2000)
    language: str = "en"
    path: str = Field(default="/", max_length=200)
    page_text: str = Field(default="", max_length=6000)
    history: list[Turn] = Field(default_factory=list, max_length=20)
    calendar: list[CalendarEntry] = Field(default_factory=list, max_length=300)
