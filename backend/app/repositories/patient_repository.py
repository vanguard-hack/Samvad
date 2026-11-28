"""Patients in Supabase, read and written as the signed-in doctor.

Requests carry the doctor's own access token, so row-level security limits
them to that doctor's patients (no service-role key is used).
"""

from typing import Any

import httpx

from app.core.config import get_settings
from app.core.exceptions import ToolError

PATIENT_COLUMNS = (
    "id,patient_number,full_name,age,sex,phone,language,can_read,companion,allergies,conditions,medicines,"
    "consent,patient_words,clinic,reason,priority,queue_status,last_event,last_event_at,due_at,visits,last_visit,created_at"
)
LIST_COLUMNS = "id,patient_number,full_name,age,sex,language,clinic,reason,priority,queue_status,last_event,last_event_at,due_at"


class Db:
    def __init__(self, token: str):
        s = get_settings()
        self.base = f"{s.supabase_url}/rest/v1/patients"
        self.headers = {"apikey": s.supabase_publishable_key, "Authorization": f"Bearer {token}"}

    async def request(self, method: str, params: dict | None = None, body: Any = None, prefer: str | None = None) -> Any:
        headers = dict(self.headers)
        if prefer:
            headers["Prefer"] = prefer
        async with httpx.AsyncClient(timeout=15) as c:
            r = await c.request(method, self.base, params=params, json=body, headers=headers)
        if r.status_code >= 400:
            raise ToolError(f"Database error ({r.status_code}). {r.json().get('message', '') if r.content else ''}".strip())
        return r.json() if r.content else None
