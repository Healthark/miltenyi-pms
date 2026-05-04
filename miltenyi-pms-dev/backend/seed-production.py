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
  Departments:   Strategy, IDT, RWE, Marketing, HR
  Designations:  Consultant, Senior Consultant, Manager, Senior Manager,
                 Associate Director, Director,
                 HR Executive, Senior HR Executive, Head HR
  Users (all role=Admin, password=password123):
    Amol Pandya      amol@healtharkinsights.com      Head HR              is_management=True   (no mentor)
    Devanshi Shukla  devanshi@healtharkinsights.com  Senior HR Executive  mentor=Amol
    Trapti Tiwari    trapti@healtharkinsights.com    HR Executive         mentor=Devanshi

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
from app.models.reference_models import Department, Designation
from app.models.user_models import User
from app.models.system_settings_models import SystemSettings, CycleType

from app.models.password_reset_token_models import PasswordResetToken
from app.models.goal_notification_models import GoalNotification
from app.models.goal_mentor_review_models import GoalMentorReview
from app.models.goal_self_review_models import GoalSelfReview
from app.models.goal_criteria_models import GoalCriterion
from app.models.goal_models import Goal
from app.models.role_expectation_models import RoleExpectation
from app.models.annual_review_models import AnnualReview
from app.models.project_review_models import ProjectReview, ProjectReviewEvaluator
from app.models.project_models import Project, ProjectAssignment


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
    """Delete every domain row in FK-safe (child -> parent) order."""
    print("Wiping existing data...")

    # Tables that reference users/goals/projects/etc.
    wipe_order = [
        PasswordResetToken,
        GoalNotification,
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
        SystemSettings,
    ]
    for model in wipe_order:
        n = db.query(model).delete(synchronize_session=False)
        print(f"  wiped {n:>4} rows from {model.__tablename__}")

    # Break the User self-FK before deleting so any mentor chain is harmless.
    db.query(User).update({User.mentor_id: None}, synchronize_session=False)
    db.flush()

    for model in (User, Designation, Department, Organization):
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
    dept_names = ["Strategy", "IDT", "RWE", "Marketing", "HR"]
    depts = {n: Department(org_id=org.id, name=n) for n in dept_names}
    db.add_all(depts.values())

    desig_specs = [
        # Existing org-wide ladder (mirrors seed.py).
        ("Consultant",          1),
        ("Senior Consultant",   2),
        ("Manager",             3),
        ("Senior Manager",      4),
        ("Associate Director",  5),
        ("Director",            6),
        # New HR-track designations.
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

    print(f"  [+] Departments: {', '.join(dept_names)}")
    print(f"  [+] Designations: {', '.join(d[0] for d in desig_specs)}")
    return depts, desigs


def _seed_users(db, org, depts, desigs):
    pw = get_password_hash(PASSWORD)
    hr_dept = depts["HR"]

    amol = User(
        org_id=org.id,
        department_id=hr_dept.id,
        designation_id=desigs["Head HR"].id,
        employee_code="HRK-001",
        full_name="Amol Pandya",
        email="amol@healtharkinsights.com",
        role="Admin",
        is_management=True,
        password_hash=pw,
        must_change_password=False,
    )
    devanshi = User(
        org_id=org.id,
        department_id=hr_dept.id,
        designation_id=desigs["Senior HR Executive"].id,
        employee_code="HRK-002",
        full_name="Devanshi Shukla",
        email="devanshi@healtharkinsights.com",
        role="Admin",
        is_management=False,
        password_hash=pw,
        must_change_password=False,
    )
    trapti = User(
        org_id=org.id,
        department_id=hr_dept.id,
        designation_id=desigs["HR Executive"].id,
        employee_code="HRK-003",
        full_name="Trapti Tiwari",
        email="trapti@healtharkinsights.com",
        role="Admin",
        is_management=False,
        password_hash=pw,
        must_change_password=False,
    )
    db.add_all([amol, devanshi, trapti])
    db.flush()

    devanshi.mentor_id = amol.id
    trapti.mentor_id = devanshi.id
    db.flush()

    print("  [+] Users:")
    print(f"      - {amol.email}      (Head HR, is_management=True)")
    print(f"      - {devanshi.email}  (Senior HR Executive, mentor=Amol)")
    print(f"      - {trapti.email}    (HR Executive, mentor=Devanshi)")

    return {"amol": amol, "devanshi": devanshi, "trapti": trapti}


EXPECTATIONS_DATA = {
    "Strategy": {
        "Consultant": {
            "exp_task_execution": "Applies fundamental frameworks with clear guidance and breaks down problems into smaller components.",
            "exp_ownership": "Takes responsibility for assigned tasks and modules, executes independently once goals are defined.",
            "exp_client_deliverables": "Produces accurate, well-formatted outputs with minimal errors.",
            "exp_communication": "Drafts clear and concise meeting notes and written updates.",
            "exp_project_management": "Conducts deep secondary research and takes ownership of specific sector research.",
            "exp_mentoring": "Encourages team building and performs peer reviews.",
            "exp_firm_growth": "Participate in firm activities and initiatives | Contribute to knowledge sharing / development within the firm",
            "exp_competency_skills": "Builds foundational knowledge in a specific sector or domain.",
        },
        "Senior Consultant": {
            "exp_task_execution": "Independently structures and solves moderately complex problems.",
            "exp_ownership": "Owns multiple modules within a project and ensures quality delivery.",
            "exp_client_deliverables": "Develops polished, visually appealing outputs with compelling narratives.",
            "exp_communication": "Leads internal discussions and co-leads client readouts.",
            "exp_project_management": "Develops project management plans and structures research effectively.",
            "exp_mentoring": "Provides guidance to junior team members on project tasks.",
            "exp_firm_growth": "Leads a firm initiative | Contribute to the firm's knowledge base by writing white papers, blogs, or creating innovative frameworks/tools relevant to the firm's services or for internal use | Plays a major role in finalising proposals | Owns knowledge management at the end of the project (structured research uploads, key documents etc.) to facilitate firm knowledge build-up | Supports the recruitment efforts and drives interviews / other activities when required with some leadership team",
            "exp_competency_skills": "Leads a firm initiative and develops deeper industry expertise.",
        },
        "Manager": {
            "exp_task_execution": "Leads problem definition and solution design for complex issues.",
            "exp_ownership": "Understands each team member and leverages their strengths for project success.",
            "exp_client_deliverables": "Crafts compelling, story-driven outputs aligned with client expectations.",
            "exp_communication": "Leads client discussions, readouts, and critical meetings independently.",
            "exp_project_management": "Takes end-to-end ownership of projects or large workstreams.",
            "exp_mentoring": "Coaches team members on advanced skills and career development.",
            "exp_firm_growth": "Identifies opportunities for process improvements and efficiency | Supports organisation growth and continuously identifies areas for upskilling team/practice (encourages people to undertake development activities, makes required resources available) | Acts as a role model by fostering a positive culture within the organisation and demonstrates responsibility for review and action where required | Creates an environment to enable others to be creative, agile, innovative and value quality (gives space to team members working on a project to think of approach, delegating instead of hand-holding every time) | Plays a leadership role within their firm, sometimes leading a new initiative or a function (e.g. recruiting, social events), contributing in making collective decisions (promotions, staffing etc.) | Leads proposals independently with minimal guidance from the leadership | Supports recruitment activities; trains and retains top talent while fostering a culture of collaboration and continuous learning",
            "exp_competency_skills": "Identifies opportunities for process improvements and leads proposals.",
        },
    },
    "IDT": {
        "Consultant": {
            "exp_task_execution": "Performs simple to medium complexity tasks and breaks down problems.",
            "exp_ownership": "Executes tasks independently once goals are defined.",
            "exp_project_management": "Adheres to timelines and communicates potential delays early.",
            "exp_client_deliverables": "Produces quality code and deliverables with no major defects.",
            "exp_communication": "Drafts clear meeting notes and written communications.",
            "exp_mentoring": "Encourages team building and knowledge sharing.",
            "exp_firm_growth": "Participate in firm activities and initiatives | Contribute to knowledge sharing / development within the firm | Contribute to Eminence and Excellence activities to grow the service offering for their respective practice area",
            "exp_competency_skills": "Proficient in assigned technology area and produces quality code on time.",
        },
        "Senior Consultant": {
            "exp_task_execution": "Independently structures and solves moderately complex technical problems.",
            "exp_ownership": "Owns multiple modules and guides junior team members.",
            "exp_project_management": "Performs work estimation, planning, and delivery management.",
            "exp_client_deliverables": "Reviews code and leverages expertise to produce high-quality deliverables.",
            "exp_communication": "Leads internal discussions and manages client relationships.",
            "exp_mentoring": "Provides guidance to junior team members and leads coaching.",
            "exp_firm_growth": "Plays a leadership role within the team; is the face of the organization / leadership team to junior team members | Participates in new proposals / SoW creation | Leads and owns Eminence and Excellence activities to grow the service offering for their respective practice area | Participates in screening and hiring of new members in the organization",
            "exp_competency_skills": "Leads technical eminence and demonstrates SME capability.",
        },
        "Manager": {
            "exp_task_execution": "Leads problem definition and architecture decisions for complex solutions.",
            "exp_ownership": "Independently manages multiple large projects end-to-end.",
            "exp_project_management": "Owns SoW governance and ensures quality, risk, and budget management.",
            "exp_client_deliverables": "Reviews and ensures final deliverables are free from defects.",
            "exp_communication": "Leads client discussions and builds strong stakeholder relationships.",
            "exp_mentoring": "Develops junior team members through structured coaching.",
            "exp_firm_growth": "Acts as a role model by fostering a positive culture within the organisation and demonstrates responsibility for review and action where required | Operates with full independence, managing projects and anticipating client needs | Identifies opportunities for process improvements and efficiency | Plays a leadership role within their firm, sometimes leading a new initiative or a function (e.g. recruiting, social events), contributing in making collective decisions (promotions, staffing etc.) | Leads proposals independently with minimal guidance from the leadership | Supports recruitment activities | Recruits, trains, and retains top talent while fostering a culture of collaboration and continuous learning",
            "exp_competency_skills": "Acts as role model and drives process improvements.",
        },
    },
    "RWE": {
        "Consultant": {
            "exp_task_execution": "Performs simple to medium complexity RWE tasks.",
            "exp_ownership": "Completes assigned tasks on time with quality.",
            "exp_project_management": "Communicates timely status and updates to the team.",
            "exp_communication": "Drafts clear research summaries and meeting notes.",
            "exp_client_deliverables": "Produces accurate, well-formatted RWE outputs.",
            "exp_mentoring": "Encourages team building and participates actively.",
            "exp_firm_growth": "Participate in firm activities and initiatives | Contribute to knowledge sharing / development within the firm",
            "exp_competency_skills": "Proficient in project-specific RWE concepts.",
        },
        "Senior Consultant": {
            "exp_task_execution": "Develops independent perspective on RWE tasks and solves complex problems.",
            "exp_ownership": "Owns delivery of one or more workstreams end-to-end.",
            "exp_project_management": "Performs work estimation and manages team delivery.",
            "exp_communication": "Independently interacts with clients and leads workstreams.",
            "exp_client_deliverables": "Produces contextual, high-quality RWE deliverables.",
            "exp_mentoring": "Demonstrates maturity in coaching junior team members.",
            "exp_firm_growth": "Plays a leadership role within the team; is the face of the organization / leadership team to junior team members | Contributes to pitching for different projects and proposal development; able to identify small-scale opportunities for cross-sell or up-sell within existing client projects | Participates in / leads firm initiatives | Contributes to the firm's knowledge base by writing white papers, blogs, or creating innovative frameworks/tools relevant to the firm's services or for internal use | Acts as a role model by fostering a positive culture within the organisation and demonstrates responsibility for review and action where required | Helps in interviewing / recruiting new talent to the practice",
            "exp_competency_skills": "Is a Subject Matter Expert in one RWE vertical.",
        },
        "Manager": {
            "exp_task_execution": "Leads RWE methodology design for complex studies.",
            "exp_ownership": "Takes end-to-end ownership of RWE programs.",
            "exp_project_management": "Owns study governance and quality across multiple projects.",
            "exp_communication": "Leads client and clinical stakeholder discussions.",
            "exp_client_deliverables": "Ensures final RWE deliverables are publication-quality.",
            "exp_mentoring": "Coaches team members and leads knowledge building.",
            "exp_firm_growth": "Plays a leadership role within the firm; acts as a role model by fostering a positive culture and encouraging teamwork within the organisation | Drives initiatives that enhance the firm's service offerings and expand its market presence | Leads proposal development for new projects and opportunities | Contributes to the firm's knowledge base by writing white papers, blogs, or creating innovative frameworks/tools relevant to the firm's services or for internal use | Demonstrates responsibility for review and action where required | Recruits, trains, and retains top talent while fostering a culture of collaboration and continuous learning",
            "exp_competency_skills": "Thought leader in RWE methodology and scientific rigor.",
        },
    },
}


def _seed_role_expectations(db, org):
    """Add role expectations for each dept/designation combo that doesn't already exist."""
    added_count = 0
    skipped_count = 0
    for dept_name, designations_dict in EXPECTATIONS_DATA.items():
        dept = db.query(Department).filter(
            Department.org_id == org.id, Department.name == dept_name
        ).first()
        if not dept:
            print(f"  [!] Department '{dept_name}' not found, skipping")
            continue
        for desig_name, competencies in designations_dict.items():
            desig = db.query(Designation).filter(
                Designation.org_id == org.id, Designation.name == desig_name
            ).first()
            if not desig:
                print(f"  [!] Designation '{desig_name}' not found, skipping")
                continue
            already_exists = db.query(RoleExpectation).filter(
                RoleExpectation.org_id == org.id,
                RoleExpectation.department_id == dept.id,
                RoleExpectation.designation_id == desig.id,
            ).first()
            if already_exists:
                skipped_count += 1
                continue
            db.add(RoleExpectation(
                org_id=org.id,
                department_id=dept.id,
                designation_id=desig.id,
                exp_task_execution=competencies.get("exp_task_execution", ""),
                exp_ownership=competencies.get("exp_ownership", ""),
                exp_project_management=competencies.get("exp_project_management", ""),
                exp_client_deliverables=competencies.get("exp_client_deliverables", ""),
                exp_communication=competencies.get("exp_communication", ""),
                exp_mentoring=competencies.get("exp_mentoring", ""),
                exp_firm_growth=competencies.get("exp_firm_growth", ""),
                exp_competency_skills=competencies.get("exp_competency_skills", ""),
            ))
            added_count += 1
    db.flush()
    if added_count:
        print(f"  [+] Seeded {added_count} Role Expectations")
    if skipped_count:
        print(f"  [~] Skipped {skipped_count} Role Expectations (already exist)")


def _seed_system_settings(db, org, admin_user):
    db.add(SystemSettings(
        org_id=org.id,
        active_cycle_name="H1 FY26-27",
        cycle_type=CycleType.HALF_YEARLY.value,
        fiscal_start_month=4,
        goals_submission_open=True,
        reviews_submission_open=True,
        annual_goals_edit_enabled=True,
        updated_by_id=admin_user.id,
    ))
    db.flush()
    print("  [+] SystemSettings: H1 FY26-27 (Half Yearly)")


def _print_summary(users):
    print()
    print("=" * 60)
    print("Seeded production data — login with password: password123")
    print("=" * 60)
    print(f"  Amol Pandya     | {users['amol'].email}     | Head HR              | Admin + Management")
    print(f"  Devanshi Shukla | {users['devanshi'].email} | Senior HR Executive  | Admin (mentee of Amol)")
    print(f"  Trapti Tiwari   | {users['trapti'].email}   | HR Executive         | Admin (mentee of Devanshi)")
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
        depts, desigs = _seed_reference_data(db, org)
        users = _seed_users(db, org, depts, desigs)
        _seed_system_settings(db, org, users["amol"])
        _seed_role_expectations(db, org)
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


def seed_expectations_only():
    """Add role expectations to the existing org without touching any other data."""
    db = SessionLocal()
    try:
        org = db.query(Organization).filter(
            Organization.domain == "healtharkinsights.com"
        ).first()
        if not org:
            print("No Healthark organization found. Run the full seed first.")
            return
        print(f"Adding role expectations to org: {org.name} (id={org.id})")
        _seed_role_expectations(db, org)
        db.commit()
        print("Done.")
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    if "--expectations-only" in sys.argv:
        seed_expectations_only()
    else:
        seed_production(skip_confirm="--yes" in sys.argv)
