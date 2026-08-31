import os
os.environ.setdefault("OAUTHLIB_INSECURE_TRANSPORT", "1")
# Google adds/reorders the 'openid' scope on sign-in; don't let oauthlib reject the token for it.
os.environ.setdefault("OAUTHLIB_RELAX_TOKEN_SCOPE", "1")

from contextlib import contextmanager
from datetime import datetime, timedelta, date
from pathlib import Path
import calendar
import json
import re
import sqlite3
import time
import mimetypes

from dotenv import load_dotenv
from flask import Flask, jsonify, render_template, request, session, redirect
from flask_compress import Compress

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

DATA_DIR    = Path(os.environ.get("DATA_DIR", str(Path(__file__).parent / "data")))
DATA_DIR.mkdir(exist_ok=True)

GCS_BUCKET   = os.environ.get("GCS_BUCKET", "")
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

FINANCE_FILE     = DATA_DIR / "finances.json"
SUBS_FILE        = DATA_DIR / "subscriptions.json"
SAVINGS_FILE     = DATA_DIR / "savings.json"   # legacy: migrated into ACCOUNTS_FILE on first read
ACCOUNTS_FILE    = DATA_DIR / "accounts.json"  # balances + dated snapshots for the net-worth trend
DB_PATH          = DATA_DIR / "mission_control.db"
FINANCE_SHEET_ID = os.environ.get("FINANCE_SHEET_ID", "")
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


FINANCE_IMPORT_FILE = DATA_DIR / "finance_import.json"   # dedup fingerprints for Rocket Money CSV imports
ROOMMATE_FILE      = DATA_DIR / "roommate_payment.json"  # local fallback for the Sheet "roommate payment" section
USER_CONFIG_FILE   = DATA_DIR / "user_config.json"

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
    if p in ('/login', '/privacy', '/api/healthz', '/api/login', '/api/logout', '/api/me',
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


# ── Finance tools ──────────────────────────────────────────────────────────────

def _add_local_transaction(description, amount, type_, category, date=""):
    finances = _load(FINANCE_FILE)
    tid = max((t["id"] for t in finances), default=0) + 1
    finances.append({"id": tid, "description": description, "amount": float(amount), "type": type_, "category": category, "date": date or datetime.now().strftime("%Y-%m-%d")})
    _save(FINANCE_FILE, finances)
    return f"Logged: {'+'if type_=='income'else'-'}${amount} — {description} [{category}]"


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

@app.route("/api/healthz")
def healthz():
    """Unauthenticated liveness probe. Replaces the old /api/health, which was the
    fitness module's endpoint rather than a health check.

    Under /api/ deliberately: Google Frontend intercepts a bare /healthz on Cloud
    Run and answers it with its own 404 before the request ever reaches the
    container, so the obvious path silently doesn't work in production."""
    return jsonify({"ok": True}), 200

@app.route("/")
def index():
    return render_template(
        "index.html",
        asset_version=_asset_version(),
        # Prod image bakes PRECOMPILED_ASSETS=1 → serve plain .js (no in-browser Babel).
        # Unset locally → dev serves .jsx via Babel-standalone (hot-reload, no build step).
        precompiled=os.environ.get("PRECOMPILED_ASSETS") == "1",
    )


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
    _add_local_transaction(desc, amt, txn_type, cat, date)
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


# ── User profile & settings ───────────────────────────────────────────────────

@app.route("/api/user/profile", methods=["GET", "POST"])
def user_profile():
    if request.method == "GET":
        cfg = _load(USER_CONFIG_FILE, {})
        return jsonify({"name": cfg.get("name", "")})
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
    to_clear = [FINANCE_FILE, SUBS_FILE, SAVINGS_FILE, ROOMMATE_FILE, FINANCE_IMPORT_FILE]
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


# ── Finance import: Rocket Money CSV from Google Drive ───────────────────────────


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
    """Map a Rocket Money category/merchant onto a category the month tab can hold.

    The return value MUST be in PLACEABLE_CATEGORIES. _finance_sync_month counts a
    charge toward csv_total before deciding where to put it, so a category with no
    home in the Sheet would be counted as spending and never written — the tab could
    then never reconcile to Rocket Money's total. That is why the fallback is 'Fun'
    rather than the more natural 'Other': Fun has a detail table, Other does not.

    Consequence worth knowing: Rocket Money's 'Shopping' has no home either, so
    Walmart/Amazon/Reverb land in Fun and inflate it. To split them out, add a
    'Shopping' detail table or budget section to the Sheet, then add it to
    DETAIL_TABLE_KEYWORDS / BUDGET_TRANSACTION_CATEGORIES and map it here."""
    blob = (str(rm_cat or "").lower() + " " + str(name or "").lower())
    if any(k in blob for k in ("subscript",) + _RM_SUBSCRIPTION_MERCHANTS):       return "Subscriptions"
    if "shopping" in blob:                                                        return "Shopping"
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

    # A tab with no table for a detail category cannot receive those charges. Fold them
    # into the documented fallback for this run instead of counting spending the tab can
    # never show: older tabs predate Shopping, and a new one may not have it yet. Adding
    # a 'Shopping Total' table to the Sheet is all it takes to switch this off.
    reroute = {}
    for cat_from, cat_to in DETAIL_TABLE_FALLBACK.items():
        if not _find_detail_table(rows, cat_from) and _find_detail_table(rows, cat_to):
            reroute[cat_from] = cat_to

    # -- what the CSV says this month's spending is --
    desired_detail = {c: [] for c in DETAIL_TABLE_KEYWORDS}
    desired_budget = {c: [] for c in BUDGET_TRANSACTION_CATEGORIES}
    csv_total, by_category = 0.0, {}
    rerouted_total = {}       # cat_from -> amount folded into its fallback this run
    unplaceable = []          # charges with no home in the Sheet — see PLACEABLE_CATEGORIES
    for r in csv_rows:
        if (r.get('date') or '')[:7] != month or _rocket_is_nonspend(r):
            continue
        cat  = _rocket_to_finance_category(r.get('category'), r.get('name'))
        amt  = round(abs(r.get('amount') or 0), 2)
        if cat in reroute:
            rerouted_total[cat] = round(rerouted_total.get(cat, 0) + amt, 2)
            cat = reroute[cat]
        name = (r.get('name') or 'Transaction').strip()
        csv_total = round(csv_total + amt, 2)
        by_category[cat] = round(by_category.get(cat, 0) + amt, 2)
        if cat in desired_detail:
            # Gas/Groceries tables key column 1 on the date, Fun/Dining on the merchant.
            label = name if cat in ('Fun', 'Dining and Drinks') else _format_short_date(r['date'])
            desired_detail[cat].append({'label': label, 'amount': amt, 'date': r['date'], 'name': name})
        elif cat in desired_budget:
            desired_budget[cat].append({'name': name, 'amount': amt, 'date': r['date']})
        else:
            # Counted toward csv_total above but with nowhere to go — the tab could never
            # reach that total. Never silently: track it so the caller can report the gap.
            unplaceable.append({'name': name, 'amount': amt, 'category': cat})

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

    # A charge counted toward csv_total but with nowhere to write it means the tab can
    # never reach that total. Report it loudly rather than letting the numbers drift.
    for cat_from, amt in sorted(rerouted_total.items()):
        warnings.append(
            f"${amt:,.2f} of {cat_from} went into {reroute[cat_from]} — '{tab}' has no "
            f"{cat_from} table. Add a '{cat_from} Total' table to the Sheet to track it separately.")

    if unplaceable:
        gap = round(sum(u['amount'] for u in unplaceable), 2)
        cats = sorted({u['category'] for u in unplaceable})
        warnings.append(
            f"{len(unplaceable)} charge(s) totalling ${gap:,.2f} have no home in '{tab}' "
            f"(category: {', '.join(cats)}) — the tab cannot reconcile to Rocket Money until "
            f"the Sheet gains a section for them")

    plan = {'tab': tab, 'month': month, 'purge': purge, 'applied': False,
            'added': added, 'updated': updated, 'removed': removed,
            'new_rows': len(appends), 'csv_total': csv_total,
            'manual_total': round(manual_total, 2),
            'expected_total': round(csv_total + manual_total, 2),
            'rerouted': rerouted_total,
            'unplaceable': unplaceable,
            'unplaceable_total': round(sum(u['amount'] for u in unplaceable), 2),
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
            _add_local_transaction(r["name"] or "Transaction", abs(r["amount"]), "expense",
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


# ── Google Drive / Sheets ─────────────────────────────────────────────────────

def _extract_sheet_id(url_or_id):
    m = re.search(r'/spreadsheets/d/([a-zA-Z0-9_-]+)', url_or_id)
    return m.group(1) if m else url_or_id.strip()

def _extract_drive_folder_id(url_or_id):
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
    # Added 2026-08-30. Only takes effect on a tab that actually has a Shopping table —
    # _finance_sync_month re-routes these to Fun (the historical home) on any tab that
    # doesn't, so the month still reconciles. See DETAIL_TABLE_FALLBACK.
    'Shopping':          ['shopping total', 'shopping totals'],
}

# Where a detail category goes on a tab that has no table for it. The month total must
# reconcile against Rocket Money on every tab, including older ones written before the
# category existed, so a missing table degrades to the old destination instead of
# dropping the charge.
DETAIL_TABLE_FALLBACK = {'Shopping': 'Fun'}
BUDGET_TRANSACTION_CATEGORIES = {'Utilities', 'Subscriptions'}

# The only categories a month tab can actually receive a charge into. _finance_sync_month
# counts a charge toward csv_total before choosing a destination, so anything outside this
# set would be counted as spending and never written, and the tab could never reconcile to
# Rocket Money's total. _rocket_to_finance_category must only ever return one of these.
PLACEABLE_CATEGORIES = set(DETAIL_TABLE_KEYWORDS) | BUDGET_TRANSACTION_CATEGORIES

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


# ── TCPG Monitor ───────────────────────────────────────────────────────────────



# ══════════════════════════════════════════════════════════════════════════════
# Bills & subscriptions calendar
# ══════════════════════════════════════════════════════════════════════════════

def _parse_due_day(cell):
    """Day-of-month from whatever the Sheet's due-date column holds: '5', '5th',
    '2026-08-05', '8/5', '8/5/2026'. Returns 1-31, or None if there's no day in it."""
    s = str(cell or "").strip()
    if not s:
        return None
    m = re.search(r'^(\d{4})-(\d{2})-(\d{2})', s)          # ISO
    if m:
        return int(m.group(3))
    m = re.search(r'^(\d{1,2})\s*/\s*(\d{1,2})', s)         # US M/D
    if m:
        return int(m.group(2))
    m = re.search(r'(\d{1,2})', s)                          # bare day / '5th'
    if m:
        d = int(m.group(1))
        return d if 1 <= d <= 31 else None
    return None


def _is_paid_flag(cell):
    return str(cell or "").strip().lower() in ("y", "yes", "x", "true", "paid", "✓", "✔", "1")


def _parse_budget_bills(rows):
    """Per-ROW view of the budget section - one entry per line item that carries a
    due date and/or an amount. _parse_budget_rows aggregates the same rows by
    category; this keeps them separate so they can be laid out on a calendar."""
    if not rows:
        return []
    max_cols = max((len(r) for r in rows), default=1)
    rows = [r + [''] * (max_cols - len(r)) for r in rows]

    hdr_idx, desc_col, due_col, actual_col = _finance_budget_columns(rows)
    hdr = [str(c).lower().strip() for c in rows[hdr_idx]]
    budget_col = next((i for i, h in enumerate(hdr) if 'budget' in h), 4)
    paid_col = next((i for i, h in enumerate(hdr) if 'paid' in h), actual_col + 1)
    acct_col = next((i for i, h in enumerate(hdr) if 'account' in h), 2)

    out, current_cat = [], ''
    for row in rows[hdr_idx + 1:]:
        joined = ' '.join(row[:8]).lower()
        if any(kw in joined for kw in ['anticipated', 'actual total', 'roommate', 'savings total']):
            break
        cat_val = row[0].strip()
        if cat_val and not any(ch.isdigit() for ch in cat_val):
            current_cat = cat_val
        desc = row[desc_col].strip() if len(row) > desc_col else ''
        canon = _budget_row_canon(cat_val, desc, current_cat)
        if not canon:
            continue
        budgeted = _parse_money(row[budget_col]) if len(row) > budget_col else 0.0
        actual = _parse_money(row[actual_col]) if len(row) > actual_col else 0.0
        due_day = _parse_due_day(row[due_col]) if len(row) > due_col else None
        # A row with no money and no due date is scaffolding, not a bill.
        if not budgeted and not actual and due_day is None:
            continue
        out.append({
            "name": desc or canon,
            "category": canon,
            "account": row[acct_col].strip() if len(row) > acct_col else '',
            "budgeted": round(budgeted, 2),
            "actual": round(actual, 2),
            "due_day": due_day,
            "paid": _is_paid_flag(row[paid_col]) if len(row) > paid_col else False,
        })
    return out


def _bill_status(item, month, today):
    """paid | posted | due | overdue.
      paid    - the Sheet's paid column is ticked
      posted  - no tick, but an actual amount has landed
      overdue - nothing landed and the due day has passed
      due     - nothing landed and it is still ahead (or undated)"""
    if item.get("paid"):
        return "paid"
    if item.get("actual"):
        return "posted"
    day = item.get("due_day")
    cur = today.strftime("%Y-%m")
    if day and month < cur:
        return "overdue"
    if day and month == cur and day < today.day:
        return "overdue"
    return "due"


@app.route("/api/finances/upcoming", methods=["GET"])
def finances_upcoming():
    """What is still going out this month, and when.

    Merges the three places a recurring charge can live: the Sheet's budget rows
    (which carry the due date and the paid tick), the subscriptions list the
    Rocket Money import fills in, and the roommate's half of the utilities.
    Returns items plus `committed_remaining` - everything expected but not yet
    paid or posted."""
    month = request.args.get("month") or datetime.now().strftime("%Y-%m")
    today = datetime.now()
    items = []

    if FINANCE_SHEET_ID:
        try:
            svc = _sheets_svc()
            tab = _resolve_month_tab(svc, month)
            for b in _parse_budget_bills(_finance_rows(svc, tab)):
                items.append({**b, "source": "sheet",
                              "amount": b["actual"] or b["budgeted"],
                              "status": _bill_status(b, month, today)})
        except Exception as e:
            app.logger.warning("Upcoming: budget rows unavailable for %s: %s", month, e)

    # Subscriptions the import discovered. Skip any the Sheet already listed -
    # a subscription with a budget row is the same bill seen twice.
    seen = {i["name"].strip().lower() for i in items if i.get("name")}
    for s in _load_subs()["items"]:
        name = str(s.get("name", "")).strip()
        if not name or name.lower() in seen:
            continue
        amt = round(float(s.get("amt") or 0), 2)
        # The list only holds charges that already appeared in the export, so a
        # subscription on it has posted by definition.
        items.append({"name": name, "category": "Subscriptions", "account": s.get("acct", ""),
                      "budgeted": amt, "actual": amt, "amount": amt,
                      "due_day": _parse_due_day(s.get("due")), "paid": False,
                      "source": "subscription", "status": "posted"})

    try:
        room = _load(ROOMMATE_FILE, None)
        if isinstance(room, dict) and room.get("items"):
            r = _roommate_from_items(room["items"])
            if r["total"] > 0:
                items.append({"name": "Roommate payment", "category": "Income",
                              "account": "", "budgeted": r["total"], "actual": 0.0,
                              "amount": r["total"], "due_day": None, "paid": False,
                              "source": "roommate", "status": "due", "income": True})
    except Exception:
        pass

    outgoing = [i for i in items if not i.get("income")]
    committed = round(sum(i["amount"] for i in outgoing if i["status"] in ("due", "overdue")), 2)
    items.sort(key=lambda i: (i.get("due_day") is None, i.get("due_day") or 0, i["name"].lower()))
    return jsonify({
        "month": month,
        "items": items,
        "committed_remaining": committed,
        "paid_total": round(sum(i["amount"] for i in outgoing if i["status"] in ("paid", "posted")), 2),
        "days_in_month": calendar.monthrange(int(month[:4]), int(month[5:7]))[1],
    })


# ══════════════════════════════════════════════════════════════════════════════
# Accounts & net worth
# ══════════════════════════════════════════════════════════════════════════════

def _net_worth(accounts):
    """Debt counts against you; everything else counts for you."""
    return round(sum((-1 if a.get("type") == "debt" else 1) * float(a.get("balance") or 0)
                     for a in accounts), 2)


def _snapshot_from(accounts, date_str):
    return {"date": date_str,
            "balances": {str(a["id"]): round(float(a.get("balance") or 0), 2) for a in accounts},
            "net_worth": _net_worth(accounts)}


def _stamp_snapshot(data, date_str):
    """One snapshot per day - re-saving on the same day updates it in place rather
    than stacking duplicate points on the chart."""
    snap = _snapshot_from(data["accounts"], date_str)
    for i, s in enumerate(data["snapshots"]):
        if s.get("date") == date_str:
            data["snapshots"][i] = snap
            break
    else:
        data["snapshots"].append(snap)
    data["snapshots"].sort(key=lambda s: s.get("date", ""))
    del data["snapshots"][:-400]          # ~13 months of daily points is plenty


def _load_accounts():
    """{accounts: [...], snapshots: [...]}, migrating the old flat savings.json
    (account + one balance, no history) on first read."""
    data = _load(ACCOUNTS_FILE, None)
    if isinstance(data, dict) and "accounts" in data:
        data.setdefault("snapshots", [])
        return data
    legacy = _load(SAVINGS_FILE, [])
    accounts = []
    for i, s in enumerate(legacy if isinstance(legacy, list) else [], start=1):
        name = str(s.get("account") or f"Account {i}")
        accounts.append({
            "id": s.get("id") or i,
            "name": name,
            "type": "brokerage" if "robinhood" in name.lower() else "cash",
            "balance": round(float(s.get("balance") or 0), 2),
            "updated": s.get("date") or datetime.now().strftime("%Y-%m-%d"),
        })
    data = {"accounts": accounts, "snapshots": []}
    if accounts:
        # Seed one snapshot so the trend has a starting point rather than an empty
        # chart until the second manual update.
        data["snapshots"].append(_snapshot_from(accounts, accounts[0]["updated"]))
        _save(ACCOUNTS_FILE, data)
    return data


@app.route("/api/accounts", methods=["GET"])
def get_accounts():
    data = _load_accounts()
    prev = data["snapshots"][-2] if len(data["snapshots"]) >= 2 else None
    for a in data["accounts"]:
        was = (prev or {}).get("balances", {}).get(str(a["id"]))
        a["change"] = round(float(a.get("balance") or 0) - was, 2) if was is not None else None
    return jsonify({
        "accounts": data["accounts"],
        "net_worth": _net_worth(data["accounts"]),
        "previous_net_worth": prev["net_worth"] if prev else None,
        "snapshots": data["snapshots"],
    })


@app.route("/api/accounts", methods=["POST"])
def post_accounts():
    """Replace the account list. Body: {accounts: [{id?, name, type, balance}]}.
    Editing a balance also stamps today's snapshot, so the trend follows the
    numbers without a separate 'save history' step."""
    d = request.json or {}
    raw = d.get("accounts")
    if not isinstance(raw, list):
        return jsonify({"error": "accounts must be a list"}), 400
    data = _load_accounts()
    clean = []
    next_id = max([a.get("id", 0) for a in data["accounts"]] or [0]) + 1
    today = datetime.now().strftime("%Y-%m-%d")
    for a in raw:
        if not isinstance(a, dict):
            continue
        name = str(a.get("name", "")).strip()
        if not name:
            continue
        try:
            bal = float(str(a.get("balance", 0)).replace("$", "").replace(",", "").strip() or 0)
        except (TypeError, ValueError):
            return jsonify({"error": f"'{name}' has a balance that isn't a number"}), 400
        acct_type = a.get("type") if a.get("type") in ("cash", "brokerage", "debt") else "cash"
        aid = a.get("id")
        if not isinstance(aid, int) or aid <= 0:
            aid, next_id = next_id, next_id + 1
        clean.append({"id": aid, "name": name, "type": acct_type,
                      "balance": round(bal, 2), "updated": today})
    data["accounts"] = clean
    _stamp_snapshot(data, today)
    _save(ACCOUNTS_FILE, data)
    return jsonify({"ok": True, "accounts": clean, "net_worth": _net_worth(clean)})


@app.route("/api/accounts/snapshot", methods=["POST"])
def post_account_snapshot():
    """Pin today's balances to the history without changing them."""
    data = _load_accounts()
    if not data["accounts"]:
        return jsonify({"error": "No accounts to snapshot yet"}), 400
    _stamp_snapshot(data, datetime.now().strftime("%Y-%m-%d"))
    _save(ACCOUNTS_FILE, data)
    return jsonify({"ok": True, "snapshots": len(data["snapshots"]),
                    "net_worth": _net_worth(data["accounts"])})


# ══════════════════════════════════════════════════════════════════════════════
# Category trends across month tabs
# ══════════════════════════════════════════════════════════════════════════════

_TRENDS_CACHE = {}
_TRENDS_TTL = 900          # 15 min - each miss is one Sheets read per month tab


def _norm_tab(s):
    return ''.join(str(s).lower().split())


@app.route("/api/finances/trends", methods=["GET"])
def finances_trends():
    """Month-over-month income, expense and per-category actuals.

    Reads one Sheet tab per month, so it is deliberately capped and cached hard:
    the container runs gunicorn with a single worker and no threads, and an
    uncached 12-month call is 12 serialized Sheets round-trips that block every
    other request. Months whose tab is missing or unparseable are skipped rather
    than failing the whole range - hand-made tabs drift."""
    if not FINANCE_SHEET_ID:
        return jsonify({"error": "No finance sheet configured"}), 400
    try:
        months = max(2, min(12, int(request.args.get("months", 6))))
    except (TypeError, ValueError):
        months = 6
    end = request.args.get("end") or datetime.now().strftime("%Y-%m")

    key = f"{end}:{months}"
    hit = _TRENDS_CACHE.get(key)
    if hit and (time.monotonic() - hit[0]) < _TRENDS_TTL:
        return jsonify({**hit[1], "cached": True})

    try:
        y, m = int(end[:4]), int(end[5:7])
    except (TypeError, ValueError):
        return jsonify({"error": "end must be YYYY-MM"}), 400

    wanted = []
    for _ in range(months):
        wanted.append(f"{y}-{m:02d}")
        m -= 1
        if m == 0:
            m, y = 12, y - 1
    wanted.reverse()

    try:
        svc = _sheets_svc()
        titles = {_norm_tab(t) for t in _sheet_tab_titles(svc, FINANCE_SHEET_ID)}
    except Exception as e:
        return jsonify({"error": f"Couldn't list the sheet's tabs: {e}"}), 502

    series, skipped = [], []
    for ym in wanted:
        tab = _resolve_month_tab(svc, ym)
        if _norm_tab(tab) not in titles:
            skipped.append(ym)
            continue
        try:
            parsed = _parse_budget_rows(_finance_rows(svc, tab))
        except Exception as e:
            app.logger.warning("Trends: couldn't parse '%s': %s", tab, e)
            skipped.append(ym)
            continue
        series.append({
            "month": ym,
            "tab": tab,
            "income": parsed["income"],
            "expense": parsed["expense"],
            "categories": {c["name"]: c["actual"] for c in parsed["categories"]},
        })

    payload = {"months": series, "skipped": skipped, "requested": wanted}
    _TRENDS_CACHE[key] = (time.monotonic(), payload)
    return jsonify({**payload, "cached": False})


# startup_sync removed — the contacts Google Sheet had corrupted data (songs as contacts)
# and was overwriting correct local data on every container start.

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    # Local staging only (Cloud Run uses gunicorn and never runs this block):
    # hot-reload templates from disk so index.html/login.html edits show on refresh
    # without a server restart.
    app.config["TEMPLATES_AUTO_RELOAD"] = True
    app.jinja_env.auto_reload = True
    print(f"Mission Control -> http://localhost:{port}")
    app.run(debug=False, port=port, host="0.0.0.0")
