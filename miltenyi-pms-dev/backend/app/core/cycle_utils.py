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

from datetime import date, datetime, timedelta, timezone
from typing import Optional, TYPE_CHECKING
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
from app.models.system_settings_models import CycleType

if TYPE_CHECKING:
    # Imported only for type hints to avoid a runtime circular import:
    # cycle_utils is consumed by route modules that themselves import
    # SystemSettings, and the model module imports CycleType from here.
    from app.models.system_settings_models import SystemSettings
    from app.models.system_settings_year_override_models import (
        SystemSettingsYearOverride,
    )
    from app.models.annual_review_models import AnnualReview
    from app.models.goal_models import Goal
    from app.models.project_review_models import ProjectReview
    from sqlalchemy.orm import Session as SqlSession


def _org_tz(settings: "Optional[SystemSettings]") -> "ZoneInfo | timezone":
    """Resolve the org's timezone from settings, falling back to UTC.

    `settings.timezone` is a freeform IANA string column. A bad value
    (typo, deprecated zone, missing tzdata on the host) must not
    take down the cycle path — we just fall back to UTC. The bad
    string stays in the DB so HR can correct it later; nothing else
    breaks.
    """
    if settings is None:
        return timezone.utc
    tz_name = getattr(settings, "timezone", None)
    if not tz_name:
        return timezone.utc
    try:
        return ZoneInfo(tz_name)
    except (ZoneInfoNotFoundError, Exception):
        return timezone.utc


def resolve_today(settings: "Optional[SystemSettings]" = None) -> date:
    """Return the date the rest of the system should treat as "today".

    Priority:
      1. `settings.simulated_today` (demo / QA override) wins outright.
      2. Otherwise: `datetime.now(org_tz).date()` — the calendar day in
         the org's configured timezone.
      3. If `settings` is None or carries an unparseable timezone, falls
         back to UTC.

    Used by every cycle-determination, FY-end, and review-window check
    so users near midnight in a non-UTC zone don't experience off-by-
    one rollovers vs. the server clock.

    Audit timestamps (project completion, assignment end, export
    filename) intentionally bypass this helper — they must always
    reflect real wall time / a deterministic UTC instant.
    """
    if settings is not None and getattr(settings, "simulated_today", None):
        return settings.simulated_today
    return datetime.now(_org_tz(settings)).date()


def resolve_now(settings: "Optional[SystemSettings]" = None) -> datetime:
    """Return the current wall instant as a timezone-aware datetime in
    the org's timezone.

    Used for cycle-stamping helpers that need a datetime (not just a
    date) — e.g. `get_goal_cycle_name(created_at, fiscal_start_month)`
    which derives the FY label from a timestamp's year+month. Picking
    the org's tz ensures a user in Asia/Kolkata creating a goal at
    01:00 IST on April 1 sees the new FY's label, instead of the
    server's UTC midnight-was-still-yesterday answer.

    When `settings.simulated_today` is set, returns midnight of that
    date in the org's tz so cycle math stays deterministic during
    date-simulation demos.
    """
    org_tz = _org_tz(settings)
    if settings is not None and getattr(settings, "simulated_today", None):
        return datetime.combine(
            settings.simulated_today, datetime.min.time(), tzinfo=org_tz
        )
    return datetime.now(org_tz)


def apply_rollover_resets(settings: "SystemSettings", fresh_cycle: str) -> bool:
    """Reset the org-wide submission / visibility flags whenever the
    active cycle has changed since `settings.active_cycle_name` was
    last stored.

    Resets three flags to False:
      - `annual_reviews_enabled`
      - `project_ratings_visible`
      - `annual_review_final_rating_visible`

    Preserved (intentionally): `annual_goals_edit_enabled`. HR may want
    annual-goal editing to stay open across the rollover; they re-open
    the others deliberately per cycle.

    Also updates `settings.active_cycle_name` to the new value so
    subsequent calls short-circuit. Returns True when a reset was
    applied. Caller is responsible for `db.commit()`.
    """
    if settings.active_cycle_name == fresh_cycle:
        return False
    settings.active_cycle_name = fresh_cycle
    settings.annual_reviews_enabled = False
    settings.project_ratings_visible = False
    settings.annual_review_final_rating_visible = False
    return True


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
    *,
    override: bool = False,
) -> bool:
    """True iff the (target_cycle, target_fy_year) review window is open.

    Rule (per product spec):
        - Same FY required — no cross-fiscal-year reviews.
        - A cycle's window opens at the start of that cycle and stays open
          through the end of the FY (so any earlier cycle can be backfilled
          while the FY is still in flight).

    Demo escape hatch: if `override=True` (driven by the SystemSettings
    `cycle_window_override` flag), this returns True unconditionally so
    stakeholders can fill both H1 and H2 reviews in a single session
    even when calendar time hasn't reached H2 yet. Production should
    always pass override=False; the flag is meant for non-production
    test instances only.

    Examples (fiscal_start_month=4):
        is_review_window_open("H1", 2026, date(2026, 5, 1)) → True   (H1 of FY26)
        is_review_window_open("H2", 2026, date(2026, 5, 1)) → False  (H2 not yet)
        is_review_window_open("H1", 2026, date(2026, 11, 1)) → True  (backfill OK)
        is_review_window_open("H2", 2026, date(2026, 11, 1)) → True  (current)
        is_review_window_open("Q3", 2026, date(2026, 11, 1)) → True  (Q3 of FY26)
        is_review_window_open("Q4", 2026, date(2026, 11, 1)) → False (Q4 not yet)
        is_review_window_open("H1", 2026, date(2027, 5, 1))  → False (FY ended)
        is_review_window_open("H2", 2026, date(2026, 5, 1), override=True) → True
    """
    if override:
        return True
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


import re as _re

_FY_TOKEN_RE = _re.compile(r"FY(\d{2,4})", _re.IGNORECASE)


def extract_fy_year(cycle_name: str | None) -> int | None:
    """Pull the 4-digit fiscal start year out of any cycle name string.

    Accepts the same shapes `extract_fy_label` does, plus the legacy
    "H1 2026" / "H2 2026" form. Two-digit FY tokens are interpreted as
    2000-relative (FY26 → 2026), matching the convention everywhere
    else in the codebase. Returns None when no recognisable token is
    present (or the input is None / empty).
    """
    if not cycle_name:
        return None
    match = _FY_TOKEN_RE.search(cycle_name)
    if match:
        head = match.group(1).split("-", 1)[0]
        if head.isdigit():
            return 2000 + int(head) if len(head) <= 2 else int(head)
    for token in cycle_name.upper().split():
        if token.isdigit() and len(token) == 4:
            return int(token)
    return None


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


# ── Per-year override row helpers ────────────────────────────────────
#
# The four access-control toggles now live on `system_settings_year_overrides`
# keyed on `(org_id, fy_label)`. These helpers centralise the lookup so
# gating helpers in route modules don't each re-parse cycle strings or
# duplicate the lazy-create logic.

#: Flag names whose values move from `SystemSettings` to per-FY override
#: rows. Listed once so seed paths can copy them as a unit.
YEAR_OVERRIDE_FLAGS: tuple[str, ...] = (
    "annual_reviews_enabled",
    "annual_review_final_rating_visible",
    "annual_goals_edit_enabled",
    "project_ratings_visible",
)


def _fy_label_of_cycle_string(cycle_text: str | None) -> str | None:
    """Strip any cycle prefix off `cycle_text` and return the bare FY token.

    Wraps `extract_fy_label` but returns None instead of echoing the
    input back when no FY token is present, so callers can distinguish
    "unknown FY — default-deny" from a successful lookup.
    """
    if not cycle_text:
        return None
    extracted = extract_fy_label(cycle_text)
    return extracted if extracted.upper().startswith("FY") else None


def _fy_label_of_review(review: "AnnualReview") -> str | None:
    """FY label for an annual review row.

    `AnnualReview.cycle_name` is already stored as the bare FY token
    ("FY26-27") at creation time (see `_active_fy_label` in
    annual_review_routes), so this is a thin wrapper that guards against
    legacy "H1 FY26-27" stamping that may exist on older rows.
    """
    return _fy_label_of_cycle_string(getattr(review, "cycle_name", None))


def _fy_label_of_goal(goal: "Goal") -> str | None:
    """FY label for a goal row.

    Annual goals stamp `cycle_name` to the bare FY at creation
    (`get_goal_cycle_name`). Regular goals have a NULL `cycle_name`;
    those return None and the caller decides what to do (regular goals
    don't go through the annual-goal gate).
    """
    return _fy_label_of_cycle_string(getattr(goal, "cycle_name", None))


def _fy_label_of_project_review(review: "ProjectReview") -> str | None:
    """FY label for a project review row.

    `ProjectReview.cycle` carries the full cycle name ("Q1 FY26-27"),
    not the bare FY — we strip the period prefix here.
    """
    return _fy_label_of_cycle_string(getattr(review, "cycle", None))


def get_year_override(
    db: "SqlSession",
    org_id: int,
    fy_label: str | None,
) -> "SystemSettingsYearOverride | None":
    """Look up the override row for (org_id, fy_label). Does NOT create.

    Returns None when the FY label is missing or no row exists. Gating
    helpers use this when the default-deny / past-FY-passthrough policy
    requires distinguishing "row missing" from "row present but flag
    False" — `ensure_year_override_row` is for the admin write path.
    """
    if not fy_label:
        return None
    # Local import dodges the model-layer circular: cycle_utils is
    # imported by route modules that import the model, and the model
    # itself reaches back into cycle_utils via TYPE_CHECKING.
    from app.models.system_settings_year_override_models import (
        SystemSettingsYearOverride,
    )
    return (
        db.query(SystemSettingsYearOverride)
        .filter(
            SystemSettingsYearOverride.org_id == org_id,
            SystemSettingsYearOverride.fy_label == fy_label,
        )
        .first()
    )


def ensure_year_override_row(
    db: "SqlSession",
    org_id: int,
    fy_label: str,
    *,
    seed_from_settings: "Optional[SystemSettings]" = None,
    updated_by_id: Optional[int] = None,
) -> "SystemSettingsYearOverride":
    """Lazily create the override row for (org_id, fy_label) and return it.

    Seeding precedence on creation:
      1. The most recent existing override row for the same org (so a
         new FY inherits the previous FY's configuration — HR almost
         always wants this).
      2. The legacy flag values on `SystemSettings` when `seed_from_settings`
         is supplied (used by the admin and read paths that already have
         the row in hand).
      3. All-False defaults.

    The created row is committed before return so concurrent readers
    don't see a phantom session-local row. Caller does NOT need to
    commit again unless they're mutating the row in the same request.
    """
    existing = get_year_override(db, org_id, fy_label)
    if existing is not None:
        return existing

    from app.models.system_settings_year_override_models import (
        SystemSettingsYearOverride,
    )

    seed_values = {flag: False for flag in YEAR_OVERRIDE_FLAGS}

    # Prefer the latest existing override for this org as the seed source.
    latest_prior = (
        db.query(SystemSettingsYearOverride)
        .filter(SystemSettingsYearOverride.org_id == org_id)
        .order_by(SystemSettingsYearOverride.created_at.desc())
        .first()
    )
    if latest_prior is not None:
        for flag in YEAR_OVERRIDE_FLAGS:
            seed_values[flag] = bool(getattr(latest_prior, flag))
    elif seed_from_settings is not None:
        for flag in YEAR_OVERRIDE_FLAGS:
            seed_values[flag] = bool(getattr(seed_from_settings, flag, False))

    row = SystemSettingsYearOverride(
        org_id=org_id,
        fy_label=fy_label,
        updated_by_id=updated_by_id,
        **seed_values,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


# ── FY → calendar date range ────────────────────────────────────────


def fy_year_to_date_range(
    fy_year: int, fiscal_start_month: int = 4
) -> tuple[date, date]:
    """Convert a 4-digit FY start year into the inclusive [start, end]
    calendar dates of that fiscal year.

    Examples (fiscal_start_month=4, the default):
        2026 → (date(2026, 4, 1), date(2027, 3, 31))
        2023 → (date(2023, 4, 1), date(2024, 3, 31))

    fiscal_start_month=1 (calendar-year orgs) returns Jan 1 – Dec 31.
    """
    start = date(fy_year, fiscal_start_month, 1)
    if fiscal_start_month == 1:
        end = date(fy_year, 12, 31)
    else:
        end = date(fy_year + 1, fiscal_start_month, 1) - timedelta(days=1)
    return start, end


def fy_filter_to_date_ranges(
    fy_filter: Optional[set[int]],
    fiscal_start_month: int = 4,
) -> Optional[list[tuple[date, date]]]:
    """Convert a set of 4-digit FY start years into a list of
    [(fy_start, fy_end)] date ranges, sorted by start. Returns None when
    the filter is empty / None (caller treats that as "no narrowing")."""
    if not fy_filter:
        return None
    ranges = [
        fy_year_to_date_range(year, fiscal_start_month)
        for year in sorted(fy_filter)
    ]
    return ranges
