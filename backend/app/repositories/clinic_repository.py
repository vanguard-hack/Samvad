"""The clinic's patients and doctors in Supabase, read as the signed-in doctor (RLS applies)."""

from typing import Any

from app.repositories.supabase_rest import SupabaseTable

PATIENT_COLUMNS = "id,patient_number,full_name,age,sex,language,conditions,clinic,visits"
DOCTOR_COLUMNS = "code,name,department"


class PatientRepository(SupabaseTable):
    table = "patients"
    label = "patients"

    async def get(self, patient_id: str) -> dict[str, Any] | None:
        """One of the doctor's patients by its database id (uuid), or None."""
        rows = await self._request("GET", params={"id": f"eq.{patient_id}", "select": PATIENT_COLUMNS})
        return rows[0] if rows else None


class DoctorRepository(SupabaseTable):
    table = "doctors"
    label = "doctors"

    async def list_active(self) -> list[dict[str, Any]]:
        return await self._request("GET", params={"active": "is.true", "select": DOCTOR_COLUMNS, "order": "name"}) or []

    async def get(self, code: str) -> dict[str, Any] | None:
        rows = await self._request("GET", params={"code": f"eq.{code}", "active": "is.true", "select": DOCTOR_COLUMNS})
        return rows[0] if rows else None
