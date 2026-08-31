"""Regression tests for the Rocket Money import.

Pinned against a real August 2026 export (tests/fixtures/rocket_money_2026-08.csv).
The point is the arithmetic: what the CSV totals, what the filter drops and why, and
that every charge the sync counts as spending has somewhere in the Sheet to go.

pytest is not installed here, so this runs standalone:

    python tests/test_rocket_sync.py

It also works under pytest if that ever gets added.
"""

import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import app as A  # noqa: E402

FIXTURE = Path(__file__).parent / "fixtures" / "rocket_money_2026-08.csv"

# Verified against Parker's own August export on 2026-08-30.
RAW_TOTAL = 4632.53
SPEND_TOTAL = 3600.09
DROPPED_TOTAL = 1032.44
ROW_COUNT = 38

# Shopping is split out as of 2026-08-30. On a tab with no Shopping table these fold
# back into Fun (Fun 1299.23), which is what DETAIL_TABLE_FALLBACK is for.
EXPECTED_BY_CATEGORY = {
    "Utilities": 1446.25,
    "Shopping": 1158.34,
    "Dining and Drinks": 560.61,
    "Gas": 158.48,
    "Fun": 140.89,
    "Subscriptions": 135.52,
}
FUN_IF_NO_SHOPPING_TABLE = 1299.23


def _rows():
    return A._parse_rocket_csv(FIXTURE.read_bytes())


def test_parses_every_row():
    rows = _rows()
    assert len(rows) == ROW_COUNT, f"expected {ROW_COUNT} rows, got {len(rows)}"
    total = round(sum(r["amount"] for r in rows), 2)
    assert total == RAW_TOTAL, f"raw total drifted: {total} != {RAW_TOTAL}"


def test_dates_normalize():
    for r in _rows():
        assert r["date"].startswith("2026-08"), f"bad date: {r['date']!r}"


def test_nonspend_filter_drops_exactly_the_investment_and_the_pending_charge():
    """The gap between the export's raw total and what reaches the Sheet must always
    be explainable. Here it is a $1,000 transfer into Robinhood (an investment, not
    spending) and a still-pending Uber Eats charge that will re-post with different
    details. Anything else going missing is a bug."""
    rows = _rows()
    dropped = [r for r in rows if A._rocket_is_nonspend(r)]
    names = sorted(r["name"] for r in dropped)
    assert names == ["Robinhood", "UBER * EATS PENDING"], names
    assert round(sum(r["amount"] for r in dropped), 2) == DROPPED_TOTAL

    spend = [r for r in rows if not A._rocket_is_nonspend(r)]
    assert round(sum(r["amount"] for r in spend), 2) == SPEND_TOTAL
    assert round(SPEND_TOTAL + DROPPED_TOTAL, 2) == RAW_TOTAL, "the gap must fully account"


def test_every_counted_charge_has_somewhere_to_go():
    """The invariant that keeps the month tab reconcilable.

    _finance_sync_month adds a charge to csv_total BEFORE deciding where to write it,
    so a category outside PLACEABLE_CATEGORIES would be counted as spending and never
    written — the tab could then never reach Rocket Money's total. This is the test
    that fails if someone maps a Rocket Money category to, say, 'Shopping' without
    first giving the Sheet a Shopping section."""
    for r in _rows():
        if A._rocket_is_nonspend(r):
            continue
        cat = A._rocket_to_finance_category(r.get("category"), r.get("name"))
        assert cat in A.PLACEABLE_CATEGORIES, (
            f"{r['name']!r} (Rocket Money category {r['category']!r}) maps to {cat!r}, "
            f"which the Sheet has no home for. Placeable: {sorted(A.PLACEABLE_CATEGORIES)}"
        )


def test_category_split_is_stable():
    rows = [r for r in _rows() if not A._rocket_is_nonspend(r)]
    by = defaultdict(float)
    for r in rows:
        by[A._rocket_to_finance_category(r["category"], r["name"])] += r["amount"]
    got = {k: round(v, 2) for k, v in by.items()}
    assert got == EXPECTED_BY_CATEGORY, f"\n  got      {got}\n  expected {EXPECTED_BY_CATEGORY}"
    assert round(sum(got.values()), 2) == SPEND_TOTAL


def test_known_merchants_land_where_they_should():
    """Spot-checks for the mappings that are easy to break, including the ones that
    only work because a merchant match beats the Rocket Money category."""
    m = A._rocket_to_finance_category
    # Merchant beats category:
    assert m("Bills & Utilities", "Planet Fitness") == "Subscriptions"
    assert m("Bills & Utilities", "Microsoft*Realms 1 Mon") == "Subscriptions"
    assert m("Entertainment & Rec.", "Netflix") == "Subscriptions"
    assert m("Shopping", "CLOUD 6wHSWS") == "Subscriptions"
    assert m("Home & Garden", "The Grove") == "Utilities"        # rent
    # Category drives the rest:
    assert m("Auto & Transport", "MURPHY EXPRESS 8559") == "Gas"
    assert m("Dining & Drinks", "Chick-fil-A") == "Dining and Drinks"
    assert m("Bills & Utilities", "AMER ELECT PWR") == "Utilities"
    # The curly apostrophe Rocket Money actually exports:
    assert m("Subscription’s", "Hulu") == "Subscriptions"
    assert m("Shopping", "REVERB.COM LLC") == "Shopping"
    assert m("Shopping", "WM SUPERCENTER #5260") == "Shopping"
    # Fun stays the catch-all for anything with no better home.
    assert m("Family Care", "GREENLIGHT N-766968") == "Fun"
    assert m("Entertainment & Rec.", "Malco Pinnacle Hills") == "Fun"


def test_pending_charges_are_held_back():
    assert A._rocket_is_nonspend({"amount": 32.44, "category": "Dining & Drinks",
                                  "name": "UBER * EATS PENDING"})
    assert not A._rocket_is_nonspend({"amount": 32.44, "category": "Dining & Drinks",
                                      "name": "UBER * EATS"})


def test_income_and_transfers_never_count_as_spending():
    for cat in ("Investment", "Credit Card Payment", "Transfers", "Paycheck"):
        assert A._rocket_is_nonspend({"amount": 500, "category": cat, "name": "x"}), cat
    assert A._rocket_is_nonspend({"amount": -500, "category": "Dining & Drinks", "name": "refund"})





def test_shopping_folds_into_fun_when_the_tab_has_no_shopping_table():
    """DETAIL_TABLE_FALLBACK is what keeps older tabs reconcilable. Splitting Shopping
    out must not strand those charges on a tab that has no table to put them in, so the
    sync folds them back into Fun and says so. The month total is identical either way —
    that is the property that matters."""
    assert A.DETAIL_TABLE_FALLBACK["Shopping"] == "Fun"

    rows = [r for r in _rows() if not A._rocket_is_nonspend(r)]
    split, folded = defaultdict(float), defaultdict(float)
    for r in rows:
        cat = A._rocket_to_finance_category(r["category"], r["name"])
        split[cat] += r["amount"]
        folded[A.DETAIL_TABLE_FALLBACK.get(cat, cat)] += r["amount"]

    assert round(folded["Fun"], 2) == FUN_IF_NO_SHOPPING_TABLE
    assert "Shopping" not in folded
    assert round(sum(split.values()), 2) == round(sum(folded.values()), 2) == SPEND_TOTAL


def test_shopping_is_placeable_either_way():
    """Whichever side of the fallback a charge lands on, it has a home — this is what
    stops the split-out from silently dropping $1,158."""
    assert "Shopping" in A.PLACEABLE_CATEGORIES
    for src, dest in A.DETAIL_TABLE_FALLBACK.items():
        assert src in A.PLACEABLE_CATEGORIES, src
        assert dest in A.PLACEABLE_CATEGORIES, dest


def main():
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    failed = 0
    for t in tests:
        try:
            t()
            print(f"  PASS  {t.__name__}")
        except AssertionError as e:
            failed += 1
            print(f"  FAIL  {t.__name__}\n        {e}")
    print(f"\n{len(tests) - failed}/{len(tests)} passed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
