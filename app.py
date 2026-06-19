import os
os.environ.setdefault("OAUTHLIB_INSECURE_TRANSPORT", "1")
# Google adds/reorders the 'openid' scope on sign-in; don't let oauthlib reject the token for it.
os.environ.setdefault("OAUTHLIB_RELAX_TOKEN_SCOPE", "1")

from contextlib import contextmanager
from datetime import datetime, timedelta, date
from pathlib import Path
import json
import sqlite3
import sys

from dotenv import load_dotenv
from flask import Flask, jsonify, render_template, request, session, redirect
import anthropic

load_dotenv()

app = Flask(__name__)
app.secret_key = os.environ.get("FLASK_SECRET", "mc-change-this-secret-key-2026")

@app.after_request
def no_cache_static(response):
    if request.path.startswith("/static/") or request.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate"
        response.headers["Pragma"] = "no-cache"
    return response
app.config["PERMANENT_SESSION_LIFETIME"] = timedelta(days=int(os.environ.get("SESSION_LIFETIME_DAYS", "7")))

DASHBOARD_PASSWORD = os.environ.get("DASHBOARD_PASSWORD", "aces2026")
# Google sign-in: only these accounts may log in. Comma-separated; defaults to Parker's account.
ALLOWED_LOGIN_EMAILS = [e.strip().lower() for e in os.environ.get(
    "ALLOWED_LOGIN_EMAILS", "parkergent7@gmail.com").split(",") if e.strip()]
# Break-glass only: the legacy shared-password login. Off by default so production is password-free
# (required for the Plaid MFA / zero-trust attestations). Set ALLOW_PASSWORD_LOGIN=true to re-enable.
ALLOW_PASSWORD_LOGIN = os.environ.get("ALLOW_PASSWORD_LOGIN", "false").lower() in ("1", "true", "yes")
GOOGLE_LOGIN_SCOPES = ["openid", "https://www.googleapis.com/auth/userinfo.email"]

BAND_DIR    = Path(os.environ.get("BAND_DIR", "C:/Users/Parker/projects/coming-up-aces"))
DATA_DIR    = Path(os.environ.get("DATA_DIR", str(Path(__file__).parent / "data")))
DATA_DIR.mkdir(exist_ok=True)

GCS_BUCKET   = os.environ.get("GCS_BUCKET", "")
GITHUB_TOKEN = os.environ.get("GITHUB_TOKEN", "")
CUA_REPO     = "ParkerGent101/CUA-Website"
_gcs_client_cache = None

def _gcs():
    global _gcs_client_cache
    if _gcs_client_cache is None and GCS_BUCKET:
        try:
            from google.cloud import storage
            _gcs_client_cache = storage.Client()
        except Exception:
            pass
    return _gcs_client_cache

SHOWS_FILE       = BAND_DIR / "shows.json" if BAND_DIR.exists() else DATA_DIR / "shows.json"
VIDEOS_FILE      = BAND_DIR / "videos.json" if BAND_DIR.exists() else DATA_DIR / "videos.json"
FINANCE_FILE     = DATA_DIR / "finances.json"
SUBS_FILE        = DATA_DIR / "subscriptions.json"
TASKS_FILE       = DATA_DIR / "tasks.json"
RECURRING_FILE   = DATA_DIR / "recurring_tasks.json"
REMINDERS_FILE   = DATA_DIR / "reminders.json"
SAVINGS_FILE     = DATA_DIR / "savings.json"
CONTENT_FILE     = DATA_DIR / "band_content.json"
SONGS_FILE       = DATA_DIR / "band_songs.json"
BAND_CONTACTS_FILE = DATA_DIR / "band_contacts.json"
AGENDA_FILE      = DATA_DIR / "agenda.json"
HEALTH_FILE      = DATA_DIR / "health.json"
WORK_FILE        = DATA_DIR / "work_tasks.json"
CALENDAR_EVENTS_FILE = DATA_DIR / "calendar_events.json"
BRIEF_FILE       = DATA_DIR / "brief.json"
DB_PATH          = DATA_DIR / "mission_control.db"
FINANCE_SHEET_ID = os.environ.get("FINANCE_SHEET_ID", "")
HEALTH_SHEET_ID  = os.environ.get("HEALTH_SHEET_ID", "")
# Email to share rollover-generated finance files with (so Parker, not just the
# Cloud Run service account, can open them). Optional.
FINANCE_OWNER_EMAIL = os.environ.get("FINANCE_OWNER_EMAIL", "")

GCAL_SCOPES    = ['https://www.googleapis.com/auth/calendar.events']
GCAL_CREDS_FILE = DATA_DIR / "credentials.json"
GCAL_TOKEN_FILE = DATA_DIR / "token.json"
GOOGLE_OAUTH_CLIENT_ID = os.environ.get("GOOGLE_OAUTH_CLIENT_ID", "")
GOOGLE_OAUTH_CLIENT_SECRET = os.environ.get("GOOGLE_OAUTH_CLIENT_SECRET", "")
GOOGLE_OAUTH_PROJECT_ID = os.environ.get("GOOGLE_OAUTH_PROJECT_ID", "")

GDRIVE_SCOPES      = ['https://www.googleapis.com/auth/drive', 'https://www.googleapis.com/auth/spreadsheets']
GDRIVE_TOKEN_FILE  = DATA_DIR / "drive_token.json"
GDRIVE_CONFIG_FILE = DATA_DIR / "drive_config.json"


ONBOARDING_FILE   = DATA_DIR / "onboarding.json"
PLAID_CONFIG_FILE  = DATA_DIR / "plaid_config.json"
USER_CONFIG_FILE   = DATA_DIR / "user_config.json"
TCPG_FILE          = DATA_DIR / "tcpg.json"
PRACTICE_FILE      = DATA_DIR / "practice.json"

NATIONAL_HOLIDAYS = [
    {"date": "2026-01-01", "title": "New Year's Day"},
    {"date": "2026-01-19", "title": "Martin Luther King Jr. Day"},
    {"date": "2026-02-16", "title": "Presidents' Day"},
    {"date": "2026-05-25", "title": "Memorial Day"},
    {"date": "2026-06-19", "title": "Juneteenth"},
    {"date": "2026-07-04", "title": "Independence Day"},
    {"date": "2026-09-07", "title": "Labor Day"},
    {"date": "2026-11-11", "title": "Veterans Day"},
    {"date": "2026-11-26", "title": "Thanksgiving"},
    {"date": "2026-12-25", "title": "Christmas Day"},
    {"date": "2026-12-31", "title": "New Year's Eve"},
]

POP_CULTURE_EVENTS = [
    {"date": "2026-02-08", "title": "Super Bowl LX"},
    {"date": "2026-02-15", "title": "NBA All-Star Game"},
    {"date": "2026-02-22", "title": "Grammy Awards 2026"},
    {"date": "2026-03-02", "title": "Academy Awards (Oscars)"},
    {"date": "2026-06-11", "title": "FIFA World Cup 2026 begins"},
    {"date": "2026-07-19", "title": "FIFA World Cup 2026 Final"},
    {"date": "2026-09-13", "title": "NFL Season Kickoff 2026"},
]

PLAID_CLIENT_ID = os.environ.get("PLAID_CLIENT_ID", "")
PLAID_SECRET    = os.environ.get("PLAID_SECRET", "")
PLAID_ENV       = os.environ.get("PLAID_ENV", "sandbox")
# Required for OAuth banks (Fidelity, Chase, etc.): the exact HTTPS URL registered as an
# allowed redirect URI in the Plaid dashboard. Leave unset for simple credential banks.
PLAID_REDIRECT_URI = os.environ.get("PLAID_REDIRECT_URI", "")

def _load(path, default=None):
    p = Path(path)
    fallback = default if default is not None else []
    if GCS_BUCKET:
        try:
            client = _gcs()
            if client:
                blob = client.bucket(GCS_BUCKET).blob(p.name)
                if blob.exists():
                    return json.loads(blob.download_as_text())
                return fallback
        except Exception:
            pass
    if not p.exists():
        p.write_text(json.dumps(default) if default is not None else "[]", encoding="utf-8")
    try:
        return json.loads(p.read_text(encoding="utf-8-sig"))
    except Exception:
        return fallback

def _save(path, data):
    p = Path(path)
    content = json.dumps(data, indent=2, ensure_ascii=False)
    if GCS_BUCKET:
        try:
            client = _gcs()
            if client:
                client.bucket(GCS_BUCKET).blob(p.name).upload_from_string(
                    content, content_type="application/json"
                )
                return
        except Exception:
            pass
    p.write_text(content, encoding="utf-8")

@contextmanager
def _db():
    conn = sqlite3.connect(str(DB_PATH), timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=MEMORY")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.execute("""
        CREATE TABLE IF NOT EXISTS activity_log (
            id     INTEGER PRIMARY KEY AUTOINCREMENT,
            ts     TEXT NOT NULL,
            module TEXT NOT NULL,
            action TEXT NOT NULL,
            detail TEXT NOT NULL DEFAULT '',
            meta   TEXT NOT NULL DEFAULT ''
        )
    """)
    conn.commit()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

def _log(module, action, detail="", meta=""):
    try:
        with _db() as conn:
            conn.execute(
                "INSERT INTO activity_log (ts, module, action, detail, meta) VALUES (?,?,?,?,?)",
                (datetime.now().isoformat(timespec="seconds"), module, action, str(detail), str(meta))
            )
            conn.execute(
                "DELETE FROM activity_log WHERE id NOT IN (SELECT id FROM activity_log ORDER BY id DESC LIMIT 500)"
            )
    except Exception:
        pass  # logging must never break the request

@app.errorhandler(500)
def handle_500(e):
    import traceback
    return f"<h2>500 Error</h2><pre>{traceback.format_exc()}</pre>", 500

# ── Auth ───────────────────────────────────────────────────────────────────────

@app.before_request
def require_auth():
    p = request.path
    if p.startswith('/static/'):
        return None
    if p in ('/login', '/privacy', '/api/login', '/api/logout', '/api/me',
             '/api/auth/google/start', '/api/auth/google/callback'):
        return None
    if session.get('authenticated'):
        return None
    if p.startswith('/api/'):
        return jsonify({'error': 'auth_required'}), 401
    return redirect('/login')

@app.route("/login")
def login_page():
    return render_template("login.html")

@app.route("/privacy")
def privacy_page():
    """Public privacy policy for the application where Plaid Link is deployed."""
    return render_template("privacy.html")

def _effective_password():
    override = _load(USER_CONFIG_FILE, {}).get("password")
    return override if override else DASHBOARD_PASSWORD

@app.route("/api/login", methods=["POST"])
def do_login():
    if not ALLOW_PASSWORD_LOGIN:
        return jsonify({"ok": False, "error": "Password login is disabled — use Sign in with Google."}), 403
    data = request.get_json(silent=True) or request.form
    pw = data.get("password", "")
    if pw == _effective_password():
        session.permanent = True
        session["authenticated"] = True
        return jsonify({"ok": True})
    return jsonify({"ok": False}), 401

@app.route("/api/logout", methods=["POST"])
def logout():
    session.clear()
    return jsonify({"ok": True})

@app.route("/api/me")
def whoami():
    """Public: lets the login page / settings know who's in and whether the password fallback is live."""
    return jsonify({
        "authenticated": bool(session.get("authenticated")),
        "email": session.get("user_email"),
        "password_login": ALLOW_PASSWORD_LOGIN,
    })

# ── Google sign-in (identity + MFA via the user's own Google account) ────────────
@app.route("/api/auth/google/start")
def google_login_start():
    if not _has_google_oauth_client():
        return "Google sign-in isn't configured (missing OAuth client ID/secret).", 500
    redirect_uri = _request_base_url() + '/api/auth/google/callback'
    flow = _oauth_flow(GOOGLE_LOGIN_SCOPES, redirect_uri)
    if flow is None:
        return "Google sign-in isn't configured.", 500
    auth_url, state = flow.authorization_url(
        access_type='online', include_granted_scopes='true', prompt='select_account')
    session['login_oauth_state'] = state
    session['login_code_verifier'] = getattr(flow, 'code_verifier', None)
    return redirect(auth_url)

@app.route("/api/auth/google/callback")
def google_login_callback():
    try:
        from google_auth_oauthlib.flow import Flow  # noqa: F401  (ensure dep present)
    except ImportError:
        return "google-auth-oauthlib not installed", 500
    redirect_uri = _request_base_url() + '/api/auth/google/callback'
    try:
        flow = _oauth_flow(GOOGLE_LOGIN_SCOPES, redirect_uri)
        if flow is None:
            return "Google sign-in isn't configured.", 400
        verifier = session.pop('login_code_verifier', None)
        if verifier:
            flow.code_verifier = verifier
        flow.fetch_token(authorization_response=request.url)
        email = _google_userinfo_email(flow.credentials)
    except Exception as e:
        return f"<h2>Sign-in error</h2><pre>{e}</pre><br><a href='/login'>Back</a>", 400
    if email and email.lower() in ALLOWED_LOGIN_EMAILS:
        session.permanent = True
        session["authenticated"] = True
        session["user_email"] = email
        return redirect('/')
    return redirect('/login?denied=' + (email or 'unknown'))

# ── Band tools ─────────────────────────────────────────────────────────────────

def tool_list_shows():
    shows = _load(SHOWS_FILE)
    if not shows:
        return "No shows in shows.json yet."
    return "\n".join(f"{i}. {s['date']} | {s['event']} | {s['venue']}, {s['city']}" for i, s in enumerate(shows))

def tool_add_show(date, event, venue, city, tickets="", notes=""):
    shows = _load(SHOWS_FILE)
    shows.append({"date": date, "event": event, "venue": venue, "city": city, "tickets": tickets, "notes": notes})
    _save(SHOWS_FILE, shows)
    push_result = tool_push_site(f"Add show: {event} at {venue}")
    _gcal_create_event(
        title=f"🎸 {event}",
        date_str=date, time_str="",
        description=f"Coming Up Aces show\nVenue: {venue}\n{notes}".strip(),
        location=f"{venue}, {city}",
    )
    return f"Show added: {event} — {venue}, {city} on {date}. {push_result}"

def tool_edit_show(index: int, fields: dict):
    shows = _load(SHOWS_FILE)
    if not (0 <= index < len(shows)):
        return f"No show at index {index}."
    allowed = {"date", "event", "venue", "city", "tickets", "notes"}
    for k, v in fields.items():
        if k in allowed:
            shows[index][k] = v
    _save(SHOWS_FILE, shows)
    s = shows[index]
    push_result = tool_push_site(f"Edit show: {s.get('event','')} at {s.get('venue','')}")
    return f"Show updated: {s.get('event','')} — {s.get('venue','')}, {s.get('city','')} on {s.get('date','')}. {push_result}"

def tool_remove_show(index: int):
    shows = _load(SHOWS_FILE)
    if 0 <= index < len(shows):
        removed = shows.pop(index)
        _save(SHOWS_FILE, shows)
        push_result = tool_push_site(f"Remove show: {removed['event']} on {removed['date']}")
        return f"Removed: {removed['event']} on {removed['date']}. {push_result}"
    return f"No show at index {index}."

def tool_add_video(title, url, date=""):
    videos = _load(VIDEOS_FILE)
    videos.append({"title": title, "url": url, "date": date or datetime.now().strftime("%Y-%m-%d")})
    _save(VIDEOS_FILE, videos)
    return f"Video added: {title}"

def tool_push_site(message="Update site content"):
    """Push shows.json to the CUA Website repo via GitHub API. Works locally and on Cloud Run."""
    import base64
    import urllib.request
    import urllib.error
    if not GITHUB_TOKEN:
        return "Push failed: GITHUB_TOKEN not set. Add it to .env"
    try:
        shows = _load(SHOWS_FILE)
        content = json.dumps(shows, indent=2, ensure_ascii=False)
    except Exception as e:
        return f"Push failed: could not load shows data: {e}"
    api_url = f"https://api.github.com/repos/{CUA_REPO}/contents/shows.json"
    headers = {
        "Authorization": f"token {GITHUB_TOKEN}",
        "Accept": "application/vnd.github.v3+json",
        "User-Agent": "mission-control",
    }
    sha = ""
    try:
        req = urllib.request.Request(api_url, headers=headers)
        with urllib.request.urlopen(req) as resp:
            sha = json.loads(resp.read().decode())["sha"]
    except Exception:
        pass
    payload = json.dumps({
        "message": message,
        "content": base64.b64encode(content.encode()).decode(),
        "sha": sha,
    }).encode()
    put_headers = {**headers, "Content-Type": "application/json"}
    req = urllib.request.Request(api_url, data=payload, headers=put_headers, method="PUT")
    try:
        with urllib.request.urlopen(req):
            return f"Pushed to GitHub: '{message}'. comingupaces.net will update in ~1 min."
    except urllib.error.HTTPError as e:
        return f"Push failed: {e.code} {e.read().decode()}"
    except Exception as e:
        return f"Push failed: {e}"

# ── Reminder tools ─────────────────────────────────────────────────────────────

def tool_list_reminders():
    reminders = _load(REMINDERS_FILE)
    if not reminders:
        return "No reminders set."
    today = datetime.now().date()
    lines = []
    for r in sorted(reminders, key=lambda x: x.get("next_due", "9999")):
        due = r.get("next_due", "")
        days_out = ""
        if due:
            delta = (datetime.strptime(due, "%Y-%m-%d").date() - today).days
            if delta < 0:
                days_out = " ⚠️ OVERDUE"
            elif delta == 0:
                days_out = " TODAY"
            elif delta <= 7:
                days_out = f" in {delta}d"
            else:
                days_out = f" ({delta}d)"
        rtype = "↺" if r.get("type") == "recurring" else "◈"
        lines.append(f"{rtype} [{r['id']}] {r['title']} — due {due}{days_out} [{r.get('category','')}]")
    return "\n".join(lines)

def tool_add_reminder(title, due_date, category="personal", reminder_type="one-time", interval_days=None, notes=""):
    reminders = _load(REMINDERS_FILE)
    rid = max((r["id"] for r in reminders), default=0) + 1
    r = {"id": rid, "title": title, "category": category, "type": reminder_type, "next_due": due_date, "notes": notes}
    if interval_days:
        r["interval_days"] = int(interval_days)
    reminders.append(r)
    _save(REMINDERS_FILE, reminders)
    _gcal_create_event(
        title=f"⏰ {title}",
        date_str=due_date, time_str="",
        description=f"Reminder — {category}\n{notes}".strip(),
    )
    return f"Reminder set: {title} — due {due_date}"

def tool_snooze_reminder(reminder_id: int):
    reminders = _load(REMINDERS_FILE)
    for r in reminders:
        if r["id"] == reminder_id:
            if r.get("type") == "recurring" and r.get("interval_days"):
                next_due = (datetime.now().date() + timedelta(days=r["interval_days"])).strftime("%Y-%m-%d")
                r["next_due"] = next_due
                _save(REMINDERS_FILE, reminders)
                return f"'{r['title']}' snoozed — next due {next_due}"
            else:
                reminders.remove(r)
                _save(REMINDERS_FILE, reminders)
                return f"'{r['title']}' marked done and removed."
    return f"Reminder #{reminder_id} not found."

# ── Task tools ─────────────────────────────────────────────────────────────────

def tool_add_task(title, role, priority="normal", notes=""):
    tasks = _load(TASKS_FILE)
    tid = max((t["id"] for t in tasks), default=0) + 1
    tasks.append({"id": tid, "title": title, "role": role, "priority": priority, "notes": notes, "done": False, "created": datetime.now().strftime("%Y-%m-%d")})
    _save(TASKS_FILE, tasks)
    return f"Task #{tid} added: {title} [{role}]"

def tool_complete_task(task_id: int):
    tasks = _load(TASKS_FILE)
    for t in tasks:
        if t["id"] == task_id:
            t["done"] = True
            _save(TASKS_FILE, tasks)
            return f"Done: {t['title']}"
    return f"Task #{task_id} not found."

def tool_list_tasks(role=None, show_done=False):
    tasks = _load(TASKS_FILE)
    filtered = [t for t in tasks if (role is None or t["role"].lower() == role.lower()) and (show_done or not t["done"])]
    if not filtered:
        return "No open tasks."
    pri = {"high": "!", "normal": "-", "low": "·"}
    return "\n".join(f"#{t['id']} {pri.get(t['priority'],'○')} [{t['role']}] {t['title']}" for t in filtered)

# ── Finance tools ──────────────────────────────────────────────────────────────

def tool_add_transaction(description, amount, type_, category, date=""):
    finances = _load(FINANCE_FILE)
    tid = max((t["id"] for t in finances), default=0) + 1
    finances.append({"id": tid, "description": description, "amount": float(amount), "type": type_, "category": category, "date": date or datetime.now().strftime("%Y-%m-%d")})
    _save(FINANCE_FILE, finances)
    return f"Logged: {'+'if type_=='income'else'-'}${amount} — {description} [{category}]"

def tool_financial_summary(category=None):
    finances = _load(FINANCE_FILE)
    if not finances:
        return "No financial records yet."
    buckets = {}
    for tx in finances:
        if category and tx["category"].lower() != category.lower():
            continue
        cat = tx["category"]
        buckets.setdefault(cat, {"income": 0.0, "expense": 0.0})
        buckets[cat][tx["type"]] += tx["amount"]
    lines = ["Financial Summary:"]
    gi = ge = 0.0
    for cat, v in sorted(buckets.items()):
        net = v["income"] - v["expense"]
        lines.append(f"  {cat:<12} in:${v['income']:>8.2f}  out:${v['expense']:>8.2f}  net:${net:>8.2f}")
        gi += v["income"]; ge += v["expense"]
    lines.append(f"  {'TOTAL':<12} in:${gi:>8.2f}  out:${ge:>8.2f}  net:${gi-ge:>8.2f}")
    return "\n".join(lines)

# ── Agenda tools ──────────────────────────────────────────────────────────────

def tool_add_agenda_item(label, time="09:00", tag="Personal", date=""):
    items = _load(AGENDA_FILE)
    aid = max((a["id"] for a in items), default=0) + 1
    date_str = date or datetime.now().strftime("%Y-%m-%d")
    items.append({"id": aid, "time": time, "label": label, "tag": tag, "done": False, "date": date_str})
    _save(AGENDA_FILE, items)
    _gcal_create_event(
        title=label,
        date_str=date_str, time_str=time,
        duration_min=30,
        description=f"Agenda — {tag}",
    )
    return f"Agenda item added: {label} at {time}"

# ── Work tasks (GLS/Code) ──────────────────────────────────────────────────────

def tool_add_work_task(title, project="", priority="normal", notes=""):
    items = _load(WORK_FILE)
    wid = max((w["id"] for w in items), default=0) + 1
    items.append({"id": wid, "title": title, "project": project, "priority": priority,
                  "done": False, "notes": notes, "created": datetime.now().strftime("%Y-%m-%d")})
    _save(WORK_FILE, items)
    return f"Work task #{wid} added: {title} [{project or 'GLS'}]"

# ── Health tools ───────────────────────────────────────────────────────────────

def tool_log_weight(weight, date=""):
    health = _load(HEALTH_FILE)
    if not isinstance(health, dict):
        health = {"habits": {}, "weight": {}, "calories": {}}
    health.setdefault("weight", {})[date or datetime.now().strftime("%Y-%m-%d")] = float(weight)
    _save(HEALTH_FILE, health)
    return f"Weight logged: {weight} lb"

def tool_log_calories(consumed, burned=0, date=""):
    health = _load(HEALTH_FILE)
    if not isinstance(health, dict):
        health = {"habits": {}, "weight": {}, "calories": {}}
    d = date or datetime.now().strftime("%Y-%m-%d")
    cal = health.setdefault("calories", {}).setdefault(d, {})
    cal["consumed"] = int(consumed)
    if burned:
        cal["burned"] = int(burned)
    _save(HEALTH_FILE, health)
    return f"Calories: {consumed} in{f', {burned} burned' if burned else ''}"

# ── Tool dispatch ──────────────────────────────────────────────────────────────

TOOL_MAP = {
    "list_shows":           lambda i: tool_list_shows(),
    "add_show":             lambda i: tool_add_show(**i),
    "remove_show":          lambda i: tool_remove_show(i["index"]),
    "add_video":            lambda i: tool_add_video(**i),
    "push_site":            lambda i: tool_push_site(i.get("message", "Update site content")),
    "list_reminders":       lambda i: tool_list_reminders(),
    "add_reminder":         lambda i: tool_add_reminder(**i),
    "snooze_reminder":      lambda i: tool_snooze_reminder(i["reminder_id"]),
    "add_task":             lambda i: tool_add_task(**i),
    "complete_task":        lambda i: tool_complete_task(i["task_id"]),
    "list_tasks":           lambda i: tool_list_tasks(i.get("role"), i.get("show_done", False)),
    "add_transaction":      lambda i: tool_add_transaction(**i),
    "financial_summary":    lambda i: tool_financial_summary(i.get("category")),
    "add_agenda_item":      lambda i: tool_add_agenda_item(**i),
    "add_work_task":        lambda i: tool_add_work_task(**i),
    "log_weight":           lambda i: tool_log_weight(i["weight"], i.get("date","")),
    "log_calories":         lambda i: tool_log_calories(i["consumed"], i.get("burned",0), i.get("date","")),
}

TOOLS = [
    {"name":"list_shows","description":"List all shows","input_schema":{"type":"object","properties":{}}},
    {"name":"add_show","description":"Add a show to comingupaces.net","input_schema":{"type":"object","properties":{"date":{"type":"string"},"event":{"type":"string"},"venue":{"type":"string"},"city":{"type":"string"},"tickets":{"type":"string"},"notes":{"type":"string"}},"required":["date","event","venue","city"]}},
    {"name":"remove_show","description":"Remove a show by index","input_schema":{"type":"object","properties":{"index":{"type":"integer"}},"required":["index"]}},
    {"name":"add_video","description":"Add a video to band site","input_schema":{"type":"object","properties":{"title":{"type":"string"},"url":{"type":"string"},"date":{"type":"string"}},"required":["title","url"]}},
    {"name":"push_site","description":"Push band site live","input_schema":{"type":"object","properties":{"message":{"type":"string"}}}},
    {"name":"list_reminders","description":"List all reminders","input_schema":{"type":"object","properties":{}}},
    {"name":"add_reminder","description":"Add a reminder (one-time or recurring)","input_schema":{"type":"object","properties":{"title":{"type":"string"},"due_date":{"type":"string","description":"YYYY-MM-DD"},"category":{"type":"string","enum":["personal","IT","band","coding","learning","shopping"]},"reminder_type":{"type":"string","enum":["one-time","recurring"]},"interval_days":{"type":"integer"},"notes":{"type":"string"}},"required":["title","due_date"]}},
    {"name":"snooze_reminder","description":"Done/snooze a reminder","input_schema":{"type":"object","properties":{"reminder_id":{"type":"integer"}},"required":["reminder_id"]}},
    {"name":"add_task","description":"Add a task (tasks.json — general roles)","input_schema":{"type":"object","properties":{"title":{"type":"string"},"role":{"type":"string","enum":["band","IT","coding","personal","learning","shopping"]},"priority":{"type":"string","enum":["high","normal","low"]},"notes":{"type":"string"}},"required":["title","role"]}},
    {"name":"complete_task","description":"Complete a task by ID","input_schema":{"type":"object","properties":{"task_id":{"type":"integer"}},"required":["task_id"]}},
    {"name":"list_tasks","description":"List open tasks","input_schema":{"type":"object","properties":{"role":{"type":"string"},"show_done":{"type":"boolean"}}}},
    {"name":"add_transaction","description":"Log an expense or income","input_schema":{"type":"object","properties":{"description":{"type":"string"},"amount":{"type":"number"},"type_":{"type":"string","enum":["income","expense"]},"category":{"type":"string","enum":["band","IT","coding","personal"]},"date":{"type":"string"}},"required":["description","amount","type_","category"]}},
    {"name":"financial_summary","description":"Get finance summary","input_schema":{"type":"object","properties":{"category":{"type":"string"}}}},
    {"name":"add_agenda_item","description":"Add an item to today's agenda","input_schema":{"type":"object","properties":{"label":{"type":"string"},"time":{"type":"string","description":"HH:MM"},"tag":{"type":"string"},"date":{"type":"string"}},"required":["label"]}},
    {"name":"add_work_task","description":"Add a GLS or coding work task (work_tasks.json)","input_schema":{"type":"object","properties":{"title":{"type":"string"},"project":{"type":"string","description":"e.g. GLS Security, GLS IT, GLS SharePoint, Code"},"priority":{"type":"string","enum":["high","normal","low"]},"notes":{"type":"string"}},"required":["title"]}},
    {"name":"log_weight","description":"Log today's weight in lbs","input_schema":{"type":"object","properties":{"weight":{"type":"number"},"date":{"type":"string"}},"required":["weight"]}},
    {"name":"log_calories","description":"Log calories consumed and/or burned","input_schema":{"type":"object","properties":{"consumed":{"type":"integer"},"burned":{"type":"integer"},"date":{"type":"string"}},"required":["consumed"]}},
]

SYSTEM_PROMPT = """You are Mission Control — Parker Gent's personal AI command center.

PARKER'S PROFILE:
• IT Manager at Ground Level Services (GLS) — Azure, SharePoint, MDM, security, vendor mgmt, WIP reporting
• Band Manager & Lead Guitarist — Coming Up Aces (NWA classic rock). Site: comingupaces.net
• Freelance Developer — building "aGent Security Consultancy"
• Certifications: pursuing CISM (exam 2026-08-16), CRISC
• Personal: dog (flea medicine every 3 months), tennis elbow rehab

TODAY IS {today}. URGENT: ASR policies audit→block due 2026-05-22. Ian MFA on Rightworks is high priority.

BEHAVIOR: Act like a sharp chief of staff. Extract ALL actionable items from voice dumps and log them without asking. Be concise. Use tools immediately.

SMART ROUTING:
• "spent $X at Y" / "paid $X" → add_transaction (auto-detect category)
• "gig/show at X on [date]" → add_show
• "remind me" / "don't forget" → add_reminder
• "add to today" / "schedule at [time]" → add_agenda_item
• "weigh Xlb" / "weight is X" → log_weight
• "ate X cal" / "burned X cal" → log_calories
• "GLS task:" / "work task:" / "code task:" → add_work_task

RESPONSE FORMAT — always reply with ONLY this JSON (no markdown, no extra text):
{{"module":"agenda|finance|band|health|work|none","action":"added|logged|updated|scheduled|found|noted","summary":"one-line description of what was done","reply":"brief conversational reply (1-2 sentences max)"}}""".format(today=datetime.now().strftime("%B %d, %Y"))

client = anthropic.Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY"))

_CACHED_TOOLS = [*TOOLS[:-1], {**TOOLS[-1], "cache_control": {"type": "ephemeral"}}]

def run_agent(messages, model="claude-sonnet-4-6"):
    while True:
        response = client.messages.create(
            model=model,
            max_tokens=1024,
            system=[{"type": "text", "text": SYSTEM_PROMPT, "cache_control": {"type": "ephemeral"}}],
            tools=_CACHED_TOOLS,
            messages=messages
        )
        messages.append({"role": "assistant", "content": response.content})
        if response.stop_reason == "tool_use":
            results = []
            for block in response.content:
                if block.type == "tool_use":
                    try:
                        result = TOOL_MAP[block.name](block.input)
                    except Exception as e:
                        result = f"Error in {block.name}: {e}"
                    results.append({"type": "tool_result", "tool_use_id": block.id, "content": result})
            messages.append({"role": "user", "content": results})
        else:
            text = next((b.text for b in response.content if b.type == "text"), "")
            return text, messages

# ── Routes ─────────────────────────────────────────────────────────────────────

@app.route("/")
def index():
    return render_template("index.html")

@app.route("/api/chat", methods=["POST"])
def chat():
    data = request.json
    messages = data.get("messages", [])
    messages.append({"role": "user", "content": data.get("message", "")})
    try:
        reply, updated = run_agent(messages)
        return jsonify({"reply": reply, "messages": updated})
    except Exception as e:
        return jsonify({"reply": f"Error: {e}", "messages": messages}), 500

@app.route("/api/shows", methods=["GET"])
def get_shows():
    return jsonify(_load(SHOWS_FILE))

@app.route("/api/shows", methods=["POST"])
def post_show():
    d = request.json or {}
    if not d.get("event"):
        return jsonify({"error": "event field is required"}), 400
    message = tool_add_show(d["date"], d["event"], d["venue"], d["city"], d.get("tickets",""), d.get("notes",""))
    status = 502 if "Push failed:" in message else 200
    return jsonify({"message": message, "ok": status == 200}), status

@app.route("/api/shows/<int:idx>", methods=["PUT"])
def put_show(idx):
    d = request.json or {}
    message = tool_edit_show(idx, d)
    if message.startswith("No show"):
        return jsonify({"message": message, "ok": False}), 404
    status = 502 if "Push failed:" in message else 200
    return jsonify({"message": message, "ok": status == 200}), status

@app.route("/api/shows/<int:idx>", methods=["DELETE"])
def delete_show(idx):
    message = tool_remove_show(idx)
    if message.startswith("No show"):
        return jsonify({"message": message, "ok": False}), 404
    status = 502 if "Push failed:" in message else 200
    return jsonify({"message": message, "ok": status == 200}), status

@app.route("/api/videos", methods=["GET"])
def get_videos():
    return jsonify(_load(VIDEOS_FILE))

@app.route("/api/videos", methods=["POST"])
def post_video():
    d = request.json
    return jsonify({"message": tool_add_video(d["title"], d["url"], d.get("date",""))})

@app.route("/api/site/push", methods=["POST"])
def push():
    return jsonify({"message": tool_push_site(request.json.get("message","Update site content"))})

@app.route("/api/tasks", methods=["GET"])
def get_tasks():
    return jsonify(_load(TASKS_FILE))

@app.route("/api/tasks", methods=["POST"])
def post_task():
    d = request.json
    return jsonify({"message": tool_add_task(d["title"], d["role"], d.get("priority","normal"), d.get("notes",""))})

@app.route("/api/tasks/<int:task_id>/done", methods=["POST"])
def done_task(task_id):
    return jsonify({"message": tool_complete_task(task_id)})

# ── Recurring tasks (daily / weekly / monthly chores) ─────────────────────────

RECURRING_FREQS = ("daily", "weekly", "monthly")

def _recurring_is_due(item, today=None):
    today = today or date.today()
    last = item.get("last_completed")
    if not last:
        return True
    try:
        last_d = date.fromisoformat(last)
    except ValueError:
        return True
    freq = item.get("frequency", "weekly")
    if freq == "daily":
        return last_d < today
    if freq == "weekly":
        return (today - last_d).days >= 7
    if freq == "monthly":
        return (last_d.year, last_d.month) != (today.year, today.month)
    return True

@app.route("/api/recurring", methods=["GET"])
def get_recurring():
    items = _load(RECURRING_FILE, [])
    today = date.today()
    for it in items:
        it["due"] = _recurring_is_due(it, today)
    return jsonify(items)

@app.route("/api/recurring", methods=["POST"])
def post_recurring():
    d = request.json or {}
    title = (d.get("title") or "").strip()
    freq = d.get("frequency", "weekly")
    if not title or freq not in RECURRING_FREQS:
        return jsonify({"error": "title and valid frequency required"}), 400
    items = _load(RECURRING_FILE, [])
    new = {
        "id": (max((i.get("id", 0) for i in items), default=0) + 1),
        "title": title,
        "frequency": freq,
        "last_completed": None,
        "created": date.today().isoformat(),
    }
    items.append(new)
    _save(RECURRING_FILE, items)
    _log("recurring", "add", title, freq)
    return jsonify(new)

@app.route("/api/recurring/<int:rid>/done", methods=["POST"])
def done_recurring(rid):
    items = _load(RECURRING_FILE, [])
    for it in items:
        if it.get("id") == rid:
            it["last_completed"] = date.today().isoformat()
            _save(RECURRING_FILE, items)
            _log("recurring", "complete", it.get("title", ""), it.get("frequency", ""))
            return jsonify({"ok": True, "last_completed": it["last_completed"]})
    return jsonify({"error": "not found"}), 404

@app.route("/api/recurring/<int:rid>/undo", methods=["POST"])
def undo_recurring(rid):
    items = _load(RECURRING_FILE, [])
    for it in items:
        if it.get("id") == rid:
            it["last_completed"] = None
            _save(RECURRING_FILE, items)
            return jsonify({"ok": True})
    return jsonify({"error": "not found"}), 404

@app.route("/api/recurring/reset", methods=["POST"])
def reset_recurring():
    """Start a new week or month: clear the completed routines in scope so they
    become due again. Daily routines already reset on their own each day (same as
    the health habits), so 'week' covers daily+weekly and 'month' covers all three.
    Body: {"scope": "week"|"month"}."""
    scope = (request.json or {}).get("scope", "")
    freqs = {
        "week":  {"daily", "weekly"},
        "month": {"daily", "weekly", "monthly"},
    }.get(scope)
    if not freqs:
        return jsonify({"error": "scope must be 'week' or 'month'"}), 400
    items = _load(RECURRING_FILE, [])
    cleared = 0
    for it in items:
        if it.get("frequency") in freqs and it.get("last_completed"):
            it["last_completed"] = None
            cleared += 1
    _save(RECURRING_FILE, items)
    _log("recurring", "reset", scope, str(cleared))
    return jsonify({"ok": True, "cleared": cleared})

@app.route("/api/recurring/<int:rid>", methods=["DELETE"])
def delete_recurring(rid):
    items = _load(RECURRING_FILE, [])
    new_items = [i for i in items if i.get("id") != rid]
    if len(new_items) == len(items):
        return jsonify({"error": "not found"}), 404
    _save(RECURRING_FILE, new_items)
    return jsonify({"ok": True})

@app.route("/api/finances", methods=["GET"])
def get_finances():
    month = request.args.get("month")
    if FINANCE_SHEET_ID:
        try:
            svc  = _sheets_svc()
            tab  = _month_tab(month) if month else _first_sheet_name(svc, FINANCE_SHEET_ID)
            rows = svc.spreadsheets().values().get(
                spreadsheetId=FINANCE_SHEET_ID, range=tab
            ).execute().get('values', [])
            return jsonify(_parse_transaction_rows(rows, tab=tab))
        except Exception:
            pass
    data = _load(FINANCE_FILE)
    if month:
        data = [t for t in data if t.get("date", "").startswith(month)]
    return jsonify(data)

@app.route("/api/finances/budget", methods=["GET"])
def get_finances_budget():
    month = request.args.get("month")
    if FINANCE_SHEET_ID:
        try:
            svc  = _sheets_svc()
            tab  = _month_tab(month) if month else _first_sheet_name(svc, FINANCE_SHEET_ID)
            rows = svc.spreadsheets().values().get(
                spreadsheetId=FINANCE_SHEET_ID, range=tab
            ).execute().get('values', [])
            return jsonify(_parse_budget_rows(rows))
        except Exception:
            pass  # fall through to local calculation
    fin_month = month or datetime.now().strftime("%Y-%m")
    finances = _load(FINANCE_FILE)
    txns = [t for t in finances if t.get("date", "").startswith(fin_month)]
    income  = sum(float(t.get("amount", 0)) for t in txns if t.get("type") == "income")
    expense = sum(float(t.get("amount", 0)) for t in txns if t.get("type") == "expense")
    # Local fallback (Sheet unavailable): we have transactions but no per-category
    # budgeted amounts to report — those live in the Sheet (_parse_budget_rows).
    # Return empty categories so the Finance card uses its built-in default budgets
    # (FIN_CATS) and derives actuals from the transactions + subscriptions itself.
    return jsonify({"income": income, "expense": expense, "categories": []})

@app.route("/api/finances/budget", methods=["PATCH"])
def patch_finances_budget():
    """Edit a category's budgeted amount (column E) in the month's budget tracker.
    Body: {month: 'YYYY-MM', category: 'Housing', budgeted: 1050}. Writes the new
    value to the category's single budget row; refuses if the category is split
    across multiple budget rows (edit those directly in the Sheet)."""
    if not FINANCE_SHEET_ID:
        return jsonify({"error": "No finance sheet configured"}), 400
    d = request.json or {}
    category = _canon_cat(d.get("category") or "")
    if not category:
        return jsonify({"error": "category required"}), 400
    try:
        budgeted = float(str(d.get("budgeted")).replace('$', '').replace(',', '') or 0)
    except (TypeError, ValueError):
        return jsonify({"error": "budgeted must be a number"}), 400
    month = d.get("month") or datetime.now().strftime("%Y-%m")
    try:
        svc = _sheets_svc()
        tab = _month_tab(month)
        rows = svc.spreadsheets().values().get(
            spreadsheetId=FINANCE_SHEET_ID, range=tab
        ).execute().get('values', [])
        max_cols = max((len(r) for r in rows), default=1)
        padded = [r + [''] * (max_cols - len(r)) for r in rows]
        hdr_row_idx, _, _, _ = _finance_budget_columns(padded)
        hdr = [str(c).lower().strip() for c in padded[hdr_row_idx]]
        budget_col = next((i for i, h in enumerate(hdr) if 'budget' in h), 4)
        matches = []      # all rows for this category
        budget_rows = []  # rows that already carry a budgeted value
        current_cat = ''
        for ri in range(hdr_row_idx + 1, len(padded)):
            row = padded[ri]
            rl = ' '.join(row[:8]).lower()
            if any(kw in rl for kw in ['anticipated', 'actual total', 'roommate', 'savings total']):
                break
            cat_val = row[0].strip() if len(row) > 0 else ''
            if cat_val and not any(ch.isdigit() for ch in cat_val):
                current_cat = cat_val
            desc_val = row[1].strip() if len(row) > 1 else ''
            if _canon_cat(cat_val or desc_val or current_cat) != category:
                continue
            matches.append(ri)
            budg_str = row[budget_col].strip() if len(row) > budget_col else ''
            try:
                if float(budg_str.replace('$', '').replace(',', '') or 0) > 0:
                    budget_rows.append(ri)
            except ValueError:
                pass
        if not matches:
            return jsonify({"error": f"No '{category}' budget row found in '{tab}'."}), 404
        if len(budget_rows) > 1:
            return jsonify({"error": f"'{category}' is split across multiple rows in '{tab}'. Edit those directly in the Sheet."}), 409
        target_row = budget_rows[0] if budget_rows else matches[0]
        svc.spreadsheets().values().update(
            spreadsheetId=FINANCE_SHEET_ID,
            range=f"'{tab}'!{_col_letter(budget_col)}{target_row + 1}",
            valueInputOption='USER_ENTERED',
            body={'values': [[budgeted]]}
        ).execute()
        return jsonify({"ok": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/finances", methods=["POST"])
def post_finance():
    d = request.json
    date     = d.get("date") or datetime.now().strftime("%Y-%m-%d")
    desc, amt = d.get("description", ""), float(d.get("amount", 0))
    txn_type, cat = d.get("type", "expense"), d.get("category", "Fun")
    cat = _canonical_finance_category(cat)
    if FINANCE_SHEET_ID and txn_type == "expense":
        try:
            svc = _sheets_svc()
            tab = _month_tab(date[:7])
            rows = svc.spreadsheets().values().get(
                spreadsheetId=FINANCE_SHEET_ID, range=tab
            ).execute().get('values', [])
            if cat in DETAIL_TABLE_KEYWORDS:
                written = _write_detail_transaction(svc, FINANCE_SHEET_ID, tab, rows, cat, desc, amt, date)
                if not written:
                    return jsonify({"error": f"No '{cat}' table found in sheet tab '{tab}'."}), 400
                target_row, target_col = written
                return jsonify({"ok": True, "sheet_tab": tab, "sheet_row": target_row, "sheet_col": target_col, "sheet_cols": 2, "sheet_kind": "detail"})
            if cat in BUDGET_TRANSACTION_CATEGORIES:
                written = _write_budget_transaction(svc, FINANCE_SHEET_ID, tab, rows, cat, desc, amt)
                if not written:
                    return jsonify({"error": f"No empty '{cat}' budget row found in sheet tab '{tab}'."}), 400
                target_row, target_col = written
                return jsonify({"ok": True, "sheet_tab": tab, "sheet_row": target_row, "sheet_col": target_col, "sheet_cols": 1, "sheet_kind": "budget"})
            allowed = ", ".join(["Housing", "Utilities", "Food / Grocery", "Fun", "Gas"])
            return jsonify({"error": f"'{cat}' isn't a transaction-tracked category. Use {allowed}."}), 400
        except Exception as e:
            return jsonify({"error": str(e)}), 500
    tool_add_transaction(desc, amt, txn_type, cat, date)
    return jsonify({"ok": True})

@app.route("/api/finances/<int:tid>", methods=["DELETE"])
def delete_finance(tid):
    if FINANCE_SHEET_ID:
        return jsonify({"error": "Edit the Google Sheet directly to remove transactions"}), 400
    finances = _load(FINANCE_FILE)
    _save(FINANCE_FILE, [t for t in finances if t.get("id") != tid])
    return jsonify({"ok": True})

@app.route("/api/finances/sheet", methods=["DELETE"])
def delete_finance_sheet():
    """Remove a sheet-sourced transaction by clearing its description + amount cells.
    Query params: tab (sheet name), row (0-indexed), col (0-indexed start column)."""
    if not FINANCE_SHEET_ID:
        return jsonify({"error": "No finance sheet configured"}), 400
    tab = request.args.get("tab", "").strip()
    try:
        row = int(request.args.get("row", ""))
        col = int(request.args.get("col", ""))
        cols = int(request.args.get("cols", "2"))
    except (TypeError, ValueError):
        return jsonify({"error": "row, col and cols must be integers"}), 400
    if not tab or row < 0 or col < 0 or cols < 1:
        return jsonify({"error": "tab, row, col are required"}), 400
    try:
        svc = _sheets_svc()
        _clear_sheet_values(svc, FINANCE_SHEET_ID, tab, row, col, cols)
        return jsonify({"ok": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/finances/<int:tid>", methods=["PATCH"])
def patch_finance(tid):
    d = request.json or {}
    if FINANCE_SHEET_ID:
        return _patch_finance_sheet(d)
    finances = _load(FINANCE_FILE)
    txn = next((t for t in finances if t.get("id") == tid), None)
    if not txn:
        return jsonify({"error": "Not found"}), 404
    for key in ("category", "description", "amount", "type"):
        if key in d:
            txn[key] = d[key]
    _save(FINANCE_FILE, finances)
    return jsonify({"ok": True})

@app.route("/api/finances/summary", methods=["GET"])
def finance_summary():
    return jsonify({"summary": tool_financial_summary()})

@app.route("/api/finances/months", methods=["GET"])
def finance_months():
    finances = _load(FINANCE_FILE)
    months = sorted({t["date"][:7] for t in finances if t.get("date")}, reverse=True)
    return jsonify(months)

@app.route("/api/finances/rollover/month", methods=["POST"])
def rollover_month():
    """Duplicate a month's tab into the next month, keeping the budget, income and
    GLS payments the same and clearing only the one-off transaction tables.
    Body: {"month": "YYYY-MM"} — the source month (defaults to current)."""
    if not FINANCE_SHEET_ID:
        return jsonify({"error": "No finance sheet configured"}), 400
    d = request.json or {}
    src_month = d.get("month") or datetime.now().strftime("%Y-%m")
    try:
        y, m = int(src_month[:4]), int(src_month[5:7])
    except Exception:
        return jsonify({"error": "month must be YYYY-MM"}), 400
    src_tab = MONTH_NAMES_FULL[m - 1]
    nm, ny = (1, y + 1) if m == 12 else (m + 1, y)
    dst_tab = MONTH_NAMES_FULL[nm - 1]
    try:
        svc = _sheets_svc()
        if _sheet_id_by_name(svc, FINANCE_SHEET_ID, dst_tab) is not None:
            return jsonify({"error": f"A '{dst_tab}' tab already exists in your sheet."}), 409
        src_id = _sheet_id_by_name(svc, FINANCE_SHEET_ID, src_tab)
        if src_id is None:
            return jsonify({"error": f"No '{src_tab}' tab found to roll over from."}), 404
        svc.spreadsheets().batchUpdate(
            spreadsheetId=FINANCE_SHEET_ID,
            body={"requests": [{"duplicateSheet": {
                "sourceSheetId": src_id,
                "insertSheetIndex": 0,
                "newSheetName": dst_tab,
            }}]}
        ).execute()
        _clear_detail_tables(svc, FINANCE_SHEET_ID, dst_tab)
        _clear_budget_actuals(svc, FINANCE_SHEET_ID, dst_tab)
        return jsonify({"ok": True, "tab": dst_tab, "month": f"{ny}-{str(nm).zfill(2)}"})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/finances/rollover/year", methods=["POST"])
def rollover_year():
    """Create a fresh spreadsheet for the next year, pre-filled with 12 month tabs
    cloned from the current month template (budget + income + GLS payments kept,
    transactions cleared) — a new file to fill out for the year.
    Body: {"month": "YYYY-MM"} — the template month (defaults to current)."""
    if not FINANCE_SHEET_ID:
        return jsonify({"error": "No finance sheet configured"}), 400
    d = request.json or {}
    src_month = d.get("month") or datetime.now().strftime("%Y-%m")
    try:
        y, m = int(src_month[:4]), int(src_month[5:7])
    except Exception:
        return jsonify({"error": "month must be YYYY-MM"}), 400
    new_year = y + 1
    tmpl_tab = MONTH_NAMES_FULL[m - 1]
    try:
        svc = _sheets_svc()
        tmpl_id = _sheet_id_by_name(svc, FINANCE_SHEET_ID, tmpl_tab)
        if tmpl_id is None:
            return jsonify({"error": f"No '{tmpl_tab}' tab to use as the year template."}), 404
        created = svc.spreadsheets().create(body={
            "properties": {"title": f"Finances {new_year}"}
        }, fields="spreadsheetId,sheets.properties").execute()
        new_id = created["spreadsheetId"]
        default_sheet_id = created["sheets"][0]["properties"]["sheetId"]
        requests = []
        for mn in MONTH_NAMES_FULL:
            copied = svc.spreadsheets().sheets().copyTo(
                spreadsheetId=FINANCE_SHEET_ID, sheetId=tmpl_id,
                body={"destinationSpreadsheetId": new_id}
            ).execute()
            requests.append({"updateSheetProperties": {
                "properties": {"sheetId": copied["sheetId"], "title": mn},
                "fields": "title",
            }})
        # Remove the empty default sheet that create() generated.
        requests.append({"deleteSheet": {"sheetId": default_sheet_id}})
        svc.spreadsheets().batchUpdate(spreadsheetId=new_id, body={"requests": requests}).execute()
        for mn in MONTH_NAMES_FULL:
            _clear_detail_tables(svc, new_id, mn)
            _clear_budget_actuals(svc, new_id, mn)
        # The new file is owned by the ADC identity (service account on Cloud Run);
        # best-effort share with Parker so he can open it.
        shared_with = None
        if FINANCE_OWNER_EMAIL:
            try:
                import google.auth
                from googleapiclient.discovery import build
                dcreds, _ = google.auth.default(scopes=['https://www.googleapis.com/auth/drive'])
                drive = build('drive', 'v3', credentials=dcreds)
                drive.permissions().create(
                    fileId=new_id, sendNotificationEmail=False,
                    body={'type': 'user', 'role': 'writer', 'emailAddress': FINANCE_OWNER_EMAIL},
                ).execute()
                shared_with = FINANCE_OWNER_EMAIL
            except Exception:
                pass
        return jsonify({
            "ok": True, "year": new_year, "spreadsheet_id": new_id,
            "url": f"https://docs.google.com/spreadsheets/d/{new_id}/edit",
            "shared_with": shared_with,
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/reminders", methods=["GET"])
def get_reminders():
    return jsonify(_load(REMINDERS_FILE))

@app.route("/api/reminders", methods=["POST"])
def post_reminder():
    d = request.json
    return jsonify({"message": tool_add_reminder(d["title"], d["due_date"], d.get("category","personal"), d.get("type","one-time"), d.get("interval_days"), d.get("notes",""))})

@app.route("/api/reminders/<int:rid>/snooze", methods=["POST"])
def snooze_reminder(rid):
    return jsonify({"message": tool_snooze_reminder(rid)})

# ── Savings ────────────────────────────────────────────────────────────────────

@app.route("/api/savings", methods=["GET"])
def get_savings():
    return jsonify(_load(SAVINGS_FILE))

@app.route("/api/savings", methods=["POST"])
def post_savings():
    d = request.json
    savings = _load(SAVINGS_FILE)
    acct = d["account"]
    existing = next((s for s in savings if s["account"] == acct), None)
    if existing:
        existing["balance"] = float(d["balance"])
        existing["date"] = d.get("date") or datetime.now().strftime("%Y-%m-%d")
    else:
        sid = max((s["id"] for s in savings), default=0) + 1
        savings.append({"id": sid, "account": acct, "balance": float(d["balance"]),
                        "date": d.get("date") or datetime.now().strftime("%Y-%m-%d"), "notes": ""})
    _save(SAVINGS_FILE, savings)
    return jsonify({"message": f"{acct} updated: ${d['balance']}"})

# ── Subscriptions ─────────────────────────────────────────────────────────────

@app.route("/api/finances/subscriptions", methods=["GET"])
def get_subscriptions():
    return jsonify(_load(SUBS_FILE))

@app.route("/api/finances/subscriptions", methods=["POST"])
def post_subscription():
    d = request.json
    name, acct = d.get("name", ""), d.get("acct", "")
    amt, due = float(d.get("amt", 0)), d.get("due", "")
    subs = _load(SUBS_FILE)
    sid = max((s["id"] for s in subs), default=0) + 1
    subs.append({"id": sid, "name": name, "acct": acct, "amt": amt, "due": due})
    _save(SUBS_FILE, subs)
    sheet_status = "not_configured"
    sheet_error = None
    if FINANCE_SHEET_ID:
        sheet_status = "error"
        try:
            svc = _sheets_svc()
            tab = _month_tab(datetime.now().strftime("%Y-%m"))
            rows = svc.spreadsheets().values().get(
                spreadsheetId=FINANCE_SHEET_ID, range=tab
            ).execute().get('values', [])
            target_row = _find_budget_section_next_row(rows, 'Subscriptions')
            if target_row is None:
                sheet_status = "section_full"
            else:
                # Layout: A=category(blank, merged), B=description, C=account, D=due, E=budgeted, F=actual
                a1 = f"'{tab}'!B{target_row + 1}:E{target_row + 1}"
                svc.spreadsheets().values().update(
                    spreadsheetId=FINANCE_SHEET_ID, range=a1,
                    valueInputOption='USER_ENTERED',
                    body={'values': [[name, acct, due, amt]]}
                ).execute()
                sheet_status = "written"
        except Exception as e:
            sheet_error = str(e)
    resp = {"id": sid, "sheet_status": sheet_status}
    if sheet_error:
        resp["sheet_error"] = sheet_error
    return jsonify(resp)

@app.route("/api/finances/subscriptions/<int:sid>", methods=["PATCH"])
def patch_subscription(sid):
    d = request.json or {}
    subs = _load(SUBS_FILE)
    sub = next((s for s in subs if s.get("id") == sid), None)
    if not sub:
        return jsonify({"error": "Not found"}), 404
    old_name = sub.get("name", "")
    sub["name"] = d.get("name", sub.get("name", ""))
    sub["acct"] = d.get("acct", sub.get("acct", ""))
    sub["amt"]  = float(d.get("amt", sub.get("amt", 0)) or 0)
    sub["due"]  = d.get("due", sub.get("due", ""))
    _save(SUBS_FILE, subs)

    sheet_status = "not_configured"
    sheet_error = None
    if FINANCE_SHEET_ID:
        sheet_status = "error"
        try:
            svc = _sheets_svc()
            tab = _month_tab(datetime.now().strftime("%Y-%m"))
            rows = svc.spreadsheets().values().get(
                spreadsheetId=FINANCE_SHEET_ID, range=tab
            ).execute().get('values', [])
            # Locate the row by the OLD name (it may be renamed); fall back to the new name.
            row_idx = _find_subscription_sheet_row(rows, old_name)
            if row_idx is None:
                row_idx = _find_subscription_sheet_row(rows, sub["name"])
            if row_idx is None:
                sheet_status = "not_found"
            else:
                a1 = f"'{tab}'!B{row_idx + 1}:E{row_idx + 1}"
                svc.spreadsheets().values().update(
                    spreadsheetId=FINANCE_SHEET_ID, range=a1,
                    valueInputOption='USER_ENTERED',
                    body={'values': [[sub["name"], sub["acct"], sub["due"], sub["amt"]]]}
                ).execute()
                sheet_status = "updated"
        except Exception as e:
            sheet_error = str(e)
    resp = {"ok": True, "sheet_status": sheet_status}
    if sheet_error:
        resp["sheet_error"] = sheet_error
    return jsonify(resp)

@app.route("/api/finances/subscriptions/<int:sid>", methods=["DELETE"])
def delete_subscription(sid):
    subs = _load(SUBS_FILE)
    target = next((s for s in subs if s.get("id") == sid), None)
    subs = [s for s in subs if s.get("id") != sid]
    _save(SUBS_FILE, subs)

    sheet_status = "not_configured"
    sheet_error = None
    if FINANCE_SHEET_ID and target:
        sheet_status = "error"
        try:
            svc = _sheets_svc()
            tab = _month_tab(datetime.now().strftime("%Y-%m"))
            rows = svc.spreadsheets().values().get(
                spreadsheetId=FINANCE_SHEET_ID, range=tab
            ).execute().get('values', [])
            row_idx = _find_subscription_sheet_row(rows, target.get("name", ""))
            if row_idx is None:
                sheet_status = "not_found"
            else:
                # Layout: B=description, C=account, D=due, E=budgeted, F=actual.
                # Clearing leaves a blank row the add path can reuse as the next slot.
                a1 = f"'{tab}'!B{row_idx + 1}:F{row_idx + 1}"
                svc.spreadsheets().values().update(
                    spreadsheetId=FINANCE_SHEET_ID, range=a1,
                    valueInputOption='USER_ENTERED',
                    body={'values': [['', '', '', '', '']]}
                ).execute()
                sheet_status = "cleared"
        except Exception as e:
            sheet_error = str(e)

    resp = {"ok": True, "sheet_status": sheet_status}
    if sheet_error:
        resp["sheet_error"] = sheet_error
    return jsonify(resp)

# ── Band Content Queue ─────────────────────────────────────────────────────────

def _load_songs():
    data = _load(SONGS_FILE, {"setlists": [], "repertoire": [], "future_songs": [], "organized_by_key": []})
    data.setdefault("setlists", [])
    data.setdefault("repertoire", [])
    data.setdefault("future_songs", [])
    data.setdefault("organized_by_key", [])
    return data

@app.route("/api/band/songs", methods=["GET"])
def get_songs():
    return jsonify(_load_songs())

@app.route("/api/band/songs/repertoire", methods=["POST", "DELETE"])
def edit_repertoire():
    song = (request.json or {}).get("song", "").strip()
    if not song:
        return jsonify({"error": "song required"}), 400
    data = _load_songs()
    if request.method == "POST":
        if song not in data["repertoire"]:
            data["repertoire"].append(song)
    else:
        data["repertoire"] = [s for s in data["repertoire"] if s != song]
    _save(SONGS_FILE, data)
    return jsonify(data)

@app.route("/api/band/songs/future", methods=["POST", "DELETE"])
def edit_future_songs():
    song = (request.json or {}).get("song", "").strip()
    if not song:
        return jsonify({"error": "song required"}), 400
    data = _load_songs()
    if request.method == "POST":
        if song not in data["future_songs"]:
            data["future_songs"].append(song)
    else:
        data["future_songs"] = [s for s in data["future_songs"] if s != song]
    _save(SONGS_FILE, data)
    return jsonify(data)

@app.route("/api/band/songs/setlist", methods=["POST", "DELETE", "PATCH"])
def edit_setlist():
    d = request.json or {}
    name = (d.get("name") or "").strip()
    if not name:
        return jsonify({"error": "name required"}), 400
    data = _load_songs()
    if request.method == "POST":
        if not any(sl.get("name") == name for sl in data["setlists"]):
            data["setlists"].append({"name": name, "songs": []})
    elif request.method == "DELETE":
        data["setlists"] = [sl for sl in data["setlists"] if sl.get("name") != name]
    else:  # PATCH = rename
        new_name = (d.get("new_name") or "").strip()
        if not new_name:
            return jsonify({"error": "new_name required"}), 400
        for sl in data["setlists"]:
            if sl.get("name") == name:
                sl["name"] = new_name
    _save(SONGS_FILE, data)
    return jsonify(data)

@app.route("/api/band/songs/setlist/song", methods=["POST", "DELETE"])
def edit_setlist_song():
    d = request.json or {}
    setlist = (d.get("setlist") or "").strip()
    song = (d.get("song") or "").strip()
    if not setlist or not song:
        return jsonify({"error": "setlist and song required"}), 400
    data = _load_songs()
    sl = next((x for x in data["setlists"] if x.get("name") == setlist), None)
    if sl is None:
        return jsonify({"error": "setlist not found"}), 404
    sl.setdefault("songs", [])
    if request.method == "POST":
        sl["songs"].append(song)
    else:
        # remove first matching occurrence
        if song in sl["songs"]:
            sl["songs"].remove(song)
    _save(SONGS_FILE, data)
    return jsonify(data)

@app.route("/api/band/content", methods=["GET"])
def get_content():
    data = _load(CONTENT_FILE)
    if isinstance(data, dict): data = []
    return jsonify(data)

@app.route("/api/band/content", methods=["POST"])
def post_content():
    d = request.json
    content = _load(CONTENT_FILE)
    cid = max((c["id"] for c in content), default=0) + 1
    content.append({"id": cid, "title": d["title"], "type": d.get("type", ""), "priority": d.get("priority", "normal"),
                    "status": "queued", "created": datetime.now().strftime("%Y-%m-%d"), "notes": d.get("notes", "")})
    _save(CONTENT_FILE, content)
    return jsonify({"message": f"Queued: {d['title']}"})

@app.route("/api/band/content/<int:cid>/done", methods=["POST"])
def done_content(cid):
    content = _load(CONTENT_FILE)
    for c in content:
        if c["id"] == cid:
            c["status"] = "done"
            _save(CONTENT_FILE, content)
            return jsonify({"message": f"Done: {c['title']}"})
    return jsonify({"error": "not found"}), 404

# ── Band Contacts ──────────────────────────────────────────────────────────────

@app.route("/api/band/contacts", methods=["GET"])
def get_band_contacts():
    return jsonify(_load(BAND_CONTACTS_FILE))

@app.route("/api/band/contacts", methods=["POST"])
def post_band_contact():
    d = request.json
    contacts = _load(BAND_CONTACTS_FILE)
    cid = max((c["id"] for c in contacts), default=0) + 1
    contacts.append({
        "id": cid, "name": d.get("name",""), "venue": d.get("venue",""),
        "city": d.get("city",""), "last": d.get("last","—"),
        "status": d.get("status","not contacted"), "notes": d.get("notes","")
    })
    _save(BAND_CONTACTS_FILE, contacts)
    _sheets_push_contacts()
    return jsonify({"id": cid})

@app.route("/api/band/contacts/<int:cid>", methods=["PUT"])
def update_band_contact(cid):
    d = request.json
    contacts = _load(BAND_CONTACTS_FILE)
    for c in contacts:
        if c["id"] == cid:
            c.update({k: v for k, v in d.items() if k != "id"})
            _save(BAND_CONTACTS_FILE, contacts)
            _sheets_push_contacts()
            return jsonify({"ok": True})
    return jsonify({"error": "not found"}), 404

@app.route("/api/band/contacts/<int:cid>", methods=["DELETE"])
def delete_band_contact(cid):
    contacts = _load(BAND_CONTACTS_FILE)
    contacts = [c for c in contacts if c["id"] != cid]
    _save(BAND_CONTACTS_FILE, contacts)
    _sheets_push_contacts()
    return jsonify({"ok": True})

# ── User profile & settings ───────────────────────────────────────────────────

@app.route("/api/user/profile", methods=["GET", "POST"])
def user_profile():
    ob = _load(ONBOARDING_FILE, {})
    if request.method == "GET":
        cfg = _load(USER_CONFIG_FILE, {})
        return jsonify({
            "name": cfg.get("name") or ob.get("name", ""),
            "persona": ob.get("persona", ""),
        })
    d = request.json or {}
    cfg = _load(USER_CONFIG_FILE, {})
    if d.get("name"):
        cfg["name"] = d["name"].strip()
    _save(USER_CONFIG_FILE, cfg)
    return jsonify({"ok": True})

@app.route("/api/user/password", methods=["POST"])
def user_change_password():
    if not ALLOW_PASSWORD_LOGIN:
        return jsonify({"error": "Password login is disabled — sign-in uses your Google account."}), 403
    d = request.json or {}
    if d.get("current") != _effective_password():
        return jsonify({"error": "Current password incorrect"}), 401
    new_pw = (d.get("new") or "").strip()
    if len(new_pw) < 4:
        return jsonify({"error": "New password must be at least 4 characters"}), 400
    cfg = _load(USER_CONFIG_FILE, {})
    cfg["password"] = new_pw
    _save(USER_CONFIG_FILE, cfg)
    return jsonify({"ok": True})

@app.route("/api/user/reset-onboarding", methods=["POST"])
def user_reset_onboarding():
    ob = _load(ONBOARDING_FILE, {})
    ob["completed"] = False
    _save(ONBOARDING_FILE, ob)
    return jsonify({"ok": True})

# ── Data management ────────────────────────────────────────────────────────────

@app.route("/api/data/export")
def data_export():
    import io, zipfile
    from flask import send_file
    buf = io.BytesIO()
    skip = {"user_config.json", "plaid_config.json", "onboarding.json", "mission_control.db"}
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for f in DATA_DIR.glob("*.json"):
            if f.name not in skip:
                zf.write(f, f.name)
    buf.seek(0)
    return send_file(buf, mimetype="application/zip", as_attachment=True,
                     download_name=f"mc-data-{datetime.now().strftime('%Y%m%d')}.zip")

@app.route("/api/data/reset", methods=["POST"])
def data_reset():
    to_clear = [
        FINANCE_FILE, SUBS_FILE, SAVINGS_FILE, TASKS_FILE, WORK_FILE,
        REMINDERS_FILE, CONTENT_FILE, BAND_CONTACTS_FILE, AGENDA_FILE,
        HEALTH_FILE, BRIEF_FILE, RECURRING_FILE,
    ]
    for f in to_clear:
        p = Path(f)
        if p.exists():
            p.unlink()
    try:
        with _db() as conn:
            conn.execute("DELETE FROM activity_log")
    except Exception:
        pass
    _log("system", "reset", "All module data reset")
    return jsonify({"ok": True})

# ── Onboarding ────────────────────────────────────────────────────────────────

@app.route("/api/onboarding", methods=["GET"])
def onboarding_status():
    if not ONBOARDING_FILE.exists():
        # Brand new install — skip wizard if user already has data
        has_data = any([
            bool(_load(FINANCE_FILE, [])),
            bool(_load(WORK_FILE, [])),
            bool(_load(TASKS_FILE, [])),
        ])
        return jsonify({"needed": not has_data})
    ob = _load(ONBOARDING_FILE, {})
    # File exists: respect completed flag (completed=False lets you re-run the wizard)
    return jsonify({"needed": not ob.get("completed", False)})

@app.route("/api/onboarding", methods=["POST"])
def complete_onboarding():
    d = request.json or {}
    _save(ONBOARDING_FILE, {
        "completed": True,
        "name": d.get("name", ""),
        "persona": d.get("persona", ""),
        "modules": d.get("modules", {}),
        "theme": d.get("theme", ""),
        "fitness": d.get("fitness", {}),
        "completed_at": datetime.now().isoformat(),
    })
    # Persist fitness config into health.json so the Health card can use it
    fitness = d.get("fitness", {})
    if fitness.get("program") and fitness["program"] != "none":
        health = _load(HEALTH_FILE)
        if not isinstance(health, dict):
            health = {"habits": {}, "weight": {}, "calories": {}}
        health["workout_config"] = fitness
        _save(HEALTH_FILE, health)
    return jsonify({"ok": True})

# ── Plaid ──────────────────────────────────────────────────────────────────────

def _plaid_client():
    try:
        import plaid
        from plaid.api import plaid_api
        # plaid-python 39 removed the "development" environment — only Sandbox/Production exist.
        env_map = {
            "sandbox":     plaid.Environment.Sandbox,
            "production":  plaid.Environment.Production,
        }
        cfg = plaid.Configuration(
            host=env_map.get(PLAID_ENV, plaid.Environment.Sandbox),
            api_key={"clientId": PLAID_CLIENT_ID, "secret": PLAID_SECRET},
        )
        return plaid_api.PlaidApi(plaid.ApiClient(cfg)), None
    except ImportError:
        return None, "plaid-python not installed — run: pip install plaid-python"
    except Exception as e:
        return None, str(e)

@app.route("/api/plaid/link_token", methods=["POST"])
def plaid_link_token():
    if not PLAID_CLIENT_ID or not PLAID_SECRET:
        return jsonify({"error": "Plaid not configured — add PLAID_CLIENT_ID and PLAID_SECRET to .env"}), 400
    client, err = _plaid_client()
    if err:
        return jsonify({"error": err}), 500
    try:
        from plaid.model.link_token_create_request import LinkTokenCreateRequest
        from plaid.model.link_token_create_request_user import LinkTokenCreateRequestUser
        from plaid.model.products import Products
        from plaid.model.country_code import CountryCode
        ob = _load(ONBOARDING_FILE, {})
        user_name = ob.get("name", "user")
        req_kwargs = dict(
            products=[Products("transactions")],
            client_name="Mission Control",
            country_codes=[CountryCode("US")],
            language="en",
            user=LinkTokenCreateRequestUser(client_user_id="mc-user", legal_name=user_name),
        )
        # OAuth institutions require a registered redirect URI; only send it when configured.
        if PLAID_REDIRECT_URI:
            req_kwargs["redirect_uri"] = PLAID_REDIRECT_URI
        req = LinkTokenCreateRequest(**req_kwargs)
        resp = client.link_token_create(req)
        return jsonify({"link_token": resp["link_token"]})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/plaid/exchange", methods=["POST"])
def plaid_exchange():
    if not PLAID_CLIENT_ID or not PLAID_SECRET:
        return jsonify({"error": "Plaid not configured"}), 400
    body = request.json or {}
    public_token = body.get("public_token")
    if not public_token:
        return jsonify({"error": "Missing public_token"}), 400
    client, err = _plaid_client()
    if err:
        return jsonify({"error": err}), 500
    try:
        from plaid.model.item_public_token_exchange_request import ItemPublicTokenExchangeRequest
        resp = client.item_public_token_exchange(ItemPublicTokenExchangeRequest(public_token=public_token))
        config = _load(PLAID_CONFIG_FILE, {"items": []})
        # Plaid Link's onSuccess metadata carries the chosen institution; store its name
        # so multiple linked accounts (Capital One, SoFi, …) can be told apart and managed.
        inst = body.get("institution") or {}
        config["items"].append({
            "access_token": resp["access_token"],
            "item_id": resp["item_id"],
            "institution": inst.get("name") or body.get("institution_name") or "Bank",
            "institution_id": inst.get("institution_id"),
            "added": datetime.now().isoformat(),
        })
        _save(PLAID_CONFIG_FILE, config)
        return jsonify({"ok": True, "item_id": resp["item_id"], "institution": inst.get("name")})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/plaid/status", methods=["GET"])
def plaid_status():
    config = _load(PLAID_CONFIG_FILE, {"items": []})
    items = config.get("items", [])
    # Surface the linked institutions (never the access tokens) so the Finance card can
    # list connected accounts and offer per-account disconnect.
    accounts = [{
        "item_id": it.get("item_id"),
        "institution": it.get("institution") or "Bank",
        "added": it.get("added"),
    } for it in items]
    return jsonify({"connected": len(items) > 0, "count": len(items), "accounts": accounts})

@app.route("/api/plaid/disconnect", methods=["POST"])
def plaid_disconnect():
    """Remove a single connected Plaid item by item_id: invalidate it at Plaid
    (best-effort) and drop it locally so its transactions stop syncing."""
    item_id = (request.json or {}).get("item_id")
    if not item_id:
        return jsonify({"error": "Missing item_id"}), 400
    config = _load(PLAID_CONFIG_FILE, {"items": []})
    items = config.get("items", [])
    target = next((it for it in items if it.get("item_id") == item_id), None)
    if not target:
        return jsonify({"error": "Account not found"}), 404
    client, err = _plaid_client()
    if client and not err:
        try:
            from plaid.model.item_remove_request import ItemRemoveRequest
            client.item_remove(ItemRemoveRequest(access_token=target["access_token"]))
        except Exception:
            pass   # local removal proceeds even if the Plaid call fails
    config["items"] = [it for it in items if it.get("item_id") != item_id]
    _save(PLAID_CONFIG_FILE, config)
    return jsonify({"ok": True, "count": len(config["items"])})

@app.route("/api/plaid/transactions", methods=["GET"])
def plaid_transactions():
    config = _load(PLAID_CONFIG_FILE, {"items": []})
    items = config.get("items", [])
    if not items:
        return jsonify({"error": "No Plaid accounts connected"}), 400
    plaid_c, err = _plaid_client()
    if err:
        return jsonify({"error": err}), 500
    try:
        from plaid.model.transactions_get_request import TransactionsGetRequest
        from plaid.model.transactions_get_request_options import TransactionsGetRequestOptions
        import datetime as dt
        end_date = dt.date.today()
        start_date = end_date - dt.timedelta(days=30)
        req = TransactionsGetRequest(
            access_token=items[0]["access_token"],
            start_date=start_date,
            end_date=end_date,
            options=TransactionsGetRequestOptions(count=50),
        )
        resp = plaid_c.transactions_get(req)
        txns = []
        for t in resp["transactions"]:
            raw_cats = t.get("category") or []
            cat = raw_cats[0].lower().replace(" ", "_") if raw_cats else "other"
            txns.append({
                "id": t["transaction_id"],
                "name": t.get("merchant_name") or t["name"],
                "amount": float(t["amount"]),
                "date": t["date"].isoformat() if hasattr(t["date"], "isoformat") else str(t["date"]),
                "category": cat,
            })
        return jsonify({"transactions": txns})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/plaid/categorize", methods=["POST"])
def plaid_categorize():
    d = request.json or {}
    categories = d.get("categories", {})
    config = _load(PLAID_CONFIG_FILE, {"items": []})
    config["category_map"] = {**config.get("category_map", {}), **categories}
    _save(PLAID_CONFIG_FILE, config)
    return jsonify({"ok": True, "saved": len(categories)})

# Plaid personal_finance_category -> Sheet category. DETAILED is most specific (checked
# first); PRIMARY is the fallback. Lets auto-import categorize even when the legacy
# `category` field is empty (newer Plaid items often return only PFC).
PFC_DETAILED_MAP = {
    "TRANSPORTATION_GAS": "Gas",
    "FOOD_AND_DRINK_GROCERIES": "Food / Grocery",
    "GENERAL_MERCHANDISE_CONVENIENCE_STORES": "Food / Grocery",
    "RENT_AND_UTILITIES_RENT": "Housing",
    "RENT_AND_UTILITIES_GAS_AND_ELECTRICITY": "Utilities",
    "RENT_AND_UTILITIES_WATER": "Utilities",
    "RENT_AND_UTILITIES_SEWAGE_AND_WASTE_MANAGEMENT": "Utilities",
    "RENT_AND_UTILITIES_INTERNET_AND_CABLE": "Utilities",
    "RENT_AND_UTILITIES_TELEPHONE": "Utilities",
    "RENT_AND_UTILITIES_OTHER_UTILITIES": "Utilities",
}
PFC_PRIMARY_MAP = {
    "FOOD_AND_DRINK": "Fun",
    "RENT_AND_UTILITIES": "Utilities",
    "ENTERTAINMENT": "Fun",
    "TRANSPORTATION": "Gas",
}

def _plaid_pfc(t):
    """(primary, detailed) upper-case from a Plaid txn's personal_finance_category, or ('','')."""
    try:
        pfc = t.get("personal_finance_category") if hasattr(t, "get") else None
        if pfc:
            return str(pfc.get("primary") or "").upper(), str(pfc.get("detailed") or "").upper()
    except Exception:
        pass
    return "", ""

def _plaid_is_nonspend(t):
    """True for transactions that aren't new discretionary spend, so auto-import doesn't
    distort the Sheet: transfers between accounts, income, and credit-card bill payments
    (the underlying purchases are what count). Mortgage / auto loans are kept as expenses."""
    primary, detailed = _plaid_pfc(t)
    if primary in ("TRANSFER_IN", "TRANSFER_OUT", "INCOME"):
        return True
    if detailed == "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT":
        return True
    legacy = " ".join(str(c).lower() for c in (t.get("category") or [])) if hasattr(t, "get") else ""
    return any(k in legacy for k in ("transfer", "credit card payment"))

def _plaid_to_finance_category(t_or_cats, name=""):
    """Map a Plaid transaction onto a Sheet-tracked finance category. Accepts either a full
    Plaid txn (preferred -- uses personal_finance_category) or a legacy category list.
    Defaults to 'Fun' (always Sheet-writable) so nothing is un-importable."""
    cats = []
    if isinstance(t_or_cats, (list, tuple)):
        cats = list(t_or_cats)
    elif hasattr(t_or_cats, "get"):
        primary, detailed = _plaid_pfc(t_or_cats)
        if detailed in PFC_DETAILED_MAP: return PFC_DETAILED_MAP[detailed]
        if primary in PFC_PRIMARY_MAP:   return PFC_PRIMARY_MAP[primary]
        cats = list(t_or_cats.get("category") or [])
    blob = (" ".join(str(c).lower() for c in cats) + " " + str(name or "").lower()).replace("_", " ")
    if any(k in blob for k in ("gas station", "fuel")):                                  return "Gas"
    if any(k in blob for k in ("supermarket", "groceries", "grocery", "food store")):    return "Food / Grocery"
    if any(k in blob for k in ("rent", "mortgage")):                                     return "Housing"
    if any(k in blob for k in ("internet", "cable", "electric", "water", "utilit", "telephone")): return "Utilities"
    if any(k in blob for k in ("restaurant", "fast food", "coffee", "dining", "food and drink", "bar", "pub")): return "Fun"
    if any(k in blob for k in ("entertainment", "recreation", "movie", "music", "game")): return "Fun"
    return "Fun"
def _record_expense(date, desc, amt, cat):
    """Write one expense to the finance Sheet (detail or budget table) or the local
    JSON fallback. Returns (ok: bool, detail: str|dict). Mirrors POST /api/finances."""
    cat = _canonical_finance_category(cat)
    if FINANCE_SHEET_ID:
        svc = _sheets_svc()
        tab = _month_tab(date[:7])
        rows = svc.spreadsheets().values().get(
            spreadsheetId=FINANCE_SHEET_ID, range=tab).execute().get('values', [])
        if cat in DETAIL_TABLE_KEYWORDS:
            if _write_detail_transaction(svc, FINANCE_SHEET_ID, tab, rows, cat, desc, amt, date):
                return True, {"tab": tab, "kind": "detail"}
            return False, f"No '{cat}' table in tab '{tab}'"
        if cat in BUDGET_TRANSACTION_CATEGORIES:
            if _write_budget_transaction(svc, FINANCE_SHEET_ID, tab, rows, cat, desc, amt):
                return True, {"tab": tab, "kind": "budget"}
            return False, f"No empty '{cat}' budget row in tab '{tab}'"
        return False, f"'{cat}' isn't a Sheet-tracked category"
    tool_add_transaction(desc, amt, "expense", cat, date)
    return True, {"kind": "local"}

@app.route("/api/plaid/sync", methods=["GET"])
def plaid_sync():
    """Pull recent expenses from every connected Plaid item, auto-categorize, and
    return a de-duplicated review queue. Does NOT write anything to the Sheet."""
    config = _load(PLAID_CONFIG_FILE, {"items": []})
    items = config.get("items", [])
    if not items:
        return jsonify({"error": "No Plaid accounts connected"}), 400
    plaid_c, err = _plaid_client()
    if err:
        return jsonify({"error": err}), 500
    seen = set(config.get("imported_ids", [])) | set(config.get("skipped_ids", []))
    try:
        from plaid.model.transactions_get_request import TransactionsGetRequest
        from plaid.model.transactions_get_request_options import TransactionsGetRequestOptions
        import datetime as dt
        try:
            days = max(1, min(90, int(request.args.get("days", 30))))
        except (TypeError, ValueError):
            days = 30
        end_date = dt.date.today()
        start_date = end_date - dt.timedelta(days=days)
        pending = []
        for it in items:
            req = TransactionsGetRequest(
                access_token=it["access_token"], start_date=start_date, end_date=end_date,
                options=TransactionsGetRequestOptions(count=100))
            resp = plaid_c.transactions_get(req)
            for t in resp["transactions"]:
                tid = t["transaction_id"]
                amt = float(t["amount"])
                if tid in seen or amt <= 0:   # already handled, or inflow/refund (expenses only)
                    continue
                name = t.get("merchant_name") or t["name"]
                pending.append({
                    "id": tid, "name": name, "amount": amt,
                    "date": t["date"].isoformat() if hasattr(t["date"], "isoformat") else str(t["date"]),
                    "category": _plaid_to_finance_category(t.get("category"), name),
                })
        pending.sort(key=lambda x: x["date"], reverse=True)
        return jsonify({"pending": pending, "count": len(pending)})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/plaid/import", methods=["POST"])
def plaid_import():
    """Write the chosen reviewed transactions to the finance Sheet and remember their
    Plaid ids so they never import twice."""
    d = request.json or {}
    txns = d.get("transactions", [])
    config = _load(PLAID_CONFIG_FILE, {"items": []})
    imported = set(config.get("imported_ids", []))
    written, failed, errors = 0, 0, []
    for t in txns:
        tid = t.get("id")
        if not tid or tid in imported:
            continue
        try:
            ok, detail = _record_expense(
                t.get("date") or datetime.now().strftime("%Y-%m-%d"),
                t.get("name", "Bank transaction"),
                float(t.get("amount", 0)),
                t.get("category", "Fun"))
            if ok:
                imported.add(tid); written += 1
            else:
                failed += 1; errors.append(detail)
        except Exception as e:
            failed += 1; errors.append(str(e))
    config["imported_ids"] = list(imported)
    _save(PLAID_CONFIG_FILE, config)
    return jsonify({"ok": True, "written": written, "failed": failed, "errors": errors[:5]})

@app.route("/api/plaid/autoimport", methods=["GET"])
def plaid_autoimport():
    """Auto-pull recent SETTLED expenses from every connected Plaid item and write them
    straight to the finance Sheet -- categorized and de-duplicated, no review step.
    Skips pending charges (they re-post under a new id -> would double-count) and
    non-spend transactions (transfers, card/loan payments, income)."""
    config = _load(PLAID_CONFIG_FILE, {"items": []})
    items = config.get("items", [])
    if not items:
        return jsonify({"error": "No Plaid accounts connected"}), 400
    plaid_c, err = _plaid_client()
    if err:
        return jsonify({"error": err}), 500
    imported = set(config.get("imported_ids", []))
    skipped  = set(config.get("skipped_ids", []))
    written, failed, scanned, errors = 0, 0, 0, []
    try:
        from plaid.model.transactions_get_request import TransactionsGetRequest
        from plaid.model.transactions_get_request_options import TransactionsGetRequestOptions
        import datetime as dt
        try:
            days = max(1, min(90, int(request.args.get("days", 30))))
        except (TypeError, ValueError):
            days = 30
        end_date = dt.date.today()
        start_date = end_date - dt.timedelta(days=days)
        for it in items:
            req = TransactionsGetRequest(
                access_token=it["access_token"], start_date=start_date, end_date=end_date,
                options=TransactionsGetRequestOptions(count=100))
            resp = plaid_c.transactions_get(req)
            for t in resp["transactions"]:
                scanned += 1
                tid = t["transaction_id"]
                if tid in imported or tid in skipped:
                    continue
                if t.get("pending"):                 # not settled yet -> re-posts under a new id
                    continue
                amt = float(t["amount"])
                if amt <= 0:                          # inflow / refund -- not an expense
                    continue
                if _plaid_is_nonspend(t):             # transfer / card-loan payment / income
                    continue
                name = t.get("merchant_name") or t["name"]
                date = t["date"].isoformat() if hasattr(t["date"], "isoformat") else str(t["date"])
                try:
                    ok, detail = _record_expense(date, name, amt, _plaid_to_finance_category(t, name))
                    if ok:
                        imported.add(tid); written += 1
                    else:
                        failed += 1
                        if isinstance(detail, str) and detail not in errors:
                            errors.append(detail)
                except Exception as e:
                    failed += 1; errors.append(str(e))
        config["imported_ids"] = list(imported)
        _save(PLAID_CONFIG_FILE, config)
        return jsonify({"ok": True, "written": written, "failed": failed, "scanned": scanned, "errors": errors[:5]})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/plaid/skip", methods=["POST"])
def plaid_skip():
    """Remember transactions the user chose not to import so they stop reappearing."""
    d = request.json or {}
    ids = [i for i in d.get("ids", []) if i]
    config = _load(PLAID_CONFIG_FILE, {"items": []})
    skipped = set(config.get("skipped_ids", []))
    skipped.update(ids)
    config["skipped_ids"] = list(skipped)
    _save(PLAID_CONFIG_FILE, config)
    return jsonify({"ok": True, "skipped": len(ids)})

# ── Calendar overview ─────────────────────────────────────────────────────────

@app.route("/api/calendar/overview")
def calendar_overview():
    today = datetime.now().date()
    cutoff = today + timedelta(days=90)
    events = []

    # Band shows
    for s in _load(SHOWS_FILE):
        try:
            d = datetime.strptime(s["date"], "%Y-%m-%d").date()
            if today <= d <= cutoff:
                events.append({"date": s["date"], "type": "show",
                    "title": f"{s['event']} — {s['venue']}, {s['city']}", "meta": s.get("notes","")})
        except Exception:
            pass

    # National holidays
    for h in NATIONAL_HOLIDAYS:
        try:
            d = datetime.strptime(h["date"], "%Y-%m-%d").date()
            if today <= d <= cutoff:
                events.append({"date": h["date"], "type": "holiday", "title": h["title"], "meta": ""})
        except Exception:
            pass

    # Pop culture events
    for c in POP_CULTURE_EVENTS:
        try:
            d = datetime.strptime(c["date"], "%Y-%m-%d").date()
            if today <= d <= cutoff:
                events.append({"date": c["date"], "type": "culture", "title": c["title"], "meta": ""})
        except Exception:
            pass

    # Work items with due_date
    for w in _load(WORK_FILE):
        if not w.get("done") and w.get("due_date"):
            try:
                d = datetime.strptime(w["due_date"], "%Y-%m-%d").date()
                if today <= d <= cutoff:
                    events.append({"date": w["due_date"], "type": "work",
                        "title": w["title"], "meta": w.get("project", "")})
            except Exception:
                pass

    # Manually-added calendar events (band / work / birthday / anniversary / other)
    # Annual events (birthdays, anniversaries) are projected onto each year in the window.
    manual_keys = set()  # (title, date) of emitted manual events, used to dedupe Google copies
    for m in _load(CALENDAR_EVENTS_FILE, []):
        try:
            base = datetime.strptime(m["date"], "%Y-%m-%d").date()
        except Exception:
            continue
        cat = m.get("category", "other")
        item_common = {"type": cat, "title": m.get("title", ""), "meta": _event_meta(m),
                       "highlight": m.get("highlight", False), "id": m.get("id", "")}
        rec = m.get("recurring")
        if rec == "annual":
            for yr in range(today.year, cutoff.year + 1):
                try:
                    occ = base.replace(year=yr)
                except ValueError:
                    occ = base.replace(year=yr, day=28)  # Feb 29 -> Feb 28
                if today <= occ <= cutoff:
                    iso = occ.isoformat()
                    events.append({"date": iso, **item_common})
                    manual_keys.add((item_common["title"], iso))
        elif rec == "weekly":
            wds = m.get("weekdays") or []
            day = max(base, today)  # don't show occurrences before the anchor date
            while wds and day <= cutoff:
                if ((day.weekday() + 1) % 7) in wds:  # python Mon=0 -> JS Sun=0 convention
                    iso = day.isoformat()
                    events.append({"date": iso, **item_common})
                    manual_keys.add((item_common["title"], iso))
                day += timedelta(days=1)
        elif today <= base <= cutoff:
            events.append({"date": m["date"], **item_common})
            manual_keys.add((item_common["title"], m["date"]))

    # Google Calendar (if connected)
    try:
        svc, err = _gcal_service()
        if not err and svc:
            now_iso = datetime.utcnow().isoformat() + 'Z'
            end_iso = (datetime.utcnow() + timedelta(days=90)).isoformat() + 'Z'
            items = svc.events().list(
                calendarId='primary', timeMin=now_iso, timeMax=end_iso,
                maxResults=60, singleEvents=True, orderBy='startTime'
            ).execute().get('items', [])
            for item in items:
                start = item.get('start', {}).get('dateTime', item.get('start', {}).get('date', ''))
                if start:
                    summary = item.get('summary', '(no title)')
                    # Skip events we pushed ourselves (any manual event) to avoid double-listing
                    if (summary, start[:10]) in manual_keys:
                        continue
                    events.append({"date": start[:10], "type": "gcal",
                        "title": summary,
                        "meta": item.get('location', '')})
    except Exception:
        pass

    events.sort(key=lambda e: e["date"])
    return jsonify({"events": events})

VALID_EVENT_CATEGORIES = {"band", "work", "piano", "birthday", "anniversary", "other"}

def _clean_weekdays(val):
    """Normalize a weekdays payload to a sorted list of unique JS getDay indices (0=Sun..6=Sat)."""
    if not isinstance(val, list):
        return []
    out = set()
    for w in val:
        try:
            iw = int(w)
        except (TypeError, ValueError):
            continue
        if 0 <= iw <= 6:
            out.add(iw)
    return sorted(out)

def _fmt_time(hhmm):
    """'17:00' -> '5:00pm'. Returns '' on bad input."""
    try:
        h, mm = str(hhmm).split(":")
        h, mm = int(h), int(mm)
    except Exception:
        return ""
    ap = "am" if h < 12 else "pm"
    return f"{(h % 12) or 12}:{mm:02d}{ap}"

def _event_meta(m):
    """Combine a manual event's time range with its note for display (e.g. '6:00pm–8:00pm · Studio')."""
    rng = ""
    if m.get("time"):
        rng = _fmt_time(m["time"]) + (f"–{_fmt_time(m['end_time'])}" if m.get("end_time") else "")
    note = m.get("meta", "")
    return f"{rng} · {note}" if (rng and note) else (rng or note)

def _push_event_to_gcal(m):
    """Push one manual event to Google Calendar. Returns htmlLink or None (silent on errors)."""
    return _gcal_create_event(
        title=m.get("title", ""),
        date_str=m.get("date", ""),
        time_str=m.get("time", ""),
        end_time=m.get("end_time", ""),
        description=m.get("meta", ""),
        recurrence=m.get("recurring", ""),
        weekdays=m.get("weekdays") or None,
    )

@app.route("/api/calendar/events/manual", methods=["GET"])
def get_manual_events():
    return jsonify(_load(CALENDAR_EVENTS_FILE, []))

@app.route("/api/calendar/events/manual", methods=["POST"])
def post_manual_event():
    d = request.json or {}
    category = (d.get("category") or "other").strip()
    title = (d.get("title") or "").strip()
    date = (d.get("date") or "").strip()
    if category not in VALID_EVENT_CATEGORIES:
        return jsonify({"error": "invalid_category"}), 400
    if not title or not date:
        return jsonify({"error": "title_and_date_required"}), 400
    try:
        datetime.strptime(date, "%Y-%m-%d")
    except ValueError:
        return jsonify({"error": "invalid_date"}), 400

    annual = category in ("birthday", "anniversary")
    weekdays = _clean_weekdays(d.get("weekdays"))
    if annual:
        recurring = "annual"
    elif (d.get("recurring") == "weekly") and weekdays:
        recurring = "weekly"
    else:
        recurring = ""
    record = {
        "id": f"evt_{int(datetime.now().timestamp()*1000)}",
        "category": category,
        "title": title,
        "date": date,
        "time": (d.get("time") or "").strip(),
        "end_time": (d.get("end_time") or "").strip(),
        "meta": (d.get("meta") or "").strip(),
        "highlight": True if annual else bool(d.get("highlight")),
        "recurring": recurring,
        "weekdays": weekdays,
        "gcal_link": "",
        "created": datetime.now().strftime("%Y-%m-%d"),
    }
    # Push every category to Google at create time (no-op/silent if Google isn't connected).
    link = _push_event_to_gcal(record)
    record["gcal_link"] = link or ""

    items = _load(CALENDAR_EVENTS_FILE, [])
    items.append(record)
    _save(CALENDAR_EVENTS_FILE, items)
    return jsonify({"ok": True, "event": record})

@app.route("/api/calendar/events/manual/<eid>", methods=["PATCH"])
def patch_manual_event(eid):
    d = request.json or {}
    items = _load(CALENDAR_EVENTS_FILE, [])
    found = next((m for m in items if m.get("id") == eid), None)
    if not found:
        return jsonify({"error": "not_found"}), 404
    if "category" in d:
        cat = (d.get("category") or "").strip()
        if cat not in VALID_EVENT_CATEGORIES:
            return jsonify({"error": "invalid_category"}), 400
        found["category"] = cat
        if cat in ("birthday", "anniversary"):
            found["recurring"] = "annual"
        elif found.get("recurring") == "annual":
            found["recurring"] = ""  # leaving annual category clears annual recurrence
    if "title" in d:
        title = (d.get("title") or "").strip()
        if title:
            found["title"] = title
    if "date" in d:
        date = (d.get("date") or "").strip()
        try:
            datetime.strptime(date, "%Y-%m-%d")
        except ValueError:
            return jsonify({"error": "invalid_date"}), 400
        found["date"] = date
    if "time" in d:
        found["time"] = (d.get("time") or "").strip()
    if "end_time" in d:
        found["end_time"] = (d.get("end_time") or "").strip()
    if "weekdays" in d:
        found["weekdays"] = _clean_weekdays(d.get("weekdays"))
    if "recurring" in d and found.get("category") not in ("birthday", "anniversary"):
        rec = d.get("recurring")
        found["recurring"] = "weekly" if (rec == "weekly" and found.get("weekdays")) else ""
    if "meta" in d:
        found["meta"] = (d.get("meta") or "").strip()
    if "highlight" in d:
        found["highlight"] = bool(d.get("highlight"))
    # Birthdays/anniversaries are always highlighted.
    if found.get("category") in ("birthday", "anniversary"):
        found["highlight"] = True
    _save(CALENDAR_EVENTS_FILE, items)
    return jsonify({"ok": True, "event": found})

@app.route("/api/calendar/events/manual/<eid>", methods=["DELETE"])
def delete_manual_event(eid):
    items = _load(CALENDAR_EVENTS_FILE, [])
    kept = [e for e in items if e.get("id") != eid]
    _save(CALENDAR_EVENTS_FILE, kept)
    return jsonify({"ok": True, "removed": len(items) - len(kept)})

@app.route("/api/calendar/sync-google", methods=["POST"])
def sync_calendar_google():
    """Back-fill: push every not-yet-synced manual event up to Google Calendar."""
    svc, err = _gcal_service()
    if err or not svc:
        return jsonify({"ok": False, "error": err or "not_connected"})
    items = _load(CALENDAR_EVENTS_FILE, [])
    synced = 0
    for m in items:
        if m.get("gcal_link"):
            continue
        link = _push_event_to_gcal(m)
        if link:
            m["gcal_link"] = link
            synced += 1
    _save(CALENDAR_EVENTS_FILE, items)
    pending = sum(1 for m in items if not m.get("gcal_link"))
    return jsonify({"ok": True, "synced": synced, "pending": pending, "total": len(items)})

# ── Google Sheets auto-sync helpers ──────────────────────────────────────────

def _sheets_push_finances():
    """Push local finances to Google Sheets after any write. Silent on errors."""
    try:
        cfg = _load(GDRIVE_CONFIG_FILE, {})
        sheet_id = cfg.get("sheet_finance")
        if not sheet_id:
            return
        sheets, err = _gdrive_service()
        if err:
            return
        tab = _first_sheet_name(sheets, sheet_id)
        finances = _load(FINANCE_FILE)
        values = [["Date", "Description", "Amount", "Type", "Category"]]
        for t in sorted(finances, key=lambda x: x.get("date", ""), reverse=True):
            values.append([t.get("date",""), t.get("description",""),
                           t.get("amount",""), t.get("type",""), t.get("category","")])
        sheets.spreadsheets().values().update(
            spreadsheetId=sheet_id, range=tab,
            valueInputOption='USER_ENTERED', body={'values': values}
        ).execute()
    except Exception:
        pass

def _sheets_push_contacts():
    """Push local band contacts to Google Sheets after any write. Silent on errors."""
    try:
        cfg = _load(GDRIVE_CONFIG_FILE, {})
        sheet_id = cfg.get("sheet_contacts")
        if not sheet_id:
            return
        sheets, err = _gdrive_service()
        if err:
            return
        tab = _first_sheet_name(sheets, sheet_id)
        contacts = _load(BAND_CONTACTS_FILE)
        values = [["Name", "Venue", "City", "Status", "Last", "Notes"]]
        for c in contacts:
            values.append([c.get("name",""), c.get("venue",""), c.get("city",""),
                           c.get("status",""), c.get("last",""), c.get("notes","")])
        sheets.spreadsheets().values().update(
            spreadsheetId=sheet_id, range=tab,
            valueInputOption='USER_ENTERED', body={'values': values}
        ).execute()
    except Exception:
        pass

# ── Health sheet auto-sync helpers ───────────────────────────────────────────

def _health_sheet_daily_columns():
    """Read header row of Daily tab → (svc, {column_label_lower: (letter, index)}). None if unavailable."""
    if not HEALTH_SHEET_ID:
        return None
    svc, err = _gdrive_service()
    if err:
        return None
    try:
        result = svc.spreadsheets().values().get(
            spreadsheetId=HEALTH_SHEET_ID, range="Daily!1:1"
        ).execute()
        headers = result.get("values", [[]])
        if not headers:
            return None
        headers = headers[0]
        cols = {}
        for i, label in enumerate(headers):
            letter = chr(ord('A') + i) if i < 26 else 'A' + chr(ord('A') + i - 26)
            cols[str(label).strip().lower()] = (letter, i)
        return svc, cols
    except Exception:
        return None

def _health_sheet_find_or_create_row(svc, date_str):
    """Return 1-based row index in Daily tab for the given date. Creates row if missing."""
    try:
        result = svc.spreadsheets().values().get(
            spreadsheetId=HEALTH_SHEET_ID, range="Daily!A:A"
        ).execute()
        col_a = result.get("values", [])
        for i, row in enumerate(col_a):
            if row and str(row[0]).strip() == date_str:
                return i + 1
        next_row = len(col_a) + 1
        svc.spreadsheets().values().update(
            spreadsheetId=HEALTH_SHEET_ID,
            range=f"Daily!A{next_row}",
            valueInputOption="RAW",
            body={"values": [[date_str]]},
        ).execute()
        return next_row
    except Exception:
        return None

def _health_sheet_update_daily(date_str, updates):
    """Upsert one or more fields in the Daily tab for `date_str`. updates = {column_label: value}. Silent on errors."""
    try:
        res = _health_sheet_daily_columns()
        if not res:
            return
        svc, cols = res
        row = _health_sheet_find_or_create_row(svc, date_str)
        if not row:
            return

        def _col_letter(i):
            return chr(ord('A') + i) if i < 26 else 'A' + chr(ord('A') + i - 26)

        data = []
        for label, value in updates.items():
            key = str(label).strip().lower()
            col_info = cols.get(key)
            if not col_info:
                # Column doesn't exist yet — append it to the header row and use it.
                next_idx = (max((i for _, i in cols.values())) + 1) if cols else 0
                letter = _col_letter(next_idx)
                try:
                    svc.spreadsheets().values().update(
                        spreadsheetId=HEALTH_SHEET_ID,
                        range=f"Daily!{letter}1",
                        valueInputOption="RAW",
                        body={"values": [[str(label).strip()]]},
                    ).execute()
                except Exception:
                    continue
                cols[key] = (letter, next_idx)
                col_info = cols[key]
            letter, _ = col_info
            if isinstance(value, bool):
                value = "TRUE" if value else "FALSE"
            data.append({"range": f"Daily!{letter}{row}", "values": [[str(value)]]})
        if data:
            svc.spreadsheets().values().batchUpdate(
                spreadsheetId=HEALTH_SHEET_ID,
                body={"valueInputOption": "RAW", "data": data},
            ).execute()
    except Exception:
        pass

def _health_sheet_append_food(date_str, item):
    """Append a food row to the Food tab. Silent on errors."""
    if not HEALTH_SHEET_ID:
        return
    try:
        svc, err = _gdrive_service()
        if err:
            return
        svc.spreadsheets().values().append(
            spreadsheetId=HEALTH_SHEET_ID,
            range="Food!A:F",
            valueInputOption="RAW",
            insertDataOption="INSERT_ROWS",
            body={"values": [[
                date_str,
                item.get("name", ""),
                str(item.get("calories", "")),
                str(item.get("protein", "")),
                str(item.get("carbs", "")),
                str(item.get("fat", "")),
            ]]},
        ).execute()
    except Exception:
        pass

def _health_sheet_clear_food(date_str, index=None, name=None):
    """Clear matching Food tab row(s) and return remaining calories for that date."""
    if not HEALTH_SHEET_ID:
        return {"deleted": False, "remaining_calories": None}
    try:
        svc, err = _gdrive_service()
        if err:
            return {"deleted": False, "remaining_calories": None}
        rows = svc.spreadsheets().values().get(
            spreadsheetId=HEALTH_SHEET_ID, range="Food!A2:F1000"
        ).execute().get("values", [])

        idx = None
        if index is not None:
            try:
                idx = int(index)
            except (TypeError, ValueError):
                idx = None
        target_name = str(name or "").strip().lower()
        date_match_idx = 0
        rows_to_clear = []

        for sheet_row, row in enumerate(rows, start=2):
            row_date = str(row[0]).strip() if len(row) > 0 else ""
            row_name = str(row[1]).strip() if len(row) > 1 else ""
            if row_date != date_str or not row_name:
                continue
            should_clear = False
            if idx is not None:
                should_clear = date_match_idx == idx
            elif target_name:
                should_clear = row_name.lower() == target_name
            if should_clear:
                rows_to_clear.append(sheet_row)
                if idx is not None:
                    break
            date_match_idx += 1

        remaining_calories = 0
        for sheet_row, row in enumerate(rows, start=2):
            if sheet_row in rows_to_clear:
                continue
            row_date = str(row[0]).strip() if len(row) > 0 else ""
            if row_date != date_str:
                continue
            try:
                remaining_calories += int(float(row[2])) if len(row) > 2 and row[2] else 0
            except ValueError:
                pass

        if rows_to_clear:
            svc.spreadsheets().values().batchClear(
                spreadsheetId=HEALTH_SHEET_ID,
                body={"ranges": [f"Food!A{r}:F{r}" for r in rows_to_clear]},
            ).execute()
        return {"deleted": bool(rows_to_clear), "remaining_calories": remaining_calories}
    except Exception:
        return {"deleted": False, "remaining_calories": None}

def _health_habit_label(habit_id):
    """Look up the display label for a habit_id from health.json habit_list."""
    try:
        h = _load(HEALTH_FILE)
        for hbt in (h.get("habit_list", []) if isinstance(h, dict) else []):
            if hbt.get("id") == habit_id:
                return hbt.get("label", habit_id)
    except Exception:
        pass
    return habit_id

def _health_label_to_habit_id(label):
    """Reverse: find a habit_id for a display label (case-insensitive)."""
    try:
        h = _load(HEALTH_FILE)
        target = (label or "").strip().lower()
        for hbt in (h.get("habit_list", []) if isinstance(h, dict) else []):
            if hbt.get("label", "").strip().lower() == target:
                return hbt.get("id")
    except Exception:
        pass
    return None

def _health_sheet_read():
    """Read Daily + Food tabs from the Sheet, return dict in the shape of health.json sections.
    Sheet wins on conflicts. Returns None if Sheets unavailable so caller can fall back to local JSON."""
    if not HEALTH_SHEET_ID:
        return None
    try:
        svc, err = _gdrive_service()
        if err:
            return None

        result = {"weight": {}, "habits": {}, "calories": {}, "food_log": {}, "water": {}}

        # --- Daily tab ---
        daily = svc.spreadsheets().values().get(
            spreadsheetId=HEALTH_SHEET_ID, range="Daily!A1:Z1000"
        ).execute()
        rows = daily.get("values", [])
        if rows and len(rows) > 1:
            headers = [str(h).strip() for h in rows[0]]
            cmap = {h.lower(): i for i, h in enumerate(headers)}
            known = {"date", "weight (lb)", "cal goal", "cal eaten", "cal burned", "notes", "water (oz)"}
            habit_cols = {h: i for h, i in cmap.items() if h and h not in known}

            for row in rows[1:]:
                if not row or not row[0]:
                    continue
                date_str = str(row[0]).strip()

                def cell(label):
                    idx = cmap.get(label.lower())
                    if idx is None or idx >= len(row):
                        return ""
                    return str(row[idx]).strip()

                w = cell("weight (lb)")
                if w:
                    try: result["weight"][date_str] = float(w)
                    except ValueError: pass

                wat = cell("water (oz)")
                if wat:
                    try: result["water"][date_str] = int(float(wat))
                    except ValueError: pass

                cal_entry = {}
                for src, dst in [("cal goal", "goal"), ("cal eaten", "calories"), ("cal burned", "burned")]:
                    v = cell(src)
                    if v:
                        try: cal_entry[dst] = int(float(v))
                        except ValueError: pass
                if cal_entry:
                    result["calories"][date_str] = cal_entry

                habits_today = {}
                for label_lower, idx in habit_cols.items():
                    val = str(row[idx]).strip().upper() if idx < len(row) else ""
                    habit_id = _health_label_to_habit_id(label_lower)
                    if habit_id is None:
                        continue
                    if val in ("TRUE", "1", "YES"):
                        habits_today[habit_id] = True
                    elif val in ("FALSE", "0", "NO"):
                        habits_today[habit_id] = False
                if habits_today:
                    result["habits"][date_str] = habits_today

        # --- Food tab ---
        food = svc.spreadsheets().values().get(
            spreadsheetId=HEALTH_SHEET_ID, range="Food!A2:F1000"
        ).execute()
        for row in food.get("values", []):
            if not row or len(row) < 2:
                continue
            date_str = str(row[0]).strip()
            if not date_str:
                continue
            def num(i):
                if i >= len(row) or not row[i]: return 0
                try: return int(float(row[i]))
                except ValueError: return 0
            item = {
                "name": str(row[1]) if len(row) > 1 else "",
                "calories": num(2),
                "protein":  num(3),
                "carbs":    num(4),
                "fat":      num(5),
            }
            result["food_log"].setdefault(date_str, []).append(item)

        return result
    except Exception:
        return None

# ── Google Drive / Sheets ─────────────────────────────────────────────────────

def _extract_sheet_id(url_or_id):
    import re
    m = re.search(r'/spreadsheets/d/([a-zA-Z0-9_-]+)', url_or_id)
    return m.group(1) if m else url_or_id.strip()

def _first_sheet_name(sheets_svc, sheet_id):
    meta = sheets_svc.spreadsheets().get(spreadsheetId=sheet_id, fields='sheets.properties.title').execute()
    return meta['sheets'][0]['properties']['title']

def _sheets_svc():
    """Sheets API client using Application Default Credentials. Works on Cloud Run (service account) and locally (gcloud auth application-default login)."""
    import google.auth
    import google.auth.transport.requests
    from googleapiclient.discovery import build
    creds, _ = google.auth.default(scopes=['https://www.googleapis.com/auth/spreadsheets'])
    if not creds.valid:
        creds.refresh(google.auth.transport.requests.Request())
    return build('sheets', 'v4', credentials=creds)

def _month_tab(yyyy_mm):
    """Convert YYYY-MM to full month name for sheet tab lookup."""
    months = ['January','February','March','April','May','June',
              'July','August','September','October','November','December']
    try:
        return months[int(str(yyyy_mm).split('-')[1]) - 1]
    except Exception:
        return months[0]

def _parse_budget_rows(rows):
    """Parse a budget-tracker sheet and return {income, expense, categories}.
    Sheet layout: col A=category (merged), B=description, C=account, D=due date,
    E=budgeted amount, F=actual amount, G=paid. Income section on the right side."""
    if not rows:
        return {'income': 0.0, 'expense': 0.0, 'categories': []}
    max_cols = max((len(r) for r in rows), default=1)
    rows = [r + [''] * (max_cols - len(r)) for r in rows]

    # Find the header row (first 5 rows) by looking for "Budgeted Amount" or "Actual Amount"
    hdr_row_idx = 0
    for i, row in enumerate(rows[:5]):
        row_lower = ' '.join(row).lower()
        if 'budget' in row_lower or 'actual amount' in row_lower:
            hdr_row_idx = i
            break

    hdr = [c.lower().strip() for c in rows[hdr_row_idx]]
    budget_col  = next((i for i, h in enumerate(hdr) if 'budget' in h), 4)
    actual_col  = next((i for i, h in enumerate(hdr) if 'actual' in h), 5)
    income_col  = next((i for i, h in enumerate(hdr) if h == 'income'), None)

    # Parse budget section (left side, rows after header)
    cat_data = {}
    current_cat = ''
    for row in rows[hdr_row_idx + 1:]:
        row_lower = ' '.join(row[:8]).lower()
        if any(kw in row_lower for kw in ['anticipated', 'actual total', 'roommate', 'savings total']):
            break
        cat_val = row[0].strip()
        if cat_val and not any(ch.isdigit() for ch in cat_val):
            current_cat = cat_val
        # Prefer the row's description (col B) over a stale carried-forward parent
        # when the parent isn't a known category — handles sheets that put each
        # utility/subscription sub-item in col A with no merged parent.
        desc_val = row[1].strip() if len(row) > 1 else ''
        row_key = cat_val or desc_val or current_cat
        canon = _canon_cat(row_key)
        if not canon:
            continue
        budg_str   = row[budget_col].strip() if len(row) > budget_col else ''
        actual_str = row[actual_col].strip() if len(row) > actual_col else ''
        if not budg_str and not actual_str:
            continue
        try: budg = float(budg_str.replace('$','').replace(',','') or 0)
        except: budg = 0.0
        try: actual = float(actual_str.replace('$','').replace(',','') or 0)
        except: actual = 0.0
        if budg > 0 or actual > 0:
            if canon not in cat_data:
                cat_data[canon] = {'budgeted': 0.0, 'actual': 0.0}
            cat_data[canon]['budgeted'] += budg
            cat_data[canon]['actual']   += actual

    # Parse income section (right side — scan for "Income" header column)
    income_total = 0.0
    if income_col is None:
        # Scan all rows for a cell that says exactly "Income"
        for ri, row in enumerate(rows[:5]):
            for ci, cell in enumerate(row):
                if cell.strip().lower() == 'income':
                    income_col = ci
                    break
            if income_col is not None:
                break

    if income_col is not None:
        amt_col = income_col + 2
        for row in rows[hdr_row_idx + 1:]:
            if len(row) <= income_col:
                continue
            desc = row[income_col].strip()
            if not desc:
                continue
            if 'total' in desc.lower():
                try:
                    t = float(row[amt_col].strip().replace('$','').replace(',','') or 0)
                    if t > 0:
                        income_total = t
                except Exception:
                    pass
                break
            if len(row) > amt_col:
                try:
                    income_total += float(row[amt_col].strip().replace('$','').replace(',','') or 0)
                except Exception:
                    pass

    categories = [{'name': k, 'budgeted': round(v['budgeted'], 2), 'actual': round(v['actual'], 2)}
                  for k, v in cat_data.items() if v['budgeted'] > 0 or v['actual'] > 0]
    expense_total = sum(v['actual'] for v in cat_data.values())
    return {'income': round(income_total, 2), 'expense': round(expense_total, 2), 'categories': categories}

def _col_letter(n):
    """0-indexed column number → A1-notation letters (0→A, 25→Z, 26→AA, ...)."""
    s = ""
    n = int(n)
    while n >= 0:
        s = chr(ord('A') + n % 26) + s
        n = n // 26 - 1
    return s

def _parse_money(value):
    try:
        return float(str(value).replace('$', '').replace(',', '').strip() or 0)
    except (TypeError, ValueError):
        return 0.0

def _finance_budget_columns(rows):
    hdr_row_idx = 0
    for i, row in enumerate(rows[:5]):
        row_lower = ' '.join(str(c) for c in row).lower()
        if 'budget' in row_lower or 'actual amount' in row_lower:
            hdr_row_idx = i
            break
    hdr = [str(c).lower().strip() for c in rows[hdr_row_idx]] if rows else []
    desc_col = next((i for i, h in enumerate(hdr) if 'description' in h or h == 'name'), 1)
    due_col = next((i for i, h in enumerate(hdr) if 'due' in h), 3)
    actual_col = next((i for i, h in enumerate(hdr) if 'actual' in h), 5)
    return hdr_row_idx, desc_col, due_col, actual_col

DETAIL_TABLE_KEYWORDS = {
    'Gas':           ['gas total', 'gas totals'],
    'Fun':           ['fun total', 'fun totals'],
    'Food / Grocery': ['grocery trip', 'groceries total', 'grocery'],
}
BUDGET_TRANSACTION_CATEGORIES = {'Housing', 'Utilities'}
FINANCE_CATEGORY_NAMES = {
    'Housing', 'Utilities', 'Subscriptions', 'Food / Grocery', 'Fun',
    'Gas', 'Shopping', 'Band', 'Loans', 'Other',
}

# Canonical budget category map. Lookup is lowercase, exact-match first then substring.
# Mirrors normFinCat in modules.jsx but adds common utility/subscription sub-names so
# every line item collapses to one parent bar.
_CANON_CAT_EXACT = {
    'housing': 'Housing', 'rent': 'Housing', 'mortgage': 'Housing',
    'utilities': 'Utilities', 'utilites': 'Utilities', 'utilties': 'Utilities',
    'water': 'Utilities', 'sewer': 'Utilities', 'trash': 'Utilities',
    'electric': 'Utilities', 'electricity': 'Utilities', 'power': 'Utilities',
    'internet': 'Utilities', 'wifi': 'Utilities', 'wi-fi': 'Utilities', 'cable': 'Utilities',
    'phone': 'Utilities',
    'heating': 'Utilities', 'cooling': 'Utilities',
    'water, sewer, trash': 'Utilities',
    'subscriptions': 'Subscriptions', 'subscription': 'Subscriptions', 'streaming': 'Subscriptions',
    'netflix': 'Subscriptions', 'hulu': 'Subscriptions', 'spotify': 'Subscriptions',
    'apple music': 'Subscriptions', 'youtube': 'Subscriptions', 'amazon prime': 'Subscriptions',
    'prime': 'Subscriptions', 'disney+': 'Subscriptions', 'disney plus': 'Subscriptions',
    'hbo': 'Subscriptions', 'hbo max': 'Subscriptions', 'paramount': 'Subscriptions', 'peacock': 'Subscriptions',
    'patreon': 'Subscriptions', 'github': 'Subscriptions', 'chatgpt': 'Subscriptions',
    'claude': 'Subscriptions', 'notion': 'Subscriptions', 'adobe': 'Subscriptions',
    'icloud': 'Subscriptions', 'microsoft 365': 'Subscriptions', 'office 365': 'Subscriptions',
    'food': 'Food / Grocery', 'food / grocery': 'Food / Grocery', 'food / grocer': 'Food / Grocery',
    'food/grocery': 'Food / Grocery', 'food/grocer': 'Food / Grocery',
    'grocer': 'Food / Grocery', 'groceries': 'Food / Grocery', 'grocery': 'Food / Grocery',
    'fun': 'Fun', 'dining': 'Fun', 'restaurants': 'Fun',
    'entertainment': 'Fun',
    'gas': 'Gas', 'fuel': 'Gas', 'transportation': 'Gas', 'transport': 'Gas', 'auto': 'Gas',
    'shopping': 'Shopping',
    'band': 'Band',
    'loans': 'Loans', 'loan': 'Loans',
}
_CANON_SUBSTR = [
    ('netflix', 'Subscriptions'), ('hulu', 'Subscriptions'), ('spotify', 'Subscriptions'),
    ('disney', 'Subscriptions'), ('prime', 'Subscriptions'), ('youtube', 'Subscriptions'),
    ('apple', 'Subscriptions'), ('hbo', 'Subscriptions'),
    ('internet', 'Utilities'), ('electric', 'Utilities'), ('water', 'Utilities'),
    ('cable', 'Utilities'), ('power', 'Utilities'), ('sewer', 'Utilities'),
    ('trash', 'Utilities'), ('phone', 'Utilities'),
    ('renters insurance', 'Housing'), ('rent', 'Housing'), ('mortgage', 'Housing'),
    ('grocery', 'Food / Grocery'), ('grocer', 'Food / Grocery'),
]

def _canon_cat(raw):
    if not raw:
        return 'Other'
    key = str(raw).strip().lower()
    if key in _CANON_CAT_EXACT:
        return _CANON_CAT_EXACT[key]
    for substr, canon in _CANON_SUBSTR:
        if substr in key:
            return canon
    return str(raw).strip()

def _canonical_finance_category(raw):
    key = str(raw or "").strip()
    aliases = {
        'auto': 'Gas',
        'dining': 'Fun',
        'electric': 'Utilities',
        'electricity': 'Utilities',
        'entertainment': 'Fun',
        'food': 'Food / Grocery',
        'food / grocery': 'Food / Grocery',
        'food / grocer': 'Food / Grocery',
        'food/grocery': 'Food / Grocery',
        'food/grocer': 'Food / Grocery',
        'fuel': 'Gas',
        'fun': 'Fun',
        'gas': 'Gas',
        'groceries': 'Food / Grocery',
        'grocery': 'Food / Grocery',
        'grocer': 'Food / Grocery',
        'housing': 'Housing',
        'internet': 'Utilities',
        'mortgage': 'Housing',
        'phone': 'Utilities',
        'rent': 'Housing',
        'restaurants': 'Fun',
        'transport': 'Gas',
        'transportation': 'Gas',
        'utilities': 'Utilities',
        'water': 'Utilities',
    }
    return aliases.get(key.lower(), key or 'Fun')

def _find_detail_table(rows, category):
    """Return (header_row, header_col) for the detail table for `category`, or None."""
    keywords = DETAIL_TABLE_KEYWORDS.get(category)
    if not keywords or not rows:
        return None
    max_cols = max((len(r) for r in rows), default=1)
    padded = [r + [''] * (max_cols - len(r)) for r in rows]
    for ri, row in enumerate(padded):
        for ci, cell in enumerate(row):
            if any(kw in str(cell).lower() for kw in keywords):
                return (ri, ci)
    return None

def _find_next_empty_table_row(rows, header_row, header_col):
    """Find first row index after header where both data columns are empty,
    stopping before any 'total' row. Returns row index (0-based)."""
    max_cols = max((len(r) for r in rows), default=1)
    padded = [r + [''] * (max_cols - len(r)) for r in rows]
    for ri in range(header_row + 2, len(padded)):
        row = padded[ri]
        cell1 = str(row[header_col]).strip() if len(row) > header_col else ''
        cell2 = str(row[header_col + 1]).strip() if len(row) > header_col + 1 else ''
        if 'total' in (cell1 + cell2).lower():
            return ri  # caller will refuse to write here
        if not cell1 and not cell2:
            return ri
    return len(padded)

def _format_short_date(iso_date):
    """Convert 'YYYY-MM-DD' to 'D-MMM' (e.g. '2026-05-15' -> '15-May')."""
    try:
        d = datetime.strptime(iso_date[:10], '%Y-%m-%d')
        return f"{d.day}-{d.strftime('%b')}"
    except Exception:
        return iso_date

def _write_detail_transaction(svc, spreadsheet_id, tab, rows, cat, desc, amt, date):
    pos = _find_detail_table(rows, cat)
    if not pos:
        return None
    header_row, header_col = pos
    target_row = _find_next_empty_table_row(rows, header_row, header_col)
    check = rows[target_row] if target_row < len(rows) else []
    c1 = check[header_col].strip()     if len(check) > header_col     else ''
    c2 = check[header_col + 1].strip() if len(check) > header_col + 1 else ''
    if 'total' in (c1 + c2).lower():
        raise ValueError(f"'{cat}' table is full - add more empty rows before the Total row.")
    col1 = desc if cat == 'Fun' else _format_short_date(date)
    a1 = f"'{tab}'!{_col_letter(header_col)}{target_row + 1}:{_col_letter(header_col + 1)}{target_row + 1}"
    svc.spreadsheets().values().update(
        spreadsheetId=spreadsheet_id, range=a1,
        valueInputOption='USER_ENTERED',
        body={'values': [[col1, amt]]}
    ).execute()
    return target_row, header_col

def _write_budget_transaction(svc, spreadsheet_id, tab, rows, cat, desc, amt):
    target_row = _find_budget_section_next_row(rows, cat)
    if target_row is None:
        return None
    _, desc_col, _, actual_col = _finance_budget_columns(rows)
    data = [
        {'range': f"'{tab}'!{_col_letter(desc_col)}{target_row + 1}", 'values': [[desc or cat]]},
        {'range': f"'{tab}'!{_col_letter(actual_col)}{target_row + 1}", 'values': [[amt]]},
    ]
    svc.spreadsheets().values().batchUpdate(
        spreadsheetId=spreadsheet_id,
        body={'valueInputOption': 'USER_ENTERED', 'data': data}
    ).execute()
    return target_row, actual_col

def _clear_sheet_values(svc, spreadsheet_id, tab, row, col, cols):
    end_col = col + max(1, cols) - 1
    a1 = f"'{tab}'!{_col_letter(col)}{row + 1}:{_col_letter(end_col)}{row + 1}"
    svc.spreadsheets().values().clear(
        spreadsheetId=spreadsheet_id, range=a1, body={}
    ).execute()

def _patch_finance_sheet(d):
    tab = str(d.get("sheet_tab") or "").strip()
    try:
        row = int(d.get("sheet_row"))
        col = int(d.get("sheet_col"))
        cols = int(d.get("sheet_cols") or 2)
    except (TypeError, ValueError):
        return jsonify({"error": "sheet_tab, sheet_row and sheet_col are required"}), 400
    if not tab or row < 0 or col < 0 or cols < 1:
        return jsonify({"error": "sheet_tab, sheet_row and sheet_col are required"}), 400

    cat = _canonical_finance_category(d.get("category"))
    if cat not in DETAIL_TABLE_KEYWORDS and cat not in BUDGET_TRANSACTION_CATEGORIES:
        allowed = ", ".join(["Housing", "Utilities", "Food / Grocery", "Fun", "Gas"])
        return jsonify({"error": f"'{cat}' isn't a transaction-tracked category. Use {allowed}."}), 400

    try:
        svc = _sheets_svc()
        rows = svc.spreadsheets().values().get(
            spreadsheetId=FINANCE_SHEET_ID, range=tab
        ).execute().get('values', [])
        max_cols = max((len(r) for r in rows), default=col + cols)
        padded = [r + [''] * (max_cols - len(r)) for r in rows]
        old_row = padded[row] if row < len(padded) else []
        kind = d.get("sheet_kind") or ("budget" if cols == 1 else "detail")
        if kind == "budget" or cols == 1:
            _, desc_col, _, _ = _finance_budget_columns(padded)
            old_desc = old_row[desc_col].strip() if len(old_row) > desc_col else ''
            old_amt = _parse_money(old_row[col] if len(old_row) > col else 0)
            old_cat = _canon_cat((old_row[0] if old_row else '') or old_desc)
        else:
            old_desc = old_row[col].strip() if len(old_row) > col else ''
            old_amt = _parse_money(old_row[col + 1] if len(old_row) > col + 1 else 0)
            old_cat = ''
        desc = str(d.get("description") or old_desc or cat).strip()
        amt = _parse_money(d.get("amount")) if "amount" in d else old_amt
        date_val = d.get("date") or datetime.now().strftime("%Y-%m-%d")

        if kind == "budget" and old_cat == cat:
            # Category unchanged — update description/amount in place (col = actual cell).
            _, desc_col, _, _ = _finance_budget_columns(padded)
            svc.spreadsheets().values().batchUpdate(
                spreadsheetId=FINANCE_SHEET_ID,
                body={'valueInputOption': 'USER_ENTERED', 'data': [
                    {'range': f"'{tab}'!{_col_letter(desc_col)}{row + 1}", 'values': [[desc]]},
                    {'range': f"'{tab}'!{_col_letter(col)}{row + 1}", 'values': [[amt]]},
                ]}
            ).execute()
            return jsonify({"ok": True})
        if cat in BUDGET_TRANSACTION_CATEGORIES:
            written = _write_budget_transaction(svc, FINANCE_SHEET_ID, tab, rows, cat, desc, amt)
            target_cols = 1
            if not written:
                return jsonify({"error": f"No empty '{cat}' budget row found in sheet tab '{tab}'."}), 400
        else:
            written = _write_detail_transaction(svc, FINANCE_SHEET_ID, tab, rows, cat, desc, amt, date_val)
            target_cols = 2
            if not written:
                return jsonify({"error": f"No '{cat}' table found in sheet tab '{tab}'."}), 400
        target_row, target_col = written
        if target_row != row or target_col != col or target_cols != cols:
            _clear_sheet_values(svc, FINANCE_SHEET_ID, tab, row, col, cols)
        return jsonify({"ok": True})
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        return jsonify({"error": str(e)}), 500

MONTH_NAMES_FULL = ['January','February','March','April','May','June',
                    'July','August','September','October','November','December']

def _sheet_id_by_name(svc, spreadsheet_id, title):
    """Return the numeric sheetId of the tab named `title`, or None."""
    meta = svc.spreadsheets().get(spreadsheetId=spreadsheet_id, fields='sheets.properties').execute()
    for s in meta.get('sheets', []):
        if s['properties']['title'].strip().lower() == str(title).strip().lower():
            return s['properties']['sheetId']
    return None

def _clear_detail_tables(svc, spreadsheet_id, tab):
    """Clear the variable transaction rows (Gas/Fun/Grocery) in a month tab while
    leaving the budget tracker, income and GLS payments intact. Used after a
    rollover so the new month starts with the same recurring finances but no
    carried-over one-off transactions."""
    rows = svc.spreadsheets().values().get(
        spreadsheetId=spreadsheet_id, range=tab
    ).execute().get('values', [])
    if not rows:
        return
    max_cols = max((len(r) for r in rows), default=1)
    padded = [r + [''] * (max_cols - len(r)) for r in rows]
    clears = []
    for cat in DETAIL_TABLE_KEYWORDS:
        pos = _find_detail_table(rows, cat)
        if not pos:
            continue
        hr, hc = pos
        for ri in range(hr + 2, len(padded)):
            c1 = str(padded[ri][hc]).strip()     if len(padded[ri]) > hc     else ''
            c2 = str(padded[ri][hc + 1]).strip() if len(padded[ri]) > hc + 1 else ''
            if 'total' in (c1 + c2).lower():
                break
            if c1 or c2:
                clears.append(f"'{tab}'!{_col_letter(hc)}{ri + 1}:{_col_letter(hc + 1)}{ri + 1}")
    if clears:
        svc.spreadsheets().values().batchClear(
            spreadsheetId=spreadsheet_id, body={'ranges': clears}
        ).execute()

def _clear_budget_actuals(svc, spreadsheet_id, tab):
    """After a rollover, empty the 'actual' column of the budget tracker so the new
    month starts with budgeted amounts only — actuals fill in as transactions happen.
    Reads with FORMULA rendering and skips any formula cell (e.g. =SUM of a detail
    table) so existing linkage is preserved; only static carried-over values are cleared."""
    rows = svc.spreadsheets().values().get(
        spreadsheetId=spreadsheet_id, range=tab, valueRenderOption='FORMULA'
    ).execute().get('values', [])
    if not rows:
        return
    max_cols = max((len(r) for r in rows), default=1)
    padded = [r + [''] * (max_cols - len(r)) for r in rows]
    hdr_row_idx, _, _, actual_col = _finance_budget_columns(padded)
    clears = []
    for ri in range(hdr_row_idx + 1, len(padded)):
        row = padded[ri]
        rl = ' '.join(str(c) for c in row[:8]).lower()
        if any(kw in rl for kw in ['anticipated', 'actual total', 'roommate', 'savings total']):
            break
        if len(row) <= actual_col:
            continue
        val = str(row[actual_col]).strip()
        if not val or val.startswith('='):   # blank already, or a formula to preserve
            continue
        clears.append(f"'{tab}'!{_col_letter(actual_col)}{ri + 1}")
    if clears:
        svc.spreadsheets().values().batchClear(
            spreadsheetId=spreadsheet_id, body={'ranges': clears}
        ).execute()

def _find_budget_section_next_row(rows, canon_target):
    """Find the next insertion row inside a budget-tracker section matching canon_target.
    Returns 0-based row index to write to, or None if section not found."""
    if not rows:
        return None
    max_cols = max((len(r) for r in rows), default=1)
    padded = [r + [''] * (max_cols - len(r)) for r in rows]

    hdr_row_idx = 0
    for i, row in enumerate(padded[:5]):
        rl = ' '.join(row).lower()
        if 'budget' in rl or 'actual amount' in rl:
            hdr_row_idx = i
            break

    section_start = None
    current_cat = ''
    for ri in range(hdr_row_idx + 1, len(padded)):
        row = padded[ri]
        rl = ' '.join(row[:8]).lower()
        if any(kw in rl for kw in ['anticipated', 'actual total', 'roommate', 'savings total']):
            break
        cat_val = row[0].strip() if len(row) > 0 else ''
        desc_val = row[1].strip() if len(row) > 1 else ''
        if cat_val and not any(ch.isdigit() for ch in cat_val):
            current_cat = cat_val
        row_canon = _canon_cat(cat_val or desc_val or current_cat)
        if row_canon == canon_target:
            if section_start is None:
                section_start = ri
            if not desc_val and not cat_val:
                return ri
        elif section_start is not None:
            return None
    return None

def _find_subscription_sheet_row(rows, name):
    """Find the 0-based row index within the Subscriptions budget section whose
    description (col B) matches `name` (case-insensitive). Returns None if not found.
    Mirrors _find_budget_section_next_row's section-scanning so add/delete stay in sync."""
    if not rows or not name:
        return None
    max_cols = max((len(r) for r in rows), default=1)
    padded = [r + [''] * (max_cols - len(r)) for r in rows]

    hdr_row_idx = 0
    for i, row in enumerate(padded[:5]):
        rl = ' '.join(row).lower()
        if 'budget' in rl or 'actual amount' in rl:
            hdr_row_idx = i
            break

    section_start = None
    current_cat = ''
    target = name.strip().lower()
    for ri in range(hdr_row_idx + 1, len(padded)):
        row = padded[ri]
        rl = ' '.join(row[:8]).lower()
        if any(kw in rl for kw in ['anticipated', 'actual total', 'roommate', 'savings total']):
            break
        cat_val = row[0].strip() if len(row) > 0 else ''
        desc_val = row[1].strip() if len(row) > 1 else ''
        if cat_val and not any(ch.isdigit() for ch in cat_val):
            current_cat = cat_val
        row_canon = _canon_cat(cat_val or desc_val or current_cat)
        if row_canon == 'Subscriptions':
            if section_start is None:
                section_start = ri
            if desc_val.strip().lower() == target:
                return ri
        elif section_start is not None:
            break
    return None

def _parse_budget_transaction_rows(rows, tab=""):
    if not rows:
        return []
    max_cols = max((len(r) for r in rows), default=1)
    padded = [r + [''] * (max_cols - len(r)) for r in rows]
    hdr_row_idx, desc_col, _, actual_col = _finance_budget_columns(padded)
    transactions = []
    current_cat = ''
    for ri in range(hdr_row_idx + 1, len(padded)):
        row = padded[ri]
        row_lower = ' '.join(str(c) for c in row[:8]).lower()
        if any(kw in row_lower for kw in ['anticipated', 'actual total', 'roommate', 'savings total']):
            break
        cat_val = str(row[0]).strip() if len(row) > 0 else ''
        desc_val = str(row[desc_col]).strip() if len(row) > desc_col else ''
        if cat_val and not any(ch.isdigit() for ch in cat_val):
            current_cat = cat_val
        canon = _canon_cat(cat_val or desc_val or current_cat)
        if canon not in BUDGET_TRANSACTION_CATEGORIES:
            continue
        actual = _parse_money(row[actual_col] if len(row) > actual_col else 0)
        if actual <= 0:
            continue
        transactions.append({'description': desc_val or cat_val or canon, 'date': '',
                              'amount': abs(actual), 'category': canon, 'type': 'expense',
                              'sheet_tab': tab, 'sheet_row': ri, 'sheet_col': actual_col,
                              'sheet_cols': 1, 'sheet_kind': 'budget'})
    return transactions

def _parse_transaction_rows(rows, tab=""):
    """Parse individual transactions from detail tables and Housing/Utilities budget rows.
    Each returned txn carries sheet_tab/sheet_row/sheet_col so the frontend can delete
    by clearing the source cells in the Google Sheet."""
    if not rows:
        return []
    max_cols = max((len(r) for r in rows), default=1)
    rows = [r + [''] * (max_cols - len(r)) for r in rows]

    table_configs = [(cat, kws) for cat, kws in DETAIL_TABLE_KEYWORDS.items()]
    transactions = []

    for cat, keywords in table_configs:
        header_row = header_col = None
        for ri, row in enumerate(rows):
            for ci, cell in enumerate(row):
                if any(kw in str(cell).lower() for kw in keywords):
                    header_row, header_col = ri, ci
                    break
            if header_row is not None:
                break
        if header_row is None:
            continue

        blanks_in_a_row = 0
        for ri in range(header_row + 2, len(rows)):
            row    = rows[ri]
            cell1  = str(row[header_col]).strip()     if len(row) > header_col     else ''
            cell2  = str(row[header_col + 1]).strip() if len(row) > header_col + 1 else ''
            if 'total' in (cell1 + cell2).lower():
                break
            if not cell1 and not cell2:
                blanks_in_a_row += 1
                if blanks_in_a_row >= 5:
                    break
                continue
            blanks_in_a_row = 0
            amt = _parse_money(cell2)
            if amt <= 0:
                continue
            desc, date_val = cell1, ''
            import re
            if cell1 and re.match(r'^\d{1,2}[-/]\w+$|^\w{3,}[-/]\d{1,2}$', cell1):
                date_val, desc = cell1, cat
            transactions.append({'description': desc, 'date': date_val,
                                  'amount': abs(amt), 'category': cat, 'type': 'expense',
                                  'sheet_tab': tab, 'sheet_row': ri, 'sheet_col': header_col,
                                  'sheet_cols': 2, 'sheet_kind': 'detail'})

    transactions.extend(_parse_budget_transaction_rows(rows, tab))
    return [{'id': i + 1, 'source': 'sheet', **t} for i, t in enumerate(transactions)]

def _office_file_error(e):
    msg = str(e)
    if 'Office file' in msg:
        return 'This file is an Excel/Office file — open it in Google Drive and go to File → Save as Google Sheets, then use the new sheet URL.'
    return None

def _request_base_url():
    """Return the correct base URL, forcing https when behind Cloud Run's load balancer."""
    base = request.host_url.rstrip('/')
    if request.headers.get('X-Forwarded-Proto') == 'https':
        base = 'https://' + base.split('://', 1)[-1]
    return base

def _google_oauth_client_config():
    if not GOOGLE_OAUTH_CLIENT_ID or not GOOGLE_OAUTH_CLIENT_SECRET:
        return None
    web = {
        "client_id": GOOGLE_OAUTH_CLIENT_ID,
        "client_secret": GOOGLE_OAUTH_CLIENT_SECRET,
        "auth_uri": "https://accounts.google.com/o/oauth2/auth",
        "token_uri": "https://oauth2.googleapis.com/token",
        "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
        "redirect_uris": [
            "http://localhost:5000/api/drive/callback",
            "http://localhost:5000/api/calendar/callback",
            "http://localhost:5000/api/auth/google/callback",
            "https://mission-control-568559213462.us-central1.run.app/api/drive/callback",
            "https://mission-control-568559213462.us-central1.run.app/api/calendar/callback",
            "https://mission-control-568559213462.us-central1.run.app/api/auth/google/callback",
        ],
    }
    if GOOGLE_OAUTH_PROJECT_ID:
        web["project_id"] = GOOGLE_OAUTH_PROJECT_ID
    return {"web": web}

def _has_google_oauth_client():
    return GCAL_CREDS_FILE.exists() or _google_oauth_client_config() is not None

def _oauth_flow(scopes, redirect_uri):
    from google_auth_oauthlib.flow import Flow
    if GCAL_CREDS_FILE.exists():
        return Flow.from_client_secrets_file(str(GCAL_CREDS_FILE), scopes=scopes, redirect_uri=redirect_uri)
    config = _google_oauth_client_config()
    if not config:
        return None
    return Flow.from_client_config(config, scopes=scopes, redirect_uri=redirect_uri)

def _google_userinfo_email(creds):
    """Return the verified email for a freshly-authorized Google sign-in, or None."""
    try:
        from google.auth.transport.requests import AuthorizedSession
        resp = AuthorizedSession(creds).get(
            "https://www.googleapis.com/oauth2/v3/userinfo", timeout=10)
        info = resp.json()
    except Exception:
        return None
    email = info.get("email")
    verified = info.get("email_verified")
    if email and verified in (True, "true", None):
        return email
    return None

def _gdrive_service():
    try:
        from google.oauth2.credentials import Credentials
        from google.auth.transport.requests import Request
        from googleapiclient.discovery import build
    except ImportError:
        return None, "not_installed"
    if not _has_google_oauth_client():
        return None, "setup_required"
    creds = None
    if GDRIVE_TOKEN_FILE.exists():
        try:
            creds = Credentials.from_authorized_user_file(str(GDRIVE_TOKEN_FILE), GDRIVE_SCOPES)
        except Exception:
            return None, "auth_required"
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            try:
                creds.refresh(Request())
                GDRIVE_TOKEN_FILE.write_text(creds.to_json())
            except Exception:
                return None, "auth_required"
        else:
            return None, "auth_required"
    return build('sheets', 'v4', credentials=creds), None

@app.route("/api/credentials/upload", methods=["POST"])
def upload_credentials():
    d = request.json or {}
    content = d.get("content", "")
    try:
        parsed = json.loads(content)
    except Exception:
        return jsonify({"error": "Invalid JSON"}), 400
    if "installed" not in parsed and "web" not in parsed:
        return jsonify({"error": "Not a valid Google OAuth credentials file"}), 400
    GCAL_CREDS_FILE.write_text(content)
    GDRIVE_TOKEN_FILE.unlink(missing_ok=True)
    GCAL_TOKEN_FILE.unlink(missing_ok=True)
    return jsonify({"ok": True})

@app.route("/api/drive/status")
def drive_status():
    cfg = _load(GDRIVE_CONFIG_FILE, {})
    base = {"sheet_finance": cfg.get("sheet_finance", ""), "sheet_contacts": cfg.get("sheet_contacts", "")}
    if not _has_google_oauth_client():
        return jsonify({**base, "connected": False, "setup_required": True})
    _, err = _gdrive_service()
    return jsonify({**base, "connected": err is None, "setup_required": False, "error": err})

@app.route("/api/drive/auth")
def drive_auth_route():
    try:
        from google_auth_oauthlib.flow import Flow
    except ImportError:
        return jsonify({"error": "Run: pip install google-auth-oauthlib google-api-python-client"})
    if not _has_google_oauth_client():
        return jsonify({"error": "setup_required"})
    redirect_uri = _request_base_url() + '/api/drive/callback'
    flow = _oauth_flow(GDRIVE_SCOPES, redirect_uri)
    auth_url, state = flow.authorization_url(access_type='offline', prompt='consent')
    session['gdrive_state'] = state
    session['gdrive_code_verifier'] = getattr(flow, 'code_verifier', None)
    return jsonify({"auth_url": auth_url})

@app.route("/api/drive/auth/start")
def drive_auth_start():
    try:
        from google_auth_oauthlib.flow import Flow
    except ImportError:
        return "Run: pip install google-auth-oauthlib google-api-python-client", 500
    if not _has_google_oauth_client():
        return "Google OAuth client not configured", 400
    redirect_uri = _request_base_url() + '/api/drive/callback'
    flow = _oauth_flow(GDRIVE_SCOPES, redirect_uri)
    auth_url, state = flow.authorization_url(access_type='offline', prompt='consent')
    session['gdrive_state'] = state
    session['gdrive_code_verifier'] = getattr(flow, 'code_verifier', None)
    return redirect(auth_url)

@app.route("/api/drive/callback")
def drive_callback():
    try:
        from google_auth_oauthlib.flow import Flow
    except ImportError:
        return "google-auth-oauthlib not installed", 500
    redirect_uri = _request_base_url() + '/api/drive/callback'
    try:
        flow = _oauth_flow(GDRIVE_SCOPES, redirect_uri)
        if flow is None:
            return "Google OAuth client not configured", 400
        verifier = session.pop('gdrive_code_verifier', None)
        if verifier:
            flow.code_verifier = verifier
        flow.fetch_token(authorization_response=request.url)
        GDRIVE_TOKEN_FILE.write_text(flow.credentials.to_json())
        return redirect('/?connected=drive')
    except Exception as e:
        return f"<h2>Drive auth error</h2><pre>{e}</pre><br><a href='/'>Back to app</a>", 400

@app.route("/api/drive/config", methods=["GET", "POST"])
def drive_config():
    if request.method == "GET":
        return jsonify(_load(GDRIVE_CONFIG_FILE, {}))
    d = request.json or {}
    cfg = _load(GDRIVE_CONFIG_FILE, {})
    if "sheet_finance" in d and d["sheet_finance"]:
        cfg["sheet_finance"] = _extract_sheet_id(d["sheet_finance"])
    if "sheet_contacts" in d and d["sheet_contacts"]:
        cfg["sheet_contacts"] = _extract_sheet_id(d["sheet_contacts"])
    _save(GDRIVE_CONFIG_FILE, cfg)
    return jsonify({"ok": True})

@app.route("/api/drive/sync/finances", methods=["POST"])
def drive_sync_finances():
    cfg = _load(GDRIVE_CONFIG_FILE, {})
    sheet_id = cfg.get("sheet_finance")
    if not sheet_id:
        return jsonify({"error": "No Finance sheet ID configured — save it in Settings → Integrations"}), 400
    sheets, err = _gdrive_service()
    if err:
        return jsonify({"error": f"Drive not connected: {err}"}), 400
    try:
        tab = _first_sheet_name(sheets, sheet_id)
        rows = sheets.spreadsheets().values().get(
            spreadsheetId=sheet_id, range=tab
        ).execute().get('values', [])
        if len(rows) < 2:
            return jsonify({"ok": True, "count": 0})
        headers = [h.lower().strip().replace(" ", "_") for h in rows[0]]
        rebuilt = []
        for idx, row in enumerate(rows[1:], start=1):
            d = dict(zip(headers, row + [""] * max(0, len(headers) - len(row))))
            desc = d.get("description", d.get("name", "")).strip()
            date = d.get("date", "").strip()
            try:
                amt = float(str(d.get("amount", 0)).replace("$","").replace(",","") or 0)
            except ValueError:
                amt = 0.0
            txn_type = d.get("type", "expense").strip().lower()
            if txn_type not in ("income", "expense"):
                txn_type = "expense"
            raw_cat = d.get("category", "personal").strip() or "personal"
            category = _canonical_finance_category(raw_cat)
            if raw_cat.lower() in ("", "personal", "other"):
                inferred = _canon_cat(desc)
                if inferred in FINANCE_CATEGORY_NAMES:
                    category = inferred
            rebuilt.append({"id": idx, "date": date, "description": desc,
                             "amount": amt, "type": txn_type,
                             "category": category})
        _save(FINANCE_FILE, rebuilt)
        return jsonify({"ok": True, "count": len(rebuilt)})
    except Exception as e:
        return jsonify({"error": _office_file_error(e) or str(e)}), 500

@app.route("/api/drive/push/finances", methods=["POST"])
def drive_push_finances():
    cfg = _load(GDRIVE_CONFIG_FILE, {})
    sheet_id = cfg.get("sheet_finance")
    if not sheet_id:
        return jsonify({"error": "No Finance sheet ID configured"}), 400
    sheets, err = _gdrive_service()
    if err:
        return jsonify({"error": f"Drive not connected: {err}"}), 400
    try:
        tab = _first_sheet_name(sheets, sheet_id)
        finances = _load(FINANCE_FILE)
        values = [["Date", "Description", "Amount", "Type", "Category"]]
        for t in sorted(finances, key=lambda x: x.get("date", ""), reverse=True):
            values.append([t.get("date",""), t.get("description",""),
                           t.get("amount",""), t.get("type",""), t.get("category","")])
        sheets.spreadsheets().values().update(
            spreadsheetId=sheet_id, range=tab,
            valueInputOption='USER_ENTERED', body={'values': values}
        ).execute()
        return jsonify({"ok": True, "count": len(finances)})
    except Exception as e:
        return jsonify({"error": _office_file_error(e) or str(e)}), 500

@app.route("/api/drive/sync/contacts", methods=["POST"])
def drive_sync_contacts():
    cfg = _load(GDRIVE_CONFIG_FILE, {})
    sheet_id = cfg.get("sheet_contacts")
    if not sheet_id:
        return jsonify({"error": "No Contacts sheet ID configured — save it in Settings → Integrations"}), 400
    sheets, err = _gdrive_service()
    if err:
        return jsonify({"error": f"Drive not connected: {err}"}), 400
    try:
        tab = _first_sheet_name(sheets, sheet_id)
        rows = sheets.spreadsheets().values().get(
            spreadsheetId=sheet_id, range=tab
        ).execute().get('values', [])
        if len(rows) < 2:
            return jsonify({"ok": True, "count": 0})
        headers = [h.lower().strip().replace(" ", "_") for h in rows[0]]
        existing = _load(BAND_CONTACTS_FILE)
        seen = {c.get("name","").lower() for c in existing}
        max_id = max((c.get("id", 0) for c in existing), default=0)
        new_count = 0
        for row in rows[1:]:
            d = dict(zip(headers, row + [""] * max(0, len(headers) - len(row))))
            name = d.get("name","").strip()
            if not name or name.lower() in seen:
                continue
            max_id += 1
            existing.append({"id": max_id, "name": name,
                              "venue": d.get("venue","").strip(),
                              "city": d.get("city","").strip(),
                              "last": d.get("last","—").strip() or "—",
                              "status": d.get("status","not contacted").strip() or "not contacted",
                              "notes": d.get("notes","").strip()})
            seen.add(name.lower())
            new_count += 1
        _save(BAND_CONTACTS_FILE, existing)
        return jsonify({"ok": True, "count": new_count})
    except Exception as e:
        return jsonify({"error": _office_file_error(e) or str(e)}), 500

@app.route("/api/drive/push/contacts", methods=["POST"])
def drive_push_contacts():
    cfg = _load(GDRIVE_CONFIG_FILE, {})
    sheet_id = cfg.get("sheet_contacts")
    if not sheet_id:
        return jsonify({"error": "No Contacts sheet ID configured"}), 400
    sheets, err = _gdrive_service()
    if err:
        return jsonify({"error": f"Drive not connected: {err}"}), 400
    try:
        tab = _first_sheet_name(sheets, sheet_id)
        contacts = _load(BAND_CONTACTS_FILE)
        values = [["Name", "Venue", "City", "Status", "Last", "Notes"]]
        for c in contacts:
            values.append([c.get("name",""), c.get("venue",""), c.get("city",""),
                           c.get("status",""), c.get("last",""), c.get("notes","")])
        sheets.spreadsheets().values().update(
            spreadsheetId=sheet_id, range=tab,
            valueInputOption='USER_ENTERED', body={'values': values}
        ).execute()
        return jsonify({"ok": True, "count": len(contacts)})
    except Exception as e:
        return jsonify({"error": _office_file_error(e) or str(e)}), 500

# ── Google Calendar ────────────────────────────────────────────────────────────

def _gcal_service():
    try:
        from google.oauth2.credentials import Credentials
        from google.auth.transport.requests import Request
        from googleapiclient.discovery import build
    except ImportError:
        return None, "not_installed"
    creds = None
    if GCAL_TOKEN_FILE.exists():
        try:
            creds = Credentials.from_authorized_user_file(str(GCAL_TOKEN_FILE), GCAL_SCOPES)
        except Exception:
            return None, "auth_required"
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            try:
                from google.auth.transport.requests import Request as Req
                creds.refresh(Req())
                GCAL_TOKEN_FILE.write_text(creds.to_json())
            except Exception:
                return None, "auth_required"
        else:
            return None, "auth_required"
    return build('calendar', 'v3', credentials=creds), None

# JS getDay() index (0=Sun..6=Sat) -> RFC5545 BYDAY code
_BYDAY = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"]

def _gcal_create_event(title, date_str, time_str="", duration_min=60, description="", location="",
                       recurrence="", end_time="", weekdays=None):
    """Create a Google Calendar event. Silent on errors. Returns event link or None.

    recurrence="annual"  -> RRULE:FREQ=YEARLY (birthdays/anniversaries)
    recurrence="weekly"  -> RRULE:FREQ=WEEKLY;BYDAY=... using `weekdays` (JS getDay indices)
    end_time ("HH:MM")   -> sets the event end for timed events (overrides duration_min)
    """
    try:
        svc, err = _gcal_service()
        if err:
            return None
        from datetime import datetime as dt, timedelta
        if time_str:
            try:
                start = dt.strptime(f"{date_str} {time_str}", "%Y-%m-%d %H:%M")
            except ValueError:
                start = dt.strptime(date_str, "%Y-%m-%d")
                time_str = ""
        else:
            start = dt.strptime(date_str, "%Y-%m-%d")
        if time_str:
            end = None
            if end_time:
                try:
                    end = dt.strptime(f"{date_str} {end_time}", "%Y-%m-%d %H:%M")
                except ValueError:
                    end = None
            if end is None or end <= start:
                end = start + timedelta(minutes=int(duration_min))
            body = {
                "summary": title,
                "description": description,
                "location": location,
                "start": {"dateTime": start.isoformat(), "timeZone": "America/Chicago"},
                "end":   {"dateTime": end.isoformat(),   "timeZone": "America/Chicago"},
            }
        else:
            # All-day event
            end_day = start + timedelta(days=1)
            body = {
                "summary": title,
                "description": description,
                "location": location,
                "start": {"date": start.strftime("%Y-%m-%d")},
                "end":   {"date": end_day.strftime("%Y-%m-%d")},
            }
        if recurrence == "annual":
            body["recurrence"] = ["RRULE:FREQ=YEARLY"]
        elif recurrence == "weekly" and weekdays:
            days = ",".join(_BYDAY[w] for w in weekdays if 0 <= w <= 6)
            if days:
                body["recurrence"] = [f"RRULE:FREQ=WEEKLY;BYDAY={days}"]
        created = svc.events().insert(calendarId="primary", body=body).execute()
        return created.get("htmlLink")
    except Exception:
        return None

@app.route("/api/calendar/events")
def get_calendar_events():
    if not _has_google_oauth_client():
        return jsonify({"error": "setup_required"})
    svc, err = _gcal_service()
    if err:
        return jsonify({"error": err})
    try:
        now = datetime.utcnow().isoformat() + 'Z'
        end = (datetime.utcnow() + timedelta(days=30)).isoformat() + 'Z'
        items = svc.events().list(
            calendarId='primary', timeMin=now, timeMax=end,
            maxResults=20, singleEvents=True, orderBy='startTime'
        ).execute().get('items', [])
        return jsonify({"events": items})
    except Exception as e:
        return jsonify({"error": str(e)})

@app.route("/api/calendar/auth")
def calendar_auth_route():
    try:
        from google_auth_oauthlib.flow import Flow
    except ImportError:
        return jsonify({"error": "Run: pip install google-auth-oauthlib google-api-python-client"})
    if not _has_google_oauth_client():
        return jsonify({"error": "setup_required"})
    redirect_uri = _request_base_url() + '/api/calendar/callback'
    flow = _oauth_flow(GCAL_SCOPES, redirect_uri)
    auth_url, state = flow.authorization_url(access_type='offline', prompt='consent')
    session['gcal_state'] = state
    session['gcal_code_verifier'] = getattr(flow, 'code_verifier', None)
    return jsonify({"auth_url": auth_url})

@app.route("/api/calendar/callback")
def calendar_callback():
    try:
        from google_auth_oauthlib.flow import Flow
    except ImportError:
        return "google-auth-oauthlib not installed", 500
    redirect_uri = _request_base_url() + '/api/calendar/callback'
    try:
        flow = _oauth_flow(GCAL_SCOPES, redirect_uri)
        if flow is None:
            return "Google OAuth client not configured", 400
        verifier = session.pop('gcal_code_verifier', None)
        if verifier:
            flow.code_verifier = verifier
        flow.fetch_token(authorization_response=request.url)
        GCAL_TOKEN_FILE.write_text(flow.credentials.to_json())
        return redirect('/?connected=calendar')
    except Exception as e:
        return f"<h2>Calendar auth error</h2><pre>{e}</pre><br><a href='/'>Back to app</a>", 400

# ── Talk (new UI card) ─────────────────────────────────────────────────────────

@app.route("/api/talk", methods=["POST"])
def talk():
    data = request.json
    text = data.get("text", "")
    messages = [{"role": "user", "content": text}]
    try:
        reply, _ = run_agent(messages, model="claude-haiku-4-5-20251001")
        return jsonify({"reply": reply})
    except Exception as e:
        return jsonify({"reply": f"Error: {e}"}), 500

# ── Morning Brief ─────────────────────────────────────────────────────────────

@app.route("/api/brief")
def get_brief():
    today = datetime.now().date().isoformat()
    if BRIEF_FILE.exists():
        cached = _load(BRIEF_FILE, {})
        if cached.get("date") == today:
            return jsonify(cached)

    today_dt = datetime.now().date()
    agenda_today = [i for i in _load(AGENDA_FILE) if i.get("date") == today and not i.get("done")]
    work_high = [t for t in _load(WORK_FILE) if not t.get("done") and t.get("priority") == "high"][:3]

    health = _load(HEALTH_FILE)
    habits = [h.get("label", h.get("id", "")) for h in health.get("habit_list", [])][:4]

    context = (
        f"Today is {today} ({datetime.now().strftime('%A')}).\n"
        f"Agenda: {', '.join(i['label'] for i in agenda_today) or 'nothing scheduled'}\n"
        f"High priority work: {', '.join(t['title'] for t in work_high) or 'none'}\n"
        f"Daily habits: {', '.join(habits)}"
    )

    try:
        client = anthropic.Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY", ""))
        resp = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=150,
            system="You are Mission Control. Write a 1-2 sentence morning brief for Parker. Be specific and direct — mention what's on today and what matters most. No greeting, no sign-off, no emojis.",
            messages=[{"role": "user", "content": context}]
        )
        text = resp.content[0].text
    except Exception as e:
        text = f"Good morning, Parker. {', '.join(i['label'] for i in agenda_today[:2]) or 'Clear schedule today'}."

    result = {"date": today, "text": text}
    _save(BRIEF_FILE, result)
    return jsonify(result)

# ── Today Hub ──────────────────────────────────────────────────────────────────

@app.route("/api/today")
def get_today():
    today = datetime.now().date().isoformat()
    today_dt = datetime.now().date()

    agenda = [i for i in _load(AGENDA_FILE) if i.get("date") == today]
    health = _load(HEALTH_FILE)
    habits_today = health.get("habits", {}).get(today, {})
    habit_list = health.get("habit_list", [])
    work = [t for t in _load(WORK_FILE) if not t.get("done") and t.get("priority") == "high"][:5]

    return jsonify({"agenda": agenda, "habits": {"today": habits_today, "list": habit_list}, "work_priority": work})

# ── Agenda ─────────────────────────────────────────────────────────────────────

@app.route("/api/agenda", methods=["GET"])
def get_agenda():
    return jsonify(_load(AGENDA_FILE))

@app.route("/api/agenda", methods=["POST"])
def post_agenda():
    d = request.json
    items = _load(AGENDA_FILE)
    aid = max((a["id"] for a in items), default=0) + 1
    label = d.get("label") or d.get("text", "")
    date_str = d.get("date", datetime.now().strftime("%Y-%m-%d"))
    time_str = d.get("time", "")
    items.append({
        "id": aid, "time": time_str, "label": label,
        "tag": d.get("tag", ""), "done": False, "date": date_str,
    })
    _save(AGENDA_FILE, items)
    _log("agenda", "add", label)
    _gcal_create_event(
        title=label,
        date_str=date_str, time_str=time_str,
        duration_min=30,
        description=f"Agenda — {d.get('tag','')}",
    )
    return jsonify({"id": aid})

@app.route("/api/agenda/<int:aid>/toggle", methods=["POST"])
def toggle_agenda(aid):
    items = _load(AGENDA_FILE)
    item = next((i for i in items if i["id"] == aid), None)
    if not item:
        return jsonify({"error": "not found"}), 404
    was_done = item.get("done", False)
    if not was_done:
        items = [i for i in items if i["id"] != aid]
        _save(AGENDA_FILE, items)
        _log("agenda", "done", item.get("label", ""))
        return jsonify({"done": True, "removed": True})
    item["done"] = False
    _save(AGENDA_FILE, items)
    return jsonify({"done": False})

@app.route("/api/agenda/<int:aid>", methods=["DELETE"])
def delete_agenda(aid):
    items = _load(AGENDA_FILE)
    items = [i for i in items if i["id"] != aid]
    _save(AGENDA_FILE, items)
    return jsonify({"ok": True})

# ── Health ─────────────────────────────────────────────────────────────────────

@app.route("/api/health", methods=["GET"])
def get_health():
    data = _load(HEALTH_FILE)
    if not isinstance(data, dict):
        data = {"habits": {}, "weight": {}, "calories": {}}

    # Merge live Sheet data over local JSON (Sheet is source of truth)
    sheet_data = _health_sheet_read()
    if sheet_data:
        for section in ("weight", "habits", "calories", "food_log", "water"):
            sheet_section = sheet_data.get(section, {})
            if not sheet_section:
                continue
            local_section = data.get(section, {})
            if not isinstance(local_section, dict):
                local_section = {}
            if section in ("habits", "calories"):
                # Deep merge per-date so per-key values present only in local
                # (e.g., Creatine, Vitamins) aren't wiped when the Sheet returns
                # a partial row for the same date. Sheet still wins on overlap.
                merged = dict(local_section)
                for date_key, sheet_val in sheet_section.items():
                    local_val = merged.get(date_key)
                    if isinstance(local_val, dict) and isinstance(sheet_val, dict):
                        merged[date_key] = {**local_val, **sheet_val}
                    else:
                        merged[date_key] = sheet_val
                data[section] = merged
            else:
                data[section] = {**local_section, **sheet_section}

    # Build weight_log: sorted list of {date, weight} objects
    weight_dict = data.get("weight", {})
    weight_log = [{"date": d, "weight": w} for d, w in sorted(weight_dict.items())]

    # Build habits_weekly for current Mon–Sun (local time so Sunday evening doesn't roll to Monday)
    today = datetime.now().date()
    week_start = today - timedelta(days=today.weekday())  # Monday
    week_days = [(week_start + timedelta(days=i)) for i in range(7)]
    week_day_strs = [d.strftime("%Y-%m-%d") for d in week_days]
    day_abbrevs = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

    habits_by_date = data.get("habits", {})
    habit_list = data.get("habit_list", [
        {"id": "Lift", "label": "Lift"}, {"id": "Walk 8k", "label": "Walk 8k"},
        {"id": "Sleep 7h", "label": "Sleep 7h"}, {"id": "Water", "label": "Water"},
    ])
    all_names = [h.get("label", h.get("id", "")) for h in habit_list]
    for day_str in week_day_strs:
        for name in habits_by_date.get(day_str, {}):
            if name not in all_names:
                all_names.append(name)

    habits_weekly = {}
    for name in all_names:
        if not name:
            continue
        day_map = {}
        for day_str, day_abbrev in zip(week_day_strs, day_abbrevs):
            day_map[day_abbrev] = bool(habits_by_date.get(day_str, {}).get(name))
        habits_weekly[name] = day_map

    # Most recent calories_target
    cal_target = 2200
    calories = data.get("calories", {})
    if calories:
        latest = max(calories.keys())
        cal_target = calories[latest].get("goal", 2200)

    today_str = today.strftime("%Y-%m-%d")
    food_log_today = data.get("food_log", {}).get(today_str, [])
    water_today = data.get("water", {}).get(today_str, 0)

    return jsonify({**data, "weight_log": weight_log, "habits_weekly": habits_weekly, "calories_target": cal_target, "food_log_today": food_log_today, "water_today": water_today})

@app.route("/api/health/workout")
def get_health_workout():
    """Return workout for a given date (defaults to today in America/Chicago).
    Mon=Day 1, ..., Sat=Day 6, Sun=rest. Use ?date=YYYY-MM-DD to view another day."""
    if not HEALTH_SHEET_ID:
        return jsonify({"connected": False, "error": "HEALTH_SHEET_ID not set"})
    sheets, err = _gdrive_service()
    if err:
        return jsonify({"connected": False, "error": err})

    # Default to "today" in Parker's timezone (America/Chicago), not server UTC
    date_param = request.args.get("date", "")
    if date_param:
        try:
            target = datetime.strptime(date_param, "%Y-%m-%d")
        except ValueError:
            target = None
    else:
        target = None
    if target is None:
        try:
            from zoneinfo import ZoneInfo
            target = datetime.now(ZoneInfo("America/Chicago"))
        except Exception:
            # Fallback: subtract 5 hours from UTC (CDT offset)
            from datetime import timedelta
            target = datetime.utcnow() - timedelta(hours=5)

    wd = target.weekday()  # 0=Mon, 6=Sun
    date_str = target.strftime("%Y-%m-%d")
    weekday_name = target.strftime("%A")

    if wd == 6:
        return jsonify({"connected": True, "rest_day": True, "weekday": weekday_name,
                        "date": date_str, "day": None, "focus": "Rest", "exercises": []})
    day_num = wd + 1  # Mon=1, Tue=2, ..., Sat=6

    try:
        result = sheets.spreadsheets().values().get(
            spreadsheetId=HEALTH_SHEET_ID, range="Workouts!A2:G500"
        ).execute()
        rows = result.get("values", [])
    except Exception as e:
        return jsonify({"connected": True, "error": f"read failed: {e}"})

    focus = ""
    exercises = []
    for r in rows:
        if not r or not r[0]:
            continue
        try:
            row_day = int(r[0])
        except (ValueError, TypeError):
            continue
        if row_day != day_num:
            continue
        if not focus and len(r) > 1:
            focus = r[1]
        exercises.append({
            "name":  r[2] if len(r) > 2 else "",
            "sets":  r[3] if len(r) > 3 else "",
            "reps":  r[4] if len(r) > 4 else "",
            "rest":  r[5] if len(r) > 5 else "",
            "note":  r[6] if len(r) > 6 else "",
        })

    return jsonify({
        "connected": True, "rest_day": False,
        "weekday": weekday_name, "date": date_str,
        "day": day_num, "focus": focus, "exercises": exercises
    })

@app.route("/api/health/habit", methods=["POST"])
def post_health_habit():
    d = request.json
    health = _load(HEALTH_FILE)
    if not isinstance(health, dict):
        health = {"habits": {}, "weight": {}, "calories": {}}
    date = d.get("date", datetime.now().strftime("%Y-%m-%d"))
    habits = health.setdefault("habits", {})
    day = habits.setdefault(date, {})
    habit_name = d["habit"]
    # Honor an explicit desired value when the client sends one (optimistic UI sends the
    # exact target state), so a slow request or a double-tap can't desync client and server.
    # Fall back to a server-side toggle for older callers / the agent tools.
    if d.get("value") is not None:
        new_val = bool(d["value"])
    else:
        new_val = not day.get(habit_name, False)
    day[habit_name] = new_val

    # Register the habit in habit_list if it isn't there yet, so the Sheet
    # round-trip works (_health_label_to_habit_id maps Sheet column headers
    # back to habit ids via habit_list). Without this, Sheet writes succeed
    # but reads drop the column, breaking persistence on previous days.
    habit_list = health.setdefault("habit_list", [])
    if not isinstance(habit_list, list):
        habit_list = []
        health["habit_list"] = habit_list
    if not any(isinstance(h, dict) and h.get("id") == habit_name for h in habit_list):
        habit_list.append({"id": habit_name, "label": habit_name})

    _save(HEALTH_FILE, health)
    _log("health", "habit", f"{habit_name} {'✓' if new_val else '✗'}")
    _health_sheet_update_daily(date, {_health_habit_label(habit_name): new_val})
    return jsonify({"ok": True})

@app.route("/api/health/weight", methods=["POST"])
def post_health_weight():
    d = request.json
    health = _load(HEALTH_FILE)
    if not isinstance(health, dict):
        health = {"habits": {}, "weight": {}, "calories": {}}
    date = d.get("date", datetime.now().strftime("%Y-%m-%d"))
    health.setdefault("weight", {})[date] = float(d["weight"])
    _save(HEALTH_FILE, health)
    _log("health", "weight", f"{d['weight']} lb")
    _health_sheet_update_daily(date, {"Weight (lb)": d["weight"]})
    return jsonify({"ok": True})

@app.route("/api/health/water", methods=["POST"])
def post_health_water():
    """Set the day's total water intake in ounces. Body: {oz, date?}. Default goal is 1 gallon (128 oz)."""
    d = request.json or {}
    health = _load(HEALTH_FILE)
    if not isinstance(health, dict):
        health = {"habits": {}, "weight": {}, "calories": {}}
    date = d.get("date", datetime.now().strftime("%Y-%m-%d"))
    try:
        bottle_oz = max(1.0, float(health.get("water_bottle_oz", 32) or 32))
    except (TypeError, ValueError):
        bottle_oz = 32.0
    try:
        if "add_bottles" in d:
            current = int(float(health.get("water", {}).get(date, 0) or 0))
            oz = current + (float(d.get("add_bottles") or 0) * bottle_oz)
        elif "add_oz" in d:
            current = int(float(health.get("water", {}).get(date, 0) or 0))
            oz = current + float(d.get("add_oz") or 0)
        else:
            oz = float(d.get("oz", 0))
        oz = max(0, int(round(oz)))
    except (TypeError, ValueError):
        oz = 0
    health.setdefault("water", {})[date] = oz
    _save(HEALTH_FILE, health)
    _log("health", "water", f"{oz} oz ({oz / bottle_oz:.1f} Owala bottles)")
    _health_sheet_update_daily(date, {"Water (oz)": oz})
    return jsonify({"ok": True, "oz": oz})

@app.route("/api/health/rehab", methods=["POST"])
def post_health_rehab():
    """Persist one elbow rehab checkbox for a date. Body: {date?, key, done?}."""
    d = request.json or {}
    health = _load(HEALTH_FILE)
    if not isinstance(health, dict):
        health = {"habits": {}, "weight": {}, "calories": {}}
    date = d.get("date", datetime.now().strftime("%Y-%m-%d"))
    key = str(d.get("key") or d.get("exercise") or d.get("index") or "").strip()
    if not key:
        return jsonify({"error": "missing key"}), 400

    rehab = health.setdefault("rehab", {})
    day = rehab.setdefault(date, {})
    if "done" in d:
        raw_done = d.get("done")
        done = raw_done.strip().lower() in ("1", "true", "yes", "on") if isinstance(raw_done, str) else bool(raw_done)
    else:
        done = not bool(day.get(key, False))
    day[key] = done

    _save(HEALTH_FILE, health)
    _log("health", "rehab", f"{key} {'✓' if done else '✗'}")
    return jsonify({"ok": True, "key": key, "done": done})

@app.route("/api/health/core", methods=["POST"])
def post_health_core():
    """Record whether core training was done for a date. Body: {date?, done?}.
    Tracked as part of the WORKOUT section, deliberately NOT a habit: it is stored under
    a separate `core` map and written to a `Core` column on the Daily tab, but is never
    added to habit_list — so it stays out of the habit grid/streaks. (`_health_sheet_read`
    skips columns that don't map to a habit_list entry, so this never round-trips as a habit.)"""
    d = request.json or {}
    health = _load(HEALTH_FILE)
    if not isinstance(health, dict):
        health = {"habits": {}, "weight": {}, "calories": {}}
    date = d.get("date", datetime.now().strftime("%Y-%m-%d"))
    core = health.setdefault("core", {})
    if "done" in d:
        raw_done = d.get("done")
        done = raw_done.strip().lower() in ("1", "true", "yes", "on") if isinstance(raw_done, str) else bool(raw_done)
    else:
        done = not bool(core.get(date, False))
    core[date] = done
    _save(HEALTH_FILE, health)
    _log("health", "core", f"core {'✓' if done else '✗'}")
    _health_sheet_update_daily(date, {"Core": done})
    return jsonify({"ok": True, "done": done})

@app.route("/api/health/config", methods=["POST"])
def post_health_config():
    d = request.json or {}
    health = _load(HEALTH_FILE)
    if not isinstance(health, dict):
        health = {"habits": {}, "weight": {}, "calories": {}}
    for key in ("height_in", "goal_weight", "water_bottle_oz", "water_goal_oz"):
        if key in d:
            health[key] = d[key]
    _save(HEALTH_FILE, health)
    return jsonify({"ok": True})

@app.route("/api/health/calories", methods=["POST"])
def post_health_calories():
    d = request.json
    health = _load(HEALTH_FILE)
    if not isinstance(health, dict):
        health = {"habits": {}, "weight": {}, "calories": {}}
    date = d.get("date", datetime.now().strftime("%Y-%m-%d"))
    day = health.setdefault("calories", {}).setdefault(date, {})
    day.update({k: v for k, v in d.items() if k != "date"})
    _save(HEALTH_FILE, health)
    # Mirror to Sheet (Daily tab): map known fields to column labels
    sheet_updates = {}
    if "calories" in d:    sheet_updates["Cal Eaten"]  = d["calories"]
    if "consumed" in d:    sheet_updates["Cal Eaten"]  = d["consumed"]
    if "burned" in d:      sheet_updates["Cal Burned"] = d["burned"]
    if "goal" in d:        sheet_updates["Cal Goal"]   = d["goal"]
    if sheet_updates:
        _health_sheet_update_daily(date, sheet_updates)
    return jsonify({"ok": True})

@app.route("/api/health/food", methods=["POST"])
def post_health_food():
    d = request.json
    health = _load(HEALTH_FILE)
    if not isinstance(health, dict):
        health = {"habits": {}, "weight": {}, "calories": {}, "food_log": {}}
    date = d.get("date", datetime.now().strftime("%Y-%m-%d"))
    items = health.setdefault("food_log", {}).setdefault(date, [])
    item = {
        "name": d.get("name", ""),
        "calories": int(d.get("calories", 0)),
        "protein": int(d.get("protein", 0)),
        "carbs": int(d.get("carbs", 0)),
        "fat": int(d.get("fat", 0)),
    }
    items.append(item)
    _save(HEALTH_FILE, health)
    _log("health", "food", f"{item['name']} {item['calories']} kcal P{item['protein']} C{item['carbs']} F{item['fat']}")
    _health_sheet_append_food(date, item)
    # Recompute today's total kcal and mirror to Daily tab
    total_today = sum(int(f.get("calories", 0) or 0) for f in items)
    _health_sheet_update_daily(date, {"Cal Eaten": total_today})
    return jsonify({"ok": True})

@app.route("/api/health/food/suggestions")
def health_food_suggestions():
    """Distinct previously-logged foods with their most-recent macros + usage count.

    Powers the food-name autocomplete so repeat items (protein shakes, etc.) prefill numbers.
    Names listed in food_hidden_suggestions are tagged hidden so the UI can suppress them
    by default while keeping the original food_log entries intact (preserves history/totals).
    Pass ?include_hidden=1 to include them in the response (used by the "show hidden" toggle).
    """
    health = _load(HEALTH_FILE)
    log = dict(health.get("food_log", {})) if isinstance(health, dict) else {}
    hidden = set((health.get("food_hidden_suggestions") or []) if isinstance(health, dict) else [])
    include_hidden = request.args.get("include_hidden") in ("1", "true", "yes")
    # Merge the Google Sheet "Food" tab (source of truth), same as /api/health, so
    # foods logged via the Sheet also become autocomplete suggestions.
    try:
        sheet_data = _health_sheet_read()
        if sheet_data and sheet_data.get("food_log"):
            log = {**log, **sheet_data["food_log"]}
    except Exception:
        pass
    agg = {}
    for date in sorted(log.keys()):  # ascending: later dates overwrite macros with most-recent
        for it in (log.get(date) or []):
            name = (it.get("name") or "").strip()
            if not name:
                continue
            key = name.lower()
            entry = agg.get(key, {"count": 0})
            entry.update({
                "name": name,
                "calories": int(it.get("calories", 0) or 0),
                "protein": int(it.get("protein", 0) or 0),
                "carbs": int(it.get("carbs", 0) or 0),
                "fat": int(it.get("fat", 0) or 0),
            })
            entry["count"] += 1
            agg[key] = entry
    items = list(agg.values())
    for entry in items:
        entry["hidden"] = entry["name"].lower() in hidden
    if not include_hidden:
        items = [e for e in items if not e["hidden"]]
    out = sorted(items, key=lambda x: (-x["count"], x["name"].lower()))
    return jsonify(out)

@app.route("/api/health/food/hide_suggestion", methods=["POST"])
def health_food_hide_suggestion():
    """Add or remove a food name from the autocomplete-hidden list.

    Body: { "name": "...", "hide": true|false }
    The underlying food_log entries are not touched — only the suggestion dropdown.
    """
    d = request.json or {}
    name = (d.get("name") or "").strip().lower()
    if not name:
        return jsonify({"ok": False, "error": "name required"}), 400
    hide = bool(d.get("hide", True))
    health = _load(HEALTH_FILE)
    if not isinstance(health, dict):
        health = {"habits": {}, "weight": {}, "calories": {}, "food_log": {}}
    hidden = list(health.get("food_hidden_suggestions") or [])
    hidden_set = {h.lower() for h in hidden}
    if hide and name not in hidden_set:
        hidden.append(name)
    elif not hide and name in hidden_set:
        hidden = [h for h in hidden if h.lower() != name]
    health["food_hidden_suggestions"] = hidden
    _save(HEALTH_FILE, health)
    return jsonify({"ok": True, "hidden": hidden})

@app.route("/api/health/food", methods=["DELETE"])
def delete_health_food():
    d = request.json or {}
    health = _load(HEALTH_FILE)
    if not isinstance(health, dict):
        return jsonify({"ok": False})
    date = d.get("date", datetime.now().strftime("%Y-%m-%d"))
    food_log = health.setdefault("food_log", {})
    items = food_log.get(date, [])
    idx = d.get("index")
    try:
        idx = int(idx) if idx is not None else None
    except (TypeError, ValueError):
        idx = None
    name = d.get("name")
    local_deleted = False
    if idx is not None and 0 <= idx < len(items):
        items.pop(idx)
        food_log[date] = items
        _save(HEALTH_FILE, health)
        local_deleted = True
    elif name:
        food_log[date] = [f for f in items if f.get("name") != name]
        _save(HEALTH_FILE, health)
        local_deleted = len(food_log[date]) != len(items)

    sheet_result = _health_sheet_clear_food(date, index=idx, name=name)
    if sheet_result["remaining_calories"] is not None:
        _health_sheet_update_daily(date, {"Cal Eaten": sheet_result["remaining_calories"]})
    elif local_deleted:
        total_today = sum(int(f.get("calories", 0) or 0) for f in food_log.get(date, []))
        _health_sheet_update_daily(date, {"Cal Eaten": total_today})
    return jsonify({"ok": True, "sheet_deleted": sheet_result["deleted"]})

# ── Work ───────────────────────────────────────────────────────────────────────

@app.route("/api/work", methods=["GET"])
def get_work():
    return jsonify(_load(WORK_FILE))

@app.route("/api/work", methods=["POST"])
def post_work():
    d = request.json
    items = _load(WORK_FILE)
    wid = max((w["id"] for w in items), default=0) + 1
    item = {
        "id": wid, "title": d.get("title", ""), "project": d.get("project", ""),
        "priority": d.get("priority", "normal"), "done": False,
        "created": datetime.now().strftime("%Y-%m-%d")
    }
    if d.get("notes"):
        item["notes"] = d["notes"]
    if d.get("due_date"):
        item["due_date"] = d["due_date"]
    items.append(item)
    _save(WORK_FILE, items)
    _log("work", "add", d.get("title", ""), d.get("project", ""))
    return jsonify({"id": wid})

@app.route("/api/work/<int:wid>/done", methods=["POST"])
def done_work(wid):
    items = _load(WORK_FILE)
    done = next((i for i in items if i["id"] == wid), None)
    items = [i for i in items if i["id"] != wid]
    _save(WORK_FILE, items)
    if done:
        _log("work", "done", done.get("title", ""), done.get("project", ""))
    return jsonify({"ok": True})

@app.route("/api/work/<int:wid>", methods=["DELETE"])
def delete_work(wid):
    items = _load(WORK_FILE)
    deleted = next((i for i in items if i["id"] == wid), None)
    items = [i for i in items if i["id"] != wid]
    _save(WORK_FILE, items)
    if deleted:
        _log("work", "delete", deleted.get("title", ""), deleted.get("project", ""))
    return jsonify({"ok": True})

# ── Activity Log ───────────────────────────────────────────────────────────────

@app.route("/api/activity")
def get_activity():
    module = request.args.get("module", "")
    limit = min(int(request.args.get("limit", 100)), 500)
    with _db() as conn:
        if module:
            rows = conn.execute(
                "SELECT * FROM activity_log WHERE module=? ORDER BY ts DESC LIMIT ?",
                (module, limit)
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM activity_log ORDER BY ts DESC LIMIT ?", (limit,)
            ).fetchall()
    return jsonify([dict(r) for r in rows])

@app.route("/api/activity", methods=["DELETE"])
def clear_activity():
    with _db() as conn:
        conn.execute("DELETE FROM activity_log")
    return jsonify({"ok": True})

# ── TCPG Monitor ───────────────────────────────────────────────────────────────

def _tcpg_default():
    return {
        "config": {
            "project_id": "",
            "service_name": "",
            "region": "us-central1",
            "github_url": "",
            "cloud_run_url": ""
        }
    }

def _gcp_token():
    try:
        import google.auth
        import google.auth.transport.requests
        creds, _ = google.auth.default(scopes=["https://www.googleapis.com/auth/cloud-platform"])
        creds.refresh(google.auth.transport.requests.Request())
        return creds.token
    except Exception as e:
        return None

def _gcp_get(url, token):
    import urllib.request
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
    with urllib.request.urlopen(req, timeout=10) as resp:
        return json.loads(resp.read().decode())

def _gcp_post(url, token, body):
    import urllib.request
    data = json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, headers={
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json"
    })
    with urllib.request.urlopen(req, timeout=10) as resp:
        return json.loads(resp.read().decode())

@app.route("/api/tcpg/config", methods=["GET"])
def get_tcpg_config():
    d = _load(TCPG_FILE, _tcpg_default())
    if not isinstance(d, dict):
        d = _tcpg_default()
    return jsonify(d.get("config", _tcpg_default()["config"]))

@app.route("/api/tcpg/config", methods=["POST"])
def post_tcpg_config():
    d = _load(TCPG_FILE, _tcpg_default())
    if not isinstance(d, dict):
        d = _tcpg_default()
    d["config"] = request.json
    _save(TCPG_FILE, d)
    _log("tcpg", "config", "Configuration updated")
    return jsonify({"ok": True})

@app.route("/api/tcpg/logs")
def get_tcpg_logs():
    d = _load(TCPG_FILE, _tcpg_default())
    cfg = d.get("config", {}) if isinstance(d, dict) else {}
    project_id = cfg.get("project_id", "")
    service_name = cfg.get("service_name", "")
    if not project_id or not service_name:
        return jsonify({"error": "Not configured — set Project ID and service name in TCPG settings.", "entries": []})
    token = _gcp_token()
    if not token:
        return jsonify({"error": "GCP credentials unavailable. Run: gcloud auth application-default login", "entries": []})
    severity = request.args.get("severity", "DEFAULT")
    filter_parts = [
        f'resource.type="cloud_run_revision"',
        f'resource.labels.service_name="{service_name}"',
    ]
    if severity and severity not in ("ALL", "DEFAULT"):
        filter_parts.append(f"severity>={severity}")
    try:
        result = _gcp_post(
            "https://logging.googleapis.com/v2/entries:list",
            token,
            {
                "resourceNames": [f"projects/{project_id}"],
                "filter": " AND ".join(filter_parts),
                "orderBy": "timestamp desc",
                "pageSize": 50
            }
        )
        simplified = []
        for e in result.get("entries", []):
            msg = (
                e.get("textPayload") or
                e.get("jsonPayload", {}).get("message") or
                e.get("jsonPayload", {}).get("msg") or
                (str(e.get("jsonPayload", "")) if e.get("jsonPayload") else "") or
                ""
            )
            simplified.append({
                "timestamp": e.get("timestamp", ""),
                "severity": e.get("severity", "DEFAULT"),
                "message": msg[:400],
                "revision": e.get("resource", {}).get("labels", {}).get("revision_name", "")
            })
        return jsonify({"entries": simplified})
    except Exception as e:
        return jsonify({"error": str(e), "entries": []})

@app.route("/api/tcpg/health")
def get_tcpg_health():
    d = _load(TCPG_FILE, _tcpg_default())
    cfg = d.get("config", {}) if isinstance(d, dict) else {}
    project_id = cfg.get("project_id", "")
    service_name = cfg.get("service_name", "")
    region = cfg.get("region", "us-central1")
    if not project_id or not service_name:
        return jsonify({"status": "unconfigured"})
    token = _gcp_token()
    if not token:
        return jsonify({"status": "no_credentials", "error": "GCP credentials unavailable. Run: gcloud auth application-default login"})
    try:
        url = f"https://run.googleapis.com/v2/projects/{project_id}/locations/{region}/services/{service_name}"
        result = _gcp_get(url, token)
        conditions = result.get("conditions", [])
        terminal = result.get("terminalCondition", {})
        all_conditions = ([terminal] if terminal else []) + conditions
        ready = any(c.get("type", "").upper() == "READY" and c.get("state") == "CONDITION_SUCCEEDED" for c in all_conditions)
        latest = result.get("latestReadyRevision", "").split("/")[-1]
        return jsonify({
            "status": "healthy" if ready else "degraded",
            "service_name": result.get("name", "").split("/")[-1],
            "url": result.get("uri", ""),
            "latest_revision": latest,
            "traffic": result.get("traffic", []),
            "conditions": [{"type": c.get("type"), "state": c.get("state"), "message": c.get("message", "")} for c in conditions],
        })
    except Exception as e:
        return jsonify({"status": "error", "error": str(e)})


# ── Practice ───────────────────────────────────────────────────────────────────

PRACTICE_DEFAULT = {
    "piano": {"this_week_focus": "", "last_lesson_notes": "", "scales": [], "reminders": [], "sessions": []},
}

@app.route("/api/practice", methods=["GET"])
def get_practice():
    data = _load(PRACTICE_FILE, PRACTICE_DEFAULT)
    if "piano" not in data:
        data["piano"] = PRACTICE_DEFAULT["piano"]
    # piano-only now — drop any legacy guitar data so it can't resurface
    data.pop("guitar", None)
    return jsonify(data)

@app.route("/api/practice/<instrument>", methods=["POST"])
def update_practice(instrument):
    if instrument != "piano":
        return jsonify({"error": "invalid instrument"}), 400
    data = _load(PRACTICE_FILE, PRACTICE_DEFAULT)
    body = request.json or {}
    for field in ("this_week_focus", "last_lesson_notes"):
        if field in body:
            data[instrument][field] = body[field]
    _save(PRACTICE_FILE, data)
    return jsonify(data[instrument])

@app.route("/api/practice/<instrument>/scale", methods=["POST"])
def add_practice_scale(instrument):
    if instrument != "piano":
        return jsonify({"error": "invalid instrument"}), 400
    data = _load(PRACTICE_FILE, PRACTICE_DEFAULT)
    scales = data[instrument].get("scales", [])
    new_id = max((s["id"] for s in scales), default=0) + 1
    scales.append({"id": new_id, "name": (request.json or {}).get("name", ""), "done": False})
    data[instrument]["scales"] = scales
    _save(PRACTICE_FILE, data)
    return jsonify(scales)

@app.route("/api/practice/<instrument>/scale/<int:scale_id>/toggle", methods=["POST"])
def toggle_practice_scale(instrument, scale_id):
    if instrument != "piano":
        return jsonify({"error": "invalid instrument"}), 400
    data = _load(PRACTICE_FILE, PRACTICE_DEFAULT)
    for s in data[instrument].get("scales", []):
        if s["id"] == scale_id:
            s["done"] = not s["done"]
    _save(PRACTICE_FILE, data)
    return jsonify({"ok": True})

@app.route("/api/practice/<instrument>/scale/<int:scale_id>", methods=["DELETE"])
def delete_practice_scale(instrument, scale_id):
    if instrument != "piano":
        return jsonify({"error": "invalid instrument"}), 400
    data = _load(PRACTICE_FILE, PRACTICE_DEFAULT)
    data[instrument]["scales"] = [s for s in data[instrument].get("scales", []) if s["id"] != scale_id]
    _save(PRACTICE_FILE, data)
    return jsonify({"ok": True})

@app.route("/api/practice/<instrument>/reminder", methods=["POST"])
def add_practice_reminder(instrument):
    if instrument != "piano":
        return jsonify({"error": "invalid instrument"}), 400
    data = _load(PRACTICE_FILE, PRACTICE_DEFAULT)
    reminders = data[instrument].get("reminders", [])
    new_id = max((r["id"] for r in reminders), default=0) + 1
    reminders.append({"id": new_id, "text": (request.json or {}).get("text", ""), "done": False})
    data[instrument]["reminders"] = reminders
    _save(PRACTICE_FILE, data)
    return jsonify(reminders)

@app.route("/api/practice/<instrument>/reminder/<int:rid>/toggle", methods=["POST"])
def toggle_practice_reminder(instrument, rid):
    if instrument != "piano":
        return jsonify({"error": "invalid instrument"}), 400
    data = _load(PRACTICE_FILE, PRACTICE_DEFAULT)
    for r in data[instrument].get("reminders", []):
        if r["id"] == rid:
            r["done"] = not r["done"]
    _save(PRACTICE_FILE, data)
    return jsonify({"ok": True})

@app.route("/api/practice/<instrument>/reminder/<int:rid>", methods=["DELETE"])
def delete_practice_reminder(instrument, rid):
    if instrument != "piano":
        return jsonify({"error": "invalid instrument"}), 400
    data = _load(PRACTICE_FILE, PRACTICE_DEFAULT)
    data[instrument]["reminders"] = [r for r in data[instrument].get("reminders", []) if r["id"] != rid]
    _save(PRACTICE_FILE, data)
    return jsonify({"ok": True})

@app.route("/api/practice/<instrument>/session", methods=["POST"])
def log_practice_session(instrument):
    if instrument != "piano":
        return jsonify({"error": "invalid instrument"}), 400
    data = _load(PRACTICE_FILE, PRACTICE_DEFAULT)
    body = request.json or {}
    sessions = data[instrument].get("sessions", [])
    sessions.insert(0, {
        "date": datetime.now().strftime("%Y-%m-%d"),
        "minutes": body.get("minutes", 0),
        "note": body.get("note", "")
    })
    data[instrument]["sessions"] = sessions[:60]
    _save(PRACTICE_FILE, data)
    return jsonify({"ok": True})


# startup_sync removed — the contacts Google Sheet had corrupted data (songs as contacts)
# and was overwriting correct local data on every container start.

if __name__ == "__main__":
    if not os.environ.get("ANTHROPIC_API_KEY"):
        print("ERROR: Set ANTHROPIC_API_KEY in .env")
        sys.exit(1)
    port = int(os.environ.get("PORT", 5000))
    # Local staging only (Cloud Run uses gunicorn and never runs this block):
    # hot-reload templates from disk so index.html/login.html edits show on refresh
    # without a server restart.
    app.config["TEMPLATES_AUTO_RELOAD"] = True
    app.jinja_env.auto_reload = True
    print(f"Mission Control -> http://localhost:{port}")
    app.run(debug=False, port=port, host="0.0.0.0")
