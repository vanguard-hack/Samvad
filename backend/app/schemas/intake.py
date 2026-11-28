from pydantic import BaseModel, Field


class PromptIn(BaseModel):
    key: str
    language: str
    # Read-back text for the "confirm" prompt, in the patient's language or digits.
    value: str | None = Field(default=None, max_length=300)


class ParseIn(BaseModel):
    field: str
    language: str
    text: str = Field(min_length=1, max_length=1000)
