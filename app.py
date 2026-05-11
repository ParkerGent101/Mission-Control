import os
os.environ.setdefault("GIT_PYTHON_REFRESH", "quiet")
if os.name == "nt":
    os.environ.setdefault("GIT_PYTHON_GIT_EXECUTABLE", r"C:\Program Files\Git\cmd\git.exe")
os.environ.setdefault("OAUTHLIB_INSECURE_TRANSPORT", "1")

from datetime import datetime, timedelta
from pathlib import Path
import json
import sys

from dotenv import load_dotenv
from flask import Flask, jsonify, render_template, request, session, redirect
import anthropic
import git

load_dotenv()

app = Flask(__name__)
app.secret_key = os.environ.get("FLASK_SECRET", "mc-change-this-secret-key-2026")
app.config["PERMANENT_SESSION_LIFETIME"] = timedelta(days=30)

DASHBOARD_PASSWORD = os.environ.get("DASHBOARD_PASSWORD", "aces2026")

BAND_DIR    = Path(os.environ.get("BAND_DIR", "C:/Users/Parker/projects/coming-up-aces"))
DATA_DIR    = Path(os.environ.get("DATA_DIR", str(Path(__file__).parent / "data")))
DATA_DIR.mkdir(exist_ok=True)

SHOWS_FILE    = BAND_DIR / "shows.json" if BAND_DIR.exists() else DATA_DIR / "shows.json"
VIDEOS_FILE   = BAND_DIR / "videos.json" if BAND_DIR.exists() else DATA_DIR / "videos.json"
FINANCE_FILE  = DATA_DIR / "finances.json"
TASKS_FILE    = DATA_DIR / "tasks.json"
REMINDERS_FILE = DATA_DIR / "reminders.json"
SAVINGS_FILE  = DATA_DIR / "savings.json"
CONTENT_FILE  = DATA_DIR / "band_content.json"
AGENDA_FILE   = DATA_DIR / "agenda.json"
HEALTH_FILE   = DATA_DIR / "health.json"
WORK_FILE     = DATA_DIR / "work_tasks.json"
STUDY_FILE    = DATA_DIR / "study.json"
READING_FILE  = DATA_DIR / "reading.json"
GAMING_FILE   = DATA_DIR / "gaming.json"
HOLIDAYS_FILE = DATA_DIR / "holidays.json"
JOURNAL_FILE  = DATA_DIR / "journal.json"

GCAL_SCOPES    = ['https://www.googleapis.com/auth/calendar.readonly']
GCAL_CREDS_FILE = Path(__file__).parent / "credentials.json"
GCAL_TOKEN_FILE = Path(__file__).parent / "token.json"

def _load(path):
    p = Path(path)
    if not p.exists():
        p.write_text("[]")
    return json.loads(p.read_text(encoding="utf-8"))

def _save(path, data):
    Path(path).write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")

# ── Auth ───────────────────────────────────────────────────────────────────────

@app.before_request
def require_auth():
    public = ["/login", "/api/login", "/api/calendar/callback"]
    if request.path in public:
        return
    if not session.get("authenticated"):
        if request.path.startswith("/api/"):
            return jsonify({"error": "Unauthorized"}), 401
        return redirect("/login")

@app.route("/login")
def login_page():
    return render_template("login.html")

@app.route("/api/login", methods=["POST"])
def do_login():
    pw = (request.json or {}).get("password", "")
    if pw == DASHBOARD_PASSWORD:
        session.permanent = True
        session["authenticated"] = True
        return jsonify({"ok": True})
    return jsonify({"ok": False}), 401

@app.route("/api/logout", methods=["POST"])
def logout():
    session.clear()
    return jsonify({"ok": True})

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
    return f"Show added: {event} — {venue}, {city} on {date}"

def tool_remove_show(index: int):
    shows = _load(SHOWS_FILE)
    if 0 <= index < len(shows):
        removed = shows.pop(index)
        _save(SHOWS_FILE, shows)
        return f"Removed: {removed['event']} on {removed['date']}"
    return f"No show at index {index}."

def tool_add_video(title, url, date=""):
    videos = _load(VIDEOS_FILE)
    videos.append({"title": title, "url": url, "date": date or datetime.now().strftime("%Y-%m-%d")})
    _save(VIDEOS_FILE, videos)
    return f"Video added: {title}"

def tool_push_site(message="Update site content"):
    try:
        repo = git.Repo(BAND_DIR)
        repo.git.add(all=True)
        if not repo.is_dirty(untracked_files=True):
            return "Nothing new to push — site is already up to date."
        repo.index.commit(message)
        repo.git.push("origin", "main")
        return f"Pushed to GitHub: '{message}'. Site will update on comingupaces.net in ~2 min."
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

# ── Tool dispatch ──────────────────────────────────────────────────────────────

TOOL_MAP = {
    "list_shows":         lambda i: tool_list_shows(),
    "add_show":           lambda i: tool_add_show(**i),
    "remove_show":        lambda i: tool_remove_show(i["index"]),
    "add_video":          lambda i: tool_add_video(**i),
    "push_site":          lambda i: tool_push_site(i.get("message", "Update site content")),
    "list_reminders":     lambda i: tool_list_reminders(),
    "add_reminder":       lambda i: tool_add_reminder(**i),
    "snooze_reminder":    lambda i: tool_snooze_reminder(i["reminder_id"]),
    "add_task":           lambda i: tool_add_task(**i),
    "complete_task":      lambda i: tool_complete_task(i["task_id"]),
    "list_tasks":         lambda i: tool_list_tasks(i.get("role"), i.get("show_done", False)),
    "add_transaction":    lambda i: tool_add_transaction(**i),
    "financial_summary":  lambda i: tool_financial_summary(i.get("category")),
}

TOOLS = [
    {"name":"list_shows","description":"List all shows in the band website","input_schema":{"type":"object","properties":{}}},
    {"name":"add_show","description":"Add a show to the Coming Up Aces website","input_schema":{"type":"object","properties":{"date":{"type":"string","description":"YYYY-MM-DD"},"event":{"type":"string"},"venue":{"type":"string"},"city":{"type":"string","description":"City, State"},"tickets":{"type":"string"},"notes":{"type":"string"}},"required":["date","event","venue","city"]}},
    {"name":"remove_show","description":"Remove a show by index (list_shows first)","input_schema":{"type":"object","properties":{"index":{"type":"integer"}},"required":["index"]}},
    {"name":"add_video","description":"Add a YouTube or Google Drive video to the band site","input_schema":{"type":"object","properties":{"title":{"type":"string"},"url":{"type":"string"},"date":{"type":"string"}},"required":["title","url"]}},
    {"name":"push_site","description":"Git commit and push band site so it goes live on comingupaces.net","input_schema":{"type":"object","properties":{"message":{"type":"string"}}}},
    {"name":"list_reminders","description":"List all reminders with days until due","input_schema":{"type":"object","properties":{}}},
    {"name":"add_reminder","description":"Add a reminder — one-time or recurring","input_schema":{"type":"object","properties":{"title":{"type":"string"},"due_date":{"type":"string","description":"YYYY-MM-DD"},"category":{"type":"string","enum":["personal","IT","band","coding","learning","shopping"]},"reminder_type":{"type":"string","enum":["one-time","recurring"]},"interval_days":{"type":"integer","description":"Days between recurrences (recurring only)"},"notes":{"type":"string"}},"required":["title","due_date"]}},
    {"name":"snooze_reminder","description":"Mark a one-time reminder done, or advance a recurring one to next cycle","input_schema":{"type":"object","properties":{"reminder_id":{"type":"integer"}},"required":["reminder_id"]}},
    {"name":"add_task","description":"Add a task for any of Parker's roles","input_schema":{"type":"object","properties":{"title":{"type":"string"},"role":{"type":"string","enum":["band","IT","coding","personal","learning","shopping"]},"priority":{"type":"string","enum":["high","normal","low"]},"notes":{"type":"string"}},"required":["title","role"]}},
    {"name":"complete_task","description":"Mark a task done by ID","input_schema":{"type":"object","properties":{"task_id":{"type":"integer"}},"required":["task_id"]}},
    {"name":"list_tasks","description":"List open tasks, optionally filtered by role","input_schema":{"type":"object","properties":{"role":{"type":"string","enum":["band","IT","coding","personal","learning","shopping"]},"show_done":{"type":"boolean"}}}},
    {"name":"add_transaction","description":"Log income or expense","input_schema":{"type":"object","properties":{"description":{"type":"string"},"amount":{"type":"number"},"type_":{"type":"string","enum":["income","expense"]},"category":{"type":"string","enum":["band","IT","coding","personal"]},"date":{"type":"string"}},"required":["description","amount","type_","category"]}},
    {"name":"financial_summary","description":"Get financial summary by category","input_schema":{"type":"object","properties":{"category":{"type":"string","enum":["band","IT","coding","personal"]}}}},
]

SYSTEM_PROMPT = """You are Mission Control — Parker Gent's personal AI command center, running 24/7 on his machine.

PARKER'S PROFILE:
• IT Manager at Ground Level Services (GLS) — Azure, SharePoint, MDM, security, vendor mgmt, WIP reporting
• Band Manager & Lead Guitarist — Coming Up Aces (NWA classic rock: Nate Poplin vocals/rhythm, Parker lead guitar/keys/harmonica/backup vocals, Brandon Hargis bass, Riley Gent drums). Sound: Lynyrd Skynyrd + Tom Petty + grunge. Site: comingupaces.net
• Freelance Developer — building "aGent Security Consultancy" brand
• Learning: CISM + CRISC + MBA (for consulting practice), guitar solos, piano
• Personal: has a dog (flea medicine every 3 months), tracks gifts for friends/family, keeps personal reminders

URGENT RIGHT NOW (today is {today}):
• ASR policies audit→block due 2026-05-22
• Ian MFA on Rightworks — high priority IT

BEHAVIOR:
Act like a sharp chief of staff who knows everything. When Parker dumps notes, emails, or voice-to-text, extract every actionable item and log it without being asked. Be extremely concise. Take action immediately with tools — don't confirm first unless truly ambiguous.

When Parker says things like "learn X" → add_task (role: band or learning). "Buy X" → add_task (role: shopping). "Remind me X" → add_reminder. "Show Y at Z on date" → add_show. "Log $X from gig" → add_transaction. "Push the site" → push_site.

Surface upcoming reminders proactively. Warn about deadlines. Think ahead.""".format(today=datetime.now().strftime("%B %d, %Y"))

client = anthropic.Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY"))

def run_agent(messages):
    while True:
        response = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=2048,
            system=SYSTEM_PROMPT,
            tools=TOOLS,
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
    d = request.json
    return jsonify({"message": tool_add_show(d["date"], d["event"], d["venue"], d["city"], d.get("tickets",""), d.get("notes",""))})

@app.route("/api/shows/<int:idx>", methods=["DELETE"])
def delete_show(idx):
    return jsonify({"message": tool_remove_show(idx)})

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
    data = _load(FINANCE_FILE)
    month = request.args.get("month")
    if month:
        data = [t for t in data if t.get("date", "").startswith(month)]
    return jsonify(data)

@app.route("/api/finances", methods=["POST"])
def post_finance():
    d = request.json
    return jsonify({"message": tool_add_transaction(d["description"], d["amount"], d["type"], d["category"], d.get("date",""))})

@app.route("/api/finances/summary", methods=["GET"])
def finance_summary():
    return jsonify({"summary": tool_financial_summary()})

@app.route("/api/finances/months", methods=["GET"])
def finance_months():
    finances = _load(FINANCE_FILE)
    months = sorted({t["date"][:7] for t in finances if t.get("date")}, reverse=True)
    return jsonify(months)

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

# ── Band Content Queue ─────────────────────────────────────────────────────────

@app.route("/api/band/content", methods=["GET"])
def get_content():
    return jsonify(_load(CONTENT_FILE))

@app.route("/api/band/content", methods=["POST"])
def post_content():
    d = request.json
    content = _load(CONTENT_FILE)
    cid = max((c["id"] for c in content), default=0) + 1
    content.append({"id": cid, "title": d["title"], "status": "queued",
                    "created": datetime.now().strftime("%Y-%m-%d"), "notes": d.get("notes", "")})
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
        creds = Credentials.from_authorized_user_file(str(GCAL_TOKEN_FILE), GCAL_SCOPES)
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            from google.auth.transport.requests import Request as Req
            creds.refresh(Req())
            GCAL_TOKEN_FILE.write_text(creds.to_json())
        else:
            return None, "auth_required"
    return build('calendar', 'v3', credentials=creds), None

@app.route("/api/calendar/events")
def get_calendar_events():
    if not GCAL_CREDS_FILE.exists():
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
    if not GCAL_CREDS_FILE.exists():
        return jsonify({"error": "setup_required"})
    redirect_uri = request.host_url.rstrip('/') + '/api/calendar/callback'
    flow = Flow.from_client_secrets_file(str(GCAL_CREDS_FILE), scopes=GCAL_SCOPES, redirect_uri=redirect_uri)
    auth_url, state = flow.authorization_url(access_type='offline', prompt='consent')
    session['gcal_state'] = state
    return jsonify({"auth_url": auth_url})

@app.route("/api/calendar/callback")
def calendar_callback():
    try:
        from google_auth_oauthlib.flow import Flow
    except ImportError:
        return "google-auth-oauthlib not installed", 500
    redirect_uri = request.host_url.rstrip('/') + '/api/calendar/callback'
    flow = Flow.from_client_secrets_file(
        str(GCAL_CREDS_FILE), scopes=GCAL_SCOPES,
        state=session.get('gcal_state'), redirect_uri=redirect_uri
    )
    flow.fetch_token(authorization_response=request.url)
    GCAL_TOKEN_FILE.write_text(flow.credentials.to_json())
    return redirect('/')

# ── Talk (new UI card) ─────────────────────────────────────────────────────────

@app.route("/api/talk", methods=["POST"])
def talk():
    data = request.json
    text = data.get("text", "")
    messages = [{"role": "user", "content": text}]
    try:
        reply, _ = run_agent(messages)
        return jsonify({"reply": reply})
    except Exception as e:
        return jsonify({"reply": f"Error: {e}"}), 500

# ── Agenda ─────────────────────────────────────────────────────────────────────

@app.route("/api/agenda", methods=["GET"])
def get_agenda():
    return jsonify(_load(AGENDA_FILE))

@app.route("/api/agenda", methods=["POST"])
def post_agenda():
    d = request.json
    items = _load(AGENDA_FILE)
    aid = max((a["id"] for a in items), default=0) + 1
    items.append({
        "id": aid, "time": d.get("time", ""), "label": d.get("label", ""),
        "tag": d.get("tag", ""), "done": False,
        "date": d.get("date", datetime.now().strftime("%Y-%m-%d"))
    })
    _save(AGENDA_FILE, items)
    return jsonify({"id": aid})

@app.route("/api/agenda/<int:aid>/toggle", methods=["POST"])
def toggle_agenda(aid):
    items = _load(AGENDA_FILE)
    for item in items:
        if item["id"] == aid:
            item["done"] = not item.get("done", False)
            _save(AGENDA_FILE, items)
            return jsonify({"done": item["done"]})
    return jsonify({"error": "not found"}), 404

# ── Health ─────────────────────────────────────────────────────────────────────

@app.route("/api/health", methods=["GET"])
def get_health():
    return jsonify(_load(HEALTH_FILE))

@app.route("/api/health/habit", methods=["POST"])
def post_health_habit():
    d = request.json
    health = _load(HEALTH_FILE)
    date = d.get("date", datetime.now().strftime("%Y-%m-%d"))
    if "habits" not in health:
        health = {"habits": {}, "weight": {}, "calories": {}}
    habits = health.setdefault("habits", {})
    day = habits.setdefault(date, {})
    day[d["habit"]] = d.get("done", True)
    _save(HEALTH_FILE, health)
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
    return jsonify({"ok": True})

# ── Work ───────────────────────────────────────────────────────────────────────

@app.route("/api/work", methods=["GET"])
def get_work():
    return jsonify(_load(WORK_FILE))

@app.route("/api/work", methods=["POST"])
def post_work():
    d = request.json
    items = _load(WORK_FILE)
    wid = max((w["id"] for w in items), default=0) + 1
    items.append({
        "id": wid, "title": d.get("title", ""), "project": d.get("project", ""),
        "priority": d.get("priority", "normal"), "done": False,
        "created": datetime.now().strftime("%Y-%m-%d")
    })
    _save(WORK_FILE, items)
    return jsonify({"id": wid})

@app.route("/api/work/<int:wid>/done", methods=["POST"])
def done_work(wid):
    items = _load(WORK_FILE)
    for item in items:
        if item["id"] == wid:
            item["done"] = True
            _save(WORK_FILE, items)
            return jsonify({"ok": True})
    return jsonify({"error": "not found"}), 404

# ── Study ──────────────────────────────────────────────────────────────────────

@app.route("/api/study", methods=["GET"])
def get_study():
    return jsonify(_load(STUDY_FILE))

@app.route("/api/study/domain/<int:did>", methods=["POST"])
def post_study_domain(did):
    d = request.json
    study = _load(STUDY_FILE)
    for domain in study.get("domains", []):
        if domain["id"] == did:
            domain.update({k: v for k, v in d.items() if k != "id"})
            _save(STUDY_FILE, study)
            return jsonify({"ok": True})
    return jsonify({"error": "not found"}), 404

@app.route("/api/study/session", methods=["POST"])
def post_study_session():
    d = request.json
    study = _load(STUDY_FILE)
    sessions = study.setdefault("sessions", [])
    sessions.append({
        "date": d.get("date", datetime.now().strftime("%Y-%m-%d")),
        "minutes": d.get("minutes", 0),
        "topic": d.get("topic", "")
    })
    study["total_hours"] = round(sum(s.get("minutes", 0) for s in sessions) / 60, 1)
    _save(STUDY_FILE, study)
    return jsonify({"ok": True})

# ── Reading ────────────────────────────────────────────────────────────────────

@app.route("/api/reading", methods=["GET"])
def get_reading():
    return jsonify(_load(READING_FILE))

@app.route("/api/reading/progress", methods=["POST"])
def post_reading_progress():
    d = request.json
    reading = _load(READING_FILE)
    for book in reading:
        if book["id"] == d.get("id"):
            book["current_page"] = d.get("page", book.get("current_page", 0))
            book["last_read"] = datetime.now().strftime("%Y-%m-%d")
            _save(READING_FILE, reading)
            return jsonify({"ok": True})
    return jsonify({"error": "not found"}), 404

# ── Gaming ─────────────────────────────────────────────────────────────────────

@app.route("/api/gaming", methods=["GET"])
def get_gaming():
    return jsonify(_load(GAMING_FILE))

@app.route("/api/gaming/backlog", methods=["POST"])
def post_gaming_backlog():
    d = request.json
    gaming = _load(GAMING_FILE)
    if not isinstance(gaming, dict):
        gaming = {"current": [], "backlog": [], "completed": []}
    backlog = gaming.setdefault("backlog", [])
    bid = max((b.get("id", 0) for b in backlog), default=0) + 1
    backlog.append({"id": bid, "title": d.get("title", ""), "platform": d.get("platform", ""), "added": datetime.now().strftime("%Y-%m-%d")})
    _save(GAMING_FILE, gaming)
    return jsonify({"id": bid})

# ── Holidays ───────────────────────────────────────────────────────────────────

@app.route("/api/holidays", methods=["GET"])
def get_holidays():
    return jsonify(_load(HOLIDAYS_FILE))

@app.route("/api/holidays", methods=["POST"])
def post_holiday():
    d = request.json
    holidays = _load(HOLIDAYS_FILE)
    if not isinstance(holidays, dict):
        holidays = {"trips": []}
    trips = holidays.setdefault("trips", [])
    tid = max((t.get("id", 0) for t in trips), default=0) + 1
    trips.append({
        "id": tid, "destination": d.get("destination", ""),
        "dates": d.get("dates", ""), "checklist": d.get("checklist", [])
    })
    _save(HOLIDAYS_FILE, holidays)
    return jsonify({"id": tid})

@app.route("/api/holidays/<int:tid>/checklist/<int:idx>", methods=["POST"])
def toggle_holiday_checklist(tid, idx):
    holidays = _load(HOLIDAYS_FILE)
    if not isinstance(holidays, dict):
        return jsonify({"error": "not found"}), 404
    for trip in holidays.get("trips", []):
        if trip["id"] == tid:
            cl = trip.get("checklist", [])
            if 0 <= idx < len(cl):
                if isinstance(cl[idx], dict):
                    cl[idx]["done"] = not cl[idx].get("done", False)
                else:
                    cl[idx] = {"label": cl[idx], "done": True}
            _save(HOLIDAYS_FILE, holidays)
            return jsonify({"ok": True})
    return jsonify({"error": "not found"}), 404

# ── Journal ────────────────────────────────────────────────────────────────────

@app.route("/api/journal", methods=["GET"])
def get_journal():
    return jsonify(_load(JOURNAL_FILE))

@app.route("/api/journal", methods=["POST"])
def post_journal():
    d = request.json
    entries = _load(JOURNAL_FILE)
    date = d.get("date", datetime.now().strftime("%Y-%m-%d"))
    existing = next((e for e in entries if e["date"] == date), None)
    if existing:
        existing["body"] = d.get("body", "")
        existing["updated"] = datetime.now().isoformat()
    else:
        entries.append({
            "date": date, "body": d.get("body", ""),
            "mood": d.get("mood", ""), "created": datetime.now().isoformat()
        })
    _save(JOURNAL_FILE, entries)
    return jsonify({"ok": True})

if __name__ == "__main__":
    if not os.environ.get("ANTHROPIC_API_KEY"):
        print("ERROR: Set ANTHROPIC_API_KEY in .env")
        sys.exit(1)
    port = int(os.environ.get("PORT", 5000))
    print(f"Mission Control → http://localhost:{port}")
    app.run(debug=False, port=port, host="0.0.0.0")
