"""Appointments on Google Calendar + Supabase. Google and Supabase are mocked throughout."""

import asyncio
import datetime as dt
import json
from types import SimpleNamespace
from zoneinfo import ZoneInfo

import httpx
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.api.dependencies import current_email, current_session
from app.api.endpoints.appointments import appointment_repository, doctor_repository, patient_repository
from app.core import config, google_calendar
from app.core.google_calendar import GoogleCalendar
from app.main import app
from app.repositories import appointment_repository as repository_module
from app.repositories import supabase_rest
from app.repositories.appointment_repository import AppointmentRepository
from app.schemas.appointments import Appointment
from app.services import appointment_event, appointment_service

IST = ZoneInfo("Asia/Kolkata")
USER = "doctor-uuid-1"
EMAIL = "doctor@example.com"
PATIENT_ID = "6f1d2c3b-0a9e-4d8c-b7a6-5e4f3d2c1b0a"
DAY = "2027-01-05"  # a Tuesday comfortably in the future
client = TestClient(app)

APPOINTMENT = {
    "patient": {"id": "SMV-1001", "name": "Lakshmi Narayan", "age": 58, "sex": "F"},
    "doctor": {"id": "DOC-03", "name": "Dr. Farah Siddiqui", "department": "endocrinology"},
    "date": DAY,
    "start": "09:00",
    "end": "09:30",
    "language": "kn",
    "visit": 7,
}
BOOKING = {"date": DAY, "start": "10:00", "end": "10:30", "patientId": PATIENT_ID, "doctorId": "DOC-03"}
PATIENT_ROW = {
    "id": PATIENT_ID, "patient_number": 1001, "full_name": "Lakshmi Narayan", "age": 58, "sex": "F",
    "language": "kn", "conditions": ["diabetes"], "clinic": None, "visits": 6,
}
DOCTOR_ROWS = [
    {"code": "DOC-01", "name": "Dr. Kavita Menon", "department": "generalMedicine"},
    {"code": "DOC-02", "name": "Dr. Arjun Reddy", "department": "cardiology"},
    {"code": "DOC-03", "name": "Dr. Farah Siddiqui", "department": "endocrinology"},
]


# ---- fakes ----

class FakeCalendar:
    timezone = IST

    def __init__(self):
        self.events: list[dict] = []
        self.fail: HTTPException | None = None
        self.inserted: list[dict] = []
        self.notified: list[bool] = []
        self.list_args: list[tuple] = []

    async def insert_event(self, event, *, notify_guests=False):
        if self.fail:
            raise self.fail
        self.inserted.append(event)
        self.notified.append(notify_guests)
        return {**event, "id": "evt123", "htmlLink": "https://calendar.google.com/event?eid=evt123",
                "hangoutLink": "https://meet.google.com/abc-defg-hij"}

    async def list_events(self, time_min, time_max, private_property=None):
        if self.fail:
            raise self.fail
        self.list_args.append((time_min, time_max, private_property))
        return self.events


class FakeRepo:
    def __init__(self):
        self.next_number = 2021
        self.rows: dict[str, dict] = {}
        self.deleted: list[str] = []
        self.upserted: list[dict] = []
        self.fail_update = False
        self.fail_upsert: HTTPException | None = None

    async def insert(self, details):
        appointment_id = f"APT-{self.next_number}"
        self.next_number += 1
        self.rows[appointment_id] = {"details": details}
        return appointment_id

    async def get(self, appointment_id):
        return None

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


class FakePatients:
    def __init__(self):
        self.rows = {PATIENT_ID: dict(PATIENT_ROW)}

    async def get(self, patient_id):
        return self.rows.get(patient_id)


class FakeDoctors:
    async def list_active(self):
        return [dict(d) for d in DOCTOR_ROWS]

    async def get(self, code):
        return next((dict(d) for d in DOCTOR_ROWS if d["code"] == code), None)


@pytest.fixture
def fakes():
    calendar, repo, patients, doctors = FakeCalendar(), FakeRepo(), FakePatients(), FakeDoctors()
    app.dependency_overrides[current_session] = lambda: (USER, "token")
    app.dependency_overrides[current_email] = lambda: EMAIL
    app.dependency_overrides[google_calendar.google_calendar] = lambda: calendar
    app.dependency_overrides[appointment_repository] = lambda: repo
    app.dependency_overrides[patient_repository] = lambda: patients
    app.dependency_overrides[doctor_repository] = lambda: doctors
    yield SimpleNamespace(calendar=calendar, repo=repo, patients=patients)
    app.dependency_overrides.clear()


def sample_appointment(**changes) -> Appointment:
    return Appointment.model_validate({**APPOINTMENT, "id": "APT-2021", **changes})


def sample_event(appointment: Appointment, owner: str = USER) -> dict:
    return {**appointment_event.to_event(appointment, owner, IST), "id": "evt123", "htmlLink": "https://cal/evt123"}


# ---- sign-in ----

def test_appointment_routes_need_sign_in():
    assert client.get("/api/doctors").status_code == 401
    assert client.post("/api/appointments", json=BOOKING).status_code == 401
    assert client.patch("/api/appointments/APT-2021", json={"status": "closed"}).status_code == 401
    assert client.post("/api/fetch-appointments", json={"from": DAY, "to": DAY}).status_code == 401


# ---- doctors for a slot ----

def test_doctors_show_who_is_free_and_recommend_the_patients_department(fakes):
    fakes.calendar.events = [sample_event(sample_appointment(start="10:00", end="10:30"))]  # DOC-03 is busy

    r = client.get("/api/doctors", params={"date": DAY, "start": "10:15", "end": "10:45", "patientId": PATIENT_ID})

    assert r.status_code == 200, r.text
    data = r.json()
    assert data["recommendedDepartment"] == "endocrinology"  # from the patient's diabetes
    by_id = {d["id"]: d for d in data["doctors"]}
    assert by_id["DOC-03"]["available"] is False and by_id["DOC-03"]["recommended"] is True
    assert by_id["DOC-01"]["available"] is True and by_id["DOC-01"]["recommended"] is False
    assert data["doctors"][-1]["id"] == "DOC-03"  # busy doctors last
    assert fakes.calendar.list_args[0][2] is None  # the whole clinic calendar, every user's bookings


def test_doctors_without_a_slot_are_all_available(fakes):
    data = client.get("/api/doctors").json()
    assert all(d["available"] for d in data["doctors"]) and data["recommendedDepartment"] is None
    assert not fakes.calendar.list_args


@pytest.mark.parametrize(
    ("params", "message"),
    [
        ({"date": DAY, "start": "10:00"}, "together"),
        ({"date": DAY, "start": "10:00", "end": "09:00"}, "end must be after start"),
        ({"date": DAY, "start": "08:00", "end": "13:00"}, "at most 240 minutes"),
        ({"patientId": "not-a-uuid"}, "UUID"),
    ],
)
def test_doctors_reject_bad_slots(fakes, params, message):
    r = client.get("/api/doctors", params=params)
    assert r.status_code == 422 and message in r.text


def test_doctors_for_an_unknown_patient_is_404(fakes):
    r = client.get("/api/doctors", params={"patientId": "00000000-0000-0000-0000-000000000000"})
    assert r.status_code == 404 and r.json()["detail"] == "Patient not found"


@pytest.mark.parametrize(
    ("patient", "department"),
    [
        ({"clinic": "Cardiology OPD", "conditions": ["diabetes"]}, "cardiology"),  # the clinic wins
        ({"clinic": None, "conditions": ["asthma"]}, "pulmonology"),
        ({"clinic": "Ortho", "conditions": []}, "orthopaedics"),
        ({"clinic": None, "conditions": ["hypertension", "diabetes"]}, "cardiology"),
        ({"clinic": None, "conditions": []}, "generalMedicine"),
    ],
)
def test_department_recommendation(patient, department):
    assert appointment_service.recommend_department(patient) == department


# ---- booking ----

def test_booking_creates_a_meet_event_and_emails_the_signed_in_user(fakes):
    r = client.post("/api/appointments", json={**BOOKING, "notes": "Bring old reports"})

    assert r.status_code == 201, r.text
    data = r.json()
    assert data["id"] == "APT-2021" and data["patientId"] == "SMV-1001" and data["doctorId"] == "DOC-03"
    assert (data["date"], data["start"], data["end"]) == (DAY, "10:00", "10:30")
    assert data["language"] == "kn" and data["visit"] == 7  # from the patient record: 6 visits so far
    assert data["meetingLink"] == "https://meet.google.com/abc-defg-hij" and data["attendees"] == [EMAIL]
    assert fakes.repo.rows["APT-2021"]["calendar_event_id"] == "evt123"

    event = fakes.calendar.inserted[0]
    assert event["summary"] == "APT-2021 · Lakshmi Narayan (SMV-1001) · Dr. Farah Siddiqui"
    assert event["start"] == {"dateTime": f"{DAY}T10:00:00", "timeZone": "Asia/Kolkata"}
    assert event["attendees"] == [{"email": EMAIL}] and fakes.calendar.notified == [True]
    assert event["conferenceData"]["createRequest"]["conferenceSolutionKey"] == {"type": "hangoutsMeet"}
    assert event["extendedProperties"]["private"] == {"samvadAppointmentId": "APT-2021", "samvadOwner": USER}
    for line in ("Patient name: Lakshmi Narayan", "Doctor name: Dr. Farah Siddiqui", "Department: endocrinology",
                 "Time slot: 10:00-10:30", "Language: kn", "Notes: Bring old reports"):
        assert line in event["description"]


def test_booking_without_an_email_still_books_but_sends_nothing(fakes):
    app.dependency_overrides[current_email] = lambda: ""
    r = client.post("/api/appointments", json=BOOKING)
    assert r.status_code == 201 and r.json()["attendees"] == [] and fakes.calendar.notified == [False]


@pytest.mark.parametrize(
    ("booked", "message"),
    [
        ({"start": "10:15", "end": "10:45"}, "Dr. Farah Siddiqui is already booked 10:15-10:45 on that day"),
        ({"start": "09:45", "end": "10:15", "doctor": {"id": "DOC-01", "name": "Dr. Kavita Menon", "department": "generalMedicine"}},
         "Lakshmi Narayan already has an appointment 09:45-10:15 on that day"),
    ],
)
def test_booking_a_taken_slot_is_409(fakes, booked, message):
    fakes.calendar.events = [sample_event(sample_appointment(id="APT-2020", **booked))]
    r = client.post("/api/appointments", json=BOOKING)
    assert r.status_code == 409 and r.json()["detail"] == message
    assert not fakes.calendar.inserted and not fakes.repo.rows


def test_booking_back_to_back_is_allowed(fakes):
    fakes.calendar.events = [sample_event(sample_appointment(start="09:30", end="10:00"))]
    assert client.post("/api/appointments", json=BOOKING).status_code == 201


def test_booking_unknown_patient_or_doctor_is_404(fakes):
    r = client.post("/api/appointments", json={**BOOKING, "patientId": "00000000-0000-0000-0000-000000000000"})
    assert r.status_code == 404 and r.json()["detail"] == "Patient not found"
    r = client.post("/api/appointments", json={**BOOKING, "doctorId": "DOC-99"})
    assert r.status_code == 404 and r.json()["detail"] == "Doctor not found"


def test_booking_in_the_past_is_422(fakes):
    r = client.post("/api/appointments", json={**BOOKING, "date": "2020-01-01"})
    assert r.status_code == 422 and "already passed" in r.json()["detail"]


@pytest.mark.parametrize(
    "change",
    [{"end": "09:30"}, {"doctorId": "3"}, {"patientId": "SMV-1001"}, {"date": "05-01-2027"}, {"notes": "x" * 501}],
)
def test_booking_rejects_invalid_input(fakes, change):
    assert client.post("/api/appointments", json={**BOOKING, **change}).status_code == 422
    assert not fakes.calendar.inserted


def test_booking_removes_the_row_when_the_calendar_fails(fakes):
    fakes.calendar.events = []
    calendar = fakes.calendar

    async def failing_insert(event, *, notify_guests=False):
        raise HTTPException(502, "The signed-in Google account cannot change this calendar (check GOOGLE_CALENDAR_ID)")

    calendar.insert_event = failing_insert
    r = client.post("/api/appointments", json=BOOKING)
    assert r.status_code == 502 and "GOOGLE_CALENDAR_ID" in r.json()["detail"]
    assert fakes.repo.deleted == ["APT-2021"] and not fakes.repo.rows


def test_booking_still_succeeds_when_linking_the_event_fails(fakes):
    fakes.repo.fail_update = True
    r = client.post("/api/appointments", json=BOOKING)
    assert r.status_code == 201 and r.json()["calendarEventId"] == "evt123"


def test_ids_are_sequential(fakes):
    first = client.post("/api/appointments", json=BOOKING).json()["id"]
    second = client.post("/api/appointments", json={**BOOKING, "start": "11:00", "end": "11:30"}).json()["id"]
    assert (first, second) == ("APT-2021", "APT-2022")


# ---- fetch (sync) ----

def test_fetch_syncs_and_returns_appointments_in_order(fakes):
    later = sample_appointment(id="APT-2022", start="11:00", end="11:30")
    earlier = sample_appointment()
    fakes.calendar.events = [sample_event(later), sample_event(earlier), {"id": "allday", "start": {"date": DAY}}]

    r = client.post("/api/fetch-appointments", json={"from": DAY, "to": "2027-01-07"})

    assert r.status_code == 200, r.text
    data = r.json()
    assert [a["id"] for a in data["appointments"]] == ["APT-2021", "APT-2022"]
    assert data["synced"] == 2 and data["skippedEventIds"] == ["allday"]
    assert {row["appointment_id"] for row in fakes.repo.upserted} == {"APT-2021", "APT-2022"}
    time_min, time_max, prop = fakes.calendar.list_args[0]
    assert time_min.isoformat() == f"{DAY}T00:00:00+05:30"
    assert time_max.isoformat() == "2027-01-08T00:00:00+05:30"  # 'to' is inclusive
    assert prop == f"samvadOwner={USER}"


def test_fetch_picks_up_changes_made_in_google_calendar(fakes):
    event = sample_event(sample_appointment())
    event["start"] = {"dateTime": "2027-01-06T04:30:00Z"}  # moved to 10:00 IST the next day
    event["end"] = {"dateTime": "2027-01-06T05:00:00Z"}
    event["description"] = event["description"].replace("Status: scheduled", "Status: followUp")
    fakes.calendar.events = [event]

    a = client.post("/api/fetch-appointments", json={"from": DAY, "to": "2027-01-06"}).json()["appointments"][0]

    assert (a["date"], a["start"], a["end"], a["status"]) == ("2027-01-06", "10:00", "10:30", "followUp")
    assert fakes.repo.upserted[0]["appointment_date"] == "2027-01-06"


@pytest.mark.parametrize(
    ("body", "message"),
    [
        ({"from": "2027-01-05", "to": "2027-01-01"}, "'to' must be on or after 'from'"),
        ({"from": "2027-01-01", "to": "2027-12-31"}, "at most 92 days"),
        ({"from": "2027-01-01"}, "Field required"),
    ],
)
def test_fetch_rejects_bad_date_ranges(fakes, body, message):
    r = client.post("/api/fetch-appointments", json=body)
    assert r.status_code == 422 and message in r.text
    assert not fakes.calendar.list_args


def test_fetch_reports_calendar_and_database_errors(fakes):
    fakes.calendar.fail = HTTPException(503, "Google Calendar is busy, try again shortly")
    r = client.post("/api/fetch-appointments", json={"from": DAY, "to": DAY})
    assert r.status_code == 503 and r.json()["detail"] == "Google Calendar is busy, try again shortly"

    fakes.calendar.fail = None
    fakes.calendar.events = [sample_event(sample_appointment())]
    fakes.repo.fail_upsert = HTTPException(401, "Session expired, sign in again")
    assert client.post("/api/fetch-appointments", json={"from": DAY, "to": DAY}).status_code == 401


# ---- status update ----

ROW = {
    "appointment_id": "APT-2021", "patient_number": "SMV-1001", "patient_name": "Lakshmi Narayan", "patient_age": 58,
    "patient_sex": "F", "patient_phone": None, "doctor_code": "DOC-03", "doctor_name": "Dr. Farah Siddiqui",
    "department": "endocrinology", "appointment_date": DAY, "start_time": "09:00:00", "end_time": "09:30:00",
    "language": "kn", "visit": 7, "status": "scheduled", "notes": None, "calendar_event_id": "evt123", "calendar_link": None,
}


def test_status_update_patches_the_event_and_the_row(fakes):
    event = {**sample_event(sample_appointment()), "hangoutLink": "https://meet.google.com/abc-defg-hij"}
    patched: list[tuple[str, dict]] = []

    async def get(appointment_id):
        return dict(ROW) if appointment_id == "APT-2021" else None

    async def get_event(event_id):
        return event

    async def patch_event(event_id, changes):
        patched.append((event_id, changes))
        return {**event, **changes}

    fakes.repo.rows["APT-2021"] = {}
    fakes.repo.get = get
    fakes.calendar.get_event, fakes.calendar.patch_event = get_event, patch_event

    r = client.patch("/api/appointments/APT-2021", json={"status": "followUp"})

    assert r.status_code == 200, r.text
    assert r.json()["status"] == "followUp" and r.json()["meetingLink"] == "https://meet.google.com/abc-defg-hij"
    assert patched[0][0] == "evt123" and "Status: followUp" in patched[0][1]["description"]
    assert fakes.repo.rows["APT-2021"]["status"] == "followUp"

    assert client.patch("/api/appointments/APT-9999", json={"status": "closed"}).status_code == 404
    assert client.patch("/api/appointments/APT-2021", json={"status": "cancelled"}).status_code == 422
    assert client.patch("/api/appointments/nope", json={"status": "closed"}).status_code == 422


def test_row_maps_back_to_an_appointment():
    a = repository_module.from_row(ROW)
    assert (a.id, a.patient.name, a.doctor.department, a.start.strftime("%H:%M")) == ("APT-2021", "Lakshmi Narayan", "endocrinology", "09:00")


# ---- event <-> appointment ----

def test_event_round_trip():
    appointment = sample_appointment(notes="Bring old\nreports", attendees=[EMAIL])
    event = {**sample_event(appointment), "hangoutLink": "https://meet.google.com/xyz"}
    parsed = appointment_event.from_event(event, IST)
    assert parsed is not None
    expected = appointment.model_dump(exclude={"calendar_event_id", "calendar_link", "notes", "meeting_link"})
    assert parsed.model_dump(exclude={"calendar_event_id", "calendar_link", "notes", "meeting_link"}) == expected
    assert parsed.notes == "Bring old reports" and parsed.meeting_link == "https://meet.google.com/xyz"


def test_organizer_is_not_listed_as_a_guest():
    event = {**sample_event(sample_appointment()), "attendees": [{"email": "clinic@example.com", "organizer": True}, {"email": EMAIL}]}
    assert appointment_event.from_event(event, IST).attendees == [EMAIL]


def test_unreadable_events_are_skipped():
    event = sample_event(sample_appointment())
    assert appointment_event.from_event({**event, "description": "Lunch"}, IST) is None
    assert appointment_event.from_event({**event, "start": {"date": DAY}}, IST) is None


# ---- Google Calendar client (HTTP mocked) ----

def calendar_with(handler) -> GoogleCalendar:
    credentials = SimpleNamespace(valid=True, token="google-token")
    http = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    return GoogleCalendar(credentials=credentials, calendar_id="clinic@group.calendar.google.com", timezone=IST, http=http)


def test_client_lists_every_page():
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        if "pageToken" not in request.url.params:
            return httpx.Response(200, json={"items": [{"id": "a"}], "nextPageToken": "p2"})
        return httpx.Response(200, json={"items": [{"id": "b"}]})

    start = dt.datetime(2027, 1, 5, tzinfo=IST)
    cal = calendar_with(handler)
    events = asyncio.run(cal.list_events(start, start + dt.timedelta(days=1), "samvadOwner=u1"))

    assert [e["id"] for e in events] == ["a", "b"]
    first = seen[0]
    assert first.url.raw_path.startswith(b"/calendar/v3/calendars/clinic%40group.calendar.google.com/events?")
    assert first.headers["Authorization"] == "Bearer google-token"
    assert first.url.params["privateExtendedProperty"] == "samvadOwner=u1"
    assert first.url.params["timeMin"] == "2027-01-05T00:00:00+05:30"
    assert seen[1].url.params["pageToken"] == "p2"

    asyncio.run(cal.list_events(start, start + dt.timedelta(days=1)))
    assert "privateExtendedProperty" not in seen[-1].url.params


def test_insert_asks_for_meet_and_emails_guests_only_when_asked():
    seen: list[httpx.Request] = []

    def handler(request):
        seen.append(request)
        return httpx.Response(200, json={"id": "e1"})

    cal = calendar_with(handler)
    asyncio.run(cal.insert_event({}, notify_guests=True))
    asyncio.run(cal.insert_event({}))
    assert seen[0].url.params["conferenceDataVersion"] == "1" and seen[0].url.params["sendUpdates"] == "all"
    assert seen[1].url.params["sendUpdates"] == "none"


@pytest.mark.parametrize(
    ("google_status", "reason", "status", "message"),
    [
        (403, "forbidden", 502, "cannot change this calendar"),
        (403, "accessNotConfigured", 503, "Calendar API is not enabled"),
        (403, "insufficientPermissions", 502, "lacks calendar access"),
        (403, "rateLimitExceeded", 503, "busy"),
        (429, "rateLimitExceeded", 503, "busy"),
        (404, "notFound", 502, "GOOGLE_CALENDAR_ID"),
        (410, "deleted", 502, "deleted"),
        (401, "authError", 502, "google_oauth_login.py"),
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


OAUTH = {"google_oauth_client_id": "cid", "google_oauth_client_secret": "secret", "google_oauth_refresh_token": "refresh"}


@pytest.mark.parametrize(
    ("values", "message"),
    [
        ({}, "GOOGLE_OAUTH_CLIENT_ID"),
        ({**OAUTH, "google_oauth_refresh_token": ""}, "GOOGLE_OAUTH_REFRESH_TOKEN"),
        ({**OAUTH, "google_calendar_timezone": "Mars/Base"}, "not a valid time zone"),
    ],
)
def test_calendar_configuration_errors(settings, values, message):
    settings(google_calendar_id="primary", **values)
    with pytest.raises(HTTPException) as exc:
        google_calendar.google_calendar()
    assert exc.value.status_code == 503 and message in exc.value.detail


def test_calendar_signs_in_with_the_oauth_settings(settings):
    settings(google_calendar_id="primary", **OAUTH)
    cal = google_calendar.google_calendar()
    assert cal.calendar_id == "primary" and cal.timezone.key == "Asia/Kolkata"
    assert (cal.credentials.client_id, cal.credentials.refresh_token) == ("cid", "refresh")


# ---- Supabase repositories (HTTP mocked) ----

@pytest.fixture(autouse=True)
def supabase_settings(monkeypatch):
    monkeypatch.setattr(supabase_rest, "get_settings", lambda: config.Settings(
        sarvam_api_key="", supabase_url="https://db.example.supabase.co", supabase_publishable_key="pk", cors_origins=()
    ))


def mock_http(handler) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


def test_repository_insert_returns_the_assigned_id():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers["Authorization"] == "Bearer doctor-token"
        assert request.headers["Prefer"] == "return=representation"
        row = json.loads(request.content)
        assert row["patient_number"] == "SMV-1001" and row["start_time"] == "09:00" and "appointment_id" not in row
        return httpx.Response(201, json=[{"appointment_id": "APT-2001"}])

    repo = AppointmentRepository(token="doctor-token", http=mock_http(handler))
    assert asyncio.run(repo.insert(sample_appointment())) == "APT-2001"


def test_repository_upserts_by_appointment_id():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.params["on_conflict"] == "appointment_id"
        assert request.headers["Prefer"].startswith("resolution=merge-duplicates")
        return httpx.Response(201)

    asyncio.run(AppointmentRepository(token="t", http=mock_http(handler)).upsert([{"appointment_id": "APT-2001"}]))


def test_clinic_repositories_read_patients_and_active_doctors():
    from app.repositories.clinic_repository import DoctorRepository, PatientRepository

    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json=[{"code": "DOC-01"}] if "doctors" in request.url.path else [])

    assert asyncio.run(PatientRepository(token="t", http=mock_http(handler)).get(PATIENT_ID)) is None
    assert asyncio.run(DoctorRepository(token="t", http=mock_http(handler)).list_active()) == [{"code": "DOC-01"}]
    assert seen[0].url.path == "/rest/v1/patients" and seen[0].url.params["id"] == f"eq.{PATIENT_ID}"
    assert seen[1].url.path == "/rest/v1/doctors" and seen[1].url.params["active"] == "is.true"


@pytest.mark.parametrize(
    ("db_status", "code", "status", "message"),
    [
        (401, "PGRST301", 401, "Session expired"),
        (403, "42501", 403, "Not allowed"),
        (409, "23505", 409, "already exist"),
        (400, "23514", 422, "Invalid appointments"),
        (404, "PGRST205", 503, "apply the Supabase migrations"),
        (500, "XX000", 502, "Database error"),
    ],
)
def test_repository_maps_database_errors(db_status, code, status, message):
    def handler(_request):
        return httpx.Response(db_status, json={"code": code, "message": "boom"})

    with pytest.raises(HTTPException) as exc:
        asyncio.run(AppointmentRepository(token="t", http=mock_http(handler)).delete("APT-2001"))
    assert exc.value.status_code == status and message in exc.value.detail


def test_repository_reports_an_unreachable_database():
    def handler(request):
        raise httpx.ConnectError("down", request=request)

    with pytest.raises(HTTPException) as exc:
        asyncio.run(AppointmentRepository(token="t", http=mock_http(handler)).delete("APT-2001"))
    assert exc.value.status_code == 503


def test_user_email_comes_from_supabase_auth(monkeypatch):
    from app.core import security

    calls = []

    def handler(request):
        calls.append(request)
        return httpx.Response(200, json={"id": "u1", "email": "doctor@clinic.in"})

    monkeypatch.setattr(security, "_client", mock_http(handler))
    monkeypatch.setattr(security, "get_settings", lambda: config.Settings(
        sarvam_api_key="", supabase_url="https://db.example.supabase.co", supabase_publishable_key="pk", cors_origins=()
    ))
    assert asyncio.run(security.user_email("tok-email-test")) == "doctor@clinic.in"
    assert len(calls) == 1  # one Supabase call gives both the id and the email
