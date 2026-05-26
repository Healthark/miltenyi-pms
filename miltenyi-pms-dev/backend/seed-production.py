"""
seed-production.py - DESTRUCTIVE production-database first-load.

Intended for the Supabase Postgres demo environment. Wipes every domain
table in FK-safe order, then re-seeds a clean Healthark org with exactly
3 HR admin users.

WARNING: This will DELETE ALL DATA in the database pointed to by
DATABASE_URL. Requires interactive confirmation ("WIPE AND SEED") before
proceeding. Pass --yes to skip the confirmation in deploy automation.

Final state:
  Organization:  Healthark (domain: healtharkinsights.com)
  Functions:     Strategy, IDT, RWE, Marketing, HR
  Designations:  Consultant, Senior Consultant, Manager, Senior Manager,
                 Associate Director, Director,
                 HR Executive, Senior HR Executive, Head HR
  Users (all role=HR_MyOrg, password=password123):
    Amol Pandya      amol@healtharkinsights.com      Head HR              (no mentor)
    Devanshi Shukla  devanshi@healtharkinsights.com  Senior HR Executive  mentor=Amol
    Trapti Tiwari    trapti@healtharkinsights.com    HR Executive         mentor=Devanshi

Schema compatibility notes (kept in sync with backend/seed.py and the
current migrations):
  • Role taxonomy: the legacy "Admin" + is_management(bool) pair was
    replaced by the Role enum (HR_MyOrg / HR_Miltenyi / Mentor / PM /
    Employee). All 3 Healthark HR users are seeded as Role.HR_MYORG
    (full super-admin) — the platform-owner HR. The `is_management`
    column was dropped by the role_taxonomy_and_pm_field migration.
  • Designations carry `career_level` / `career_level_label` (1..4,
    Entry/Mid/Senior/Lead) but those are nullable; Healthark's
    internal consulting + HR ladders are not part of the GCC career
    path, so they're left null. The /me/expectations API renders a
    "Role expectation not defined" fallback for users without a
    career_level — that's the intended path for these HR admins.
  • RoleExpectation seeding is intentionally omitted. The old
    function×designation × 8-field PMS framework was replaced by the
    GCC (function × career_level × 6-field) framework, which is
    Miltenyi-specific content. The Healthark org doesn't need it; if
    HR wants role-expectation content later, it can be added via the
    admin UI or a follow-up seed.

Run:
  cd backend && python seed-production.py
  cd backend && python seed-production.py --yes   # non-interactive
"""

import sys
from urllib.parse import urlparse, urlunparse

from app.core.config import settings
from app.core.database import SessionLocal
from app.core.security import get_password_hash

from app.models.organization_models import Organization
from app.models.reference_models import Function, Designation
from app.models.user_models import User, Role
from app.models.system_settings_models import SystemSettings, CycleType
from app.models.system_settings_year_override_models import (
    SystemSettingsYearOverride,
)

from app.models.password_reset_token_models import PasswordResetToken
from app.models.notification_models import Notification
from app.models.goal_mentor_review_models import GoalMentorReview
from app.models.goal_self_review_models import GoalSelfReview
from app.models.goal_criteria_models import GoalCriterion
from app.models.goal_models import Goal
from app.models.role_expectation_models import RoleExpectation
from app.models.annual_review_models import AnnualReview
from app.models.project_review_models import ProjectReview, ProjectReviewEvaluator
from app.models.project_models import Project, ProjectAssignment
from app.models.export_audit_log_models import ExportAuditLog


PASSWORD = "password123"


def _sanitize_db_url(url: str) -> str:
    """Strip the password from a DB URL so it's safe to print."""
    try:
        parts = urlparse(url)
        if parts.password:
            netloc = parts.netloc.replace(f":{parts.password}@", ":****@")
            parts = parts._replace(netloc=netloc)
        return urlunparse(parts)
    except Exception:
        return "<unparseable DATABASE_URL>"


def _wipe_all(db):
    """Delete every domain row in FK-safe (child -> parent) order.

    Order matters because Postgres won't let us delete a row that's
    still referenced by another table's FK. The order below walks
    leaves -> trunks -> Organization at the very end.
    """
    print("Wiping existing data...")

    # Tables that reference users/goals/projects/etc. — kept in
    # lock-step with the model list (every model except Organization /
    # Designation / Function / User which are deleted last).
    wipe_order = [
        PasswordResetToken,
        Notification,
        ExportAuditLog,
        GoalMentorReview,
        GoalSelfReview,
        GoalCriterion,
        Goal,
        RoleExpectation,
        AnnualReview,
        ProjectReviewEvaluator,
        ProjectReview,
        ProjectAssignment,
        Project,
        # SystemSettingsYearOverride has FKs to Organization but not to
        # SystemSettings; drop both before Organization. Year-override
        # rows accumulate one per FY HR has touched, so the table is
        # rarely empty in a live demo env.
        SystemSettingsYearOverride,
        SystemSettings,
    ]
    for model in wipe_order:
        n = db.query(model).delete(synchronize_session=False)
        print(f"  wiped {n:>4} rows from {model.__tablename__}")

    # Break the User self-FK before deleting so any mentor chain is harmless.
    db.query(User).update({User.mentor_id: None}, synchronize_session=False)
    db.flush()

    for model in (User, Designation, Function, Organization):
        n = db.query(model).delete(synchronize_session=False)
        print(f"  wiped {n:>4} rows from {model.__tablename__}")

    db.commit()


def _seed_org(db) -> Organization:
    org = Organization(
        name="Healthark",
        domain="healtharkinsights.com",
        enabled_features=[
            "dashboard", "goals", "project_reviews",
            "annual_reviews", "mentoring", "admin",
        ],
    )
    db.add(org)
    db.flush()
    print(f"  [+] Organization: Healthark ({org.domain})")
    return org


def _seed_reference_data(db, org):
    """Seed Healthark's internal functions + designation ladder.

    These are NOT the Miltenyi GCC functions (which live in seed.py for
    the Miltenyi org). Healthark's HR ladder + consulting ladder are
    org-specific. `career_level` / `career_level_label` stay null —
    those are GCC-band attributes and don't apply here.
    """
    func_names = ["Strategy", "IDT", "RWE", "Marketing", "HR"]
    funcs = {n: Function(org_id=org.id, name=n) for n in func_names}
    db.add_all(funcs.values())

    desig_specs = [
        # Healthark's consulting ladder (kept as-is for back-compat with
        # historical user assignments). `level` is the legacy 1..6 sort
        # key; `career_level` is left null because these aren't GCC
        # bands and the /me/expectations API correctly falls back to
        # "Role expectation not defined".
        ("Consultant",          1),
        ("Senior Consultant",   2),
        ("Manager",             3),
        ("Senior Manager",      4),
        ("Associate Director",  5),
        ("Director",            6),
        # HR ladder.
        ("HR Executive",        1),
        ("Senior HR Executive", 2),
        ("Head HR",             4),
    ]
    desigs = {
        name: Designation(org_id=org.id, name=name, level=level)
        for name, level in desig_specs
    }
    db.add_all(desigs.values())
    db.flush()

    print(f"  [+] Functions: {', '.join(func_names)}")
    print(f"  [+] Designations: {', '.join(d[0] for d in desig_specs)}")
    return funcs, desigs


def _seed_users(db, org, funcs, desigs):
    """Seed exactly three HR admin users.

    All three are Role.HR_MYORG — the platform-owner HR role with full
    super-admin powers (manage all users, configure system settings,
    publish management ratings, etc.). The mentor chain is preserved
    from the legacy seed so the demo URLs and screenshots keep
    working, even though mentor_id is mostly meaningful on Employee
    users in the new role model.
    """
    pw = get_password_hash(PASSWORD)
    hr_func = funcs["HR"]
    hr_role = Role.HR_MYORG.value

    amol = User(
        org_id=org.id,
        function_id=hr_func.id,
        designation_id=desigs["Head HR"].id,
        employee_code="HRK-001",
        full_name="Amol Pandya",
        email="amol@healtharkinsights.com",
        role=hr_role,
        password_hash=pw,
        must_change_password=False,
    )
    devanshi = User(
        org_id=org.id,
        function_id=hr_func.id,
        designation_id=desigs["Senior HR Executive"].id,
        employee_code="HRK-002",
        full_name="Devanshi Shukla",
        email="devanshi@healtharkinsights.com",
        role=hr_role,
        password_hash=pw,
        must_change_password=False,
    )
    trapti = User(
        org_id=org.id,
        function_id=hr_func.id,
        designation_id=desigs["HR Executive"].id,
        employee_code="HRK-003",
        full_name="Trapti Tiwari",
        email="trapti@healtharkinsights.com",
        role=hr_role,
        password_hash=pw,
        must_change_password=False,
    )
    db.add_all([amol, devanshi, trapti])
    db.flush()

    # Mentor chain — Amol mentors Devanshi mentors Trapti. Preserved
    # from the legacy seed for demo continuity. The schema allows
    # mentor_id on any role; the runtime treats HR_MyOrg with mentees
    # as a benign quirk.
    devanshi.mentor_id = amol.id
    trapti.mentor_id = devanshi.id
    db.flush()

    print("  [+] Users (all role=HR_MyOrg):")
    print(f"      - {amol.email}      (Head HR)")
    print(f"      - {devanshi.email}  (Senior HR Executive, mentor=Amol)")
    print(f"      - {trapti.email}    (HR Executive, mentor=Devanshi)")

    return {"amol": amol, "devanshi": devanshi, "trapti": trapti}


def _seed_system_settings(db, org, admin_user):
    """Seed the org's SystemSettings row.

    The half-yearly cadence + FY26-27 cycle match what the legacy
    seed shipped so stakeholder screenshots / URLs stay valid. Note
    that per-FY override rows (SystemSettingsYearOverride) are NOT
    seeded — HR opens / closes annual goal + review windows via the
    admin UI on a per-year basis, which writes those rows lazily.
    Without an override row, the runtime default-denies edits to that
    FY's annual goals + reviews (intentional; HR has to explicitly
    open each year).
    """
    db.add(SystemSettings(
        org_id=org.id,
        active_cycle_name="H1 FY26-27",
        cycle_type=CycleType.HALF_YEARLY.value,
        fiscal_start_month=4,
        goals_submission_open=True,
        reviews_submission_open=True,
        annual_goals_edit_enabled=True,
        annual_reviews_enabled=True,
        updated_by_id=admin_user.id,
    ))
    db.flush()
    print("  [+] SystemSettings: H1 FY26-27 (Half Yearly)")


def _print_summary(users):
    print()
    print("=" * 60)
    print("Seeded production data — login with password: password123")
    print("=" * 60)
    print(f"  Amol Pandya     | {users['amol'].email}     | Head HR              | HR_MyOrg")
    print(f"  Devanshi Shukla | {users['devanshi'].email} | Senior HR Executive  | HR_MyOrg (mentee of Amol)")
    print(f"  Trapti Tiwari   | {users['trapti'].email}   | HR Executive         | HR_MyOrg (mentee of Devanshi)")
    print("=" * 60)


def seed_production(skip_confirm: bool = False):
    print(f"Target database: {_sanitize_db_url(settings.DATABASE_URL)}")
    print("!!! THIS WILL DELETE ALL DATA in the target database !!!")
    if not skip_confirm:
        if input("Type 'WIPE AND SEED' to continue: ").strip() != "WIPE AND SEED":
            print("Aborted.")
            return

    db = SessionLocal()
    try:
        _wipe_all(db)
        org = _seed_org(db)
        funcs, desigs = _seed_reference_data(db, org)
        users = _seed_users(db, org, funcs, desigs)
        _seed_system_settings(db, org, users["amol"])
        db.commit()

        # Hard guarantee the operator asked for: only these 3 users exist.
        user_count = db.query(User).count()
        org_count = db.query(Organization).count()
        assert user_count == 3, f"expected exactly 3 users, found {user_count}"
        assert org_count == 1, f"expected exactly 1 organization, found {org_count}"

        _print_summary(users)
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    seed_production(skip_confirm="--yes" in sys.argv)
