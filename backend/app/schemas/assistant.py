from pydantic import BaseModel, Field


class Turn(BaseModel):
    role: str = Field(pattern="^(user|assistant)$")
    text: str = Field(max_length=4000)


class AssistantIn(BaseModel):
    text: str = Field(min_length=1, max_length=2000)
    language: str = "en"
    path: str = Field(default="/", max_length=200)
    page_text: str = Field(default="", max_length=6000)
    history: list[Turn] = Field(default_factory=list, max_length=20)
