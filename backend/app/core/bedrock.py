"""Claude on Amazon Bedrock: one shared client for the voice assistant and intake parsing.

Credentials come from the standard AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY
variables (read by boto3); model and region from core/config.py.
"""

from anthropic import AsyncAnthropicBedrock
from fastapi import HTTPException, status

from app.core.config import get_settings

_client: AsyncAnthropicBedrock | None = None


def bedrock() -> AsyncAnthropicBedrock:
    global _client
    s = get_settings()
    if not s.bedrock_model or not s.aws_region:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Assistant is not configured")
    if _client is None:
        _client = AsyncAnthropicBedrock(aws_region=s.aws_region, timeout=60, max_retries=2)
    return _client
