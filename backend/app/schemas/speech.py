from pydantic import BaseModel, Field


class TtsIn(BaseModel):
    text: str = Field(min_length=1, max_length=2500)
    language: str
    pace: float = Field(default=1.0, ge=0.5, le=2.0)


class TranslateIn(BaseModel):
    text: str = Field(min_length=1, max_length=2000)
    source: str
    target: str
