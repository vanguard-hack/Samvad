from pydantic import BaseModel, Field

from app.schemas.appointments import Appointment


class AgentQueryIn(BaseModel):
    query: str = Field(min_length=1, max_length=4000)
    # Conversation id chosen by the browser. History is kept per doctor, so ids never collide across doctors.
    session_id: str = Field(default="default", min_length=1, max_length=100)
    # The doctor's interface language (a LANGUAGES code); the agent answers in it.
    language: str = Field(default="en", pattern=r"^[a-z]{2,3}$")


class AgentQueryOut(BaseModel):
    """What the Samvad Assistant page renders. Internal tool names are never included."""

    session_id: str
    response: str = Field(description="The whole answer as plain text (paragraphs joined by blank lines)")
    paragraphs: list[str] = Field(description="The answer, one plain-text paragraph per item")
    appointment_ids: list[str] = Field(description="Appointments to show as cards, in order")
    appointments: list[Appointment] = Field(description="Those appointments' details (camelCase, as /api/fetch-appointments)")
    suggestions: list[str] = Field(description="Up to 3 follow-up questions, in the doctor's language")
