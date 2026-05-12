import os
os.environ.setdefault("GIT_PYTHON_REFRESH", "quiet")
if os.name == "nt":
    os.environ.setdefault("GIT_PYTHON_GIT_EXECUTABLE", r"C:\Program Files\Git\cmd\git.exe")
os.environ.setdefault("OAUTHLIB_INSECURE_TRANSPORT", "1")

from contextlib import contextmanager
from datetime import datetime, timedelta
from pathlib import Path
import json
import sqlite3
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

SHOWS_FILE       = BAND_DIR / "shows.json" if BAND_DIR.exists() else DATA_DIR / "shows.json"
VIDEOS_FILE      = BAND_DIR / "videos.json" if BAND_DIR.exists() else DATA_DIR / "videos.json"
FINANCE_FILE     = DATA_DIR / "finances.json"
SUBS_FILE        = DATA_DIR / "subscriptions.json"
TASKS_FILE       = DATA_DIR / "tasks.json"
REMINDERS_FILE   = DATA_DIR / "reminders.json"
SAVINGS_FILE     = DATA_DIR / "savings.json"
CONTENT_FILE     = DATA_DIR / "band_content.json"
BAND_CONTACTS_FILE = DATA_DIR / "band_contacts.json"
AGENDA_FILE      = DATA_DIR / "agenda.json"
HEALTH_FILE      = DATA_DIR / "health.json"
WORK_FILE        = DATA_DIR / "work_tasks.json"
STUDY_FILE       = DATA_DIR / "study.json"
READING_FILE     = DATA_DIR / "reading.json"
GAMING_FILE      = DATA_DIR / "gaming.json"
HOLIDAYS_FILE    = DATA_DIR / "holidays.json"
JOURNAL_FILE     = DATA_DIR / "journal.json"
BRIEF_FILE       = DATA_DIR / "brief.json"
DB_PATH          = DATA_DIR / "mission_control.db"

GCAL_SCOPES    = ['https://www.googleapis.com/auth/calendar.readonly']
GCAL_CREDS_FILE = Path(__file__).parent / "credentials.json"
GCAL_TOKEN_FILE = Path(__file__).parent / "token.json"

def _load(path, default=None):
    p = Path(path)
    if not p.exists():
        init = json.dumps(default) if default is not None else "[]"
        p.write_text(init, encoding="utf-8")
    try:
        return json.loads(p.read_text(encoding="utf-8-sig"))
    except Exception:
        return default if default is not None else []

def _save(path, data):
    Path(path).write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")

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

# ── Agenda tools ──────────────────────────────────────────────────────────────

def tool_add_agenda_item(label, time="09:00", tag="Personal", date=""):
    items = _load(AGENDA_FILE)
    aid = max((a["id"] for a in items), default=0) + 1
    items.append({"id": aid, "time": time, "label": label, "tag": tag, "done": False,
                  "date": date or datetime.now().strftime("%Y-%m-%d")})
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

# ── Reading tools ──────────────────────────────────────────────────────────────

def tool_log_reading_page(page):
    reading = _load(READING_FILE)
    if not isinstance(reading, dict) or not reading.get("current"):
        return "No current book to update."
    reading["current"]["page"] = int(page)
    reading["current"]["last_read"] = datetime.now().strftime("%Y-%m-%d")
    _save(READING_FILE, reading)
    title = reading["current"].get("title", "current book")
    total = reading["current"].get("total_pages", 0)
    pct = round((int(page) / total) * 100) if total else 0
    return f"Reading updated: {title} → p.{page}/{total} ({pct}%)"

# ── Study tools ────────────────────────────────────────────────────────────────

def tool_log_study_session(minutes, topic="", date=""):
    study = _load(STUDY_FILE)
    if not isinstance(study, dict):
        study = {}
    sessions = study.setdefault("sessions", [])
    sessions.append({"date": date or datetime.now().strftime("%Y-%m-%d"), "minutes": int(minutes), "topic": topic})
    study["total_hours"] = round(sum(s.get("minutes", 0) for s in sessions) / 60, 1)
    _save(STUDY_FILE, study)
    cert = study.get("cert", "CISM")
    return f"Study: {minutes}min{f' — {topic}' if topic else ''}. {cert} total: {study['total_hours']}h"

def tool_log_practice_score(score):
    study = _load(STUDY_FILE)
    if not isinstance(study, dict):
        study = {}
    study.setdefault("practice_scores", []).append(int(score))
    _save(STUDY_FILE, study)
    return f"Practice score {score}% logged"

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

# ── Journal tools ──────────────────────────────────────────────────────────────

def tool_add_journal_entry(body, date=""):
    entries = _load(JOURNAL_FILE)
    eid = max((e.get("id", 0) for e in entries), default=0) + 1
    entries.append({"id": eid, "date": date or datetime.now().strftime("%Y-%m-%d"), "body": body})
    _save(JOURNAL_FILE, entries)
    return f"Journal entry saved ({len(body.split())} words)"

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
    "log_reading_page":     lambda i: tool_log_reading_page(i["page"]),
    "log_study_session":    lambda i: tool_log_study_session(i["minutes"], i.get("topic",""), i.get("date","")),
    "log_practice_score":   lambda i: tool_log_practice_score(i["score"]),
    "log_weight":           lambda i: tool_log_weight(i["weight"], i.get("date","")),
    "log_calories":         lambda i: tool_log_calories(i["consumed"], i.get("burned",0), i.get("date","")),
    "add_journal_entry":    lambda i: tool_add_journal_entry(i["body"], i.get("date","")),
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
    {"name":"log_reading_page","description":"Update current book page number","input_schema":{"type":"object","properties":{"page":{"type":"integer"}},"required":["page"]}},
    {"name":"log_study_session","description":"Log a CISM study session","input_schema":{"type":"object","properties":{"minutes":{"type":"integer"},"topic":{"type":"string"},"date":{"type":"string"}},"required":["minutes"]}},
    {"name":"log_practice_score","description":"Log a CISM practice test score (0-100)","input_schema":{"type":"object","properties":{"score":{"type":"integer"}},"required":["score"]}},
    {"name":"log_weight","description":"Log today's weight in lbs","input_schema":{"type":"object","properties":{"weight":{"type":"number"},"date":{"type":"string"}},"required":["weight"]}},
    {"name":"log_calories","description":"Log calories consumed and/or burned","input_schema":{"type":"object","properties":{"consumed":{"type":"integer"},"burned":{"type":"integer"},"date":{"type":"string"}},"required":["consumed"]}},
    {"name":"add_journal_entry","description":"Save a journal entry","input_schema":{"type":"object","properties":{"body":{"type":"string"},"date":{"type":"string"}},"required":["body"]}},
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
• "read page X" / "on page X" → log_reading_page
• "studied Xmin" / "X minutes on CISM" → log_study_session
• "practice test X%" → log_practice_score
• "weigh Xlb" / "weight is X" → log_weight
• "ate X cal" / "burned X cal" → log_calories
• "journal:" / "note to self:" → add_journal_entry
• "GLS task:" / "work task:" / "code task:" → add_work_task

RESPONSE FORMAT — always reply with ONLY this JSON (no markdown, no extra text):
{{"module":"agenda|finance|band|health|work|study|reading|holidays|journal|none","action":"added|logged|updated|scheduled|found|noted","summary":"one-line description of what was done","reply":"brief conversational reply (1-2 sentences max)"}}""".format(today=datetime.now().strftime("%B %d, %Y"))

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
    result = tool_add_transaction(d["description"], d["amount"], d["type"], d["category"], d.get("date",""))
    _log("finance", d.get("type","expense"), f"${d['amount']} — {d['description']}", d.get("category",""))
    return jsonify({"message": result})

@app.route("/api/finances/<int:tid>", methods=["DELETE"])
def delete_finance(tid):
    finances = _load(FINANCE_FILE)
    finances = [t for t in finances if t.get("id") != tid]
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
    subs = _load(SUBS_FILE)
    sid = max((s["id"] for s in subs), default=0) + 1
    subs.append({"id": sid, "name": d.get("name",""), "acct": d.get("acct",""), "amt": float(d.get("amt",0)), "due": d.get("due","")})
    _save(SUBS_FILE, subs)
    return jsonify({"id": sid})

@app.route("/api/finances/subscriptions/<int:sid>", methods=["DELETE"])
def delete_subscription(sid):
    subs = _load(SUBS_FILE)
    subs = [s for s in subs if s["id"] != sid]
    _save(SUBS_FILE, subs)
    return jsonify({"ok": True})

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
    return jsonify({"id": cid})

@app.route("/api/band/contacts/<int:cid>", methods=["PUT"])
def update_band_contact(cid):
    d = request.json
    contacts = _load(BAND_CONTACTS_FILE)
    for c in contacts:
        if c["id"] == cid:
            c.update({k: v for k, v in d.items() if k != "id"})
            _save(BAND_CONTACTS_FILE, contacts)
            return jsonify({"ok": True})
    return jsonify({"error": "not found"}), 404

@app.route("/api/band/contacts/<int:cid>", methods=["DELETE"])
def delete_band_contact(cid):
    contacts = _load(BAND_CONTACTS_FILE)
    contacts = [c for c in contacts if c["id"] != cid]
    _save(BAND_CONTACTS_FILE, contacts)
    return jsonify({"ok": True})

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

    trip_lines = []
    for h in _load(HOLIDAYS_FILE):
        try:
            days_out = (datetime.strptime(h["start"], "%Y-%m-%d").date() - today_dt).days
            if -7 <= days_out <= 60:
                label = f"{h['name']}: in progress" if days_out < 0 else f"{h['name']}: today" if days_out == 0 else f"{h['name']} in {days_out}d"
                trip_lines.append(label)
        except Exception:
            pass

    health = _load(HEALTH_FILE)
    habits = [h.get("label", h.get("id", "")) for h in health.get("habit_list", [])][:4]

    context = (
        f"Today is {today} ({datetime.now().strftime('%A')}).\n"
        f"Agenda: {', '.join(i['label'] for i in agenda_today) or 'nothing scheduled'}\n"
        f"High priority work: {', '.join(t['title'] for t in work_high) or 'none'}\n"
        f"Trips: {', '.join(trip_lines) or 'none upcoming'}\n"
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

    trips = []
    for h in _load(HOLIDAYS_FILE):
        try:
            days_out = (datetime.strptime(h["start"], "%Y-%m-%d").date() - today_dt).days
            if -7 <= days_out <= 30:
                trips.append({**h, "days_out": days_out})
        except Exception:
            pass

    return jsonify({"agenda": agenda, "habits": {"today": habits_today, "list": habit_list}, "work_priority": work, "trips": trips})

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
    _log("agenda", "add", d.get("label", ""))
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

    # Build weight_log: sorted list of {date, weight} objects
    weight_dict = data.get("weight", {})
    weight_log = [{"date": d, "weight": w} for d, w in sorted(weight_dict.items())]

    # Build habits_weekly for current Mon–Sun
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

    return jsonify({**data, "weight_log": weight_log, "habits_weekly": habits_weekly, "calories_target": cal_target})

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
    new_val = not day.get(habit_name, False)
    day[habit_name] = new_val
    _save(HEALTH_FILE, health)
    _log("health", "habit", f"{habit_name} {'✓' if new_val else '✗'}")
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

# ── Study ──────────────────────────────────────────────────────────────────────

@app.route("/api/study", methods=["GET"])
def get_study():
    data = _load(STUDY_FILE)
    if isinstance(data, list):
        return jsonify({})
    return jsonify(data)

@app.route("/api/study/score", methods=["POST"])
def post_study_score():
    d = request.json
    study = _load(STUDY_FILE)
    if not isinstance(study, dict):
        study = {}
    study.setdefault("practice_scores", []).append(d.get("score", 0))
    _save(STUDY_FILE, study)
    return jsonify({"ok": True})

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
    mins = d.get("minutes", 0)
    topic = d.get("topic", "")
    sessions.append({
        "date": d.get("date", datetime.now().strftime("%Y-%m-%d")),
        "minutes": mins, "topic": topic
    })
    study["total_hours"] = round(sum(s.get("minutes", 0) for s in sessions) / 60, 1)
    _save(STUDY_FILE, study)
    _log("study", "session", f"{mins}min{f' — {topic}' if topic else ''}")
    return jsonify({"ok": True})

# ── Reading ────────────────────────────────────────────────────────────────────

@app.route("/api/reading", methods=["GET"])
def get_reading():
    data = _load(READING_FILE)
    if isinstance(data, list):
        return jsonify({})
    return jsonify(data)

@app.route("/api/reading/progress", methods=["POST"])
def post_reading_progress():
    d = request.json
    reading = _load(READING_FILE)
    if not isinstance(reading, dict):
        reading = {}
    if reading.get("current"):
        reading["current"]["page"] = d.get("page", reading["current"].get("page", 0))
        reading["current"]["last_read"] = datetime.now().strftime("%Y-%m-%d")
        _save(READING_FILE, reading)
        title = reading["current"].get("title", "book")
        _log("reading", "progress", f"{title} → p.{d.get('page')}")
        return jsonify({"ok": True})
    return jsonify({"error": "no current book"}), 404

@app.route("/api/reading", methods=["POST"])
def post_reading():
    d = request.json
    reading = _load(READING_FILE)
    if not isinstance(reading, dict):
        reading = {"queue": [], "completed_2026": 0, "goal_2026": 30}
    action = d.get("action", "update_page")
    if action == "set_current":
        reading["current"] = {"title": d["title"], "author": d.get("author",""), "page": d.get("page",0), "total_pages": d.get("total_pages",0), "started": datetime.now().strftime("%Y-%m-%d")}
    elif action == "add_queue":
        reading.setdefault("queue", []).append({"title": d["title"], "author": d.get("author","")})
    elif action == "complete":
        reading["completed_2026"] = reading.get("completed_2026", 0) + 1
        reading["current"] = None
    _save(READING_FILE, reading)
    return jsonify({"ok": True})

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
    data = _load(HOLIDAYS_FILE)
    # Support both old dict format and new array format
    if isinstance(data, dict):
        return jsonify(data.get("trips", []))
    return jsonify(data)

@app.route("/api/holidays", methods=["POST"])
def post_holiday():
    d = request.json
    trips = _load(HOLIDAYS_FILE)
    if isinstance(trips, dict):
        trips = trips.get("trips", [])
    tid = max((t.get("id", 0) for t in trips), default=0) + 1
    trips.append({
        "id": tid, "name": d.get("name", d.get("destination", "")),
        "location": d.get("location", ""), "start": d.get("start", ""),
        "end": d.get("end", ""), "budget": d.get("budget", 0),
        "checklist": d.get("checklist", []), "notes": d.get("notes", "")
    })
    _save(HOLIDAYS_FILE, trips)
    return jsonify({"id": tid})

@app.route("/api/holidays/<int:tid>/checklist/<int:idx>", methods=["POST"])
def toggle_holiday_checklist(tid, idx):
    trips = _load(HOLIDAYS_FILE)
    if isinstance(trips, dict):
        trips = trips.get("trips", [])
    for trip in trips:
        if trip["id"] == tid:
            cl = trip.get("checklist", [])
            if 0 <= idx < len(cl):
                if isinstance(cl[idx], dict):
                    cl[idx]["done"] = not cl[idx].get("done", False)
                else:
                    cl[idx] = {"text": cl[idx], "done": True}
            _save(HOLIDAYS_FILE, trips)
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
    words = len(d.get("body","").split())
    _log("journal", "entry", f"{date} — {words} words")
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

if __name__ == "__main__":
    if not os.environ.get("ANTHROPIC_API_KEY"):
        print("ERROR: Set ANTHROPIC_API_KEY in .env")
        sys.exit(1)
    port = int(os.environ.get("PORT", 5000))
    print(f"Mission Control → http://localhost:{port}")
    app.run(debug=False, port=port, host="0.0.0.0")
