"""
cycle_utils — Calendar / lifecycle helpers shared across goal-routes.

Two review cadences are supported on the same column family:
    - half_yearly orgs use H1 / H2 (two windows per FY).
    - quarterly  orgs use Q1 / Q2 / Q3 / Q4 (four windows per FY).

The cycle code (e.g. "H1", "Q3") is derived from the calendar instant and
the org's cycle_type. The cycle_type is also baked into the code's prefix
("H" → half-yearly, "Q" → quarterly), so a function holding only the
cycle code can recover the cadence without an extra arg — see
`cycle_keys_for`.
"""

from datetime import date, datetime
from app.models.system_settings_models import CycleType


# ── Cadence helpers ─────────────────────────────────────────────────

#: The full ordered list of cycle codes for each cadence.
HALF_KEYS:    tuple[str, ...] = ("H1", "H2")
QUARTER_KEYS: tuple[str, ...] = ("Q1", "Q2", "Q3", "Q4")


def cycle_keys_for(cycle_code: str) -> tuple[str, ...]:
    """Recover the full cadence list from any single cycle code's prefix.

    "H1" / "H2"      → ("H1", "H2")
    "Q1".."Q4"       → ("Q1", "Q2", "Q3", "Q4")

    Raises ValueError on unknown prefixes so callers don't silently treat
    a typo as half-yearly.
    """
    if cycle_code.startswith("H"):
        return HALF_KEYS
    if cycle_code.startswith("Q"):
        return QUARTER_KEYS
    raise ValueError(f"Unknown cycle code: {cycle_code!r}")


def cycles_before(cycle_code: str) -> tuple[str, ...]:
    """All cycle codes that come before `cycle_code` in the same cadence.

    "H1" → ()             "H2" → ("H1",)
    "Q1" → ()             "Q3" → ("Q1", "Q2")
    """
    keys = cycle_keys_for(cycle_code)
    return keys[: keys.index(cycle_code)]


# ── Calendar → cycle code ───────────────────────────────────────────

def get_goal_cycle_name(created_at: datetime, fiscal_start_month: int = 4) -> str:
    """
    Derive the FY cycle label for an annual goal from its creation timestamp.

    Returns "FY26-27" — the fiscal-year span the goal belongs to. The H1/H2
    distinction is per-review, not per-goal: each annual goal is reviewed
    twice within its FY, and the half is recorded on GoalSelfReview.cycle_half.
    The "Action" column on review rows composes the half + FY into
    "H1 FY26-27" for display.
    """
    month = created_at.month
    fiscal_year = created_at.year if month >= fiscal_start_month else created_at.year - 1
    return _format_fy_span(fiscal_year)


def current_half_and_fy(current_date: date, fiscal_start_month: int = 4) -> tuple[str, int]:
    """Return ('H1' | 'H2', fiscal_year_4_digit) for the given calendar instant.

    Independent of cycle_type — the calendar half is purely a function of
    the date and the fiscal_start_month. (Quarterly orgs still have an "H1"
    that runs Q1+Q2 and an "H2" that runs Q3+Q4.)
    """
    month = current_date.month
    year = current_date.year
    fiscal_year = year if month >= fiscal_start_month else year - 1
    relative_month = (month - fiscal_start_month) % 12
    half = "H1" if relative_month < 6 else "H2"
    return (half, fiscal_year)


def current_quarter_and_fy(current_date: date, fiscal_start_month: int = 4) -> tuple[str, int]:
    """Return ('Q1'..'Q4', fiscal_year_4_digit) for the given calendar instant."""
    month = current_date.month
    year = current_date.year
    fiscal_year = year if month >= fiscal_start_month else year - 1
    relative_month = (month - fiscal_start_month) % 12
    q_num = (relative_month // 3) + 1
    return (f"Q{q_num}", fiscal_year)


def current_cycle_and_fy(
    current_date: date,
    cycle_type: CycleType | str,
    fiscal_start_month: int = 4,
) -> tuple[str, int]:
    """Return (cycle_code, fy_year) appropriate to the org's cadence.

    Picks half-yearly or quarterly based on cycle_type. Annual orgs fall
    back to the H1/H2 cadence (since they don't use review windows).
    """
    ct = cycle_type.value if isinstance(cycle_type, CycleType) else cycle_type
    if ct == CycleType.QUARTERLY.value:
        return current_quarter_and_fy(current_date, fiscal_start_month)
    return current_half_and_fy(current_date, fiscal_start_month)


# ── Time-window gate ────────────────────────────────────────────────

def is_review_window_open(
    target_cycle: str,
    target_fy_year: int,
    current_date: date,
    fiscal_start_month: int = 4,
) -> bool:
    """True iff the (target_cycle, target_fy_year) review window is open.

    Rule (per product spec):
        - Same FY required — no cross-fiscal-year reviews.
        - A cycle's window opens at the start of that cycle and stays open
          through the end of the FY (so any earlier cycle can be backfilled
          while the FY is still in flight).

    Examples (fiscal_start_month=4):
        is_review_window_open("H1", 2026, date(2026, 5, 1)) → True   (H1 of FY26)
        is_review_window_open("H2", 2026, date(2026, 5, 1)) → False  (H2 not yet)
        is_review_window_open("H1", 2026, date(2026, 11, 1)) → True  (backfill OK)
        is_review_window_open("H2", 2026, date(2026, 11, 1)) → True  (current)
        is_review_window_open("Q3", 2026, date(2026, 11, 1)) → True  (Q3 of FY26)
        is_review_window_open("Q4", 2026, date(2026, 11, 1)) → False (Q4 not yet)
        is_review_window_open("H1", 2026, date(2027, 5, 1))  → False (FY ended)
    """
    keys = cycle_keys_for(target_cycle)
    # Pick the matching cadence's "current cycle" reading.
    if keys == HALF_KEYS:
        current_code, current_fy = current_half_and_fy(current_date, fiscal_start_month)
    else:
        current_code, current_fy = current_quarter_and_fy(current_date, fiscal_start_month)
    if current_fy != target_fy_year:
        return False
    return keys.index(target_cycle) <= keys.index(current_code)


def cycle_date_range(
    cycle_code: str,
    fy_year: int,
    fiscal_start_month: int = 4,
) -> tuple[date, date]:
    """Return (start_date, end_date) of the cycle within its fiscal year.

    `fy_year` is the fiscal-year *start* year — e.g. 2026 for FY2026-27,
    which begins on `fiscal_start_month` of 2026 and ends the day before
    that month in 2027.

    Examples (fiscal_start_month=4):
        cycle_date_range("H1", 2026) -> (2026-04-01, 2026-09-30)
        cycle_date_range("H2", 2026) -> (2026-10-01, 2027-03-31)
        cycle_date_range("Q1", 2026) -> (2026-04-01, 2026-06-30)
        cycle_date_range("Q4", 2026) -> (2027-01-01, 2027-03-31)

    Used by the project-review queue logic to decide whether a given
    ProjectAssignment overlapped a cycle's window — that's the
    predicate for "should this person have a review for this cycle?"
    """
    keys = cycle_keys_for(cycle_code)
    idx = keys.index(cycle_code)
    months_per_cycle = 12 // len(keys)  # 6 for half, 3 for quarter

    start_month_offset = idx * months_per_cycle
    end_month_offset = start_month_offset + months_per_cycle  # exclusive

    start_month = ((fiscal_start_month - 1) + start_month_offset) % 12 + 1
    start_year = fy_year + ((fiscal_start_month - 1) + start_month_offset) // 12

    # End date is the last day of the month before `end_month_offset`.
    end_month = ((fiscal_start_month - 1) + end_month_offset - 1) % 12 + 1
    end_year = fy_year + ((fiscal_start_month - 1) + end_month_offset - 1) // 12

    start = date(start_year, start_month, 1)
    # Compute last day of `end_month` in `end_year` without external libs.
    if end_month == 12:
        next_month_first = date(end_year + 1, 1, 1)
    else:
        next_month_first = date(end_year, end_month + 1, 1)
    end = date.fromordinal(next_month_first.toordinal() - 1)
    return (start, end)


def parse_cycle_name(cycle_name: str) -> tuple[str, int] | None:
    """Parse the canonical app-format cycle name into (code, fy_year).

    Examples:
        "H1 FY26-27"  -> ("H1", 2026)
        "Q3 FY27-28"  -> ("Q3", 2027)
        "FY26-27"     -> None  (annual cadence, no review code)

    Returns None when the input doesn't carry a code prefix (annual orgs).
    """
    parts = cycle_name.strip().split()
    if len(parts) < 2:
        return None
    code = parts[0].upper()
    fy_token = parts[1].upper()
    if not (code.startswith("H") or code.startswith("Q")):
        return None
    if not fy_token.startswith("FY"):
        return None
    # FY26-27 -> 26 -> 2026  (handle 4-digit "FY2026-27" too)
    digits = fy_token[2:].split("-")[0]
    try:
        n = int(digits)
    except ValueError:
        return None
    if n < 100:
        # Two-digit year: assume 21st century (2000–2099).
        n += 2000
    return (code, n)


def extract_fy_label(cycle_name: str) -> str:
    """
    Extract the bare fiscal-year label from any cycle name.

    The active_cycle_name on SystemSettings follows the cadence of the org's
    review cycle (e.g. "H1 FY26-27", "Q2 FY26-27"), but annual goals belong
    to a full fiscal year, not a half or quarter.  This helper strips the
    period prefix so the goal is stamped with just the year it belongs to.

        "H1 FY26-27"  →  "FY26-27"
        "Q3 FY27-28"  →  "FY27-28"
        "FY26-27"     →  "FY26-27"   (already bare — returned unchanged)
        "H1 FY26"     →  "FY26"      (legacy 2-digit form, still tolerated)
    """
    for token in cycle_name.upper().split():
        if token.startswith("FY"):
            return token
    return cycle_name  # Fallback: return as-is if pattern not found


def get_current_cycle_info(current_date: date, cycle_type: CycleType, fiscal_start_month: int = 4) -> str:
    """
    Returns the cycle name in the canonical format used across the app:
      half_yearly → "H1 FY26-27"   (April–September 2026, FY 2026-2027)
      quarterly   → "Q1 FY26-27"   (April–June 2026)
      annual      → "FY26-27"
    """
    month = current_date.month
    fiscal_year = current_date.year if month >= fiscal_start_month else current_date.year - 1
    fy_label = _format_fy_span(fiscal_year)  # e.g. 2026 → "FY26-27"

    relative_month = (month - fiscal_start_month) % 12

    if cycle_type == CycleType.QUARTERLY:
        q_num = (relative_month // 3) + 1
        return f"Q{q_num} {fy_label}"

    elif cycle_type == CycleType.HALF_YEARLY:
        h_num = (relative_month // 6) + 1
        return f"H{h_num} {fy_label}"

    else:
        return fy_label


def _format_fy_span(fiscal_year: int) -> str:
    """Render the FY token as a spanning two-year window: 2026 → 'FY26-27'.

    Wraps year-mod-100 cleanly across century boundaries (FY99 → FY99-00).
    """
    a = fiscal_year % 100
    b = (fiscal_year + 1) % 100
    return f"FY{a:02d}-{b:02d}"
