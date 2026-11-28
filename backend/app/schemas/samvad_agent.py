from pydantic import BaseModel, Field


class AgentQueryIn(BaseModel):
    query: str = Field(default="What tools do you have? List all your functionalities.", min_length=1, max_length=4000)
    # Conversation id chosen by the browser. History is kept per doctor, so ids never collide across doctors.
    session_id: str = Field(default="default", min_length=1, max_length=100)


class AgentQueryOut(BaseModel):
    session_id: str
    response: str
    tools_available: list[str]
