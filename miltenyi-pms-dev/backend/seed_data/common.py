"""
seed_data.common — the parts every Miltenyi seed shares.

Two runnable seeds sit in backend/ and both call into here:

    miltenyi-test-seed.py   the testing instance: 13 users (Admin, 3 mentors,
                            9 staff) on schema `miltenyi`
    miltenyi-uat-seed.py    the UAT instance: the stakeholders only, on
                            schema `miltenyi_uat`

What is shared (and idempotent — every step is a no-op on re-run):
    * the Miltenyi organisation with the enabled feature list
    * reference data: 8 GCC functions, ~36 designations with career levels,
      the 32 role-expectation rows (seed_data.gcc)
    * the Project Goals framework for the current goal year, from the
      Miltenyi "CY 2026 INDICATIVE GOAL THEMES" PDFs (seed_data.goal_themes)
    * System Settings (half-yearly, Asia/Kolkata), the per-year switches
      for FY26-27 (all open) and the goal year CY 26-27 with Q1–Q3 rolled
      out and Q3 current — so annual goals and reviews read H2 · CY 26-27
    * `ensure_user`, which creates a user once and reuses it afterwards

Only the cast differs between the seeds; content edits belong here or in
seed_data/gcc.py and seed_data/goal_themes.py so both instances stay in step.
"""

from __future__ import annotations

from sqlalchemy.orm import Session

from app.core.security import get_password_hash
from app.models.organization_models import Organization
from app.models.project_goal_models import (
    GoalFramework,
    GoalFrameworkKpi,
    ProjectGoalPeriodSettings,
    ProjectGoalQuarter,
    quarter_label,
)
from app.models.reference_models import Designation, Function
from app.models.role_expectation_models import RoleExpectation
from app.models.system_settings_models import CycleType, SystemSettings
from app.models.system_settings_year_override_models import SystemSettingsYearOverride
from app.models.user_models import User
from seed_data.gcc import GCC_DESIGNATIONS, GCC_ROLE_EXPECTATIONS, LEVEL_LABEL
from seed_data.goal_themes import GOAL_THEMES, PERIOD_LABEL

# `project_reviews` is deliberately absent: the per-project PM review queue
# is retired for the Miltenyi instance in favour of `project_goals` (Sep 2026
# stakeholder decision). The code stays; the server-side gate hides it.
ENABLED_FEATURES = (
    "dashboard", "goals", "project_goals", "annual_reviews", "mentoring", "admin",
)

#: The fiscal year the per-year switches are seeded for, and the cycle the
#: instance starts in (Q3 of the goal year -> H2).
FY_LABEL = "FY26-27"
ACTIVE_CYCLE = "H2 FY26-27"
CURRENT_QUARTER = 3

#: Every seeded account uses this password (stakeholder convenience).
DEFAULT_PASSWORD = "password123"


def ensure_org(db: Session) -> Organization:
    """The Miltenyi organisation with the current feature list."""
    org = db.query(Organization).filter(Organization.name == "Miltenyi").first()
    if not org:
        org = Organization(name="Miltenyi", domain="miltenyi.com", enabled_features=list(ENABLED_FEATURES))
        db.add(org)
        db.commit()
        db.refresh(org)
        print("  [+] Organization: Miltenyi")
    elif list(org.enabled_features or []) != list(ENABLED_FEATURES):
        # Keep the feature list current on re-runs: the server-side gate
        # reads it, so a stale list would hide Project Goals.
        org.enabled_features = list(ENABLED_FEATURES)
        db.commit()
        print("  [~] Organization 'Miltenyi' already exists; feature list refreshed.")
    else:
        print("  [~] Organization 'Miltenyi' already exists; reusing.")
    return org


def ensure_reference_data(db: Session, org: Organization) -> None:
    """8 GCC functions × 4 career levels of designations, each designation
    linked to its function (Project Goals resolves function × level to a
    framework row)."""
    if db.query(Function).filter(Function.org_id == org.id).count() == 0:
        names = sorted({fname for fname, _, _ in GCC_DESIGNATIONS})
        for fname in names:
            db.add(Function(org_id=org.id, name=fname))
        db.flush()
        fn_ids = {f.name: f.id for f in db.query(Function).filter_by(org_id=org.id)}
        for fname, lvl, titles in GCC_DESIGNATIONS:
            for title in titles:
                db.add(Designation(
                    org_id=org.id, name=title,
                    level=lvl, career_level=lvl, career_level_label=LEVEL_LABEL[lvl],
                    function_id=fn_ids.get(fname),
                ))
        db.commit()
        print(f"  [+] {len(names)} GCC Functions and {sum(len(t) for _, _, t in GCC_DESIGNATIONS)} Designations")
    else:
        print("  [~] Reference data already exists; reusing.")

    # Backfill the designation -> function link on databases seeded before
    # the column existed.
    fn_ids = {f.name: f.id for f in db.query(Function).filter_by(org_id=org.id)}
    title_fn = {title: fname for fname, _, titles in GCC_DESIGNATIONS for title in titles}
    linked = 0
    for d in db.query(Designation).filter_by(org_id=org.id, function_id=None):
        fid = fn_ids.get(title_fn.get(d.name, ""))
        if fid:
            d.function_id = fid
            linked += 1
    if linked:
        db.commit()
        print(f"  [~] Linked {linked} designations to their functions")


def function_by_name(db: Session, org: Organization, name: str) -> Function | None:
    return db.query(Function).filter_by(org_id=org.id, name=name).first()


def designation_by_name(db: Session, org: Organization, name: str) -> Designation | None:
    return db.query(Designation).filter_by(org_id=org.id, name=name).first()


def ensure_user(db: Session, org: Organization, email: str, *, password: str = DEFAULT_PASSWORD, **kwargs) -> User:
    """Create the user once (by email within the org); reuse afterwards."""
    existing = db.query(User).filter_by(org_id=org.id, email=email).first()
    if existing:
        return existing
    u = User(
        org_id=org.id, email=email,
        password_hash=get_password_hash(password),
        must_change_password=False,
        **kwargs,
    )
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


def ensure_system_settings(db: Session, org: Organization, admin: User) -> None:
    """Half-yearly cadence in Asia/Kolkata; the cycle label follows the goal
    year's current quarter (Q3 -> H2) and is kept in step by the app."""
    if not db.query(SystemSettings).filter(SystemSettings.org_id == org.id).first():
        db.add(SystemSettings(
            org_id=org.id,
            active_cycle_name=ACTIVE_CYCLE,
            cycle_type=CycleType.HALF_YEARLY.value,
            fiscal_start_month=4,
            timezone="Asia/Kolkata",
            updated_by_id=admin.id,
        ))
        db.commit()
        print(f"  [+] System Settings (half-yearly, {ACTIVE_CYCLE} - follows Q{CURRENT_QUARTER}, Asia/Kolkata)")
    else:
        print("  [~] System settings already exist; reusing.")

    if not db.query(SystemSettingsYearOverride).filter_by(org_id=org.id, fy_label=FY_LABEL).first():
        db.add(SystemSettingsYearOverride(
            org_id=org.id, fy_label=FY_LABEL,
            annual_reviews_enabled=True,
            annual_review_final_rating_visible=True,
            annual_goals_edit_enabled=True,
            goal_reviews_visible_h1=True,
            goal_reviews_visible_h2=True,
            management_review_enabled=True,
            updated_by_id=admin.id,
        ))
        db.commit()
        print(f"  [+] {FY_LABEL} switches: annual reviews open, ratings visible, goal editing on, goal reviews visible, management review open")
    else:
        print(f"  [~] {FY_LABEL} switches already exist; reusing.")


def ensure_role_expectations(db: Session, org: Organization) -> None:
    """32 GCC rows (8 functions × 4 career levels), keyed on (function, level)."""
    if db.query(RoleExpectation).filter(RoleExpectation.org_id == org.id).count() == 0:
        inserted = 0
        for (func_name, career_level), fields in GCC_ROLE_EXPECTATIONS.items():
            fn = function_by_name(db, org, func_name)
            if not fn:
                continue
            db.add(RoleExpectation(org_id=org.id, function_id=fn.id, career_level=career_level, **fields))
            inserted += 1
        db.commit()
        print(f"  [+] Role Expectations: {inserted} rows (8 functions × 4 career levels)")
    else:
        print("  [~] Role expectations already exist; reusing.")


def ensure_goal_framework(db: Session, org: Organization, admin: User) -> None:
    """The Project Goals framework for the goal year: 7 functions × 4 levels
    from the goal-theme PDFs (Pharmacovigilance has no PDF and no rows)."""
    if db.query(GoalFramework).filter(GoalFramework.org_id == org.id).count() == 0:
        rows = 0
        for func_name, levels in GOAL_THEMES.items():
            fn = function_by_name(db, org, func_name)
            if not fn:
                continue
            for level, row in levels.items():
                fw = GoalFramework(
                    org_id=org.id, function_id=fn.id, level=level, period_label=PERIOD_LABEL,
                    title=row["title"], business_outcomes=row["business_outcomes"],
                    functional_goals=row["functional_goals"], created_by_id=admin.id,
                )
                db.add(fw)
                db.flush()
                for seq, (text, weight) in enumerate(row["kpis"], start=1):
                    db.add(GoalFrameworkKpi(framework_id=fw.id, seq=seq, text=text, weightage=weight))
                rows += 1
        db.commit()
        print(f"  [+] Project Goals framework: {rows} rows for {PERIOD_LABEL} (7 functions × 4 levels)")
    else:
        print("  [~] Project Goals framework already exists; reusing.")


def ensure_goal_period(db: Session, org: Organization, admin: User) -> None:
    """Goal year CY 26-27: active, goal entry open, weightages visible, one
    "Additional goals" row per sheet, Q1–Q3 rolled out with Q3 current and
    ratings hidden. Testers backfill earlier quarters and roll Q4 out."""
    if not db.query(ProjectGoalPeriodSettings).filter_by(org_id=org.id, period_label=PERIOD_LABEL).first():
        db.add(ProjectGoalPeriodSettings(
            org_id=org.id, period_label=PERIOD_LABEL, is_active=True,
            entry_open=True, weightages_visible=True, current_quarter_seq=CURRENT_QUARTER,
            extra_goal_enabled=True,
            updated_by_id=admin.id,
        ))
        for seq in range(1, CURRENT_QUARTER + 1):
            db.add(ProjectGoalQuarter(
                org_id=org.id, period_label=PERIOD_LABEL, seq=seq,
                cycle_label=quarter_label(PERIOD_LABEL, seq), ratings_visible=False, opened_by_id=admin.id,
            ))
        db.commit()
        print(f"  [+] Project Goals period {PERIOD_LABEL}: active, goal entry open, weightages visible, "
              f"current quarter Q{CURRENT_QUARTER} (Q1-Q{CURRENT_QUARTER} rolled out, ratings hidden)")
    else:
        print("  [~] Project Goals period settings already exist; reusing.")


def seed_shared(db: Session, org: Organization, admin: User) -> None:
    """Everything after the organisation and the Admin: reference data,
    settings, role expectations, framework, goal year."""
    ensure_system_settings(db, org, admin)
    ensure_role_expectations(db, org)
    ensure_goal_framework(db, org, admin)
    ensure_goal_period(db, org, admin)
