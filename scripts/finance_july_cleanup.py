# One-off: purge June leftover rows from the current month's Finance tab.
# The July tab was created by duplicating June, so June's transaction rows are
# still sitting in the detail tables (Fun / Gas / Food-Grocery) and the budget
# sections. The newest Rocket Money CSV export in the Drive import folder is
# the point of truth: any data row NOT backed by a current-month CSV
# transaction is removed. Detail tables are compacted (kept rows shift up,
# blanks below); budget-section rows are cleared in place.
#
# Usage:  python scripts/finance_july_cleanup.py            (dry run - prints plan)
#         python scripts/finance_july_cleanup.py --apply    (writes to the Sheet)
#
# Safe wrt the Drive sync: import fingerprints live in finance_import.json /
# GCS, not in the Sheet, so removed rows will NOT be re-imported.
import sys
from pathlib import Path
from datetime import datetime

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import app  # reuse the live parsing/table helpers so behavior matches the sync exactly

APPLY = "--apply" in sys.argv


def norm(s):
    return str(s or "").strip().lower()


def main():
    now = datetime.now()
    month = now.strftime("%Y-%m")
    tab = app._month_tab(month)

    cfg = app._load(app.GDRIVE_CONFIG_FILE, {})
    sheet_id = str(cfg.get("sheet_finance") or "").strip() or app.FINANCE_SHEET_ID
    if not sheet_id:
        sys.exit("No finance sheet id configured (drive_config.json sheet_finance / FINANCE_SHEET_ID)")

    folder = cfg.get("finance_import_folder") or app.FINANCE_IMPORT_FOLDER
    if not folder:
        sys.exit("No Drive import folder configured")
    raw, meta = app._drive_newest_csv(folder)
    if raw is None:
        sys.exit(f"Could not fetch CSV: {meta}")
    csv_rows = app._parse_rocket_csv(raw)

    # ── truth: this month's real spend, categorized exactly like the sync ──
    detail_truth = {c: [] for c in app.DETAIL_TABLE_KEYWORDS}   # cat -> [(col1, amt)]
    budget_truth = []                                            # [(name, amt)]
    truth_total = 0.0
    for r in csv_rows:
        if (r["date"] or "")[:7] != month or app._rocket_is_nonspend(r):
            continue
        cat = app._rocket_to_finance_category(r.get("category"), r.get("name"))
        amt = round(abs(r["amount"]), 2)
        truth_total = round(truth_total + amt, 2)
        if cat in app.DETAIL_TABLE_KEYWORDS:
            col1 = r["name"] if cat == "Fun" else app._format_short_date(r["date"])
            detail_truth[cat].append((norm(col1), amt))
        else:
            budget_truth.append((norm(r["name"]), amt))
    print(f"CSV: {meta}  |  {tab} truth total: ${truth_total:.2f}")

    svc = app._sheets_svc()
    vals = app._sheets_execute(svc.spreadsheets().values().get(
        spreadsheetId=sheet_id, range=tab))
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
    removed, kept_total = [], 0.0

    # ── detail tables: Fun / Gas / Food-Grocery ──
    for cat in app.DETAIL_TABLE_KEYWORDS:
        pos = app._find_detail_table(rows, cat)
        if not pos:
            print(f"[{cat}] table not found - skipping")
            continue
        hr, hc = pos
        end = len(rows)
        for ri in range(hr + 2, len(rows)):
            c1, c2 = norm(rows[ri][hc]), norm(rows[ri][hc + 1]) if hc + 1 < max_cols else ""
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
            amt = app._parse_money(c2raw)
            if take(pool, norm(c1), amt):
                kept.append([c1, c2raw])
                kept_total = round(kept_total + amt, 2)
            else:
                removed.append((cat, c1, amt))
        n_slots = end - (hr + 2)
        body = kept + [["", ""]] * (n_slots - len(kept))
        a1 = (f"'{tab}'!{app._col_letter(hc)}{hr + 3}:"
              f"{app._col_letter(hc + 1)}{end}")
        updates.append((a1, body))
        n_removed = sum(1 for x in removed if x[0] == cat)
        print(f"[{cat}] kept={len(kept)} removed={n_removed}"
              + (f"  WARNING: {len(pool)} CSV rows missing from sheet: {pool}" if pool else ""))

    # ── budget sections: Housing / Utilities rows with actuals ──
    hdr_idx, desc_col, _, actual_col = app._finance_budget_columns(rows)
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
        canon = app._canon_cat(cat_val or desc_val or current_cat)
        if canon not in ("Housing", "Utilities"):
            continue
        actual_raw = rows[ri][actual_col] if actual_col < max_cols else ""
        if not str(actual_raw).strip():
            continue                      # unpaid/planned row - leave alone
        amt = app._parse_money(actual_raw)
        if take(budget_truth, norm(desc_val), amt):
            kept_total = round(kept_total + amt, 2)
            continue                      # backed by a July CSV txn - keep
        has_budgeted = bool(str(rows[ri][budget_col]).strip()) if budget_col < max_cols else False
        removed.append((canon, desc_val, amt))
        clears.append(f"'{tab}'!{app._col_letter(actual_col)}{ri + 1}")
        if not has_budgeted:              # import-appended row, not a template bill
            clears.append(f"'{tab}'!{app._col_letter(desc_col)}{ri + 1}")

    print(f"\n=== {'APPLYING' if APPLY else 'DRY RUN'} - rows to remove: {len(removed)} ===")
    rm_total = 0.0
    for cat, c1, amt in removed:
        rm_total = round(rm_total + amt, 2)
        print(f"  REMOVE [{cat:14}] {c1[:48]:48} ${amt:9.2f}")
    print(f"  removed total: ${rm_total:.2f}")
    print(f"  kept (CSV-backed) total: ${kept_total:.2f}  |  CSV truth total: ${truth_total:.2f}")
    if not APPLY:
        print("\nDry run only - re-run with --apply to write.")
        return

    for a1, body in updates:
        app._sheets_execute(svc.spreadsheets().values().update(
            spreadsheetId=sheet_id, range=a1,
            valueInputOption="USER_ENTERED", body={"values": body}))
    if clears:
        app._sheets_execute(svc.spreadsheets().values().batchUpdate(
            spreadsheetId=sheet_id,
            body={"valueInputOption": "USER_ENTERED",
                  "data": [{"range": a1, "values": [[""]]} for a1 in clears]}))
    print(f"\nDone. Rewrote {len(updates)} detail tables, cleared {len(clears)} budget cells.")


if __name__ == "__main__":
    main()
