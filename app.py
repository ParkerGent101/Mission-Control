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
import time
import mimetypes
import copy

from dotenv import load_dotenv
from flask import Flask, jsonify, render_template, request, session, redirect
from flask_compress import Compress
import anthropic

load_dotenv()

app = Flask(__name__)
app.secret_key = os.environ.get("FLASK_SECRET", "mc-change-this-secret-key-2026")

# Serve .jsx as JavaScript (correct content-type for the dev Babel path).
mimetypes.add_type("text/javascript", ".jsx")
# Gzip ONLY the HTML shell (large, fetched every navigation). JSON/JS are excluded:
# per-request API compression costs CPU+memory for ~no benefit to a single user on a
# fast link, and those extra buffers added to the memory pressure under concurrent load.
app.config["COMPRESS_MIMETYPES"] = ["text/html", "text/css"]
Compress(app)

@app.after_request
def cache_headers(response):
    p = request.path
    if p.startswith("/api/"):
        # Dynamic data — never cache.
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate"
        response.headers["Pragma"] = "no-cache"
    elif p.startswith("/static/"):
        if request.args.get("v"):
            # Versioned asset (?v=<hash>): the URL changes whenever the file's
            # contents change, so the browser can cache it forever and skip the
            # revalidation round-trip entirely. A deploy (or local edit) bumps the
            # hash -> new URL -> fresh fetch. The old policy was no-store, which
            # re-downloaded every JSX file on every page load (pure waste of Cloud
            # Run egress + per-request latency on each visit).
            response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
            response.headers.pop("Pragma", None)
        else:
            # Un-versioned /static/ request: still revalidate via ETag (a cheap 304)
            # instead of re-downloading the body in full.
            response.headers["Cache-Control"] = "no-cache"
            response.headers.pop("Pragma", None)
    elif response.mimetype == "text/html":
        # The HTML shell embeds the ?v=<hash> asset URLs; a cached shell (browser
        # heuristic or intermediate proxy) keeps clients on the previous deploy's
        # bundles indefinitely. no-cache = revalidate on every load, so a plain
        # refresh always picks up new asset hashes.
        response.headers["Cache-Control"] = "no-cache"
    return response
app.config["PERMANENT_SESSION_LIFETIME"] = timedelta(days=int(os.environ.get("SESSION_LIFETIME_DAYS", "7")))

DASHBOARD_PASSWORD = os.environ.get("DASHBOARD_PASSWORD", "aces2026")
# Google sign-in: only these accounts may log in. Comma-separated; defaults to Parker's account.
ALLOWED_LOGIN_EMAILS = [e.strip().lower() for e in os.environ.get(
    "ALLOWED_LOGIN_EMAILS", "parkergent7@gmail.com").split(",") if e.strip()]
# Break-glass only: the legacy shared-password login. Off by default so production is
# password-free (Google sign-in + MFA only). Set ALLOW_PASSWORD_LOGIN=true to re-enable.
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
REMINDERS_FILE   = DATA_DIR / "reminders.json"
SAVINGS_FILE     = DATA_DIR / "savings.json"
CONTENT_FILE     = DATA_DIR / "band_content.json"
SONGS_FILE       = DATA_DIR / "band_songs.json"
BAND_CONTACTS_FILE = DATA_DIR / "band_contacts.json"
AGENDA_FILE      = DATA_DIR / "agenda.json"
HEALTH_FILE      = DATA_DIR / "health.json"
WORK_FILE        = DATA_DIR / "work_tasks.json"
BRIEF_FILE       = DATA_DIR / "brief.json"
DB_PATH          = DATA_DIR / "mission_control.db"
FINANCE_SHEET_ID = os.environ.get("FINANCE_SHEET_ID", "")
HEALTH_SHEET_ID  = os.environ.get("HEALTH_SHEET_ID", "")
# Email to share rollover-generated finance files with (so Parker, not just the
# Cloud Run service account, can open them). Optional.
FINANCE_OWNER_EMAIL = os.environ.get("FINANCE_OWNER_EMAIL", "")

GOOGLE_CREDS_FILE = DATA_DIR / "credentials.json"  # shared OAuth client secret (Drive/Sheets + Google sign-in)
GOOGLE_OAUTH_CLIENT_ID = os.environ.get("GOOGLE_OAUTH_CLIENT_ID", "")
GOOGLE_OAUTH_CLIENT_SECRET = os.environ.get("GOOGLE_OAUTH_CLIENT_SECRET", "")
GOOGLE_OAUTH_PROJECT_ID = os.environ.get("GOOGLE_OAUTH_PROJECT_ID", "")

GDRIVE_SCOPES      = ['https://www.googleapis.com/auth/drive', 'https://www.googleapis.com/auth/spreadsheets']
GDRIVE_TOKEN_FILE  = DATA_DIR / "drive_token.json"
GDRIVE_CONFIG_FILE = DATA_DIR / "drive_config.json"


ONBOARDING_FILE   = DATA_DIR / "onboarding.json"
FINANCE_IMPORT_FILE = DATA_DIR / "finance_import.json"   # dedup fingerprints for Rocket Money CSV imports
ROOMMATE_FILE      = DATA_DIR / "roommate_payment.json"  # local fallback for the Sheet "roommate payment" section
USER_CONFIG_FILE   = DATA_DIR / "user_config.json"
TCPG_FILE          = DATA_DIR / "tcpg.json"

# Google Drive folder (ID) where Rocket Money transaction CSV exports are uploaded.
# Configured at runtime via Settings → Integrations and stored in drive_config.json;
# this env var is only a deploy-time default.
FINANCE_IMPORT_FOLDER = os.environ.get("FINANCE_IMPORT_FOLDER", "")

def _load(path, default=None):
    p = Path(path)
    fallback = default if default is not None else []
    if GCS_BUCKET:
        try:
            client = _gcs()
            if client:
                # Single GCS round-trip: download directly and treat a missing
                # object as the fallback. The old exists()+download pair doubled
                # the GCS reads on every _load — the hottest call in the app.
                from google.api_core.exceptions import NotFound
                blob = client.bucket(GCS_BUCKET).blob(p.name)
                try:
                    return json.loads(blob.download_as_text())
                except NotFound:
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

# The finance Sheet writers (imports, rollover, budget/detail writes) reference the
# module-global FINANCE_SHEET_ID, which is only a deploy-time env default. Let the sheet
# pasted in Settings → Integrations (drive_config.json, persisted on /data / the GCS
# bucket) override it, so pointing the app at a new budget sheet is a one-time Settings
# change — never a redeploy. Scoped to finance/drive routes so the extra config read
# (a GCS round-trip in prod — _load is the hottest call in the app) doesn't tax every
# request.
@app.before_request
def _override_finance_sheet_id():
    global FINANCE_SHEET_ID
    p = request.path or ""
    if not (p.startswith("/api/finance") or p.startswith("/api/drive")):
        return
    try:
        configured = str(_load(GDRIVE_CONFIG_FILE, {}).get("sheet_finance") or "").strip()
    except Exception:
        configured = ""
    if configured:
        FINANCE_SHEET_ID = configured

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
    """Public privacy policy page for the application."""
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

def tool_add_show(date, event, venue, city, tickets="", notes="", doors="", time=""):
    # doors/time are 24h "HH:MM" (or "") — stored as-is in shows.json; the website formats to 12h.
    shows = _load(SHOWS_FILE)
    shows.append({"date": date, "event": event, "venue": venue, "city": city,
                  "doors": doors, "time": time, "tickets": tickets, "notes": notes})
    _save(SHOWS_FILE, shows)
    push_result = tool_push_site(f"Add show: {event} at {venue}")
    return f"Show added: {event} — {venue}, {city} on {date}. {push_result}"

def tool_edit_show(index: int, fields: dict):
    shows = _load(SHOWS_FILE)
    if not (0 <= index < len(shows)):
        return f"No show at index {index}."
    allowed = {"date", "event", "venue", "city", "doors", "time", "tickets", "notes"}
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

def tool_finance_reconcile(apply=False):
    """Reconcile the current month's Finance tab against the newest Rocket Money
    CSV (CSV = truth). Dry run unless apply=True. Returns a plain string."""
    try:
        r = _finance_reconcile(apply=bool(apply))
    except Exception as e:
        return f"Reconcile failed: {e}"
    if r.get("error"):
        return f"Reconcile failed: {r['error']}"
    mode = "APPLIED" if r["applied"] else "DRY RUN (nothing written)"
    lines = [f"{mode} — {r['tab']} tab vs {r['csv']}",
             f"CSV truth total ${r['truth_total']:.2f} | kept (CSV-backed) ${r['kept_total']:.2f} | "
             f"to remove: {len(r['removed'])} rows, ${r['removed_total']:.2f}"]
    for x in r["removed"][:40]:
        lines.append(f"  REMOVE [{x['category']}] {x['label'][:48]} ${x['amount']:.2f}")
    if len(r["removed"]) > 40:
        lines.append(f"  ... and {len(r['removed']) - 40} more")
    lines += [f"  NOTE: {w}" for w in r["warnings"]]
    if not r["applied"] and r["removed"]:
        lines.append("Show this plan to the user and only re-run with apply=true after they confirm.")
    return "\n".join(lines)

def tool_add_agenda_item(label, time="09:00", tag="Personal", date=""):
    items = _load(AGENDA_FILE)
    aid = max((a["id"] for a in items), default=0) + 1
    date_str = date or datetime.now().strftime("%Y-%m-%d")
    items.append({"id": aid, "time": time, "label": label, "tag": tag, "done": False, "date": date_str})
    _save(AGENDA_FILE, items)
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
    "finance_reconcile":    lambda i: tool_finance_reconcile(i.get("apply", False)),
    "add_agenda_item":      lambda i: tool_add_agenda_item(**i),
    "add_work_task":        lambda i: tool_add_work_task(**i),
    "log_weight":           lambda i: tool_log_weight(i["weight"], i.get("date","")),
    "log_calories":         lambda i: tool_log_calories(i["consumed"], i.get("burned",0), i.get("date","")),
}

TOOLS = [
    {"name":"list_shows","description":"List all shows","input_schema":{"type":"object","properties":{}}},
    {"name":"add_show","description":"Add a show to comingupaces.net","input_schema":{"type":"object","properties":{"date":{"type":"string"},"event":{"type":"string"},"venue":{"type":"string"},"city":{"type":"string"},"doors":{"type":"string","description":"Doors-open time, 24h HH:MM e.g. '20:00'"},"time":{"type":"string","description":"Show start time, 24h HH:MM e.g. '21:00'"},"tickets":{"type":"string"},"notes":{"type":"string"}},"required":["date","event","venue","city"]}},
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
    {"name":"finance_reconcile","description":"Reconcile the current month's Finance Sheet tab against the newest Rocket Money CSV export in Drive (the CSV is the point of truth): removes detail-table rows and Utilities actuals not backed by a CSV transaction. Dry run by default — ALWAYS show the user the plan and get their confirmation before calling again with apply=true.","input_schema":{"type":"object","properties":{"apply":{"type":"boolean","description":"true to write the removals to the Sheet; omit/false for a dry-run plan"}}}},
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

def _asset_version():
    """Short hash of the static JSX files' size+mtime. Changes whenever any asset
    changes (a deploy or a local edit), so the versioned ?v=<hash> URLs in
    index.html bust the browser's immutable cache exactly when — and only when —
    the code actually changes. Computed per index load (~7 stat() calls)."""
    import hashlib
    try:
        h = hashlib.md5()
        sdir = Path(__file__).parent / "static"
        # Hash both source .jsx (dev) and precompiled .js (prod); whichever set is
        # served, the hash moves when a file changes (a deploy regenerates the .js
        # with fresh mtimes; a local edit changes the .jsx).
        files = sorted(list(sdir.glob("*.jsx")) + list(sdir.glob("*.js")), key=lambda p: p.name)
        for f in files:
            st = f.stat()
            h.update(f"{f.name}:{st.st_size}:{int(st.st_mtime)}".encode())
        return h.hexdigest()[:12]
    except Exception:
        return "0"

@app.route("/")
def index():
    return render_template(
        "index.html",
        asset_version=_asset_version(),
        # Prod image bakes PRECOMPILED_ASSETS=1 → serve plain .js (no in-browser Babel).
        # Unset locally → dev serves .jsx via Babel-standalone (hot-reload, no build step).
        precompiled=os.environ.get("PRECOMPILED_ASSETS") == "1",
    )

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
    message = tool_add_show(d["date"], d["event"], d["venue"], d["city"], d.get("tickets",""), d.get("notes",""), d.get("doors",""), d.get("time",""))
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

@app.route("/api/finances", methods=["GET"])
def get_finances():
    month = request.args.get("month")
    if FINANCE_SHEET_ID:
        try:
            svc  = _sheets_svc()
            tab  = _resolve_month_tab(svc, month) if month else _first_sheet_name(svc, FINANCE_SHEET_ID)
            rows = _finance_rows(svc, tab)
            return jsonify(_parse_transaction_rows(rows, tab=tab))
        except Exception as e:
            # Falling back to the local file silently is confusing (old freeform
            # categories render as "Other" and rows lack sheet coords) — log why.
            app.logger.warning("Finance Sheet read failed; serving local transactions: %s", e)
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
            tab  = _resolve_month_tab(svc, month) if month else _first_sheet_name(svc, FINANCE_SHEET_ID)
            rows = _finance_rows(svc, tab)
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

def _parse_roommate_section(rows):
    """Find the 'roommate payment' section in the year tab and return each line item
    with the roommate's HALF share (the bills are split 50/50). Reads whatever items
    live under the header, so it tracks the Sheet — no hardcoded amounts.

    Returns {"items": [{"label","full","half"}], "total"} where total is the sum of
    the halves; empty if the section isn't found."""
    def _num(cell):
        s = str(cell).replace("$", "").replace(",", "").strip()
        if not s:
            return None
        try:
            return float(s)
        except ValueError:
            return None

    if not rows:
        return {"items": [], "total": 0.0}
    # Locate the section header (a cell containing "roommate").
    start = None
    for i, row in enumerate(rows):
        if any("roommate" in str(c).strip().lower() for c in row):
            start = i + 1
            break
    if start is None:
        return {"items": [], "total": 0.0}

    items = []
    for row in rows[start:]:
        cells = [str(c).strip() for c in row]
        if not any(cells):                 # blank row ends the section
            if items:
                break
            continue
        label = next((c for c in cells if c and _num(c) is None), None)
        # Use the LARGEST number in the row, not the first: some rows have a stray
        # empty/0 cell (or a pre-computed half) before the real bill, which made
        # "first number" read e.g. water as 0. The full bill is the max either way.
        nums = [n for n in (_num(c) for c in cells) if n is not None]
        amount = max(nums) if nums else None
        if label is not None and amount is not None:
            items.append({"label": label, "full": round(amount, 2),
                          "half": round(amount / 2.0, 2)})
        elif label and amount is None and items:
            break                          # a new text-only header ends the section
        if len(items) >= 20:               # safety cap
            break
    total = round(sum(it["full"] for it in items) / 2.0, 2)
    return {"items": items, "total": total}

def _roommate_from_items(items):
    """Compute the roommate's half of each {label, amount} line + the total (Σfull/2)."""
    out = []
    for it in items or []:
        if not isinstance(it, dict):
            continue
        label = str(it.get("label", "")).strip()
        try:
            amt = float(str(it.get("amount", "")).replace("$", "").replace(",", "").strip())
        except (TypeError, ValueError):
            continue
        if label:
            out.append({"label": label, "full": round(amt, 2), "half": round(amt / 2.0, 2)})
    total = round(sum(i["full"] for i in out) / 2.0, 2)
    return {"items": out, "total": total}

@app.route("/api/finances/roommate", methods=["GET"])
def get_finances_roommate():
    """What the roommate owes this period: half of each utility line. The in-app config
    (ROOMMATE_FILE, edited via POST below) is authoritative; if none is saved we fall back
    to the finance Sheet's '<year>' tab 'roommate payment' section. Frontend hides the line
    when total is 0."""
    cfg = _load(ROOMMATE_FILE, None)
    if isinstance(cfg, dict) and cfg.get("items"):
        return jsonify({"ok": True, "source": "config", **_roommate_from_items(cfg["items"])})
    if FINANCE_SHEET_ID:
        try:
            svc = _sheets_svc()
            rows = _finance_rows(svc, str(datetime.now().year))
            result = _parse_roommate_section(rows)
            if result["items"]:
                return jsonify({"ok": True, "source": "sheet", **result})
        except Exception:
            pass
    return jsonify({"ok": False, "items": [], "total": 0.0})

@app.route("/api/finances/roommate", methods=["POST"])
def post_finances_roommate():
    """Save the roommate utilities the user enters in the app: {items:[{label, amount}]}.
    Stored in ROOMMATE_FILE (full bills); the GET halves them. An empty list clears it
    (so GET falls back to the Sheet)."""
    d = request.json or {}
    raw = d.get("items", [])
    if not isinstance(raw, list):
        return jsonify({"ok": False, "error": "items must be a list"}), 400
    clean = []
    for it in raw:
        if not isinstance(it, dict):
            continue
        label = str(it.get("label", "")).strip()
        try:
            amt = float(str(it.get("amount", "")).replace("$", "").replace(",", "").strip())
        except (TypeError, ValueError):
            continue
        if label:
            clean.append({"label": label, "amount": round(amt, 2)})
    _save(ROOMMATE_FILE, {"items": clean})
    return jsonify({"ok": True, "source": "config", **_roommate_from_items(clean)})

@app.route("/api/finances/budget", methods=["PATCH"])
def patch_finances_budget():
    """Edit a category's budgeted amount (column E) in the month's budget tracker.
    Body: {month: 'YYYY-MM', category: 'Utilities', budgeted: 1050}. Writes the new
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
        tab = _resolve_month_tab(svc, month)
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
            if _budget_row_canon(cat_val, desc_val, current_cat) != category:
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
        _invalidate_finance_cache()
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
            tab = _resolve_month_tab(svc, date[:7])
            rows = svc.spreadsheets().values().get(
                spreadsheetId=FINANCE_SHEET_ID, range=tab
            ).execute().get('values', [])
            if cat in DETAIL_TABLE_KEYWORDS:
                written = _write_detail_transaction(svc, FINANCE_SHEET_ID, tab, rows, cat, desc, amt, date)
                if not written:
                    return jsonify({"error": f"No '{cat}' table found in sheet tab '{tab}'."}), 400
                target_row, target_col = written
                _invalidate_finance_cache()
                return jsonify({"ok": True, "sheet_tab": tab, "sheet_row": target_row, "sheet_col": target_col, "sheet_cols": 2, "sheet_kind": "detail"})
            if cat in BUDGET_TRANSACTION_CATEGORIES:
                written = _write_budget_transaction(svc, FINANCE_SHEET_ID, tab, rows, cat, desc, amt)
                if not written:
                    return jsonify({"error": f"No empty '{cat}' budget row found in sheet tab '{tab}'."}), 400
                target_row, target_col = written
                _invalidate_finance_cache()
                return jsonify({"ok": True, "sheet_tab": tab, "sheet_row": target_row, "sheet_col": target_col, "sheet_cols": 1, "sheet_kind": "budget"})
            allowed = ", ".join(["Utilities", "Subscriptions", "Groceries", "Dining and Drinks", "Fun", "Gas"])
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
        _invalidate_finance_cache()
        return jsonify({"ok": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/finances/<int:tid>", methods=["PATCH"])
def patch_finance(tid):
    d = request.json or {}
    # Route to the Sheet editor only when the payload carries sheet coordinates.
    # When the Sheet read failed at GET time, the frontend is showing LOCAL
    # transactions (no sheet_tab) — those must be edited in the local store,
    # not rejected with "sheet_tab, sheet_row and sheet_col are required".
    if FINANCE_SHEET_ID and str(d.get("sheet_tab") or "").strip():
        resp = _patch_finance_sheet(d)
        _invalidate_finance_cache()
        return resp
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
    nm, ny = (1, y + 1) if m == 12 else (m + 1, y)
    dst_tab = MONTH_NAMES_FULL[nm - 1]   # new tabs get plain month names going forward
    try:
        svc = _sheets_svc()
        src_tab = _resolve_month_tab(svc, src_month)
        # Existing-tab check must also tolerate drifted titles ('August 2026'),
        # or a second rollover would create a duplicate month.
        existing_dst = _resolve_month_tab(svc, f"{ny}-{str(nm).zfill(2)}")
        if _sheet_id_by_name(svc, FINANCE_SHEET_ID, existing_dst) is not None:
            return jsonify({"error": f"A '{existing_dst}' tab already exists in your sheet."}), 409
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
        _invalidate_finance_cache()
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
    try:
        svc = _sheets_svc()
        tmpl_tab = _resolve_month_tab(svc, src_month)
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

def _load_subs():
    """Subscriptions list, reset to empty at the start of each month — the list
    tracks what's been charged THIS month, and the Drive import repopulates it
    as charges appear in the Rocket Money export. Legacy shape (a bare list) is
    stamped with the current month on first load."""
    cur = datetime.now().strftime("%Y-%m")
    data = _load(SUBS_FILE)
    if isinstance(data, list):
        data = {"month": cur, "items": data}
        _save(SUBS_FILE, data)
    if data.get("month") != cur:
        data = {"month": cur, "items": []}
        _save(SUBS_FILE, data)
    return data

def _save_subs(data):
    _save(SUBS_FILE, data)

def _ordinal_day(iso_date):
    """'2026-07-05' -> '5th' (the due-day format the subscriptions list uses)."""
    try:
        day = int(str(iso_date)[8:10])
    except (ValueError, IndexError):
        return ""
    suf = 'th' if 11 <= day % 100 <= 13 else {1: 'st', 2: 'nd', 3: 'rd'}.get(day % 10, 'th')
    return f"{day}{suf}"

def _upsert_subscription(data, name, amt, date):
    """Add an import-discovered subscription to the month's list. Add-only:
    an entry with the same name keeps its (possibly hand-edited) values.
    Returns True if an item was added."""
    key = str(name or "").strip().lower()
    if not key:
        return False
    if any(str(s.get("name", "")).strip().lower() == key for s in data["items"]):
        return False
    sid = max((s.get("id", 0) for s in data["items"]), default=0) + 1
    data["items"].append({"id": sid, "name": str(name).strip(), "acct": "",
                          "amt": round(float(amt), 2), "due": _ordinal_day(date)})
    return True

@app.route("/api/finances/subscriptions", methods=["GET"])
def get_subscriptions():
    return jsonify(_load_subs()["items"])

@app.route("/api/finances/subscriptions", methods=["POST"])
def post_subscription():
    d = request.json
    name, acct = d.get("name", ""), d.get("acct", "")
    amt, due = float(d.get("amt", 0)), d.get("due", "")
    data = _load_subs()
    sid = max((s.get("id", 0) for s in data["items"]), default=0) + 1
    data["items"].append({"id": sid, "name": name, "acct": acct, "amt": amt, "due": due})
    _save_subs(data)
    sheet_status = "not_configured"
    sheet_error = None
    if FINANCE_SHEET_ID:
        sheet_status = "error"
        try:
            svc = _sheets_svc()
            tab = _resolve_month_tab(svc, datetime.now().strftime("%Y-%m"))
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
                _invalidate_finance_cache()
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
    data = _load_subs()
    sub = next((s for s in data["items"] if s.get("id") == sid), None)
    if not sub:
        return jsonify({"error": "Not found"}), 404
    old_name = sub.get("name", "")
    sub["name"] = d.get("name", sub.get("name", ""))
    sub["acct"] = d.get("acct", sub.get("acct", ""))
    sub["amt"]  = float(d.get("amt", sub.get("amt", 0)) or 0)
    sub["due"]  = d.get("due", sub.get("due", ""))
    _save_subs(data)

    sheet_status = "not_configured"
    sheet_error = None
    if FINANCE_SHEET_ID:
        sheet_status = "error"
        try:
            svc = _sheets_svc()
            tab = _resolve_month_tab(svc, datetime.now().strftime("%Y-%m"))
            rows = svc.spreadsheets().values().get(
                spreadsheetId=FINANCE_SHEET_ID, range=tab
            ).execute().get('values', [])
            # Locate the row by the OLD name (it may be renamed); fall back to the new name.
            row_idx = _find_subscription_sheet_row(rows, old_name)
            if row_idx is None:
                row_idx = _find_subscription_sheet_row(rows, sub["name"])
            if row_idx is None:
                # No matching row (the import may have written a variant merchant
                # name, or the Sheet was hand-edited) — write into the next empty
                # Subscriptions slot instead of failing the edit.
                row_idx = _find_budget_section_next_row(rows, 'Subscriptions')
                pending_status = "written"
            else:
                pending_status = "updated"
            if row_idx is None:
                sheet_status = "section_full"
            else:
                a1 = f"'{tab}'!B{row_idx + 1}:E{row_idx + 1}"
                svc.spreadsheets().values().update(
                    spreadsheetId=FINANCE_SHEET_ID, range=a1,
                    valueInputOption='USER_ENTERED',
                    body={'values': [[sub["name"], sub["acct"], sub["due"], sub["amt"]]]}
                ).execute()
                _invalidate_finance_cache()
                sheet_status = pending_status
        except Exception as e:
            sheet_error = str(e)
    resp = {"ok": True, "sheet_status": sheet_status}
    if sheet_error:
        resp["sheet_error"] = sheet_error
    return jsonify(resp)

@app.route("/api/finances/subscriptions/<int:sid>", methods=["DELETE"])
def delete_subscription(sid):
    data = _load_subs()
    target = next((s for s in data["items"] if s.get("id") == sid), None)
    data["items"] = [s for s in data["items"] if s.get("id") != sid]
    _save_subs(data)

    sheet_status = "not_configured"
    sheet_error = None
    if FINANCE_SHEET_ID and target:
        sheet_status = "error"
        try:
            svc = _sheets_svc()
            tab = _resolve_month_tab(svc, datetime.now().strftime("%Y-%m"))
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
                _invalidate_finance_cache()
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
    skip = {"user_config.json", "finance_import.json", "onboarding.json", "mission_control.db"}
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
        HEALTH_FILE, BRIEF_FILE,
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

# ── Finance import: Rocket Money CSV from Google Drive ───────────────────────────

def _record_expense(date, desc, amt, cat, rows_cache=None):
    """Write one expense to the finance Sheet (detail or budget table) or the local
    JSON fallback. Returns (ok: bool, detail: str|dict). Mirrors POST /api/finances.
    Pass a dict as `rows_cache` for bulk imports: each month tab is read once and the
    in-memory copy is updated as rows are written, instead of one quota-burning
    values().get() per transaction (per-user read quota is 60/min)."""
    cat = _canonical_finance_category(cat)
    if FINANCE_SHEET_ID:
        svc = _sheets_svc()
        tab = _resolve_month_tab(svc, date[:7])
        if rows_cache is not None and tab in rows_cache:
            rows = rows_cache[tab]
        else:
            rows = _sheets_execute(svc.spreadsheets().values().get(
                spreadsheetId=FINANCE_SHEET_ID, range=tab)).get('values', [])
            if rows_cache is not None:
                rows_cache[tab] = rows
        if cat in DETAIL_TABLE_KEYWORDS:
            if _write_detail_transaction(svc, FINANCE_SHEET_ID, tab, rows, cat, desc, amt, date):
                _invalidate_finance_cache()
                return True, {"tab": tab, "kind": "detail"}
            return False, f"No '{cat}' table in tab '{tab}'"
        if cat in BUDGET_TRANSACTION_CATEGORIES:
            if _write_budget_transaction(svc, FINANCE_SHEET_ID, tab, rows, cat, desc, amt):
                _invalidate_finance_cache()
                return True, {"tab": tab, "kind": "budget"}
            return False, f"No empty '{cat}' budget row in tab '{tab}'"
        return False, f"'{cat}' isn't a Sheet-tracked category"
    tool_add_transaction(desc, amt, "expense", cat, date)
    return True, {"kind": "local"}

# Rocket Money's "Category" -> a Sheet-tracked bucket. The finance Sheet only has
# detail/budget tables for Gas, Groceries, Dining and Drinks, Utilities and Subscriptions;
# everything else (shopping, entertainment, …) collapses to 'Fun' so every spend row is importable.
# Housing (rent/mortgage) is folded into Utilities — one bills bucket per the Rocket Money export.
# Subscription merchants are checked BEFORE utilities because Rocket Money files most of
# them under "Bills & Utilities" — the only real utilities are Cox, water and electric.
# "cloud" (unqualified) is here on purpose: Google Cloud bills Parker's projects
# under names Rocket Money files as Shopping — 'CLOUD 6wHSWS', 'GOOGLE *CLOUD_xxx' —
# so a plain "google cloud" substring never matched. Anything cloud-ish is a
# subscription. Same for 'apple.com/bill', which Rocket Money files under
# Bills & Utilities.
_RM_SUBSCRIPTION_MERCHANTS = (
    "netflix", "hulu", "spotify", "apple music", "apple.com", "audible", "planet fitness",
    "cloud", "google cloud", "rocket money", "minecraft", "realms", "disney", "youtube",
    "hbo", "paramount", "peacock", "patreon", "chatgpt", "claude", "notion",
    "adobe", "icloud", "amazon prime",
)

def _rocket_to_finance_category(rm_cat, name=""):
    blob = (str(rm_cat or "").lower() + " " + str(name or "").lower())
    if any(k in blob for k in ("subscript",) + _RM_SUBSCRIPTION_MERCHANTS):       return "Subscriptions"
    if any(k in blob for k in ("gas", "fuel", "auto & transport", "transport")):  return "Gas"
    if any(k in blob for k in ("grocer", "groceries")):                           return "Groceries"
    if any(k in blob for k in ("dining", "drinks", "restaurant")):                return "Dining and Drinks"
    if any(k in blob for k in ("rent", "mortgage", "bills & utilities", "utilit",
                               "cox", "internet", "cable", "electric", "water",
                               "phone", "the grove")):                             return "Utilities"
    return "Fun"

# Rocket Money "Category" values that are NOT new discretionary spend, so they never hit
# the budget Sheet regardless of amount sign: a credit-card payment, transfer or investment
# can appear as a positive "money out" on the funding account but isn't spending to track.
RM_NONSPEND_CATS = {
    "credit card payment", "internal transfers", "transfers", "transfer",
    "investment", "investments", "buy", "sell", "income", "paycheck",
}

def _normalize_import_date(s):
    """Rocket Money exports YYYY-MM-DD; tolerate MM/DD/YYYY too. Falls back to the raw
    string (the Sheet writer only needs the YYYY-MM prefix to pick the month tab)."""
    s = str(s or "").strip()
    for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%m/%d/%y"):
        try:
            return datetime.strptime(s, fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    return s

def _parse_rocket_csv(raw_bytes):
    """Parse a Rocket Money transaction-export CSV into a list of
    {date, name, amount, category, ignored}. Header-driven and tolerant to column-name
    variants; dates normalized to YYYY-MM-DD. Amount keeps Rocket Money's sign
    (positive = money out / spending; negative = income / credit)."""
    import csv, io
    text = raw_bytes.decode("utf-8-sig", errors="replace") if isinstance(raw_bytes, (bytes, bytearray)) else str(raw_bytes)
    reader = csv.DictReader(io.StringIO(text))
    def pick(d, *keys):
        for k in keys:
            if (d.get(k) or "").strip():
                return d[k].strip()
        return ""
    rows = []
    for raw in reader:
        d = {(k or "").strip().lower(): (v or "") for k, v in raw.items()}
        try:
            amount = float(str(d.get("amount", "")).replace("$", "").replace(",", "").strip() or 0)
        except ValueError:
            amount = 0.0
        rows.append({
            "date": _normalize_import_date(pick(d, "date", "original date")),
            "name": pick(d, "name", "custom name", "description"),
            "amount": amount,
            "category": pick(d, "category"),
            "ignored": pick(d, "ignored from"),
        })
    return rows

def _rocket_is_nonspend(row):
    """True for Rocket Money rows that must NOT hit the budget Sheet: income/credits
    (amount <= 0 — Rocket Money signs spending positive), transfers / card payments /
    investments, still-pending charges (they re-post later with a changed fingerprint →
    would double-import), and rows the user marked 'Ignored From' in Rocket Money."""
    if (row.get("amount") or 0) <= 0:
        return True
    cat = str(row.get("category") or "").strip().lower()
    if cat in RM_NONSPEND_CATS or "transfer" in cat:
        return True
    if "PENDING" in str(row.get("name") or "").upper():
        return True
    if str(row.get("ignored") or "").strip():
        return True
    return False

def _rocket_fingerprint(date, amount, name):
    """Stable id for a Rocket Money row (the export has none) so a re-uploaded export that
    overlaps a prior one doesn't double-import the same transaction."""
    import hashlib
    key = f"{date}|{float(amount):.2f}|{str(name).strip().lower()}"
    return hashlib.sha1(key.encode("utf-8")).hexdigest()

# ── Reconciling sync: make a month tab match the Rocket Money export ─────────
# The old import appended every unseen CSV row to the next empty slot and deduped
# only on a date|amount|name fingerprint. That fingerprint changes whenever Rocket
# Money re-posts a charge (a pending charge posts a day later, a merchant name gets
# cleaned up, a tip settles) — so the same charge was written twice and the month's
# total drifted above what Rocket Money reports. It also ignored the recurring
# template rows in the budget sections (Water, Electricity, Netflix, …) and appended
# a second merchant-named row beside each one.
#
# The sync below reconciles instead of appending: the CSV is the truth for the month,
# so each run makes the tab MATCH it. New charges are added, changed amounts are
# updated in place, rows the sync wrote that the CSV no longer has are removed, and
# recurring charges land on the template row they belong to. Rows the sync never
# wrote (hand-entered cash spend on a template row) are left alone and reported.

_MERCHANT_STOP_TOKENS = {
    'the', 'and', 'of', 'inc', 'llc', 'co', 'corp', 'ltd', 'com', 'www',
    'pymt', 'pmt', 'payment', 'autopay', 'recurring', 'monthly', 'mon', 'mo',
    'purchase', 'debit', 'card', 'online', 'store', 'usa',
}

def _merchant_tokens(s):
    """Comparable words in a merchant name or Sheet description: lowercased, split
    on anything non-alphanumeric, with noise words and bare numbers dropped."""
    import re
    return [t for t in re.split(r'[^a-z0-9]+', str(s or '').lower())
            if len(t) > 1 and not t.isdigit() and t not in _MERCHANT_STOP_TOKENS]

def _merchant_match_score(merchant, row_desc):
    """How strongly a Rocket Money merchant matches an existing Sheet row.
    Shared whole word = 3, shared 4+ char prefix = 2, nothing in common = 0.
    This is what lets 'COX COMM KAN' find the 'Internet (COX COMM)' row,
    'AMER ELECT PWR' find 'Electricity' and 'Microsoft*Realms 1 Mon' find
    'Realms Minecraft' — instead of each one appending a new row every month."""
    mt, rt = _merchant_tokens(merchant), _merchant_tokens(row_desc)
    if not mt or not rt:
        return 0
    score = 0
    for a in mt:
        best = 0
        for b in rt:
            if a == b:
                best = max(best, 3)
            elif len(a) >= 4 and len(b) >= 4 and (a.startswith(b) or b.startswith(a)):
                best = max(best, 2)
        score += best
    return score

_MERCHANT_MATCH_MIN = 2      # a 4+ char prefix hit is the weakest match we accept

def _budget_section_scan(rows, canon_target):
    """Rows of one budget-tracker section (Utilities / Subscriptions) as
    [{'row','desc','actual','actual_raw','template'}], plus the section's column map.

    `template` marks a row Parker maintains by hand — it carries a category label,
    an account, a due date or a budgeted amount. A row with nothing but a
    description and an actual is an artifact the old importer appended, which is
    what makes it safe for the sync to clean those up."""
    if not rows:
        return [], {}
    max_cols = max((len(r) for r in rows), default=1)
    padded = [list(r) + [''] * (max_cols - len(r)) for r in rows]
    hdr_idx, desc_col, due_col, actual_col = _finance_budget_columns(padded)
    hdr = [str(c).lower().strip() for c in padded[hdr_idx]]
    budget_col = next((i for i, h in enumerate(hdr) if 'budget' in h), 4)
    acct_col   = next((i for i, h in enumerate(hdr) if 'account' in h), 2)
    out, start, end, current_cat = [], None, None, ''
    for ri in range(hdr_idx + 1, len(padded)):
        row = padded[ri]
        rl = ' '.join(str(c) for c in row[:8]).lower()
        if any(kw in rl for kw in ['anticipated', 'actual total', 'roommate', 'savings total']):
            break
        cell = lambda c: str(row[c]).strip() if c < max_cols else ''
        cat_val, desc_val = cell(0), cell(desc_col)
        if cat_val and not any(ch.isdigit() for ch in cat_val):
            current_cat = cat_val
        if _budget_row_canon(cat_val, desc_val, current_cat) == canon_target:
            if start is None:
                start = ri
            end = ri
            out.append({'row': ri, 'desc': desc_val,
                        'actual_raw': cell(actual_col), 'actual': _parse_money(cell(actual_col)),
                        'template': bool(cat_val or cell(acct_col) or cell(due_col) or cell(budget_col))})
        elif start is not None:
            break
    return out, {'desc': desc_col, 'actual': actual_col, 'budget': budget_col,
                 'start': start, 'end': end}

def _finance_sync_month(svc, month, csv_rows, purge=True, apply=True, subs_data=None):
    """Make one month tab agree with the Rocket Money export.

    purge=True (the current month) also removes sync-written rows the CSV no longer
    contains, so the tab's total equals Rocket Money's. For older months the sync is
    add-only — an export that only partly covers a past month must never wipe it.
    apply=False plans the changes without touching the Sheet.

    Returns a plan dict: added / updated / removed / manual counts and totals,
    per-category detail, and any warnings."""
    from collections import Counter

    def norm(s):
        return str(s or '').strip().lower()

    tab = _resolve_month_tab(svc, month)
    rows = _sheets_execute(svc.spreadsheets().values().get(
        spreadsheetId=FINANCE_SHEET_ID, range=tab)).get('values', [])
    max_cols = max((len(r) for r in rows), default=1)
    rows = [list(r) + [''] * (max_cols - len(r)) for r in rows]

    # -- what the CSV says this month's spending is --
    desired_detail = {c: [] for c in DETAIL_TABLE_KEYWORDS}
    desired_budget = {c: [] for c in BUDGET_TRANSACTION_CATEGORIES}
    csv_total, by_category = 0.0, {}
    for r in csv_rows:
        if (r.get('date') or '')[:7] != month or _rocket_is_nonspend(r):
            continue
        cat  = _rocket_to_finance_category(r.get('category'), r.get('name'))
        amt  = round(abs(r.get('amount') or 0), 2)
        name = (r.get('name') or 'Transaction').strip()
        csv_total = round(csv_total + amt, 2)
        by_category[cat] = round(by_category.get(cat, 0) + amt, 2)
        if cat in desired_detail:
            # Gas/Groceries tables key column 1 on the date, Fun/Dining on the merchant.
            label = name if cat in ('Fun', 'Dining and Drinks') else _format_short_date(r['date'])
            desired_detail[cat].append({'label': label, 'amount': amt, 'date': r['date'], 'name': name})
        elif cat in desired_budget:
            desired_budget[cat].append({'name': name, 'amount': amt, 'date': r['date']})

    state = _load(FINANCE_IMPORT_FILE, {"imported": []})
    if not isinstance(state, dict):
        state = {"imported": []}
    prev = (state.get('managed') or {}).get(month) or {}
    prev_detail = prev.get('detail') or {}
    prev_budget = prev.get('budget') or {}

    # Every label+amount the CSV can account for this month, in both the forms the
    # detail tables use (merchant for Fun/Dining, short date for Gas/Groceries). A
    # Sheet row matching one of these belongs to the CSV even if no earlier run
    # recorded writing it — that is what lets the first reconciling sync collapse the
    # duplicates the old importer left behind and re-home a charge Rocket Money has
    # since re-categorized, while leaving hand-entered rows (cash, splits) alone.
    # Budget-category charges are included too: a charge that moves out of a detail
    # table into Utilities/Subscriptions (Google Cloud now being a subscription) must
    # let go of its old detail row instead of being counted in both places.
    csv_keys = set()
    for lst in list(desired_detail.values()) + list(desired_budget.values()):
        for d in lst:
            csv_keys.add((norm(d.get('name') or d.get('label')), d['amount']))
            csv_keys.add((norm(_format_short_date(d['date'])), d['amount']))

    writes, warnings = [], []          # writes: (a1_range, [[...]]) for values.batchUpdate
    added = updated = removed = 0
    manual_total = 0.0
    new_detail, new_budget = {}, {}

    # -- detail tables: Gas / Fun / Groceries / Dining and Drinks --
    for cat in DETAIL_TABLE_KEYWORDS:
        want = [[d['label'], d['amount']] for d in
                sorted(desired_detail[cat], key=lambda x: (x['date'], norm(x['label']), x['amount']))]
        pos = _find_detail_table(rows, cat)
        if not pos:
            if want:
                warnings.append(f"[{cat}] no detail table in '{tab}' — {len(want)} charges not written")
            continue
        hr, hc = pos
        end = len(rows)
        for ri in range(hr + 2, len(rows)):
            c1 = norm(rows[ri][hc])
            c2 = norm(rows[ri][hc + 1]) if hc + 1 < max_cols else ''
            if 'total' in (c1 + c2):
                end = ri
                break
        slots = max(0, end - (hr + 2))
        cur_block = [[str(rows[ri][hc]), str(rows[ri][hc + 1] if hc + 1 < max_cols else '')]
                     for ri in range(hr + 2, end)]
        existing = [[c1, c2] for c1, c2 in cur_block if c1.strip() or c2.strip()]

        # Rows an earlier run wrote, or that the CSV can account for, are the sync's to
        # rewrite; anything else in the table was hand-entered and is preserved as-is.
        owned_keys = {(norm(l), round(float(a), 2)) for l, a in (prev_detail.get(cat) or [])} | csv_keys
        manual, mine = [], Counter()
        for c1, c2 in existing:
            key = (norm(c1), round(_parse_money(c2), 2))
            if key in owned_keys:
                mine[key] += 1
            else:
                manual.append([c1, c2])
        want_c = Counter((norm(l), round(float(a), 2)) for l, a in want)

        if purge:
            body = manual + want
            gone, fresh = mine - want_c, want_c - mine
            # Same merchant, different amount = one charge whose amount changed
            # (a tip settling, a pending charge posting), not a delete plus an add.
            for (lbl, _amt), n in list(gone.items()):
                same = [k for k in fresh if k[0] == lbl]
                for k in same:
                    moved = min(n, fresh[k])
                    if not moved:
                        continue
                    updated += moved
                    fresh[k] -= moved
                    gone[(lbl, _amt)] -= moved
                    n -= moved
            added   += sum(v for v in fresh.values() if v > 0)
            removed += sum(v for v in gone.values() if v > 0)
            new_detail[cat] = want
        else:
            have = Counter((norm(c1), round(_parse_money(c2), 2)) for c1, c2 in existing)
            extra = []
            for w in want:
                k = (norm(w[0]), round(float(w[1]), 2))
                if have.get(k):
                    have[k] -= 1
                else:
                    extra.append(w)
            body = existing + extra
            added += len(extra)
            new_detail[cat] = [list(x) for x in (prev_detail.get(cat) or [])] + extra
        manual_total = round(manual_total + sum(_parse_money(a) for _, a in manual), 2)

        if len(body) > slots:
            warnings.append(f"[{cat}] table has room for {slots} rows but needs {len(body)} — "
                            f"{len(body) - slots} charges not written; add rows above its Total row")
            body = body[:slots]
        body = body + [['', '']] * (slots - len(body))
        # Compare label + numeric amount, not raw strings: the Sheet hands back '6' for
        # a 6.0 write, which would otherwise make every sync rewrite the whole block.
        shape = lambda blk: [(str(a).strip(), round(_parse_money(b), 2) if str(b).strip() else None)
                             for a, b in blk]
        if shape(body) != shape(cur_block):
            writes.append((f"'{tab}'!{_col_letter(hc)}{hr + 3}:{_col_letter(hc + 1)}{end}", body))

    # -- budget sections: Utilities / Subscriptions (one row per recurring bill) --
    appends = []          # (cat, merchant, amount) with no row to land on yet
    for cat in sorted(desired_budget):
        section, cols = _budget_section_scan(rows, cat)
        want = sorted(desired_budget[cat], key=lambda x: x['date'])
        if not section:
            if want:
                warnings.append(f"[{cat}] no '{cat}' section in '{tab}' — {len(want)} charges not written")
            continue
        # Rows the old importer appended carry only a description + actual. Treat all of
        # them as sync-owned so a first run of this code cleans up the legacy duplicates.
        prev_keys = {norm(k) for k in (prev_budget.get(cat) or {})}
        was_ours = lambda s: ((not s['template']) or norm(s['desc']) in prev_keys
                              or (norm(s['desc']), round(s['actual'], 2)) in csv_keys)
        templates = [s for s in section if s['template'] and s['desc']]
        artifacts = [s for s in section if not s['template'] and s['desc']]

        assigned, mine = {}, {}
        for d in want:
            hit = None
            for pool in (templates, artifacts):     # a real template row always wins
                scored = [(_merchant_match_score(d['name'], s['desc']), -s['row'], s) for s in pool]
                scored = [x for x in scored if x[0] >= _MERCHANT_MATCH_MIN]
                if scored:
                    hit = max(scored, key=lambda x: (x[0], x[1]))[2]
                    break
            if hit is None:
                appends.append((cat, d['name'], d['amount']))
                continue
            # Several charges to the same bill in one month sum into its row.
            assigned[hit['row']] = round(assigned.get(hit['row'], 0.0) + d['amount'], 2)
            mine[hit['row']] = hit['desc']

        for s in section:
            target = assigned.get(s['row'])
            actual_cell = f"'{tab}'!{_col_letter(cols['actual'])}{s['row'] + 1}"
            desc_cell   = f"'{tab}'!{_col_letter(cols['desc'])}{s['row'] + 1}"
            if target is not None:
                if not s['actual_raw'].strip():
                    added += 1
                elif abs(s['actual'] - target) > 0.005:
                    updated += 1
                if not s['actual_raw'].strip() or abs(s['actual'] - target) > 0.005:
                    writes.append((actual_cell, [[target]]))
                new_budget.setdefault(cat, {})[s['desc']] = target
                continue
            if not purge:
                if s['actual_raw'].strip() and not was_ours(s):
                    manual_total = round(manual_total + s['actual'], 2)
                continue
            if not s['template'] and (s['desc'] or s['actual_raw'].strip()):
                # Leftover import row with nothing behind it — clear the whole row.
                writes.append((desc_cell, [['']]))
                writes.append((actual_cell, [['']]))
                if s['actual_raw'].strip():
                    removed += 1
                _set_cell(rows, s['row'], cols['desc'], '')
                _set_cell(rows, s['row'], cols['actual'], '')
            elif s['actual_raw'].strip() and was_ours(s):
                writes.append((actual_cell, [['']]))   # bill we synced, now gone from the CSV
                removed += 1
                _set_cell(rows, s['row'], cols['actual'], '')
            elif s['actual_raw'].strip():
                manual_total = round(manual_total + s['actual'], 2)   # Parker typed this one

    plan = {'tab': tab, 'month': month, 'purge': purge, 'applied': False,
            'added': added, 'updated': updated, 'removed': removed,
            'new_rows': len(appends), 'csv_total': csv_total,
            'manual_total': round(manual_total, 2),
            'expected_total': round(csv_total + manual_total, 2),
            'by_category': by_category, 'warnings': warnings}
    if not apply:
        return plan

    if writes:
        _sheets_execute(svc.spreadsheets().values().batchUpdate(
            spreadsheetId=FINANCE_SHEET_ID,
            body={'valueInputOption': 'USER_ENTERED',
                  'data': [{'range': a1, 'values': v} for a1, v in writes]}))

    # Genuinely new bills/subscriptions: no row to update, so append one. Done after
    # the batch above so freed-up artifact rows are reusable and row inserts (which
    # shift indexes) can't invalidate the ranges computed above.
    for cat, name, amt in appends:
        try:
            if _write_budget_transaction(svc, FINANCE_SHEET_ID, tab, rows, cat, name, amt):
                added += 1
                new_budget.setdefault(cat, {})[name] = amt
            else:
                warnings.append(f"[{cat}] no room for '{name}' — add a row to the {cat} section")
        except Exception as e:
            warnings.append(f"[{cat}] '{name}' failed: {e}")

    # Subscriptions charged this month also feed the card's subscription list.
    if subs_data is not None and month == datetime.now().strftime('%Y-%m'):
        for d in desired_budget.get('Subscriptions', []):
            if _upsert_subscription(subs_data, d['name'], d['amount'], d['date']):
                plan['subs_added'] = plan.get('subs_added', 0) + 1

    managed = state.setdefault('managed', {})
    managed[month] = {'detail': new_detail, 'budget': new_budget,
                      'synced_at': datetime.now().isoformat(timespec='seconds')}
    # Keep only the last few months of ownership records.
    for stale in sorted(managed)[:-6]:
        managed.pop(stale, None)
    _save(FINANCE_IMPORT_FILE, state)
    _invalidate_finance_cache()
    plan.update({'applied': True, 'added': added, 'warnings': warnings})
    return plan

def _finance_reconcile(apply=False):
    """Reconcile the current month's Finance tab against the newest Rocket Money
    CSV export in Drive — the CSV is the point of truth. Any detail-table row
    (Fun / Gas / Groceries / Dining and Drinks) or Utilities actual NOT backed by a
    current-month CSV transaction is removed: detail tables are compacted (kept
    rows shift up, blanks below), budget actuals are cleared in place. Dry run
    unless apply=True; returns a plan dict ({'error': ...} on failure).
    Safe wrt the Drive sync: import fingerprints live in finance_import.json,
    not in the Sheet, so removed rows will NOT be re-imported. Ported from the
    one-off scripts/finance_july_cleanup.py (July tab was duplicated from June)."""
    def norm(s):
        return str(s or "").strip().lower()

    month = datetime.now().strftime("%Y-%m")
    cfg = _load(GDRIVE_CONFIG_FILE, {})
    folder = cfg.get("finance_import_folder") or FINANCE_IMPORT_FOLDER
    if not folder:
        return {"error": "No Drive import folder configured — set it in Settings → Integrations"}
    raw, meta = _drive_newest_csv(folder)
    if raw is None:
        return {"error": f"Could not fetch CSV: {meta}"}
    try:
        csv_rows = _parse_rocket_csv(raw)
    except Exception as e:
        return {"error": f"Could not parse CSV: {e}"}

    # -- truth: this month's real spend, categorized exactly like the sync --
    detail_truth = {c: [] for c in DETAIL_TABLE_KEYWORDS}   # cat -> [(col1, amt)]
    budget_truth, truth_total = [], 0.0                     # [(name, amt)]
    for r in csv_rows:
        if (r["date"] or "")[:7] != month or _rocket_is_nonspend(r):
            continue
        cat = _rocket_to_finance_category(r.get("category"), r.get("name"))
        amt = round(abs(r["amount"]), 2)
        truth_total = round(truth_total + amt, 2)
        if cat in DETAIL_TABLE_KEYWORDS:
            col1 = r["name"] if cat in ("Fun", "Dining and Drinks") else _format_short_date(r["date"])
            detail_truth[cat].append((norm(col1), amt))
        else:
            budget_truth.append((norm(r["name"]), amt))

    svc = _sheets_svc()
    tab = _resolve_month_tab(svc, month)
    vals = _sheets_execute(svc.spreadsheets().values().get(
        spreadsheetId=FINANCE_SHEET_ID, range=tab))
    rows = vals.get("values", [])
    max_cols = max((len(r) for r in rows), default=1)
    rows = [r + [""] * (max_cols - len(r)) for r in rows]

    def take(pool, col1, amt):
        """Greedy multiset match: same col1 text and amount within a cent."""
        for i, (tc, ta) in enumerate(pool):
            if tc == col1 and abs(ta - amt) < 0.011:
                pool.pop(i)
                return True
        return False

    updates = []       # values().update payloads for detail-table rewrites
    clears = []        # single cells to blank in budget sections
    removed, kept_total, warnings = [], 0.0, []

    # -- detail tables: Fun / Gas / Groceries / Dining and Drinks --
    for cat in DETAIL_TABLE_KEYWORDS:
        pos = _find_detail_table(rows, cat)
        if not pos:
            warnings.append(f"[{cat}] detail table not found — skipped")
            continue
        hr, hc = pos
        end = len(rows)
        for ri in range(hr + 2, len(rows)):
            c1 = norm(rows[ri][hc])
            c2 = norm(rows[ri][hc + 1]) if hc + 1 < max_cols else ""
            if "total" in (c1 + c2):
                end = ri
                break
        pool = list(detail_truth[cat])
        kept = []
        for ri in range(hr + 2, end):
            c1 = str(rows[ri][hc]).strip()
            c2raw = rows[ri][hc + 1] if hc + 1 < max_cols else ""
            if not c1 and not str(c2raw).strip():
                continue
            amt = _parse_money(c2raw)
            if take(pool, norm(c1), amt):
                kept.append([c1, c2raw])
                kept_total = round(kept_total + amt, 2)
            else:
                removed.append({"category": cat, "label": c1, "amount": amt})
        n_slots = end - (hr + 2)
        body = kept + [["", ""]] * (n_slots - len(kept))
        a1 = f"'{tab}'!{_col_letter(hc)}{hr + 3}:{_col_letter(hc + 1)}{end}"
        updates.append((a1, body))
        if pool:
            warnings.append(f"[{cat}] {len(pool)} CSV transactions not in the Sheet yet (sync will import them)")

    # -- budget sections: Utilities rows (incl. legacy Housing) with actuals --
    hdr_idx, desc_col, _, actual_col = _finance_budget_columns(rows)
    hdr = [norm(c) for c in rows[hdr_idx]]
    budget_col = next((i for i, h in enumerate(hdr) if "budget" in h), 4)
    current_cat = ""
    for ri in range(hdr_idx + 1, len(rows)):
        rl = " ".join(rows[ri][:8]).lower()
        if any(kw in rl for kw in ["anticipated", "actual total", "roommate", "savings total"]):
            break
        cat_val = str(rows[ri][0]).strip()
        desc_val = str(rows[ri][desc_col]).strip()
        if cat_val and not any(ch.isdigit() for ch in cat_val):
            current_cat = cat_val
        canon = _budget_row_canon(cat_val, desc_val, current_cat)
        if canon != "Utilities":
            continue
        actual_raw = rows[ri][actual_col] if actual_col < max_cols else ""
        if not str(actual_raw).strip():
            continue                      # unpaid/planned row — leave alone
        amt = _parse_money(actual_raw)
        if take(budget_truth, norm(desc_val), amt):
            kept_total = round(kept_total + amt, 2)
            continue                      # backed by a CSV txn — keep
        has_budgeted = bool(str(rows[ri][budget_col]).strip()) if budget_col < max_cols else False
        removed.append({"category": canon, "label": desc_val, "amount": amt})
        clears.append(f"'{tab}'!{_col_letter(actual_col)}{ri + 1}")
        if not has_budgeted:              # import-appended row, not a template bill
            clears.append(f"'{tab}'!{_col_letter(desc_col)}{ri + 1}")

    removed_total = round(sum(x["amount"] for x in removed), 2)
    result = {"csv": meta, "tab": tab, "applied": False,
              "truth_total": truth_total, "kept_total": kept_total,
              "removed_total": removed_total, "removed": removed,
              "warnings": warnings}
    if not apply or not removed:
        return result

    for a1, body in updates:
        _sheets_execute(svc.spreadsheets().values().update(
            spreadsheetId=FINANCE_SHEET_ID, range=a1,
            valueInputOption="USER_ENTERED", body={"values": body}))
    if clears:
        _sheets_execute(svc.spreadsheets().values().batchUpdate(
            spreadsheetId=FINANCE_SHEET_ID,
            body={"valueInputOption": "USER_ENTERED",
                  "data": [{"range": a1, "values": [[""]]} for a1 in clears]}))
    _invalidate_finance_cache()
    result["applied"] = True
    return result

@app.route("/api/finance/reconcile", methods=["GET"])
def finance_reconcile():
    """Plan (default) or apply (?apply=1) a purge of current-month Sheet rows not
    backed by the newest Rocket Money CSV export. Same GET+flag style as
    /api/finance/import/drive."""
    apply = request.args.get("apply") in ("1", "true", "yes")
    try:
        result = _finance_reconcile(apply=apply)
    except Exception as e:
        return jsonify({"error": f"Reconcile failed: {e}"}), 500
    if result.get("error"):
        return jsonify(result), 400
    return jsonify(result)

@app.route("/api/finance/import/status", methods=["GET"])
def finance_import_status():
    """Whether the Finance card can sync: is a Drive import folder configured and is the
    Drive OAuth connection live. (Sheet writes use separate ADC creds, so write failures
    surface per-row in /api/finance/import/drive, not here.)"""
    cfg = _load(GDRIVE_CONFIG_FILE, {})
    folder = cfg.get("finance_import_folder") or FINANCE_IMPORT_FOLDER
    _, err = _drive_files_service()
    return jsonify({"connected": err is None, "folder_configured": bool(folder), "error": err})

@app.route("/api/finance/import/drive", methods=["GET"])
def finance_import_drive():
    """Sync the finance Sheet to the newest Rocket Money CSV export in Drive.

    The CSV is the point of truth for the month, so this reconciles rather than
    appends: new charges are added, changed amounts are updated in place, rows a
    previous sync wrote that the CSV no longer has are removed, and recurring bills
    land on their existing template row instead of a fresh duplicate. Income,
    transfers, card payments, pending and Rocket-Money-ignored rows are excluded, so
    the tab's spend total matches Rocket Money's.

    ?preview=1  categorize and plan without writing anything
    ?days=N     import window (default 60); the current month is reconciled,
                older months in the window are add-only
    """
    preview = request.args.get("preview") in ("1", "true", "yes")
    cfg = _load(GDRIVE_CONFIG_FILE, {})
    folder = cfg.get("finance_import_folder") or FINANCE_IMPORT_FOLDER
    if not folder:
        return jsonify({"error": "No Drive import folder configured — set it in Settings → Integrations"}), 400
    raw, meta = _drive_newest_csv(folder)
    if raw is None:
        return jsonify({"error": meta}), 400
    try:
        rows = _parse_rocket_csv(raw)
    except Exception as e:
        return jsonify({"error": f"Could not parse CSV: {e}"}), 400
    # A full-history export would rewrite old month tabs and blow the request timeout,
    # so only recent months are synced. Widen with ?days= to backfill an older month.
    try:
        days = max(1, min(180, int(request.args.get("days", 60))))
    except (TypeError, ValueError):
        days = 60
    cutoff = (datetime.now().date() - timedelta(days=days)).isoformat()
    cur_month = datetime.now().strftime("%Y-%m")

    scanned = len(rows)
    in_window = [r for r in rows if (r.get("date") or "") >= cutoff]
    spend = [r for r in in_window if not _rocket_is_nonspend(r)]
    skipped = scanned - len(spend)
    months = sorted({(r["date"] or "")[:7] for r in spend if r.get("date")})

    # Removing rows the CSV doesn't have is only safe when the CSV is actually current.
    # A stale export sitting in Drive (last uploaded a week ago) would otherwise delete
    # every charge since — so an old export is add-only. Override with ?purge=1/0.
    csv_max_date = max((r["date"] for r in spend if r.get("date")), default="")
    fresh_cutoff = (datetime.now().date() - timedelta(days=4)).isoformat()
    arg_purge = request.args.get("purge")
    allow_purge = (csv_max_date >= fresh_cutoff) if arg_purge is None \
        else arg_purge in ("1", "true", "yes")

    if preview:
        preview_rows = sorted(
            [{"date": r["date"], "name": r["name"], "amount": round(abs(r["amount"]), 2),
              "category": _rocket_to_finance_category(r.get("category"), r.get("name"))}
             for r in spend], key=lambda x: x["date"])
        by_cat = {}
        for x in preview_rows:
            by_cat[x["category"]] = round(by_cat.get(x["category"], 0) + x["amount"], 2)
        return jsonify({"ok": True, "preview": True, "file": meta, "window_days": days,
                        "scanned": scanned, "skipped": skipped, "months": months,
                        "count": len(preview_rows), "rows": preview_rows[:200],
                        "total": round(sum(x["amount"] for x in preview_rows), 2),
                        "by_category": by_cat})

    if not FINANCE_SHEET_ID:
        # No Sheet configured: fall back to the local transaction store, deduped on a
        # date|amount|name fingerprint (the Sheet-side row matching needs a Sheet).
        state = _load(FINANCE_IMPORT_FILE, {"imported": []})
        imported = set(state.get("imported", []))
        written = 0
        for r in spend:
            fp = _rocket_fingerprint(r["date"], r["amount"], r["name"])
            if fp in imported:
                continue
            tool_add_transaction(r["name"] or "Transaction", abs(r["amount"]), "expense",
                                 _rocket_to_finance_category(r.get("category"), r.get("name")), r["date"])
            imported.add(fp); written += 1
        state["imported"] = list(imported)
        _save(FINANCE_IMPORT_FILE, state)
        return jsonify({"ok": True, "file": meta, "window_days": days, "written": written,
                        "failed": 0, "skipped": skipped, "scanned": scanned, "local": True,
                        "errors": []})

    svc = _sheets_svc()
    subs_data = _load_subs()
    totals = {"added": 0, "updated": 0, "removed": 0}
    errors, warnings, per_month = [], [], []
    for m in months:
        try:
            plan = _finance_sync_month(svc, m, spend, purge=(m == cur_month and allow_purge),
                                       apply=True, subs_data=subs_data)
        except Exception as e:
            errors.append(f"{m}: {e}")
            continue
        for k in totals:
            totals[k] += plan.get(k, 0)
        warnings.extend(plan.get("warnings", []))
        per_month.append(plan)
    if any(p.get("subs_added") for p in per_month):
        _save_subs(subs_data)      # only on change — this runs on every card load

    cur = next((p for p in per_month if p["month"] == cur_month), None)
    if not allow_purge and cur:
        warnings.insert(0, f"Export only covers through {csv_max_date} — added new charges "
                           f"but left existing rows alone. Upload a fresh Rocket Money export, "
                           f"or sync with ?purge=1 to force a full reconcile.")
    return jsonify({"ok": True, "file": meta, "window_days": days, "months": months,
                    "csv_through": csv_max_date, "reconciled": bool(allow_purge),
                    # `written` = rows touched, kept for the Finance card's toast
                    "written": totals["added"] + totals["updated"],
                    "added": totals["added"], "updated": totals["updated"],
                    "removed": totals["removed"],
                    "failed": len(errors), "skipped": skipped, "scanned": scanned,
                    "csv_total": cur["csv_total"] if cur else None,
                    "expected_total": cur["expected_total"] if cur else None,
                    "manual_total": cur["manual_total"] if cur else None,
                    "by_category": cur["by_category"] if cur else {},
                    "months_detail": per_month,
                    "warnings": warnings[:8], "errors": errors[:5]})


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

def _extract_drive_folder_id(url_or_id):
    import re
    m = re.search(r'/folders/([a-zA-Z0-9_-]+)', url_or_id or "")
    return m.group(1) if m else (url_or_id or "").strip()

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

# ── Finance Sheet read cache ─────────────────────────────────────────────────
# /api/finances and /api/finances/budget both read the same month tab from the
# finance Sheet, and the Finance card auto-refreshes on a timer — so without a
# cache every refresh makes redundant Sheets round-trips, each adding ~0.3-0.8s
# of request latency (billed CPU time on Cloud Run) and Sheets API quota. Cache
# the raw row read briefly, keyed by tab, and clear it on EVERY write to the
# finance Sheet so the card never shows stale balances. The short TTL is a
# backstop in case a write path is ever missed. One gunicorn worker => one shared
# process-local cache, which is correct for this single-user app.
_FIN_ROWS_CACHE = {}     # tab -> (monotonic_ts, rows)
_FIN_CACHE_TTL  = 30     # seconds

def _finance_rows(svc, tab):
    """Cached read of a finance Sheet tab's raw values. Pure reads only — write
    handlers must read fresh (and call _invalidate_finance_cache after writing)."""
    hit = _FIN_ROWS_CACHE.get(tab)
    if hit and (time.monotonic() - hit[0]) < _FIN_CACHE_TTL:
        return hit[1]
    rows = svc.spreadsheets().values().get(
        spreadsheetId=FINANCE_SHEET_ID, range=tab
    ).execute().get('values', [])
    _FIN_ROWS_CACHE[tab] = (time.monotonic(), rows)
    return rows

def _invalidate_finance_cache():
    """Drop cached finance Sheet reads. Call after ANY write to the finance Sheet."""
    _FIN_ROWS_CACHE.clear()
    _TAB_TITLE_CACHE.clear()   # rollover adds tabs; keep title resolution fresh

def _month_tab(yyyy_mm):
    """Convert YYYY-MM to full month name for sheet tab lookup."""
    months = ['January','February','March','April','May','June',
              'July','August','September','October','November','December']
    try:
        return months[int(str(yyyy_mm).split('-')[1]) - 1]
    except Exception:
        return months[0]

# Month tabs are created by hand in the Sheet (duplicate last month, rename), so
# titles drift from the plain 'July' the code expects — 'July 2026', 'JULY ',
# 'Copy of June'. Sheets is the source of truth, so the app adapts to whatever
# the tab is actually called instead of 400ing with "Unable to parse range".
_TAB_TITLE_CACHE = {}    # spreadsheet_id -> (monotonic_ts, [titles])
_TAB_TITLE_TTL   = 300   # seconds; tabs are renamed rarely, reads happen constantly

def _sheet_tab_titles(svc, spreadsheet_id):
    hit = _TAB_TITLE_CACHE.get(spreadsheet_id)
    if hit and (time.monotonic() - hit[0]) < _TAB_TITLE_TTL:
        return hit[1]
    meta = svc.spreadsheets().get(
        spreadsheetId=spreadsheet_id, fields='sheets.properties.title'
    ).execute()
    titles = [s['properties']['title'] for s in meta.get('sheets', [])]
    _TAB_TITLE_CACHE[spreadsheet_id] = (time.monotonic(), titles)
    return titles

def _resolve_month_tab(svc, yyyy_mm, spreadsheet_id=None):
    """Map YYYY-MM to the tab title that actually exists in the finance Sheet.
    Falls back to the plain month name (old behavior) if metadata can't be read,
    and logs the real tab list when nothing matches so the failure is diagnosable
    from Cloud Run logs."""
    sid = spreadsheet_id or FINANCE_SHEET_ID
    want = _month_tab(yyyy_mm)
    try:
        titles = _sheet_tab_titles(svc, sid)
    except Exception as e:
        app.logger.warning("Could not list tabs for sheet %s: %s", sid, e)
        return want
    def _norm(s):
        return ''.join(str(s).lower().split())
    for t in titles:                                  # 'JULY ', 'july'
        if _norm(t) == _norm(want):
            return t
    contains = [t for t in titles if want.lower() in t.lower()]
    if not contains:                                  # 'Jul 26', 'Jul-2026'
        import re
        abbrev = want[:3].lower()
        contains = [t for t in titles
                    if re.search(r'(^|[^a-z])' + abbrev + r'([^a-z]|$)', t.lower())]
    if contains:                                      # prefer 'July 2026' for 2026-07
        year = str(yyyy_mm)[:4]
        with_year = [t for t in contains if year in t or year[2:] in t]
        return min(with_year or contains, key=len)
    app.logger.warning("No tab matching '%s' in sheet %s; tabs are: %s",
                       want, sid, titles)
    return want

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
        # Col A label wins; else the description only when it canon-maps to a
        # known category (Netflix → Subscriptions); else the section's carried
        # label — so merchant-named rows written into Utilities/Subscriptions still
        # count toward their section's bar instead of a phantom category.
        desc_val = row[1].strip() if len(row) > 1 else ''
        canon = _budget_row_canon(cat_val, desc_val, current_cat)
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

    # The bars' 'actual' for the detail-table categories (Gas/Fun/Groceries/
    # Dining and Drinks) historically came from formula cells in the budget
    # section that sum each detail table. Hand-restructured tabs drop those
    # formulas, leaving the bars empty even though the transactions are right
    # there in the tables — so compute each table's actual directly and take
    # the larger of the two (they're equal when the formula is intact).
    for det_cat in DETAIL_TABLE_KEYWORDS:
        table_actual = _detail_table_actual(rows, det_cat)
        if table_actual <= 0:
            continue
        entry = cat_data.setdefault(det_cat, {'budgeted': 0.0, 'actual': 0.0})
        entry['actual'] = max(entry['actual'], table_actual)

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
    'Gas':               ['gas total', 'gas totals'],
    'Fun':               ['fun total', 'fun totals'],
    'Groceries':         ['groceries total', 'grocery trip', 'grocery'],
    'Dining and Drinks': ['dining and drinks total', 'dining & drinks total', 'dining total'],
}
BUDGET_TRANSACTION_CATEGORIES = {'Utilities', 'Subscriptions'}
FINANCE_CATEGORY_NAMES = {
    'Utilities', 'Subscriptions', 'Groceries', 'Dining and Drinks', 'Fun',
    'Gas', 'Shopping', 'Band', 'Loans', 'Other',
}

# Canonical budget category map. Lookup is lowercase, exact-match first then substring.
# Mirrors normFinCat in modules.jsx but adds common utility/subscription sub-names so
# every line item collapses to one parent bar.
_CANON_CAT_EXACT = {
    'housing': 'Utilities', 'rent': 'Utilities', 'mortgage': 'Utilities',
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
    'google cloud': 'Subscriptions', 'rocket money': 'Subscriptions',
    'minecraft': 'Subscriptions', 'minecraft realms': 'Subscriptions', 'realms': 'Subscriptions',
    'planet fitness': 'Subscriptions', 'audible': 'Subscriptions',
    'cox': 'Utilities',
    'food': 'Groceries', 'food / grocery': 'Groceries', 'food / grocer': 'Groceries',
    'food/grocery': 'Groceries', 'food/grocer': 'Groceries',
    'grocer': 'Groceries', 'groceries': 'Groceries', 'grocery': 'Groceries',
    'fun': 'Fun', 'entertainment': 'Fun',
    'dining': 'Dining and Drinks', 'restaurants': 'Dining and Drinks',
    'dining & drinks': 'Dining and Drinks', 'dining and drinks': 'Dining and Drinks',
    'drinks': 'Dining and Drinks',
    'gas': 'Gas', 'fuel': 'Gas', 'transportation': 'Gas', 'transport': 'Gas', 'auto': 'Gas',
    'shopping': 'Shopping',
    'band': 'Band',
    'loans': 'Loans', 'loan': 'Loans',
}
_CANON_SUBSTR = [
    ('netflix', 'Subscriptions'), ('hulu', 'Subscriptions'), ('spotify', 'Subscriptions'),
    ('disney', 'Subscriptions'), ('prime', 'Subscriptions'), ('youtube', 'Subscriptions'),
    ('apple', 'Subscriptions'), ('hbo', 'Subscriptions'),
    ('google cloud', 'Subscriptions'), ('rocket money', 'Subscriptions'),
    ('minecraft', 'Subscriptions'), ('realms', 'Subscriptions'),
    ('planet fitness', 'Subscriptions'), ('audible', 'Subscriptions'),
    ('cox', 'Utilities'),
    ('internet', 'Utilities'), ('electric', 'Utilities'), ('water', 'Utilities'),
    ('cable', 'Utilities'), ('power', 'Utilities'), ('sewer', 'Utilities'),
    ('trash', 'Utilities'), ('phone', 'Utilities'),
    ('renters insurance', 'Utilities'), ('rent', 'Utilities'), ('mortgage', 'Utilities'),
    ('grocery', 'Groceries'), ('grocer', 'Groceries'),
    ('dining', 'Dining and Drinks'),
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

def _budget_row_canon(cat_val, desc_val, current_cat):
    """Attribute a budget-section row to a canonical category.
    Col A label wins; else the description, but only when it canon-maps to a
    known category (e.g. 'Netflix' → Subscriptions) — a merchant name like
    'Greystar' must NOT shadow the section the row sits in; else fall back to
    the carried-forward section label."""
    if cat_val:
        return _canon_cat(cat_val)
    if desc_val:
        desc_canon = _canon_cat(desc_val)
        if desc_canon in FINANCE_CATEGORY_NAMES:
            return desc_canon
    return _canon_cat(current_cat)

def _canonical_finance_category(raw):
    key = str(raw or "").strip()
    aliases = {
        'auto': 'Gas',
        'dining': 'Dining and Drinks',
        'dining & drinks': 'Dining and Drinks',
        'dining and drinks': 'Dining and Drinks',
        'drinks': 'Dining and Drinks',
        'electric': 'Utilities',
        'electricity': 'Utilities',
        'entertainment': 'Fun',
        'food': 'Groceries',
        'food / grocery': 'Groceries',
        'food / grocer': 'Groceries',
        'food/grocery': 'Groceries',
        'food/grocer': 'Groceries',
        'fuel': 'Gas',
        'fun': 'Fun',
        'gas': 'Gas',
        'groceries': 'Groceries',
        'grocery': 'Groceries',
        'grocer': 'Groceries',
        'housing': 'Utilities',
        'internet': 'Utilities',
        'mortgage': 'Utilities',
        'phone': 'Utilities',
        'rent': 'Utilities',
        'restaurants': 'Dining and Drinks',
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

def _detail_table_actual(rows, category):
    """Sum the amount column of a category's detail table, walking rows exactly
    like _parse_transaction_rows (data starts two rows below the header, stop at
    the Total row or after 5 consecutive blank rows)."""
    pos = _find_detail_table(rows, category)
    if not pos:
        return 0.0
    header_row, header_col = pos
    total, blanks = 0.0, 0
    for ri in range(header_row + 2, len(rows)):
        row = rows[ri]
        cell1 = str(row[header_col]).strip()     if len(row) > header_col     else ''
        cell2 = str(row[header_col + 1]).strip() if len(row) > header_col + 1 else ''
        if 'total' in (cell1 + cell2).lower():
            break
        if not cell1 and not cell2:
            blanks += 1
            if blanks >= 5:
                break
            continue
        blanks = 0
        amt = _parse_money(cell2)
        if amt > 0:
            total += amt
    return round(total, 2)

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

def _sheets_execute(req, attempts=4):
    """Execute a Sheets API request, retrying with backoff on 429 rate-limit errors
    (per-user read/write quotas are 60/min — bulk imports can exceed them)."""
    import time
    for i in range(attempts):
        try:
            return req.execute()
        except Exception as e:
            msg = str(e)
            if i == attempts - 1 or ('429' not in msg and 'RATE_LIMIT' not in msg.upper()):
                raise
            time.sleep(min(60, 15 * (i + 1)))

def _set_cell(rows, r, c, val):
    """Update an in-memory copy of sheet rows after a successful write so bulk
    imports can find the next empty row without re-reading the tab."""
    while len(rows) <= r:
        rows.append([])
    row = rows[r]
    while len(row) <= c:
        row.append('')
    row[c] = val

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
    col1 = desc if cat in ('Fun', 'Dining and Drinks') else _format_short_date(date)
    a1 = f"'{tab}'!{_col_letter(header_col)}{target_row + 1}:{_col_letter(header_col + 1)}{target_row + 1}"
    _sheets_execute(svc.spreadsheets().values().update(
        spreadsheetId=spreadsheet_id, range=a1,
        valueInputOption='USER_ENTERED',
        body={'values': [[col1, amt]]}
    ))
    _set_cell(rows, target_row, header_col, col1)
    _set_cell(rows, target_row, header_col + 1, amt)
    return target_row, header_col

def _write_budget_transaction(svc, spreadsheet_id, tab, rows, cat, desc, amt):
    target_row, section_start, section_end = _find_budget_section_slot(rows, cat)
    if target_row is None:
        if section_end is None:
            return None  # section doesn't exist in this tab at all
        # Section exists but is full: insert a fresh row *inside* it (before the
        # last entry) so SUM/total ranges below auto-expand, then write there.
        sheet_id = _sheet_id_by_name(svc, spreadsheet_id, tab)
        if sheet_id is None:
            return None
        _sheets_execute(svc.spreadsheets().batchUpdate(
            spreadsheetId=spreadsheet_id,
            body={'requests': [{'insertDimension': {
                'range': {'sheetId': sheet_id, 'dimension': 'ROWS',
                          'startIndex': section_end, 'endIndex': section_end + 1},
                'inheritFromBefore': True
            }}]}
        ))
        rows.insert(section_end, [])
        target_row = section_end
    _, desc_col, _, actual_col = _finance_budget_columns(rows)
    data = [
        {'range': f"'{tab}'!{_col_letter(desc_col)}{target_row + 1}", 'values': [[desc or cat]]},
        {'range': f"'{tab}'!{_col_letter(actual_col)}{target_row + 1}", 'values': [[amt]]},
    ]
    # Stamp the category in col A like the rows Parker keeps by hand. That's what marks
    # the row as a real line item rather than leftover import output, so the reconciling
    # sync updates it next time instead of clearing it (see _budget_section_scan).
    cur_a = str(rows[target_row][0]).strip() if target_row < len(rows) and rows[target_row] else ''
    if not cur_a:
        data.append({'range': f"'{tab}'!A{target_row + 1}", 'values': [[cat]]})
    _sheets_execute(svc.spreadsheets().values().batchUpdate(
        spreadsheetId=spreadsheet_id,
        body={'valueInputOption': 'USER_ENTERED', 'data': data}
    ))
    _set_cell(rows, target_row, desc_col, desc or cat)
    _set_cell(rows, target_row, actual_col, amt)
    if not cur_a:
        _set_cell(rows, target_row, 0, cat)
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
        allowed = ", ".join(["Utilities", "Subscriptions", "Groceries", "Dining and Drinks", "Fun", "Gas"])
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
    """Clear the variable transaction rows (Gas/Fun/Groceries/Dining and Drinks) in a month tab while
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

def _find_budget_section_slot(rows, canon_target):
    """Locate the budget-tracker section matching canon_target.
    Returns (blank_row, section_start, section_end), all 0-based row indexes.
    blank_row is the first empty row inside the section, or None if the section
    is full. section_start/section_end are None when the section isn't found."""
    if not rows:
        return None, None, None
    max_cols = max((len(r) for r in rows), default=1)
    padded = [r + [''] * (max_cols - len(r)) for r in rows]

    hdr_row_idx = 0
    for i, row in enumerate(padded[:5]):
        rl = ' '.join(str(c) for c in row).lower()
        if 'budget' in rl or 'actual amount' in rl:
            hdr_row_idx = i
            break

    section_start = None
    section_end = None
    current_cat = ''
    for ri in range(hdr_row_idx + 1, len(padded)):
        row = padded[ri]
        rl = ' '.join(str(c) for c in row[:8]).lower()
        if any(kw in rl for kw in ['anticipated', 'actual total', 'roommate', 'savings total']):
            break
        cat_val = row[0].strip() if len(row) > 0 else ''
        desc_val = row[1].strip() if len(row) > 1 else ''
        if cat_val and not any(ch.isdigit() for ch in cat_val):
            current_cat = cat_val
        row_canon = _budget_row_canon(cat_val, desc_val, current_cat)
        if row_canon == canon_target:
            if section_start is None:
                section_start = ri
            section_end = ri
            if not desc_val and not cat_val:
                return ri, section_start, section_end
        elif section_start is not None:
            break
    return None, section_start, section_end

def _find_budget_section_next_row(rows, canon_target):
    """First blank row inside the budget section, or None (back-compat wrapper)."""
    return _find_budget_section_slot(rows, canon_target)[0]

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
        row_canon = _budget_row_canon(cat_val, desc_val, current_cat)
        if row_canon == 'Subscriptions':
            if section_start is None:
                section_start = ri
            dv = desc_val.strip().lower()
            # Exact first, then containment either way — the Drive import writes
            # Rocket Money merchant names ('Hulu Disney Bundle') that rarely equal
            # the list's name ('Hulu') exactly.
            if dv and (dv == target or target in dv or dv in target):
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
        canon = _budget_row_canon(cat_val, desc_val, current_cat)
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
    """Parse individual transactions from detail tables and Utilities/Subscriptions budget rows.
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
            "http://localhost:5000/api/auth/google/callback",
            "https://mission-control-568559213462.us-central1.run.app/api/drive/callback",
            "https://mission-control-568559213462.us-central1.run.app/api/auth/google/callback",
        ],
    }
    if GOOGLE_OAUTH_PROJECT_ID:
        web["project_id"] = GOOGLE_OAUTH_PROJECT_ID
    return {"web": web}

def _has_google_oauth_client():
    return GOOGLE_CREDS_FILE.exists() or _google_oauth_client_config() is not None

def _oauth_flow(scopes, redirect_uri):
    from google_auth_oauthlib.flow import Flow
    if GOOGLE_CREDS_FILE.exists():
        return Flow.from_client_secrets_file(str(GOOGLE_CREDS_FILE), scopes=scopes, redirect_uri=redirect_uri)
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

def _drive_files_service():
    """Google Drive v3 client for listing/downloading files in a folder, using the same
    OAuth token as _gdrive_service (the Drive scope is already granted via GDRIVE_SCOPES)."""
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
    return build('drive', 'v3', credentials=creds), None

def _drive_newest_csv(folder_id):
    """Return (raw_bytes, filename) for the most-recently-modified .csv in the given Drive
    folder, or (None, err_message). Uploaded CSVs keep mimeType text/csv; a CSV that was
    converted to a Google Sheet (application/vnd.google-apps.spreadsheet) is skipped."""
    svc, err = _drive_files_service()
    if err:
        return None, f"Drive not connected: {err}"
    try:
        import io as _io
        from googleapiclient.http import MediaIoBaseDownload
        resp = svc.files().list(
            q=f"'{folder_id}' in parents and trashed=false",
            orderBy="modifiedTime desc", pageSize=50,
            fields="files(id,name,mimeType,modifiedTime)",
            supportsAllDrives=True, includeItemsFromAllDrives=True,
        ).execute()
        files = resp.get("files", [])
        csv_file = next((f for f in files
                         if f.get("name", "").lower().endswith(".csv") or f.get("mimeType") == "text/csv"), None)
        if not csv_file:
            return None, "No .csv file found in that Drive folder"
        buf = _io.BytesIO()
        downloader = MediaIoBaseDownload(buf, svc.files().get_media(fileId=csv_file["id"]))
        done = False
        while not done:
            _, done = downloader.next_chunk()
        return buf.getvalue(), csv_file["name"]
    except Exception as e:
        return None, str(e)

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
    GOOGLE_CREDS_FILE.write_text(content)
    GDRIVE_TOKEN_FILE.unlink(missing_ok=True)
    return jsonify({"ok": True})

@app.route("/api/drive/status")
def drive_status():
    cfg = _load(GDRIVE_CONFIG_FILE, {})
    base = {"sheet_finance": cfg.get("sheet_finance", ""), "sheet_contacts": cfg.get("sheet_contacts", ""),
            "finance_import_folder": cfg.get("finance_import_folder", "") or FINANCE_IMPORT_FOLDER}
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
    if "finance_import_folder" in d:
        cfg["finance_import_folder"] = _extract_drive_folder_id(d["finance_import_folder"])
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
        # Reuse the module-level Anthropic client instead of constructing a new
        # one (and a new HTTPS connection pool) on every brief request.
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
