"""Appointments on Google Calendar + Supabase. Google and Supabase are mocked throughout."""

import asyncio
import base64
import datetime as dt
import json
from types import SimpleNamespace
from zoneinfo import ZoneInfo

import httpx
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.api.dependencies import current_session
from app.api.endpoints.appointments import appointment_repository
from app.core import config, google_calendar
from app.core.google_calendar import GoogleCalendar
from app.main import app
from app.repositories import appointment_repository as repository_module
from app.repositories.appointment_repository import AppointmentRepository
from app.schemas.appointments import Appointment
from app.services import appointment_event

IST = ZoneInfo("Asia/Kolkata")
USER = "doctor-uuid-1"
client = TestClient(app)

BODY = {
    "patient": {"id": "SMV-1001", "name": "Lakshmi Narayan", "age": 58, "sex": "F", "phone": "9876543214"},
    "doctor": {"id": "DOC-03", "name": "Dr. Farah Siddiqui", "department": "endocrinology"},
    "date": "2026-12-01",
    "start": "09:00",
    "end": "09:30",
    "language": "kn",
    "visit": 7,
}


# ---- fakes ----

class FakeCalendar:
    timezone = IST

    def __init__(self, events=None, fail: HTTPException | None = None):
        self.events = events or []
        self.fail = fail
        self.inserted: list[dict] = []
        self.list_args: tuple | None = None

    async def insert_event(self, event):
        if self.fail:
            raise self.fail
        self.inserted.append(event)
        return {**event, "id": "evt123", "htmlLink": "https://calendar.google.com/event?eid=evt123"}

    async def list_events(self, time_min, time_max, private_property):
        if self.fail:
            raise self.fail
        self.list_args = (time_min, time_max, private_property)
        return self.events


class FakeRepo:
    def __init__(self, fail_update: bool = False, fail_upsert: HTTPException | None = None):
        self.next_number = 2021
        self.rows: dict[str, dict] = {}
        self.deleted: list[str] = []
        self.upserted: list[dict] = []
        self.fail_update = fail_update
        self.fail_upsert = fail_upsert

    async def insert(self, details):
        appointment_id = f"APT-{self.next_number}"
        self.next_number += 1
        self.rows[appointment_id] = {}
        return appointment_id

    async def update(self, appointment_id, values):
        if self.fail_update:
            raise HTTPException(502, "db down")
        self.rows[appointment_id].update(values)

    async def delete(self, appointment_id):
        self.deleted.append(appointment_id)
        self.rows.pop(appointment_id, None)

    async def upsert(self, rows):
        if self.fail_upsert:
            raise self.fail_upsert
        self.upserted.extend(rows)


@pytest.fixture
def fakes():
    calendar, repo = FakeCalendar(), FakeRepo()
    app.dependency_overrides[current_session] = lambda: (USER, "token")
    app.dependency_overrides[google_calendar.google_calendar] = lambda: calendar
    app.dependency_overrides[appointment_repository] = lambda: repo
    yield SimpleNamespace(calendar=calendar, repo=repo)
    app.dependency_overrides.clear()


def sample_appointment(**changes) -> Appointment:
    return Appointment.model_validate({**BODY, "id": "APT-2021", **changes})


def sample_event(appointment: Appointment, owner: str = USER) -> dict:
    return {**appointment_event.to_event(appointment, owner, IST), "id": "evt123", "htmlLink": "https://cal/evt123"}


# ---- routes ----

def test_appointment_routes_need_sign_in():
    assert client.post("/api/appointments", json=BODY).status_code == 401
    assert client.post("/api/fetch-appointments", json={"from": "2026-12-01", "to": "2026-12-02"}).status_code == 401


def test_create_assigns_id_and_writes_details_to_the_event(fakes):
    r = client.post("/api/appointments", json=BODY)

    assert r.status_code == 201, r.text
    data = r.json()
    assert data["id"] == "APT-2021"
    assert data["patientId"] == "SMV-1001" and data["doctorId"] == "DOC-03"
    assert data["start"] == "09:00" and data["end"] == "09:30" and data["status"] == "scheduled"
    assert data["calendarEventId"] == "evt123"
    assert fakes.repo.rows["APT-2021"]["calendar_event_id"] == "evt123"

    event = fakes.calendar.inserted[0]
    assert event["summary"] == "APT-2021 · Lakshmi Narayan (SMV-1001) · Dr. Farah Siddiqui"
    assert event["start"] == {"dateTime": "2026-12-01T09:00:00", "timeZone": "Asia/Kolkata"}
    assert event["end"] == {"dateTime": "2026-12-01T09:30:00", "timeZone": "Asia/Kolkata"}
    assert event["extendedProperties"]["private"] == {"samvadAppointmentId": "APT-2021", "samvadOwner": USER}
    for line in ("Appointment ID: APT-2021", "Patient phone: 9876543214", "Department: endocrinology",
                 "Time slot: 09:00-09:30", "Language: kn", "Visit: 7"):
        assert line in event["description"]


def test_create_ids_are_sequential(fakes):
    ids = [client.post("/api/appointments", json=BODY).json()["id"] for _ in range(2)]
    assert ids == ["APT-2021", "APT-2022"]


def test_create_removes_the_row_when_the_calendar_fails(fakes):
    fakes.calendar.fail = HTTPException(502, "The calendar is not shared with sa@example.com")
    r = client.post("/api/appointments", json=BODY)
    assert r.status_code == 502
    assert r.json()["detail"] == "The calendar is not shared with sa@example.com"
    assert fakes.repo.deleted == ["APT-2021"] and not fakes.repo.rows


def test_create_still_succeeds_when_linking_the_event_fails(fakes):
    fakes.repo.fail_update = True
    r = client.post("/api/appointments", json=BODY)
    assert r.status_code == 201 and r.json()["calendarEventId"] == "evt123"


@pytest.mark.parametrize(
    "change",
    [
        {"end": "08:30"},
        {"language": "xx"},
        {"visit": 0},
        {"status": "cancelled"},
        {"patient": {**BODY["patient"], "id": "1001"}},
        {"patient": {**BODY["patient"], "phone": "12345"}},
        {"doctor": {**BODY["doctor"], "department": "dermatology"}},
        {"date": "01-12-2026"},
    ],
)
def test_create_rejects_invalid_details(fakes, change):
    assert client.post("/api/appointments", json={**BODY, **change}).status_code == 422
    assert not fakes.calendar.inserted


def test_fetch_syncs_and_returns_appointments_in_order(fakes):
    later = sample_appointment(id="APT-2022", start="11:00", end="11:30")
    earlier = sample_appointment()
    fakes.calendar.events = [sample_event(later), sample_event(earlier), {"id": "allday", "start": {"date": "2026-12-01"}}]

    r = client.post("/api/fetch-appointments", json={"from": "2026-12-01", "to": "2026-12-03"})

    assert r.status_code == 200, r.text
    data = r.json()
    assert [a["id"] for a in data["appointments"]] == ["APT-2021", "APT-2022"]
    assert data["synced"] == 2 and data["skippedEventIds"] == ["allday"]
    assert {row["appointment_id"] for row in fakes.repo.upserted} == {"APT-2021", "APT-2022"}
    time_min, time_max, prop = fakes.calendar.list_args
    assert time_min.isoformat() == "2026-12-01T00:00:00+05:30"
    assert time_max.isoformat() == "2026-12-04T00:00:00+05:30"  # 'to' is inclusive
    assert prop == f"samvadOwner={USER}"


def test_fetch_picks_up_changes_made_in_google_calendar(fakes):
    event = sample_event(sample_appointment())
    event["start"] = {"dateTime": "2026-12-02T04:30:00Z"}  # moved to 10:00 IST next day
    event["end"] = {"dateTime": "2026-12-02T05:00:00Z"}
    event["description"] = event["description"].replace("Status: scheduled", "Status: followUp")
    fakes.calendar.events = [event]

    a = client.post("/api/fetch-appointments", json={"from": "2026-12-01", "to": "2026-12-02"}).json()["appointments"][0]

    assert (a["date"], a["start"], a["end"], a["status"]) == ("2026-12-02", "10:00", "10:30", "followUp")
    assert fakes.repo.upserted[0]["appointment_date"] == "2026-12-02"


@pytest.mark.parametrize(
    ("body", "message"),
    [
        ({"from": "2026-12-05", "to": "2026-12-01"}, "'to' must be on or after 'from'"),
        ({"from": "2026-01-01", "to": "2026-12-31"}, "at most 92 days"),
        ({"from": "2026-12-01"}, "Field required"),
    ],
)
def test_fetch_rejects_bad_date_ranges(fakes, body, message):
    r = client.post("/api/fetch-appointments", json=body)
    assert r.status_code == 422 and message in r.text
    assert fakes.calendar.list_args is None


def test_fetch_reports_calendar_and_database_errors(fakes):
    fakes.calendar.fail = HTTPException(503, "Google Calendar is busy, try again shortly")
    r = client.post("/api/fetch-appointments", json={"from": "2026-12-01", "to": "2026-12-01"})
    assert r.status_code == 503 and r.json()["detail"] == "Google Calendar is busy, try again shortly"

    fakes.calendar.fail = None
    fakes.calendar.events = [sample_event(sample_appointment())]
    fakes.repo.fail_upsert = HTTPException(401, "Session expired, sign in again")
    r = client.post("/api/fetch-appointments", json={"from": "2026-12-01", "to": "2026-12-01"})
    assert r.status_code == 401


# ---- event <-> appointment ----

def test_event_round_trip():
    appointment = sample_appointment(notes="Bring old\nreports")
    parsed = appointment_event.from_event(sample_event(appointment), IST)
    assert parsed is not None
    assert parsed.model_dump(exclude={"calendar_event_id", "calendar_link"}) == appointment.model_dump(
        exclude={"calendar_event_id", "calendar_link", "notes"}
    ) | {"notes": "Bring old reports"}
    assert parsed.calendar_event_id == "evt123"


def test_unreadable_events_are_skipped():
    event = sample_event(sample_appointment())
    assert appointment_event.from_event({**event, "description": "Lunch"}, IST) is None
    assert appointment_event.from_event({**event, "start": {"date": "2026-12-01"}}, IST) is None


# ---- Google Calendar client (HTTP mocked) ----

def calendar_with(handler) -> GoogleCalendar:
    credentials = SimpleNamespace(valid=True, token="google-token", service_account_email="sa@proj.iam.gserviceaccount.com")
    http = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    return GoogleCalendar(credentials=credentials, calendar_id="clinic@group.calendar.google.com", timezone=IST, http=http)


def test_client_lists_every_page_with_the_owner_filter():
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        if "pageToken" not in request.url.params:
            return httpx.Response(200, json={"items": [{"id": "a"}], "nextPageToken": "p2"})
        return httpx.Response(200, json={"items": [{"id": "b"}]})

    start = dt.datetime(2026, 12, 1, tzinfo=IST)
    events = asyncio.run(calendar_with(handler).list_events(start, start + dt.timedelta(days=1), "samvadOwner=u1"))

    assert [e["id"] for e in events] == ["a", "b"]
    first = seen[0]
    assert first.url.raw_path.startswith(b"/calendar/v3/calendars/clinic%40group.calendar.google.com/events?")
    assert first.headers["Authorization"] == "Bearer google-token"
    assert first.url.params["privateExtendedProperty"] == "samvadOwner=u1"
    assert first.url.params["timeMin"] == "2026-12-01T00:00:00+05:30"
    assert first.url.params["singleEvents"] == "true" and first.url.params["orderBy"] == "startTime"
    assert seen[1].url.params["pageToken"] == "p2"


@pytest.mark.parametrize(
    ("google_status", "reason", "status", "message"),
    [
        (403, "forbidden", 502, "not shared with sa@proj.iam.gserviceaccount.com"),
        (403, "rateLimitExceeded", 503, "busy"),
        (429, "rateLimitExceeded", 503, "busy"),
        (404, "notFound", 502, "GOOGLE_CALENDAR_ID"),
        (401, "authError", 502, "credentials"),
        (500, "backendError", 503, "unavailable"),
        (400, "invalid", 502, "Bad time"),
    ],
)
def test_client_maps_google_errors(google_status, reason, status, message):
    def handler(_request):
        return httpx.Response(google_status, json={"error": {"message": "Bad time", "errors": [{"reason": reason}]}})

    with pytest.raises(HTTPException) as exc:
        asyncio.run(calendar_with(handler).insert_event({}))
    assert exc.value.status_code == status and message in exc.value.detail


def test_client_reports_network_failures():
    def handler(request):
        raise httpx.ConnectError("down", request=request)

    with pytest.raises(HTTPException) as exc:
        asyncio.run(calendar_with(handler).insert_event({}))
    assert exc.value.status_code == 503 and exc.value.detail == "Could not reach Google Calendar"


# ---- configuration ----

@pytest.fixture
def settings(monkeypatch):
    def use(**values):
        monkeypatch.setattr(google_calendar, "_calendar", None)
        monkeypatch.setattr(google_calendar, "get_settings", lambda: config.Settings(
            sarvam_api_key="", supabase_url="", supabase_publishable_key="", cors_origins=(), **values
        ))
    return use


@pytest.mark.parametrize(
    ("values", "message"),
    [
        ({}, "not configured"),
        ({"google_service_account_json": "{}", "google_calendar_id": "c"}, "credentials are invalid"),
        ({"google_service_account_json": "not-a-key", "google_calendar_id": "c"}, "credentials are invalid"),
        ({"google_service_account_json": '{"type": "service_account"}', "google_calendar_id": "c",
          "google_calendar_timezone": "Mars/Base"}, "not a valid time zone"),
    ],
)
def test_calendar_configuration_errors(settings, values, message):
    settings(**values)
    with pytest.raises(HTTPException) as exc:
        google_calendar.google_calendar()
    assert exc.value.status_code == 503 and message in exc.value.detail


def test_service_account_key_accepts_json_or_base64():
    key = {"type": "service_account", "client_email": "sa@x"}
    assert google_calendar._load_key(json.dumps(key)) == key
    assert google_calendar._load_key(base64.b64encode(json.dumps(key).encode()).decode()) == key


# ---- Supabase repository (HTTP mocked) ----

@pytest.fixture(autouse=True)
def supabase_settings(monkeypatch):
    monkeypatch.setattr(repository_module, "get_settings", lambda: config.Settings(
        sarvam_api_key="", supabase_url="https://db.example.supabase.co", supabase_publishable_key="pk", cors_origins=()
    ))


def repo_with(handler) -> AppointmentRepository:
    return AppointmentRepository(token="doctor-token", http=httpx.AsyncClient(transport=httpx.MockTransport(handler)))


def test_repository_insert_returns_the_assigned_id():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers["Authorization"] == "Bearer doctor-token"
        assert request.headers["Prefer"] == "return=representation"
        row = json.loads(request.content)
        assert row["patient_number"] == "SMV-1001" and row["start_time"] == "09:00" and "appointment_id" not in row
        return httpx.Response(201, json=[{"appointment_id": "APT-2001"}])

    assert asyncio.run(repo_with(handler).insert(sample_appointment())) == "APT-2001"


def test_repository_upserts_by_appointment_id():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.params["on_conflict"] == "appointment_id"
        assert request.headers["Prefer"].startswith("resolution=merge-duplicates")
        return httpx.Response(201)

    asyncio.run(repo_with(handler).upsert([{"appointment_id": "APT-2001"}]))


@pytest.mark.parametrize(
    ("db_status", "code", "status"),
    [(401, "PGRST301", 401), (403, "42501", 403), (409, "23505", 409), (400, "23514", 422), (404, "PGRST205", 503), (500, "XX000", 502)],
)
def test_repository_maps_database_errors(db_status, code, status):
    def handler(_request):
        return httpx.Response(db_status, json={"code": code, "message": "boom"})

    with pytest.raises(HTTPException) as exc:
        asyncio.run(repo_with(handler).delete("APT-2001"))
    assert exc.value.status_code == status


# ---- meeting link ----

def test_meeting_link_makes_the_event_joinable_and_survives_sync(fakes):
    link = "https://meet.google.com/abc-defg-hij"
    r = client.post("/api/appointments", json={**BODY, "meetingLink": link})
    assert r.status_code == 201 and r.json()["meetingLink"] == link
    event = fakes.calendar.inserted[0]
    assert event["location"] == link and f"Meeting link: {link}" in event["description"]

    fakes.calendar.events = [{**event, "id": "evt123"}]
    a = client.post("/api/fetch-appointments", json={"from": "2026-12-01", "to": "2026-12-01"}).json()["appointments"][0]
    assert a["meetingLink"] == link


def test_meeting_link_must_be_https(fakes):
    assert client.post("/api/appointments", json={**BODY, "meetingLink": "http://zoom.us/j/1"}).status_code == 422
    assert client.post("/api/appointments", json=BODY).status_code == 201
    assert "location" not in fakes.calendar.inserted[0]


# ---- status update ----

ROW = {
    "appointment_id": "APT-2021", "patient_number": "SMV-1001", "patient_name": "Lakshmi Narayan", "patient_age": 58,
    "patient_sex": "F", "patient_phone": None, "doctor_code": "DOC-03", "doctor_name": "Dr. Farah Siddiqui",
    "department": "endocrinology", "appointment_date": "2026-12-01", "start_time": "09:00:00", "end_time": "09:30:00",
    "language": "kn", "visit": 7, "status": "scheduled", "notes": None, "calendar_event_id": "evt123", "calendar_link": None,
}


def test_status_update_patches_the_event_and_the_row(fakes):
    event = sample_event(sample_appointment(meeting_link="https://meet.google.com/abc-defg-hij"))
    patched: list[tuple[str, dict]] = []

    async def get(self, appointment_id):
        return dict(ROW) if appointment_id == "APT-2021" else None

    async def get_event(event_id):
        return event

    async def patch_event(event_id, changes):
        patched.append((event_id, changes))
        return {**event, **changes}

    fakes.repo.rows["APT-2021"] = {}
    fakes.repo.get = get.__get__(fakes.repo)
    fakes.calendar.get_event, fakes.calendar.patch_event = get_event, patch_event

    r = client.patch("/api/appointments/APT-2021", json={"status": "followUp"})

    assert r.status_code == 200, r.text
    assert r.json()["status"] == "followUp" and r.json()["meetingLink"] == "https://meet.google.com/abc-defg-hij"
    assert patched[0][0] == "evt123" and "Status: followUp" in patched[0][1]["description"]
    assert "Meeting link: https://meet.google.com/abc-defg-hij" in patched[0][1]["description"]
    assert fakes.repo.rows["APT-2021"]["status"] == "followUp"

    assert client.patch("/api/appointments/APT-9999", json={"status": "closed"}).status_code == 404
    assert client.patch("/api/appointments/APT-2021", json={"status": "cancelled"}).status_code == 422
    assert client.patch("/api/appointments/nope", json={"status": "closed"}).status_code == 422


def test_status_update_needs_sign_in():
    assert client.patch("/api/appointments/APT-2021", json={"status": "closed"}).status_code == 401


def test_row_maps_back_to_an_appointment():
    a = repository_module.from_row(ROW)
    assert (a.id, a.patient.name, a.doctor.department, a.start.strftime("%H:%M")) == ("APT-2021", "Lakshmi Narayan", "endocrinology", "09:00")
