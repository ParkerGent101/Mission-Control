"""One-shot: rewrite the Workouts tab of the Health Sheet with a 6-day PPLPPL
bodybuilding program (Push/Pull/Legs x2), core 3x/week (days 1, 3, 5).

The app reads Workouts!A2:G500 with columns:
  A=day(int 1-6, Mon=1..Sat=6)  B=focus  C=name  D=sets  E=reps  F=rest  G=note

Auth uses the same creds the app uses (data/drive_token.json + data/credentials.json).
Run from the repo root:  python scripts/update_workouts.py
"""
import os, sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from dotenv import load_dotenv  # type: ignore
load_dotenv()

from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request
from googleapiclient.discovery import build

SHEET = os.environ.get("HEALTH_SHEET_ID", "")
TOKEN = Path(__file__).resolve().parent.parent / "data" / "drive_token.json"
SCOPES = ['https://www.googleapis.com/auth/drive', 'https://www.googleapis.com/auth/spreadsheets']

# day, focus (first row of the day only), name, sets, reps, rest, note
ROWS = [
    # ── Day 1 · Push A (Chest) + Core ─────────────────────────────
    [1, "Push A · Chest + Core", "Barbell Bench Press",          4, "6-10",  "90-150 sec", "Neutral wrist; leave 1-3 reps in reserve."],
    [1, "", "Incline Dumbbell Press",        3, "8-12",  "90 sec", ""],
    [1, "", "Machine Chest Press",           3, "10-12", "75 sec", "Squeeze at top."],
    [1, "", "Cable or Pec-Deck Fly",         3, "12-15", "60 sec", "Full stretch on the chest."],
    [1, "", "Seated Dumbbell Shoulder Press",3, "8-12",  "90 sec", ""],
    [1, "", "Cable Lateral Raise",           4, "12-20", "45-60 sec", "Light and controlled."],
    [1, "", "Rope Triceps Pushdown",         3, "10-15", "60 sec", "Neutral grip, elbow-friendly."],
    [1, "", "Overhead Cable Triceps Ext",    3, "12-15", "60 sec", "Stop if elbow flares."],
    [1, "", "Hanging Knee Raise",            3, "12-15", "45-60 sec", "CORE."],
    [1, "", "Cable Crunch",                  3, "12-15", "45 sec", "CORE."],
    # ── Day 2 · Pull A (Back width + Biceps) ──────────────────────
    [2, "Pull A · Back width + Biceps", "Neutral-Grip Lat Pulldown", 4, "8-12", "90 sec", "Neutral grip protects elbow."],
    [2, "", "Chest-Supported Row",           4, "8-12",  "90 sec", ""],
    [2, "", "Seated Cable Row",              3, "10-12", "75 sec", "Neutral handle."],
    [2, "", "Straight-Arm Pulldown",         3, "12-15", "60 sec", "Lats only, soft elbows."],
    [2, "", "Face Pull",                     3, "15-20", "45-60 sec", "Rear delts / upper back."],
    [2, "", "Incline Dumbbell Curl",         3, "10-12", "60 sec", "Lighten if elbow sensitive."],
    [2, "", "Hammer Curl",                   3, "10-15", "60 sec", "Neutral grip, elbow-friendly."],
    # ── Day 3 · Legs A (Quad) + Core ──────────────────────────────
    [3, "Legs A · Quad + Core", "Back Squat or Hack Squat", 4, "6-10", "120-150 sec", "Leave 2-3 reps in reserve."],
    [3, "", "Leg Press",                     3, "10-15", "90 sec", ""],
    [3, "", "Bulgarian Split Squat",         3, "10 each leg", "75-90 sec", "Dumbbells; straps ok."],
    [3, "", "Leg Extension",                 3, "12-20", "60 sec", ""],
    [3, "", "Seated Leg Curl",               3, "10-15", "60 sec", ""],
    [3, "", "Standing Calf Raise",           4, "12-20", "45-60 sec", ""],
    [3, "", "Hanging Leg Raise",             3, "10-15", "45-60 sec", "CORE."],
    [3, "", "Plank",                         3, "30-60 sec", "45 sec", "CORE."],
    # ── Day 4 · Push B (Shoulders) ────────────────────────────────
    [4, "Push B · Shoulders", "Seated Dumbbell Shoulder Press", 4, "8-12", "90 sec", ""],
    [4, "", "Incline Dumbbell or Machine Press", 3, "8-12", "90 sec", "Upper chest."],
    [4, "", "Dumbbell or Cable Lateral Raise", 4, "12-20", "45-60 sec", "Main delt-width driver."],
    [4, "", "Cable or Pec-Deck Fly",         3, "12-15", "60 sec", ""],
    [4, "", "Reverse Pec-Deck",              3, "15-20", "45-60 sec", "Rear delts."],
    [4, "", "Machine or Assisted Dip",       3, "8-12",  "75 sec", "Neutral; stop if elbow hurts."],
    [4, "", "Overhead Cable Triceps Ext",    3, "12-15", "60 sec", ""],
    # ── Day 5 · Pull B (Back thickness + Biceps) + Core ───────────
    [5, "Pull B · Back thickness + Core", "Chest-Supported or Pendlay Row", 4, "8-10", "90-120 sec", "Straps allowed."],
    [5, "", "Wide-Grip Lat Pulldown",        3, "10-12", "90 sec", ""],
    [5, "", "Single-Arm Dumbbell Row",       3, "10-12", "75 sec", ""],
    [5, "", "Dumbbell Shrug",                3, "12-15", "60 sec", "Straps to spare grip/elbow."],
    [5, "", "Reverse Pec-Deck or Face Pull", 3, "15-20", "45-60 sec", ""],
    [5, "", "EZ-Bar or Cable Curl",          3, "10-12", "60 sec", "Lighten if elbow sensitive."],
    [5, "", "Cable or Preacher Curl",        3, "12-15", "60 sec", ""],
    [5, "", "Pallof Press",                  3, "10-12 each side", "45-60 sec", "CORE anti-rotation."],
    [5, "", "Ab Wheel or Dead Bug",          3, "10-12", "45 sec", "CORE."],
    # ── Day 6 · Legs B (Hamstring / Glute) ────────────────────────
    [6, "Legs B · Hamstring/Glute", "Romanian Deadlift", 4, "8-10", "120 sec", "Straps ok to spare elbow."],
    [6, "", "Hip Thrust",                    3, "10-12", "90 sec", ""],
    [6, "", "Hack Squat or Leg Press (feet high)", 3, "10-15", "90 sec", "Glute/ham bias."],
    [6, "", "Lying or Seated Leg Curl",      4, "10-15", "60 sec", ""],
    [6, "", "Leg Extension",                 3, "12-20", "60 sec", ""],
    [6, "", "Seated Calf Raise",             4, "15-20", "45 sec", ""],
]

HEADER = ["Day", "Focus", "Exercise", "Sets", "Reps", "Rest", "Note"]


def main():
    if not SHEET:
        sys.exit("HEALTH_SHEET_ID not set (check .env)")
    creds = Credentials.from_authorized_user_file(str(TOKEN), SCOPES)
    if not creds.valid:
        if creds.expired and creds.refresh_token:
            creds.refresh(Request())
            TOKEN.write_text(creds.to_json())
        else:
            sys.exit("drive_token.json invalid and not refreshable — re-auth needed.")
    svc = build('sheets', 'v4', credentials=creds)

    # Clear old plan rows, then write header + new program starting at A1.
    svc.spreadsheets().values().clear(
        spreadsheetId=SHEET, range="Workouts!A1:G500").execute()
    values = [HEADER] + [[str(c) for c in r] for r in ROWS]
    svc.spreadsheets().values().update(
        spreadsheetId=SHEET, range="Workouts!A1",
        valueInputOption="USER_ENTERED", body={"values": values}).execute()
    print(f"Wrote {len(ROWS)} exercise rows across 6 days to Workouts tab.")


if __name__ == "__main__":
    main()
