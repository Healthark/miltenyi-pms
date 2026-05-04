"""
seed.py — Deterministic dev seed.

Accounts (all passwords: password123):
  Healthark Admin:  admin@healthark.com  (Sarah Admin)
  New Admins:       amol@, founder1@, founder2@healthark.com
  Mentors (→ Sarah): priya@, david@, vikram@healthark.com
  Priya's mentees:  arjun@, neha@healthark.com
  David's mentees:  rahul@, meera@healthark.com
  Vikram's mentees: ananya@, karan@healthark.com
  Amol's mentees:   riya@, tej@healthark.com

Run:
  python seed.py
"""

from datetime import date, datetime, timezone

from app.core.database import SessionLocal
from app.core.security import get_password_hash
from app.models.organization_models import Organization
from app.models.reference_models import Department, Designation
from app.models.user_models import User
from app.models.system_settings_models import SystemSettings, CycleType
from app.models.project_models import Project, ProjectAssignment
from app.models.project_review_models import ProjectReview, ProjectReviewEvaluator
from app.models.annual_review_models import AnnualReview
from app.models.goal_models import Goal
from app.models.goal_self_review_models import GoalSelfReview
from app.models.role_expectation_models import RoleExpectation
from app.models.feedback_360_models import Feedback360Review, Feedback360Answer


def seed_database():
    print("Starting database seeding process...")
    db = SessionLocal()

    try:
        # ================================================================== #
        # 1. ORGANIZATIONS                                                    #
        # ================================================================== #

        org = db.query(Organization).filter(Organization.name == "Healthark").first()
        if not org:
            org = Organization(
                name="Healthark",
                domain="healthark.com",
                enabled_features=[
                    "dashboard", "goals", "project_reviews",
                    "annual_reviews", "mentoring", "admin", "feedback_360",
                ],
            )
            db.add(org)
            db.commit()
            db.refresh(org)
            print("  [+] Created Organization: Healthark (full suite)")
        else:
            print("  [~] Organization 'Healthark' already exists, skipping...")

        miltenyi_org = db.query(Organization).filter(Organization.name == "Miltenyi").first()
        if not miltenyi_org:
            miltenyi_org = Organization(
                name="Miltenyi",
                domain="miltenyi.com",
                enabled_features=[
                    "dashboard", "goals", "project_reviews",
                    "annual_reviews", "mentoring", "admin", "feedback_360",
                ],
            )
            db.add(miltenyi_org)
            db.commit()
            db.refresh(miltenyi_org)
            print("  [+] Created Organization: Miltenyi (full suite)")
        else:
            print("  [~] Organization 'Miltenyi' already exists, skipping...")

        # Idempotent backfill: ensure both orgs have the 360 feedback flag.
        # Re-running this seed against a DB that predates the feature must
        # turn it on; the JSON column needs a full list reassignment for
        # SQLAlchemy to detect the change.
        for _o in (org, miltenyi_org):
            feats = list(_o.enabled_features or [])
            if "feedback_360" not in feats:
                feats.append("feedback_360")
                _o.enabled_features = feats
                print(f"  [+] Backfilled feedback_360 onto {_o.name}")
        db.commit()

        # ================================================================== #
        # 2. DEPARTMENTS & DESIGNATIONS                                       #
        # ================================================================== #

        if db.query(Department).filter(Department.org_id == org.id).count() == 0:
            dept_strategy  = Department(org_id=org.id, name="Strategy")
            dept_idt       = Department(org_id=org.id, name="IDT")
            dept_rwe       = Department(org_id=org.id, name="RWE")
            dept_marketing = Department(org_id=org.id, name="Marketing")

            desig_consultant         = Designation(org_id=org.id, name="Consultant",          level=1)
            desig_senior_consultant  = Designation(org_id=org.id, name="Senior Consultant",   level=2)
            desig_manager            = Designation(org_id=org.id, name="Manager",             level=3)
            desig_senior_manager     = Designation(org_id=org.id, name="Senior Manager",      level=4)
            desig_associate_director = Designation(org_id=org.id, name="Associate Director",  level=5)
            desig_director           = Designation(org_id=org.id, name="Director",            level=6)

            db.add_all([
                dept_strategy, dept_idt, dept_rwe, dept_marketing,
                desig_consultant, desig_senior_consultant, desig_manager,
                desig_senior_manager, desig_associate_director, desig_director,
            ])
            db.commit()
            print("  [+] Created Healthark Departments & Designations")
        else:
            print("  [~] Healthark Reference data already exists, skipping...")

        if db.query(Department).filter(Department.org_id == miltenyi_org.id).count() == 0:
            dept_rnd = Department(org_id=miltenyi_org.id, name="R&D")
            dept_mfg = Department(org_id=miltenyi_org.id, name="Manufacturing")
            dept_com = Department(org_id=miltenyi_org.id, name="Commercial")

            desig_scientist    = Designation(org_id=miltenyi_org.id, name="Scientist",        level=1)
            desig_sr_scientist = Designation(org_id=miltenyi_org.id, name="Senior Scientist", level=2)
            desig_lead         = Designation(org_id=miltenyi_org.id, name="Team Lead",        level=3)
            desig_dir          = Designation(org_id=miltenyi_org.id, name="Director",         level=4)

            db.add_all([
                dept_rnd, dept_mfg, dept_com,
                desig_scientist, desig_sr_scientist, desig_lead, desig_dir,
            ])
            db.commit()
            print("  [+] Created Miltenyi Departments & Designations")
        else:
            print("  [~] Miltenyi Reference data already exists, skipping...")

        # ================================================================== #
        # 3. USERS — Healthark                                                #
        # ================================================================== #

        dept_strategy  = db.query(Department).filter_by(org_id=org.id, name="Strategy").first()
        dept_idt       = db.query(Department).filter_by(org_id=org.id, name="IDT").first()
        dept_rwe       = db.query(Department).filter_by(org_id=org.id, name="RWE").first()
        dept_marketing = db.query(Department).filter_by(org_id=org.id, name="Marketing").first()

        desig_consultant        = db.query(Designation).filter_by(org_id=org.id, name="Consultant").first()
        desig_senior_consultant = db.query(Designation).filter_by(org_id=org.id, name="Senior Consultant").first()
        desig_manager           = db.query(Designation).filter_by(org_id=org.id, name="Manager").first()
        desig_senior_manager    = db.query(Designation).filter_by(org_id=org.id, name="Senior Manager").first()
        desig_director          = db.query(Designation).filter_by(org_id=org.id, name="Director").first()

        pw = get_password_hash("password123")

        admin_user = db.query(User).filter(User.org_id == org.id, User.email == "admin@healthark.com").first()

        if not admin_user:
            admin_user = User(
                org_id=org.id, department_id=dept_marketing.id, designation_id=desig_director.id,
                employee_code="EMP-000", full_name="Sarah Admin", email="admin@healthark.com",
                phone="+91 98765 00000",
                role="Admin", password_hash=pw,
            )
            db.add(admin_user)
            db.commit()
            db.refresh(admin_user)
            print("  [+] Created: admin@healthark.com")

            # Mentors — all report to Sarah
            priya = User(
                org_id=org.id, department_id=dept_strategy.id, designation_id=desig_senior_manager.id,
                employee_code="EMP-101", full_name="Priya Sharma", email="priya@healthark.com",
                phone="+91 98765 10101",
                role="Staff", password_hash=pw, mentor_id=admin_user.id,
            )
            db.add(priya)
            db.commit()
            db.refresh(priya)

            arjun = User(
                org_id=org.id, department_id=dept_strategy.id, designation_id=desig_senior_consultant.id,
                employee_code="EMP-102", full_name="Arjun Patel", email="arjun@healthark.com",
                phone="+91 98765 10102",
                role="Staff", mentor_id=priya.id, password_hash=pw,
            )
            neha = User(
                org_id=org.id, department_id=dept_strategy.id, designation_id=desig_consultant.id,
                employee_code="EMP-103", full_name="Neha Gupta", email="neha@healthark.com",
                phone="+91 98765 10103",
                role="Staff", mentor_id=priya.id, password_hash=pw,
            )
            david = User(
                org_id=org.id, department_id=dept_idt.id, designation_id=desig_manager.id,
                employee_code="EMP-201", full_name="David Miller", email="david@healthark.com",
                phone="+91 98765 20101",
                role="Staff", password_hash=pw, mentor_id=admin_user.id,
            )
            db.add_all([arjun, neha, david])
            db.commit()
            db.refresh(david)

            rahul = User(
                org_id=org.id, department_id=dept_idt.id, designation_id=desig_senior_consultant.id,
                employee_code="EMP-202", full_name="Rahul Verma", email="rahul@healthark.com",
                phone="+91 98765 20102",
                role="Staff", mentor_id=david.id, password_hash=pw,
            )
            meera = User(
                org_id=org.id, department_id=dept_idt.id, designation_id=desig_consultant.id,
                employee_code="EMP-203", full_name="Meera Joshi", email="meera@healthark.com",
                phone="+91 98765 20103",
                role="Staff", mentor_id=david.id, password_hash=pw,
            )
            vikram = User(
                org_id=org.id, department_id=dept_rwe.id, designation_id=desig_manager.id,
                employee_code="EMP-301", full_name="Vikram Singh", email="vikram@healthark.com",
                phone="+91 98765 30101",
                role="Staff", password_hash=pw, mentor_id=admin_user.id,
            )
            db.add_all([rahul, meera, vikram])
            db.commit()
            db.refresh(vikram)

            ananya = User(
                org_id=org.id, department_id=dept_rwe.id, designation_id=desig_senior_consultant.id,
                employee_code="EMP-302", full_name="Ananya Reddy", email="ananya@healthark.com",
                phone="+91 98765 30102",
                role="Staff", mentor_id=vikram.id, password_hash=pw,
            )
            karan = User(
                org_id=org.id, department_id=dept_rwe.id, designation_id=desig_consultant.id,
                employee_code="EMP-303", full_name="Karan Mehta", email="karan@healthark.com",
                phone="+91 98765 30103",
                role="Staff", mentor_id=vikram.id, password_hash=pw,
            )
            db.add_all([ananya, karan])
            db.commit()

            # New Admin users — report to Sarah.
            # is_management=True marks the sub-role that gates the
            # Management Review tab (Amol + Founders).
            amol = User(
                org_id=org.id, department_id=dept_marketing.id, designation_id=desig_director.id,
                employee_code="EMP-004", full_name="Amol Kulkarni", email="amol@healthark.com",
                phone="+91 98765 00400",
                role="Admin", password_hash=pw, mentor_id=admin_user.id,
                is_management=True,
            )
            db.add(amol)
            db.commit()
            db.refresh(amol)

            founder1 = User(
                org_id=org.id, department_id=dept_strategy.id, designation_id=desig_director.id,
                employee_code="EMP-F01", full_name="Rohan Desai", email="founder1@healthark.com",
                phone="+91 98765 00401",
                role="Admin", password_hash=pw, mentor_id=admin_user.id,
                is_management=True,
            )
            founder2 = User(
                org_id=org.id, department_id=dept_strategy.id, designation_id=desig_director.id,
                employee_code="EMP-F02", full_name="Nisha Patel", email="founder2@healthark.com",
                phone="+91 98765 00402",
                role="Admin", password_hash=pw, mentor_id=admin_user.id,
                is_management=True,
            )
            db.add_all([founder1, founder2])
            db.commit()
            db.refresh(founder1)
            db.refresh(founder2)

            # Amol's mentees — Marketing staff
            riya = User(
                org_id=org.id, department_id=dept_marketing.id, designation_id=desig_consultant.id,
                employee_code="EMP-401", full_name="Riya Kapoor", email="riya@healthark.com",
                phone="+91 98765 40101",
                role="Staff", password_hash=pw, mentor_id=amol.id,
            )
            tej = User(
                org_id=org.id, department_id=dept_marketing.id, designation_id=desig_senior_consultant.id,
                employee_code="EMP-402", full_name="Tej Nair", email="tej@healthark.com",
                phone="+91 98765 40102",
                role="Staff", password_hash=pw, mentor_id=amol.id,
            )
            db.add_all([riya, tej])
            db.commit()
            print("  [+] Created Healthark staff users (incl. Amol, Founder1, Founder2, Riya, Tej)")

        else:
            print("  [~] Healthark users already exist, resolving references...")
            priya   = db.query(User).filter_by(org_id=org.id, email="priya@healthark.com").first()
            arjun   = db.query(User).filter_by(org_id=org.id, email="arjun@healthark.com").first()
            neha    = db.query(User).filter_by(org_id=org.id, email="neha@healthark.com").first()
            david   = db.query(User).filter_by(org_id=org.id, email="david@healthark.com").first()
            rahul   = db.query(User).filter_by(org_id=org.id, email="rahul@healthark.com").first()
            meera   = db.query(User).filter_by(org_id=org.id, email="meera@healthark.com").first()
            vikram  = db.query(User).filter_by(org_id=org.id, email="vikram@healthark.com").first()
            ananya  = db.query(User).filter_by(org_id=org.id, email="ananya@healthark.com").first()
            karan   = db.query(User).filter_by(org_id=org.id, email="karan@healthark.com").first()
            amol    = db.query(User).filter_by(org_id=org.id, email="amol@healthark.com").first()
            founder1 = db.query(User).filter_by(org_id=org.id, email="founder1@healthark.com").first()
            founder2 = db.query(User).filter_by(org_id=org.id, email="founder2@healthark.com").first()
            riya    = db.query(User).filter_by(org_id=org.id, email="riya@healthark.com").first()
            tej     = db.query(User).filter_by(org_id=org.id, email="tej@healthark.com").first()

        # Ensure new users exist for existing DBs seeded before this update
        if not amol:
            amol = User(
                org_id=org.id, department_id=dept_marketing.id, designation_id=desig_director.id,
                employee_code="EMP-004", full_name="Amol Kulkarni", email="amol@healthark.com",
                phone="+91 98765 00400",
                role="Admin", password_hash=pw, mentor_id=admin_user.id,
                is_management=True,
            )
            db.add(amol)
            db.commit()
            db.refresh(amol)
            print("  [+] Created: amol@healthark.com")

        if not founder1:
            founder1 = User(
                org_id=org.id, department_id=dept_strategy.id, designation_id=desig_director.id,
                employee_code="EMP-F01", full_name="Rohan Desai", email="founder1@healthark.com",
                phone="+91 98765 00401",
                role="Admin", password_hash=pw, mentor_id=admin_user.id,
                is_management=True,
            )
            db.add(founder1)
            db.commit()
            db.refresh(founder1)
            print("  [+] Created: founder1@healthark.com")

        if not founder2:
            founder2 = User(
                org_id=org.id, department_id=dept_strategy.id, designation_id=desig_director.id,
                employee_code="EMP-F02", full_name="Nisha Patel", email="founder2@healthark.com",
                phone="+91 98765 00402",
                role="Admin", password_hash=pw, mentor_id=admin_user.id,
                is_management=True,
            )
            db.add(founder2)
            db.commit()
            db.refresh(founder2)
            print("  [+] Created: founder2@healthark.com")

        if not riya:
            riya = User(
                org_id=org.id, department_id=dept_marketing.id, designation_id=desig_consultant.id,
                employee_code="EMP-401", full_name="Riya Kapoor", email="riya@healthark.com",
                phone="+91 98765 40101",
                role="Staff", password_hash=pw, mentor_id=amol.id,
            )
            db.add(riya)
            db.commit()
            db.refresh(riya)
            print("  [+] Created: riya@healthark.com")

        if not tej:
            tej = User(
                org_id=org.id, department_id=dept_marketing.id, designation_id=desig_senior_consultant.id,
                employee_code="EMP-402", full_name="Tej Nair", email="tej@healthark.com",
                phone="+91 98765 40102",
                role="Staff", password_hash=pw, mentor_id=amol.id,
            )
            db.add(tej)
            db.commit()
            db.refresh(tej)
            print("  [+] Created: tej@healthark.com")

        # Fix any users without a mentor (anyone without one gets Sarah)
        for _u, _m in [
            (priya, admin_user), (david, admin_user), (vikram, admin_user),
            (amol, admin_user), (founder1, admin_user), (founder2, admin_user),
            (riya, amol), (tej, amol),
        ]:
            if _u and _m and not _u.mentor_id:
                _u.mentor_id = _m.id

        # Backfill is_management for pre-existing seed rows (idempotent).
        for _mgmt_user in (amol, founder1, founder2):
            if _mgmt_user and not _mgmt_user.is_management:
                _mgmt_user.is_management = True
        db.commit()

        # ================================================================== #
        # 4. USERS — Miltenyi                                                 #
        # ================================================================== #

        dept_rnd = db.query(Department).filter_by(org_id=miltenyi_org.id, name="R&D").first()
        dept_mfg = db.query(Department).filter_by(org_id=miltenyi_org.id, name="Manufacturing").first()
        dept_com = db.query(Department).filter_by(org_id=miltenyi_org.id, name="Commercial").first()

        desig_scientist    = db.query(Designation).filter_by(org_id=miltenyi_org.id, name="Scientist").first()
        desig_sr_scientist = db.query(Designation).filter_by(org_id=miltenyi_org.id, name="Senior Scientist").first()
        desig_lead         = db.query(Designation).filter_by(org_id=miltenyi_org.id, name="Team Lead").first()
        desig_dir          = db.query(Designation).filter_by(org_id=miltenyi_org.id, name="Director").first()

        if db.query(User).filter(User.org_id == miltenyi_org.id).count() == 0:
            alice_admin = User(
                org_id=miltenyi_org.id, department_id=dept_com.id, designation_id=desig_dir.id,
                employee_code="MIL-000", full_name="Alice Admin", email="admin@miltenyi.com",
                phone="+49 30 1234 0000",
                role="Admin", password_hash=pw, is_management=True,
            )
            db.add(alice_admin)
            db.commit()
            db.refresh(alice_admin)

            bob_lead = User(
                org_id=miltenyi_org.id, department_id=dept_rnd.id, designation_id=desig_lead.id,
                employee_code="MIL-101", full_name="Bob Builder", email="bob@miltenyi.com",
                phone="+49 30 1234 1011",
                role="Staff", password_hash=pw, mentor_id=alice_admin.id,
            )
            db.add(bob_lead)
            db.commit()
            db.refresh(bob_lead)

            charlie = User(
                org_id=miltenyi_org.id, department_id=dept_rnd.id, designation_id=desig_sr_scientist.id,
                employee_code="MIL-102", full_name="Charlie Chemist", email="charlie@miltenyi.com",
                phone="+49 30 1234 1012",
                role="Staff", mentor_id=bob_lead.id, password_hash=pw,
            )
            dana = User(
                org_id=miltenyi_org.id, department_id=dept_rnd.id, designation_id=desig_scientist.id,
                employee_code="MIL-103", full_name="Dana DNA", email="dana@miltenyi.com",
                phone="+49 30 1234 1013",
                role="Staff", mentor_id=bob_lead.id, password_hash=pw,
            )
            evan_mfg = User(
                org_id=miltenyi_org.id, department_id=dept_mfg.id, designation_id=desig_lead.id,
                employee_code="MIL-201", full_name="Evan Engineer", email="evan@miltenyi.com",
                phone="+49 30 1234 2011",
                role="Staff", password_hash=pw, mentor_id=alice_admin.id,
            )
            db.add_all([charlie, dana, evan_mfg])
            db.commit()
            db.refresh(evan_mfg)

            fiona = User(
                org_id=miltenyi_org.id, department_id=dept_mfg.id, designation_id=desig_scientist.id,
                employee_code="MIL-202", full_name="Fiona Factory", email="fiona@miltenyi.com",
                phone="+49 30 1234 2012",
                role="Staff", mentor_id=evan_mfg.id, password_hash=pw,
            )
            db.add(fiona)
            db.commit()
            print("  [+] Created Miltenyi staff users")
        else:
            print("  [~] Miltenyi users already exist, skipping...")
            alice_admin = db.query(User).filter_by(org_id=miltenyi_org.id, email="admin@miltenyi.com").first()
            bob_lead    = db.query(User).filter_by(org_id=miltenyi_org.id, email="bob@miltenyi.com").first()
            charlie     = db.query(User).filter_by(org_id=miltenyi_org.id, email="charlie@miltenyi.com").first()
            dana        = db.query(User).filter_by(org_id=miltenyi_org.id, email="dana@miltenyi.com").first()
            evan_mfg    = db.query(User).filter_by(org_id=miltenyi_org.id, email="evan@miltenyi.com").first()
            fiona       = db.query(User).filter_by(org_id=miltenyi_org.id, email="fiona@miltenyi.com").first()

        # ── Backfill: management Admins, third Lead, and additional staff.
        # Idempotent — runs every seed for DBs that pre-date this expansion.
        def _ensure_mil_user(email, **kwargs):
            u = db.query(User).filter_by(
                org_id=miltenyi_org.id, email=email,
            ).first()
            if u:
                return u
            u = User(
                org_id=miltenyi_org.id, password_hash=pw, email=email, **kwargs,
            )
            db.add(u)
            db.commit()
            db.refresh(u)
            print(f"  [+] Created: {email}")
            return u

        hans = _ensure_mil_user(
            "hans@miltenyi.com",
            department_id=dept_rnd.id, designation_id=desig_dir.id,
            employee_code="MIL-F01", full_name="Hans Müller",
            phone="+49 30 1234 0001", role="Admin",
            mentor_id=alice_admin.id, is_management=True,
        )
        greta = _ensure_mil_user(
            "greta@miltenyi.com",
            department_id=dept_mfg.id, designation_id=desig_dir.id,
            employee_code="MIL-F02", full_name="Greta Schmidt",
            phone="+49 30 1234 0002", role="Admin",
            mentor_id=alice_admin.id, is_management=True,
        )
        lukas = _ensure_mil_user(
            "lukas@miltenyi.com",
            department_id=dept_com.id, designation_id=desig_lead.id,
            employee_code="MIL-301", full_name="Lukas Lange",
            phone="+49 30 1234 3011", role="Staff",
            mentor_id=alice_admin.id,
        )
        iris = _ensure_mil_user(
            "iris@miltenyi.com",
            department_id=dept_rnd.id, designation_id=desig_sr_scientist.id,
            employee_code="MIL-104", full_name="Iris Immel",
            phone="+49 30 1234 1014", role="Staff",
            mentor_id=bob_lead.id,
        )
        klaus = _ensure_mil_user(
            "klaus@miltenyi.com",
            department_id=dept_mfg.id, designation_id=desig_scientist.id,
            employee_code="MIL-203", full_name="Klaus Köhler",
            phone="+49 30 1234 2013", role="Staff",
            mentor_id=evan_mfg.id,
        )
        mia = _ensure_mil_user(
            "mia@miltenyi.com",
            department_id=dept_com.id, designation_id=desig_sr_scientist.id,
            employee_code="MIL-302", full_name="Mia Markt",
            phone="+49 30 1234 3012", role="Staff",
            mentor_id=lukas.id,
        )
        nils = _ensure_mil_user(
            "nils@miltenyi.com",
            department_id=dept_com.id, designation_id=desig_scientist.id,
            employee_code="MIL-303", full_name="Nils Niedermeier",
            phone="+49 30 1234 3013", role="Staff",
            mentor_id=lukas.id,
        )

        # Reassign Bob → Hans and Evan → Greta so the directors are real
        # mentors (rather than everyone reporting straight to Alice).
        if bob_lead and hans and bob_lead.mentor_id != hans.id:
            bob_lead.mentor_id = hans.id
        if evan_mfg and greta and evan_mfg.mentor_id != greta.id:
            evan_mfg.mentor_id = greta.id
        # Backfill is_management on Hans/Greta if pre-existing rows missed it.
        for _m in (hans, greta):
            if _m and not _m.is_management:
                _m.is_management = True
        db.commit()

        # ================================================================== #
        # 5. SYSTEM SETTINGS                                                  #
        # ================================================================== #

        if not db.query(SystemSettings).filter(SystemSettings.org_id == org.id).first():
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
            db.commit()
            print("  [+] Created System Settings for Healthark (H1 FY26-27, Half Yearly)")
        else:
            print("  [~] Healthark system settings already exist, skipping...")

        if not db.query(SystemSettings).filter(SystemSettings.org_id == miltenyi_org.id).first():
            db.add(SystemSettings(
                org_id=miltenyi_org.id,
                active_cycle_name="Q1 FY26-27",
                cycle_type=CycleType.QUARTERLY.value,
                fiscal_start_month=4,
                goals_submission_open=True,
                reviews_submission_open=True,
                annual_goals_edit_enabled=True,
                updated_by_id=alice_admin.id,
            ))
            db.commit()
            print("  [+] Created System Settings for Miltenyi (Q1 FY26-27, Quarterly)")
        else:
            print("  [~] Miltenyi system settings already exist, skipping...")

        # ================================================================== #
        # 6. PROJECTS                                                         #
        # ================================================================== #

        if db.query(Project).filter(Project.org_id == org.id, Project.project_code == "PRJ-101").count() == 0 \
                and priya and david and vikram:

            proj_specialty = Project(
                org_id=org.id, project_code="PRJ-101",
                name="Specialty Therapy Launch Readiness",
                description="Launch-readiness diagnostic across access, evidence, and commercial ops for a specialty therapy in 4 markets.",
                start_date=date(2025, 1, 20), expected_end_date=date(2025, 7, 31),
                reports_to_id=admin_user.id,
                secondary_evaluator_id=david.id,
            )
            db.add(proj_specialty)
            db.flush()
            db.add(ProjectAssignment(org_id=org.id, project_id=proj_specialty.id, user_id=priya.id,  assignment_role=desig_senior_manager.name,    department_id=dept_strategy.id, evaluator_type="Primary",   assigned_date=date(2025, 1, 20)))
            db.add(ProjectAssignment(org_id=org.id, project_id=proj_specialty.id, user_id=arjun.id,  assignment_role=desig_senior_consultant.name, department_id=dept_strategy.id, evaluator_type=None,        assigned_date=date(2025, 1, 20)))
            db.add(ProjectAssignment(org_id=org.id, project_id=proj_specialty.id, user_id=neha.id,   assignment_role=desig_consultant.name,        department_id=dept_strategy.id, evaluator_type=None,        assigned_date=date(2025, 2, 3)))
            # David is also a project member alongside being the Secondary evaluator.
            db.add(ProjectAssignment(org_id=org.id, project_id=proj_specialty.id, user_id=david.id,  assignment_role=desig_manager.name,           department_id=dept_idt.id,      evaluator_type=None,        assigned_date=date(2025, 1, 25)))
            db.commit()

            proj_trial = Project(
                org_id=org.id, project_code="PRJ-102",
                name="Clinical Trial Data Mart Modernization",
                description="Re-architect the clinical trial data mart into a unified analytics platform with harmonized schemas.",
                start_date=date(2025, 2, 3), expected_end_date=date(2025, 9, 15),
                reports_to_id=admin_user.id,
                secondary_evaluator_id=vikram.id,
            )
            db.add(proj_trial)
            db.flush()
            db.add(ProjectAssignment(org_id=org.id, project_id=proj_trial.id, user_id=david.id,  assignment_role=desig_manager.name,           department_id=dept_idt.id,  evaluator_type="Primary",   assigned_date=date(2025, 2, 3)))
            db.add(ProjectAssignment(org_id=org.id, project_id=proj_trial.id, user_id=rahul.id,  assignment_role=desig_senior_consultant.name, department_id=dept_idt.id,  evaluator_type=None,        assigned_date=date(2025, 2, 3)))
            db.add(ProjectAssignment(org_id=org.id, project_id=proj_trial.id, user_id=meera.id,  assignment_role=desig_consultant.name,        department_id=dept_idt.id,  evaluator_type=None,        assigned_date=date(2025, 2, 17)))
            # Vikram is the Secondary evaluator (project-level) but also a member here.
            db.add(ProjectAssignment(org_id=org.id, project_id=proj_trial.id, user_id=vikram.id, assignment_role=desig_manager.name,           department_id=dept_rwe.id,  evaluator_type=None,        assigned_date=date(2025, 2, 10)))
            db.commit()

            proj_safety = Project(
                org_id=org.id, project_code="PRJ-103",
                name="Long-Term Safety RWE Study",
                description="Multi-year RWE safety study for a chronic therapy area, with quarterly interim reads.",
                start_date=date(2025, 3, 10), expected_end_date=date(2026, 3, 31),
                reports_to_id=priya.id,
                secondary_evaluator_id=david.id,
            )
            db.add(proj_safety)
            db.flush()
            db.add(ProjectAssignment(org_id=org.id, project_id=proj_safety.id, user_id=vikram.id, assignment_role=desig_manager.name,           department_id=dept_rwe.id,      evaluator_type="Primary",  assigned_date=date(2025, 3, 10)))
            db.add(ProjectAssignment(org_id=org.id, project_id=proj_safety.id, user_id=ananya.id, assignment_role=desig_senior_consultant.name, department_id=dept_rwe.id,      evaluator_type=None,       assigned_date=date(2025, 3, 10)))
            db.add(ProjectAssignment(org_id=org.id, project_id=proj_safety.id, user_id=karan.id,  assignment_role=desig_consultant.name,        department_id=dept_rwe.id,      evaluator_type=None,       assigned_date=date(2025, 3, 20)))
            db.add(ProjectAssignment(org_id=org.id, project_id=proj_safety.id, user_id=arjun.id,  assignment_role="Evidence Lead",              department_id=dept_strategy.id, evaluator_type=None,       assigned_date=date(2025, 4, 5)))
            db.commit()

            proj_payer = Project(
                org_id=org.id, project_code="PRJ-104",
                name="Payer Evidence Portfolio — Rare Disease",
                description="Cross-functional payer evidence portfolio combining HEOR, RWE, and strategy workstreams for a rare disease launch.",
                start_date=date(2025, 4, 7), expected_end_date=date(2025, 10, 31),
                reports_to_id=admin_user.id,
                secondary_evaluator_id=vikram.id,
            )
            db.add(proj_payer)
            db.flush()
            db.add(ProjectAssignment(org_id=org.id, project_id=proj_payer.id, user_id=priya.id,  assignment_role=desig_senior_manager.name,    department_id=dept_strategy.id, evaluator_type="Primary",   assigned_date=date(2025, 4, 7)))
            db.add(ProjectAssignment(org_id=org.id, project_id=proj_payer.id, user_id=rahul.id,  assignment_role="Data Lead",                  department_id=dept_idt.id,      evaluator_type=None,        assigned_date=date(2025, 4, 7)))
            db.add(ProjectAssignment(org_id=org.id, project_id=proj_payer.id, user_id=ananya.id, assignment_role="RWE Lead",                   department_id=dept_rwe.id,      evaluator_type=None,        assigned_date=date(2025, 4, 7)))
            db.add(ProjectAssignment(org_id=org.id, project_id=proj_payer.id, user_id=neha.id,   assignment_role=desig_consultant.name,        department_id=dept_strategy.id, evaluator_type=None,        assigned_date=date(2025, 4, 20)))
            # Vikram is the Secondary evaluator (project-level) but also a member here.
            db.add(ProjectAssignment(org_id=org.id, project_id=proj_payer.id, user_id=vikram.id, assignment_role=desig_manager.name,           department_id=dept_rwe.id,      evaluator_type=None,        assigned_date=date(2025, 4, 10)))
            db.commit()

            print("  [+] Created Projects PRJ-101..PRJ-104")
        else:
            print("  [~] Healthark Projects PRJ-101..PRJ-104 already exist, skipping...")

        # PRJ-105 — Marketing Analytics Platform (Amol's project)
        proj_marketing = db.query(Project).filter_by(org_id=org.id, project_code="PRJ-105").first()
        if not proj_marketing and amol and riya and tej:
            proj_marketing = Project(
                org_id=org.id, project_code="PRJ-105",
                name="Healthark Marketing Analytics Platform",
                description="Build internal KPI dashboards and campaign performance analytics to support business development and client acquisition.",
                start_date=date(2025, 5, 1), expected_end_date=date(2025, 12, 31),
                reports_to_id=amol.id,
                secondary_evaluator_id=admin_user.id,
            )
            db.add(proj_marketing)
            db.flush()
            db.add(ProjectAssignment(org_id=org.id, project_id=proj_marketing.id, user_id=amol.id, assignment_role=desig_director.name,          department_id=dept_marketing.id, evaluator_type="Primary", assigned_date=date(2025, 5, 1)))
            db.add(ProjectAssignment(org_id=org.id, project_id=proj_marketing.id, user_id=riya.id, assignment_role=desig_consultant.name,        department_id=dept_marketing.id, evaluator_type=None,      assigned_date=date(2025, 5, 1)))
            db.add(ProjectAssignment(org_id=org.id, project_id=proj_marketing.id, user_id=tej.id,  assignment_role=desig_senior_consultant.name, department_id=dept_marketing.id, evaluator_type=None,      assigned_date=date(2025, 5, 1)))
            db.commit()
            print("  [+] Created Project PRJ-105 (Marketing Analytics Platform)")
        else:
            if proj_marketing:
                print("  [~] PRJ-105 already exists, skipping...")
            proj_marketing = db.query(Project).filter_by(org_id=org.id, project_code="PRJ-105").first()

        if db.query(Project).filter(Project.org_id == miltenyi_org.id).count() == 0 and bob_lead and evan_mfg:

            proj_cell = Project(
                org_id=miltenyi_org.id, project_code="MIL-PRJ-101",
                name="Next-Gen CAR-T Workflow Automation",
                description="Automate end-to-end CAR-T cell processing workflow with new instrumentation.",
                start_date=date(2025, 1, 15), expected_end_date=date(2025, 8, 15),
                reports_to_id=alice_admin.id,
                secondary_evaluator_id=evan_mfg.id,
            )
            db.add(proj_cell)
            db.flush()
            db.add(ProjectAssignment(org_id=miltenyi_org.id, project_id=proj_cell.id, user_id=bob_lead.id, assignment_role=desig_lead.name,         department_id=dept_rnd.id, evaluator_type="Primary", assigned_date=date(2025, 1, 15)))
            db.add(ProjectAssignment(org_id=miltenyi_org.id, project_id=proj_cell.id, user_id=charlie.id,  assignment_role=desig_sr_scientist.name, department_id=dept_rnd.id, evaluator_type=None,      assigned_date=date(2025, 1, 22)))
            db.add(ProjectAssignment(org_id=miltenyi_org.id, project_id=proj_cell.id, user_id=dana.id,     assignment_role=desig_scientist.name,    department_id=dept_rnd.id, evaluator_type=None,      assigned_date=date(2025, 2, 1)))
            db.commit()

            proj_macs = Project(
                org_id=miltenyi_org.id, project_code="MIL-PRJ-102",
                name="MACS Quant Scale-Up Program",
                description="Scale manufacturing of the next MACS Quant platform for global rollout.",
                start_date=date(2025, 3, 5), expected_end_date=date(2025, 11, 30),
                reports_to_id=alice_admin.id,
                secondary_evaluator_id=bob_lead.id,
            )
            db.add(proj_macs)
            db.flush()
            db.add(ProjectAssignment(org_id=miltenyi_org.id, project_id=proj_macs.id, user_id=evan_mfg.id, assignment_role=desig_lead.name,      department_id=dept_mfg.id, evaluator_type="Primary",   assigned_date=date(2025, 3, 5)))
            db.add(ProjectAssignment(org_id=miltenyi_org.id, project_id=proj_macs.id, user_id=fiona.id,    assignment_role=desig_scientist.name, department_id=dept_mfg.id, evaluator_type=None,        assigned_date=date(2025, 3, 5)))
            # Bob is the Secondary evaluator (project-level) but also a project member.
            db.add(ProjectAssignment(org_id=miltenyi_org.id, project_id=proj_macs.id, user_id=bob_lead.id, assignment_role="R&D Liaison",        department_id=dept_rnd.id, evaluator_type=None,        assigned_date=date(2025, 3, 18)))
            db.commit()

            print("  [+] Created Projects for Miltenyi (MIL-PRJ-101..MIL-PRJ-102)")
        else:
            print("  [~] Miltenyi base projects already exist, skipping...")

        # Idempotent additions for the broader Miltenyi project set.
        # MIL-PRJ-103 — Cell Therapy Process Validation (R&D, runs into FY26-27).
        proj_validation = db.query(Project).filter_by(
            org_id=miltenyi_org.id, project_code="MIL-PRJ-103",
        ).first()
        if not proj_validation and bob_lead and iris:
            proj_validation = Project(
                org_id=miltenyi_org.id, project_code="MIL-PRJ-103",
                name="Cell Therapy Process Validation",
                description="GMP-grade process validation for the next-gen CAR-T pipeline ahead of clinical hand-off.",
                start_date=date(2026, 1, 8), expected_end_date=date(2026, 9, 30),
                reports_to_id=hans.id,
                secondary_evaluator_id=alice_admin.id,
            )
            db.add(proj_validation)
            db.flush()
            db.add(ProjectAssignment(org_id=miltenyi_org.id, project_id=proj_validation.id, user_id=bob_lead.id, assignment_role=desig_lead.name,         department_id=dept_rnd.id, evaluator_type="Primary", assigned_date=date(2026, 1, 8)))
            db.add(ProjectAssignment(org_id=miltenyi_org.id, project_id=proj_validation.id, user_id=charlie.id,  assignment_role=desig_sr_scientist.name, department_id=dept_rnd.id, evaluator_type=None,      assigned_date=date(2026, 1, 8)))
            db.add(ProjectAssignment(org_id=miltenyi_org.id, project_id=proj_validation.id, user_id=iris.id,     assignment_role=desig_sr_scientist.name, department_id=dept_rnd.id, evaluator_type=None,      assigned_date=date(2026, 1, 8)))
            db.add(ProjectAssignment(org_id=miltenyi_org.id, project_id=proj_validation.id, user_id=dana.id,     assignment_role=desig_scientist.name,    department_id=dept_rnd.id, evaluator_type=None,      assigned_date=date(2026, 1, 22)))
            db.add(ProjectAssignment(org_id=miltenyi_org.id, project_id=proj_validation.id, user_id=evan_mfg.id, assignment_role="Mfg Liaison",           department_id=dept_mfg.id, evaluator_type=None,      assigned_date=date(2026, 1, 15)))
            db.commit()
            print("  [+] Created MIL-PRJ-103 (Cell Therapy Process Validation)")

        # MIL-PRJ-104 — Commercial Launch Strategy (Commercial, runs through FY26-27).
        proj_launch = db.query(Project).filter_by(
            org_id=miltenyi_org.id, project_code="MIL-PRJ-104",
        ).first()
        if not proj_launch and lukas and mia and nils:
            proj_launch = Project(
                org_id=miltenyi_org.id, project_code="MIL-PRJ-104",
                name="Commercial Launch Strategy 2026",
                description="Cross-functional commercial readiness for the EMEA + APAC launch waves of the new MACS Quant.",
                start_date=date(2026, 1, 5), expected_end_date=date(2026, 12, 31),
                reports_to_id=alice_admin.id,
                secondary_evaluator_id=greta.id,
            )
            db.add(proj_launch)
            db.flush()
            db.add(ProjectAssignment(org_id=miltenyi_org.id, project_id=proj_launch.id, user_id=lukas.id, assignment_role=desig_lead.name,         department_id=dept_com.id, evaluator_type="Primary", assigned_date=date(2026, 1, 5)))
            db.add(ProjectAssignment(org_id=miltenyi_org.id, project_id=proj_launch.id, user_id=mia.id,   assignment_role=desig_sr_scientist.name, department_id=dept_com.id, evaluator_type=None,      assigned_date=date(2026, 1, 5)))
            db.add(ProjectAssignment(org_id=miltenyi_org.id, project_id=proj_launch.id, user_id=nils.id,  assignment_role=desig_scientist.name,    department_id=dept_com.id, evaluator_type=None,      assigned_date=date(2026, 1, 5)))
            db.add(ProjectAssignment(org_id=miltenyi_org.id, project_id=proj_launch.id, user_id=evan_mfg.id, assignment_role="Mfg Advisor",        department_id=dept_mfg.id, evaluator_type=None,      assigned_date=date(2026, 2, 1)))
            db.commit()
            print("  [+] Created MIL-PRJ-104 (Commercial Launch Strategy 2026)")

        # Resolve project handles for downstream sections.
        proj_cell_mil       = db.query(Project).filter_by(org_id=miltenyi_org.id, project_code="MIL-PRJ-101").first()
        proj_macs_mil       = db.query(Project).filter_by(org_id=miltenyi_org.id, project_code="MIL-PRJ-102").first()
        proj_validation_mil = db.query(Project).filter_by(org_id=miltenyi_org.id, project_code="MIL-PRJ-103").first()
        proj_launch_mil     = db.query(Project).filter_by(org_id=miltenyi_org.id, project_code="MIL-PRJ-104").first()

        # ================================================================== #
        # 7. ROLE EXPECTATIONS                                                #
        # ================================================================== #

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

        if db.query(RoleExpectation).filter(RoleExpectation.org_id == org.id).count() == 0:
            added_count = 0
            for dept_name, designations_dict in EXPECTATIONS_DATA.items():
                dept = db.query(Department).filter(Department.org_id == org.id, Department.name == dept_name).first()
                if not dept:
                    continue
                for desig_name, competencies in designations_dict.items():
                    desig = db.query(Designation).filter(Designation.org_id == org.id, Designation.name == desig_name).first()
                    if not desig:
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
            db.commit()
            print(f"  [+] Seeded {added_count} Role Expectations for Healthark")
        else:
            print("  [~] Healthark Role expectations already exist, skipping...")

        # ── Miltenyi role expectations ─────────────────────────────────
        MIL_EXPECTATIONS = {
            "R&D": {
                "Scientist": {
                    "exp_task_execution": "Executes assigned bench / analytical tasks reliably with guidance from senior scientists.",
                    "exp_ownership": "Owns small experimental modules end-to-end and flags blockers early.",
                    "exp_project_management": "Tracks experiments in lab notebooks and meets agreed timelines.",
                    "exp_client_deliverables": "Produces clean datasets and well-documented protocols.",
                    "exp_communication": "Clear written summaries; growing comfort presenting in team meetings.",
                    "exp_mentoring": "Supports onboarding of new lab joiners on instruments and SOPs.",
                    "exp_firm_growth": "Participates in internal seminars and knowledge-sharing sessions | Contributes to lab safety + housekeeping initiatives",
                    "exp_competency_skills": "Building proficiency in core wet-lab and analytical assay techniques.",
                },
                "Senior Scientist": {
                    "exp_task_execution": "Designs and runs moderately complex experiments independently; troubleshoots assays.",
                    "exp_ownership": "Owns workstreams across a project and partners cross-functionally with Mfg/Commercial.",
                    "exp_project_management": "Plans experiment timelines, manages reagent supply, tracks risks.",
                    "exp_client_deliverables": "Authors method documents and study reports to GMP-friendly standards.",
                    "exp_communication": "Leads internal reviews and presents data confidently to senior stakeholders.",
                    "exp_mentoring": "Mentors junior scientists on experimental design and data interpretation.",
                    "exp_firm_growth": "Contributes to internal best-practice docs | Helps interview new scientists | Drives at least one knowledge-share per year",
                    "exp_competency_skills": "SME in one platform / assay; expanding into adjacent technologies.",
                },
                "Team Lead": {
                    "exp_task_execution": "Leads scientific direction and protocol design across the team.",
                    "exp_ownership": "Accountable for project outcomes; balances scientific rigor with delivery timelines.",
                    "exp_project_management": "Owns project plan, milestones, budget, and stakeholder communication.",
                    "exp_client_deliverables": "Reviews and signs off on regulatory-grade deliverables.",
                    "exp_communication": "Represents the team to leadership and external partners.",
                    "exp_mentoring": "Coaches scientists through career growth and structured feedback.",
                    "exp_firm_growth": "Acts as role model on culture and rigor | Drives R&D capability uplift | Identifies process improvements across the function | Participates in hiring and team-building decisions",
                    "exp_competency_skills": "Recognised expert in the team's platform area; mentors emerging SMEs.",
                },
            },
            "Manufacturing": {
                "Scientist": {
                    "exp_task_execution": "Performs routine production / QC tasks reliably; raises deviations promptly.",
                    "exp_ownership": "Owns assigned process steps and documentation accuracy.",
                    "exp_project_management": "Adheres to production schedules and escalates risks early.",
                    "exp_client_deliverables": "Produces clean batch records and SOP-compliant documentation.",
                    "exp_communication": "Clear shift hand-offs and accurate written status updates.",
                    "exp_mentoring": "Onboards new operators on cleanroom protocols.",
                    "exp_firm_growth": "Participates in continuous-improvement (Kaizen) sessions | Contributes ideas for safety + waste reduction",
                    "exp_competency_skills": "Building proficiency on key production instruments and aseptic technique.",
                },
                "Senior Scientist": {
                    "exp_task_execution": "Owns process improvements and root-cause analysis on deviations.",
                    "exp_ownership": "Drives a workstream across one or more product lines.",
                    "exp_project_management": "Coordinates with R&D on tech-transfer and runs production planning.",
                    "exp_client_deliverables": "Authors validation reports and CAPA documentation.",
                    "exp_communication": "Leads cross-functional production review meetings.",
                    "exp_mentoring": "Mentors junior staff on GMP and analytical methods.",
                    "exp_firm_growth": "Drives at least one continuous-improvement initiative per year | Supports interviewing | Contributes to compliance training material",
                    "exp_competency_skills": "Deep expertise in one production platform; growing breadth across related lines.",
                },
                "Team Lead": {
                    "exp_task_execution": "Sets manufacturing strategy and ensures regulatory readiness across the line.",
                    "exp_ownership": "Owns line-level KPIs (throughput, yield, deviation rate, customer complaints).",
                    "exp_project_management": "Owns multi-site programs end-to-end with budget and milestone accountability.",
                    "exp_client_deliverables": "Final sign-off on validation, CAPA, and audit-ready documentation.",
                    "exp_communication": "Owns regulatory and customer-facing communications for the line.",
                    "exp_mentoring": "Coaches the team on technical depth, GMP rigor, and career growth.",
                    "exp_firm_growth": "Champions operational excellence | Drives capability investments | Owns hiring plans for the line | Represents Mfg in cross-functional leadership forums",
                    "exp_competency_skills": "Recognised authority on the line's platforms; sets technical standards.",
                },
            },
            "Commercial": {
                "Scientist": {
                    "exp_task_execution": "Supports market analysis, customer onboarding, and tracker maintenance.",
                    "exp_ownership": "Owns assigned tasks within accounts / regions reliably.",
                    "exp_project_management": "Maintains opportunity trackers and meets reporting cadences.",
                    "exp_client_deliverables": "Produces clean pitch decks and customer-ready collateral with guidance.",
                    "exp_communication": "Clear written customer summaries; growing confidence on calls.",
                    "exp_mentoring": "Helps onboard new commercial joiners on tools and processes.",
                    "exp_firm_growth": "Participates in customer events and knowledge-sharing | Contributes case studies",
                    "exp_competency_skills": "Building proficiency in commercial systems, CRM, and product fundamentals.",
                },
                "Senior Scientist": {
                    "exp_task_execution": "Independently scopes and runs customer engagements end-to-end.",
                    "exp_ownership": "Owns one region / segment with quota and pipeline accountability.",
                    "exp_project_management": "Drives launch readiness across stakeholders (R&D, Mfg, Marketing).",
                    "exp_client_deliverables": "Crafts compelling pitch material and strategy briefs.",
                    "exp_communication": "Leads customer pitches and senior internal reviews.",
                    "exp_mentoring": "Mentors junior commercial staff on customer skills.",
                    "exp_firm_growth": "Owns at least one launch or commercial initiative per year | Supports recruiting | Builds case studies for eminence",
                    "exp_competency_skills": "SME in a product line or therapeutic area; growing strategic breadth.",
                },
                "Team Lead": {
                    "exp_task_execution": "Sets commercial strategy across multiple regions / product lines.",
                    "exp_ownership": "Accountable for regional pipeline, revenue, and customer satisfaction.",
                    "exp_project_management": "Owns launch programs end-to-end with cross-functional governance.",
                    "exp_client_deliverables": "Final sign-off on enterprise customer proposals and strategy decks.",
                    "exp_communication": "Owns C-level customer relationships and internal leadership reviews.",
                    "exp_mentoring": "Coaches the team on customer skills, deal craft, and career growth.",
                    "exp_firm_growth": "Drives go-to-market evolution | Champions cross-functional collaboration | Owns hiring + retention | Represents Commercial in leadership forums",
                    "exp_competency_skills": "Recognised authority on the region / segment; sets commercial playbooks.",
                },
            },
        }

        if db.query(RoleExpectation).filter(RoleExpectation.org_id == miltenyi_org.id).count() == 0:
            mil_added = 0
            for dept_name, designations_dict in MIL_EXPECTATIONS.items():
                _dept = db.query(Department).filter_by(org_id=miltenyi_org.id, name=dept_name).first()
                if not _dept:
                    continue
                for desig_name, competencies in designations_dict.items():
                    _desig = db.query(Designation).filter_by(org_id=miltenyi_org.id, name=desig_name).first()
                    if not _desig:
                        continue
                    db.add(RoleExpectation(
                        org_id=miltenyi_org.id,
                        department_id=_dept.id,
                        designation_id=_desig.id,
                        exp_task_execution=competencies.get("exp_task_execution", ""),
                        exp_ownership=competencies.get("exp_ownership", ""),
                        exp_project_management=competencies.get("exp_project_management", ""),
                        exp_client_deliverables=competencies.get("exp_client_deliverables", ""),
                        exp_communication=competencies.get("exp_communication", ""),
                        exp_mentoring=competencies.get("exp_mentoring", ""),
                        exp_firm_growth=competencies.get("exp_firm_growth", ""),
                        exp_competency_skills=competencies.get("exp_competency_skills", ""),
                    ))
                    mil_added += 1
            db.commit()
            print(f"  [+] Seeded {mil_added} Role Expectations for Miltenyi")
        else:
            print("  [~] Miltenyi Role expectations already exist, skipping...")

        # ================================================================== #
        # 8. PROJECT REVIEWS                                                  #
        # ================================================================== #

        proj_specialty = db.query(Project).filter_by(org_id=org.id, project_code="PRJ-101").first()
        proj_trial     = db.query(Project).filter_by(org_id=org.id, project_code="PRJ-102").first()
        proj_safety    = db.query(Project).filter_by(org_id=org.id, project_code="PRJ-103").first()
        proj_payer     = db.query(Project).filter_by(org_id=org.id, project_code="PRJ-104").first()

        def _pr(user, project, reviewer, cycle, status, pg=None, impact=None, **comments):
            if not project:
                return
            if not db.query(ProjectReview).filter_by(
                org_id=org.id, user_id=user.id, project_id=project.id, cycle=cycle,
            ).first():
                db.add(ProjectReview(
                    org_id=org.id, user_id=user.id, project_id=project.id,
                    reviewer_id=reviewer.id if reviewer else None,
                    cycle=cycle, status=status,
                    performance_group=pg, impact_statement=impact, **comments,
                ))

        def _pre(review_id, evaluator, impact, status="submitted"):
            if not db.query(ProjectReviewEvaluator).filter_by(
                project_review_id=review_id, evaluator_id=evaluator.id,
            ).first():
                db.add(ProjectReviewEvaluator(
                    org_id=org.id, project_review_id=review_id,
                    evaluator_id=evaluator.id, evaluator_type="Secondary",
                    status=status, impact_statement=impact,
                ))

        if db.query(ProjectReview).filter(ProjectReview.org_id == org.id).count() == 0 \
                and proj_specialty and proj_trial and proj_safety and proj_payer:

            # ── H1 FY25-26 ────────────────────────────────────────────────────
            _pr(arjun, proj_specialty, priya, "H1 FY25-26", "reviewed", pg="4",
                impact="Arjun led the payer landscape assessment with strong analytical depth across 4 markets.",
                comment_task_execution="Structured the market assessment framework end-to-end.",
                comment_ownership="Owned the multi-market comparison with proactive risk flagging.",
                comment_project_management="Maintained a clean tracker and escalated early when timelines slipped.",
                comment_client_deliverables="Storyboards were tight; client accepted in the first review round.",
                comment_communication="Clear written updates; confident in internal reviews.",
                comment_mentoring="Supported Neha on market sizing methodology.",
                comment_competency_skills="Developing a strong specialty-therapy access lens.",
            )
            _pr(neha, proj_specialty, priya, "H1 FY25-26", "reviewed", pg="3",
                impact="Neha delivered clean research outputs and adapted quickly to client feedback.",
                comment_task_execution="Completed secondary research tasks thoroughly with guidance.",
                comment_ownership="Reliable on assigned modules; building proactive instincts.",
                comment_project_management="Followed plans well; improving on proactive status updates.",
                comment_client_deliverables="Produced well-formatted slides with good consistency.",
                comment_communication="Improving verbal confidence; written communication is strong.",
                comment_mentoring="Active participant in team discussions.",
                comment_competency_skills="Building market access research fundamentals.",
            )
            db.flush()
            arjun_spec_h1 = db.query(ProjectReview).filter_by(org_id=org.id, user_id=arjun.id, project_id=proj_specialty.id, cycle="H1 FY25-26").first()
            neha_spec_h1  = db.query(ProjectReview).filter_by(org_id=org.id, user_id=neha.id,  project_id=proj_specialty.id, cycle="H1 FY25-26").first()
            if arjun_spec_h1: _pre(arjun_spec_h1.id, david, "Arjun integrated IDT analytics cleanly into the access framework.")
            if neha_spec_h1:  _pre(neha_spec_h1.id,  david, "Neha was responsive on cross-functional data asks with clean documentation.")
            db.commit()

            _pr(rahul, proj_trial, david, "H1 FY25-26", "reviewed", pg="4",
                impact="Rahul delivered the data mart ingestion layer ahead of schedule with strong quality.",
                comment_task_execution="Independently designed and implemented the schema harmonization layer.",
                comment_ownership="Full ownership of the ingestion workstream; unblocked the team consistently.",
                comment_project_management="Proactive risk escalation and clean sprint planning.",
                comment_client_deliverables="Code quality was high; zero critical defects post-deployment.",
                comment_communication="Translated technical decisions for strategy stakeholders effectively.",
                comment_mentoring="Ran code review sessions for Meera weekly.",
                comment_competency_skills="Strong in SQL, Python, and data modeling; Senior Consultant trajectory.",
            )
            _pr(meera, proj_trial, david, "H1 FY25-26", "reviewed", pg="3",
                impact="Meera contributed meaningfully to the ETL pipelines and testing framework.",
                comment_task_execution="Completed ETL tasks with guidance; learning independent structuring.",
                comment_ownership="Dependable on assigned modules; growing confidence to own more.",
                comment_project_management="Meeting sprint commitments; improving on estimation.",
                comment_client_deliverables="Output quality has risen notably across the half.",
                comment_communication="Good meeting engagement; written updates becoming more concise.",
                comment_mentoring="Eager learner; receptive in code reviews.",
                comment_competency_skills="Progressing steadily in Python and data modeling.",
            )
            db.flush()
            rahul_trial_h1 = db.query(ProjectReview).filter_by(org_id=org.id, user_id=rahul.id, project_id=proj_trial.id, cycle="H1 FY25-26").first()
            meera_trial_h1 = db.query(ProjectReview).filter_by(org_id=org.id, user_id=meera.id, project_id=proj_trial.id, cycle="H1 FY25-26").first()
            if rahul_trial_h1: _pre(rahul_trial_h1.id, vikram, "Rahul's RWE schema integration accelerated our study data pipeline.")
            if meera_trial_h1: _pre(meera_trial_h1.id, vikram, "Meera supported cross-team data requests reliably.")
            db.commit()

            _pr(ananya, proj_safety, vikram, "H1 FY25-26", "reviewed", pg="4",
                impact="Ananya led protocol design for the long-term safety study with scientific rigor.",
                comment_task_execution="Structured the methodology independently with deep scientific reasoning.",
                comment_ownership="Owned the protocol end-to-end and drove IRB submission.",
                comment_project_management="Clean multi-site timeline management; early risk escalation.",
                comment_client_deliverables="Protocol doc was publication-quality on the first pass.",
                comment_communication="Confident presenter in clinical stakeholder discussions.",
                comment_mentoring="Coached Karan on study design fundamentals.",
                comment_competency_skills="Growing expertise in chronic-therapy safety methodology.",
            )
            _pr(karan, proj_safety, vikram, "H1 FY25-26", "reviewed", pg="3",
                impact="Karan supported the literature review and early data collection with good quality.",
                comment_task_execution="Completed literature reviews with guidance on prioritization.",
                comment_ownership="Dependable on assigned tasks; building initiative.",
                comment_project_management="Following project plans well; improving on proactive flagging.",
                comment_client_deliverables="Summaries were accurate; formatting consistency improving.",
                comment_communication="Clear internal communications; building stakeholder confidence.",
                comment_mentoring="Active in team discussions.",
                comment_competency_skills="Building foundational RWE knowledge steadily.",
            )
            db.commit()

            _pr(rahul, proj_payer, priya, "H1 FY25-26", "reviewed", pg="4",
                impact="Rahul's data integration was a cornerstone of the payer evidence package.",
                comment_task_execution="Delivered the data harmonization layer across strategy, RWE, and IDT.",
                comment_ownership="Managed the data pipeline end-to-end across three teams.",
                comment_project_management="Kept the cross-functional tracker in sync across workstreams.",
                comment_client_deliverables="Outputs were clean, well-documented, and client-ready.",
                comment_communication="Translated across strategy / RWE / IDT vocabulary seamlessly.",
                comment_mentoring="Supported team members on data tooling and schema access.",
                comment_competency_skills="Showcased breadth across analytics, data engineering, and RWE.",
            )
            _pr(ananya, proj_payer, priya, "H1 FY25-26", "reviewed", pg="4",
                impact="Ananya's RWE synthesis strengthened the payer evidence base significantly.",
                comment_task_execution="Independently synthesized RWE signals into the evidence package.",
                comment_ownership="Went beyond assigned scope to drive the evidence narrative.",
                comment_project_management="Excellent cross-workstream coordination with early risk flags.",
                comment_client_deliverables="RWE sections were scientifically robust and visually compelling.",
                comment_communication="Effective with both technical and strategy stakeholders.",
                comment_mentoring="Shared RWE context with strategy team members.",
                comment_competency_skills="Strong rare-disease RWE capability in cross-functional setting.",
            )
            _pr(neha, proj_payer, priya, "H1 FY25-26", "reviewed", pg="3",
                impact="Neha contributed to strategy slides and research compilation reliably.",
                comment_task_execution="Handled research and slide compilation tasks dependably.",
                comment_ownership="Growing confidence for broader module ownership.",
                comment_project_management="Following plans well; improving at proactive status reporting.",
                comment_client_deliverables="Outputs were well-formatted; storytelling improving.",
                comment_communication="Clear and timely on assigned communication tasks.",
                comment_mentoring="Learning from cross-functional exposure.",
                comment_competency_skills="Growing grasp of integrated evidence requirements.",
            )
            db.flush()
            rahul_pay_h1  = db.query(ProjectReview).filter_by(org_id=org.id, user_id=rahul.id,  project_id=proj_payer.id, cycle="H1 FY25-26").first()
            ananya_pay_h1 = db.query(ProjectReview).filter_by(org_id=org.id, user_id=ananya.id, project_id=proj_payer.id, cycle="H1 FY25-26").first()
            neha_pay_h1   = db.query(ProjectReview).filter_by(org_id=org.id, user_id=neha.id,   project_id=proj_payer.id, cycle="H1 FY25-26").first()
            if rahul_pay_h1:  _pre(rahul_pay_h1.id,  vikram, "Rahul's cross-functional data leadership was instrumental.")
            if ananya_pay_h1: _pre(ananya_pay_h1.id, vikram, "Ananya's RWE rigor kept the evidence story scientifically sound.")
            if neha_pay_h1:   _pre(neha_pay_h1.id,   vikram, "Neha was a reliable contributor across cross-functional workstreams.")
            db.commit()

            # ── H2 FY25-26 ────────────────────────────────────────────────────
            _pr(arjun, proj_specialty, priya, "H2 FY25-26", "reviewed", pg="4",
                impact="Arjun took broader coordination responsibility across the launch portfolio.",
                comment_task_execution="Structured research gaps proactively without prompting.",
                comment_ownership="Owned two modules simultaneously without missed deadlines.",
                comment_project_management="Introduced a cross-team tracker that improved coordination.",
                comment_client_deliverables="Narrative-driven slides with strong data visualization.",
                comment_communication="More confident with stakeholders; clear written updates.",
                comment_mentoring="Guided Neha and Karan on research frameworks.",
                comment_competency_skills="Strong growth in specialty-therapy strategy; Senior Consultant potential.",
            )
            _pr(neha, proj_specialty, priya, "H2 FY25-26", "reviewed", pg="4",
                impact="Neha stepped up measurably in quality and independence during H2.",
                comment_task_execution="Structuring tasks more independently with less guidance.",
                comment_ownership="More proactive in risk flagging and clarification.",
                comment_project_management="Improved on timeline adherence and progress communication.",
                comment_client_deliverables="Visible jump in slide quality and storyboarding.",
                comment_communication="More confident in team discussions.",
                comment_mentoring="Starting to support newer members on basic tasks.",
                comment_competency_skills="Solid progress in market access research.",
            )
            db.commit()

            _pr(rahul, proj_trial, david, "H2 FY25-26", "reviewed", pg="5",
                impact="Rahul delivered an exceptional H2 with technical leadership across the mart.",
                comment_task_execution="Led architecture decisions for the expanded platform independently.",
                comment_ownership="End-to-end ownership across three workstreams; zero misses.",
                comment_project_management="Introduced sprint planning that lifted team velocity.",
                comment_client_deliverables="Client-facing dashboards were best-in-class.",
                comment_communication="Executive-level clarity on technical decisions.",
                comment_mentoring="Weekly coaching sessions with Meera throughout H2.",
                comment_competency_skills="Senior Consultant-level depth across data engineering and analytics.",
            )
            _pr(meera, proj_trial, david, "H2 FY25-26", "pending")
            db.commit()

            _pr(ananya, proj_safety, vikram, "H2 FY25-26", "reviewed", pg="5",
                impact="Ananya's leadership elevated the interim safety readouts meaningfully.",
                comment_task_execution="Led the interim statistical analysis design independently.",
                comment_ownership="Complete ownership of the protocol and evidence synthesis.",
                comment_project_management="Managed timelines across 4 sites seamlessly.",
                comment_client_deliverables="Deliverables were publication-ready.",
                comment_communication="Effective clinical stakeholder engagement.",
                comment_mentoring="Coached Karan on study design and organized knowledge sessions.",
                comment_competency_skills="Emerging SME in chronic-therapy safety RWE.",
            )
            _pr(karan, proj_safety, vikram, "H2 FY25-26", "pending")
            db.commit()

            _pr(rahul, proj_payer, priya, "H2 FY25-26", "reviewed", pg="4",
                impact="Rahul's H2 cross-functional contribution was outstanding.",
                comment_task_execution="Led the data harmonization across workstreams with minimal guidance.",
                comment_ownership="Managed multi-team dependencies with full accountability.",
                comment_project_management="Exceptional tracker management and risk escalation.",
                comment_client_deliverables="Integrated evidence outputs were best-in-class.",
                comment_communication="Proactive cross-functional risk communication.",
                comment_mentoring="Supported strategy and RWE team members on tooling.",
                comment_competency_skills="Strong cross-functional expertise demonstrated.",
            )
            _pr(ananya, proj_payer, priya, "H2 FY25-26", "reviewed", pg="5",
                impact="Ananya's RWE leadership was pivotal to the H2 payer evidence package.",
                comment_task_execution="Led the RWE synthesis workstream at a high scientific bar.",
                comment_ownership="Full ownership of the RWE narrative; exceeded scope.",
                comment_project_management="Managed timelines across workstreams cleanly.",
                comment_client_deliverables="RWE output received specific client praise.",
                comment_communication="Excellent at presenting complex evidence to non-technical audiences.",
                comment_mentoring="Coached the strategy team on RWE interpretation.",
                comment_competency_skills="Recognized as internal RWE SME.",
            )
            _pr(neha, proj_payer, priya, "H2 FY25-26", "pending")
            db.commit()

            # ── H1 FY26-27 (current) ──────────────────────────────────────────
            _pr(ananya, proj_safety, vikram, "H1 FY26-27", "pending")
            _pr(karan,  proj_safety, vikram, "H1 FY26-27", "pending")
            _pr(rahul,  proj_payer,  priya,  "H1 FY26-27", "pending")
            _pr(ananya, proj_payer,  priya,  "H1 FY26-27", "pending")
            _pr(neha,   proj_payer,  priya,  "H1 FY26-27", "pending")
            db.commit()

            print("  [+] Created Project Reviews: PRJ-101..PRJ-104 across H1 FY25-26, H2 FY25-26, H1 FY26-27")
        else:
            print("  [~] Healthark Project Reviews already exist, skipping...")

        # PRJ-105 reviews for Riya and Tej (idempotent — uses _pr which checks existence)
        if proj_marketing and riya and tej and amol:
            _pr(riya, proj_marketing, amol, "H1 FY25-26", "reviewed", pg="3",
                impact="Riya contributed solid research and data gathering across the analytics platform build.",
                comment_task_execution="Completed research and data analysis tasks reliably with guidance.",
                comment_ownership="Dependable on assigned modules; building proactive instincts.",
                comment_project_management="Following plans well; communicating status clearly.",
                comment_client_deliverables="Well-formatted reports with improving consistency.",
                comment_communication="Clear written updates; growing verbal confidence.",
                comment_mentoring="Active participant and quick learner in team sessions.",
                comment_competency_skills="Building foundational marketing analytics knowledge.",
            )
            _pr(tej, proj_marketing, amol, "H1 FY25-26", "reviewed", pg="4",
                impact="Tej led the dashboard design and independently built the campaign performance module.",
                comment_task_execution="Structured analytics tasks independently with strong methodology.",
                comment_ownership="Owned the dashboard workstream end-to-end with minimal guidance.",
                comment_project_management="Proactive on timelines and cross-team coordination.",
                comment_client_deliverables="Dashboard outputs were clean, insightful, and stakeholder-ready.",
                comment_communication="Translated analytics findings clearly for non-technical stakeholders.",
                comment_mentoring="Supported Riya on data modeling fundamentals.",
                comment_competency_skills="Strong in BI tooling and marketing analytics.",
            )
            db.commit()

            _pr(riya, proj_marketing, amol, "H2 FY25-26", "reviewed", pg="4",
                impact="Riya took on broader ownership in H2, driving the reporting automation workstream.",
                comment_task_execution="Structuring tasks more independently with less guidance.",
                comment_ownership="Stepped up to own the reporting automation module.",
                comment_project_management="Improved on proactive status updates and deadline management.",
                comment_client_deliverables="Visible quality improvement in analytics outputs.",
                comment_communication="More confident in team discussions and stakeholder updates.",
                comment_mentoring="Supporting newer joiners on tooling onboarding.",
                comment_competency_skills="Growing rapidly in marketing analytics and BI tools.",
            )
            _pr(tej, proj_marketing, amol, "H2 FY25-26", "reviewed", pg="4",
                impact="Tej delivered the full KPI framework and led client-facing dashboard rollout.",
                comment_task_execution="Led the full KPI framework design with strong analytical depth.",
                comment_ownership="End-to-end ownership of the dashboard rollout with zero misses.",
                comment_project_management="Excellent cross-team coordination and early risk flagging.",
                comment_client_deliverables="Dashboards were praised by leadership for clarity.",
                comment_communication="Executive-level clarity in presenting analytics insights.",
                comment_mentoring="Ran structured analytics sessions for the team.",
                comment_competency_skills="Senior Consultant trajectory in marketing analytics.",
            )
            db.commit()

            _pr(riya, proj_marketing, amol, "H1 FY26-27", "pending")
            _pr(tej,  proj_marketing, amol, "H1 FY26-27", "pending")
            db.commit()
            print("  [+] Ensured PRJ-105 Project Reviews for Riya and Tej")

        # ── Miltenyi Project Reviews ──────────────────────────────────
        def _pr_mil(user, project, reviewer, cycle, status, pg=None, impact=None, **comments):
            if not project or not user or not reviewer:
                return
            if not db.query(ProjectReview).filter_by(
                org_id=miltenyi_org.id, user_id=user.id, project_id=project.id, cycle=cycle,
            ).first():
                db.add(ProjectReview(
                    org_id=miltenyi_org.id, user_id=user.id, project_id=project.id,
                    reviewer_id=reviewer.id, cycle=cycle, status=status,
                    performance_group=pg, impact_statement=impact, **comments,
                ))

        if proj_cell_mil and proj_macs_mil:
            # Q4 FY25-26 — completed reviews on the original two projects.
            _pr_mil(charlie, proj_cell_mil, bob_lead, "Q4 FY25-26", "reviewed", pg="4",
                impact="Charlie drove the upstream automation module with strong technical depth.",
                comment_task_execution="Independently designed and validated the upstream module.",
                comment_ownership="Owned the deliverable end-to-end and cleared blockers proactively.",
                comment_project_management="Tight tracker discipline; risk flags were raised early.",
                comment_client_deliverables="Validation reports were GMP-ready on first review.",
                comment_communication="Clear with both R&D peers and the Mfg liaison.",
                comment_mentoring="Coached Dana on assay troubleshooting.",
                comment_competency_skills="Strong cell-therapy assay expertise; growing depth in automation.",
            )
            _pr_mil(dana, proj_cell_mil, bob_lead, "Q4 FY25-26", "reviewed", pg="3",
                impact="Dana delivered the assay validation package on time with steady quality.",
                comment_task_execution="Completed validation runs methodically with light guidance.",
                comment_ownership="Reliable on assigned modules; growing initiative.",
                comment_project_management="Met sprint commitments; improving on estimation.",
                comment_client_deliverables="Documentation quality lifted notably across the quarter.",
                comment_communication="Improving verbal confidence; written summaries are tight.",
                comment_mentoring="Active learner in code/protocol reviews.",
                comment_competency_skills="Foundational cell-therapy assay skill set is solid.",
            )
            _pr_mil(fiona, proj_macs_mil, evan_mfg, "Q4 FY25-26", "reviewed", pg="4",
                impact="Fiona authored the scale-up SOP set and led the validation runs.",
                comment_task_execution="Structured the SOP framework end-to-end with strong rigor.",
                comment_ownership="Took ownership beyond scope on the validation runs.",
                comment_project_management="Excellent timeline discipline; zero deviations on critical path.",
                comment_client_deliverables="SOPs accepted on first internal audit pass.",
                comment_communication="Clear shift hand-offs and proactive cross-team updates.",
                comment_mentoring="Supported Klaus on aseptic technique.",
                comment_competency_skills="Senior Scientist trajectory in production validation.",
            )
            _pr_mil(bob_lead, proj_macs_mil, evan_mfg, "Q4 FY25-26", "reviewed", pg="3",
                impact="Bob's R&D liaison support kept the platform tech-transfer on track.",
                comment_task_execution="Effective bridge between R&D and Mfg context-switching.",
                comment_ownership="Owned the tech-transfer package across teams.",
                comment_project_management="Reliable cadence for cross-functional updates.",
                comment_client_deliverables="Hand-off documentation was tight and audit-ready.",
                comment_communication="Translated R&D nuance for the Mfg team well.",
                comment_mentoring="N/A in this scope.",
                comment_competency_skills="Solid platform-knowledge bridge skills.",
            )
            db.commit()

            # Q1 FY26-27 (current) — pending evaluations across all four projects.
            _pr_mil(charlie, proj_cell_mil,       bob_lead, "Q1 FY26-27", "pending")
            _pr_mil(dana,    proj_cell_mil,       bob_lead, "Q1 FY26-27", "pending")
            _pr_mil(fiona,   proj_macs_mil,       evan_mfg, "Q1 FY26-27", "pending")
            _pr_mil(bob_lead, proj_macs_mil,      evan_mfg, "Q1 FY26-27", "pending")
            if proj_validation_mil:
                _pr_mil(charlie, proj_validation_mil, bob_lead, "Q1 FY26-27", "pending")
                _pr_mil(iris,    proj_validation_mil, bob_lead, "Q1 FY26-27", "pending")
                _pr_mil(dana,    proj_validation_mil, bob_lead, "Q1 FY26-27", "pending")
                _pr_mil(evan_mfg, proj_validation_mil, bob_lead, "Q1 FY26-27", "pending")
            if proj_launch_mil:
                _pr_mil(mia,    proj_launch_mil, lukas, "Q1 FY26-27", "pending")
                _pr_mil(nils,   proj_launch_mil, lukas, "Q1 FY26-27", "pending")
                _pr_mil(evan_mfg, proj_launch_mil, lukas, "Q1 FY26-27", "pending")
            db.commit()
            print("  [+] Ensured Miltenyi Project Reviews (Q4 FY25-26 completed, Q1 FY26-27 pending)")

        # ================================================================== #
        # 9. ANNUAL REVIEWS                                                   #
        # ================================================================== #

        def _ar(user, mentor, cycle, status, **fields):
            if not db.query(AnnualReview).filter_by(
                org_id=org.id, user_id=user.id, cycle_name=cycle,
            ).first():
                db.add(AnnualReview(
                    org_id=org.id, user_id=user.id,
                    mentor_id=mentor.id if mentor else None,
                    cycle_name=cycle, status=status, **fields,
                ))

        STRONG_SELF = (
            "Owned the full workstream end-to-end with clear accountability. "
            "Delivered client-ready artifacts with minimal rework, structured "
            "stakeholder updates, planned and mitigated risks proactively, "
            "coached juniors on methodology, and contributed to firm-level "
            "initiatives beyond day-to-day project work."
        )
        STRONG_MENTOR = (
            "Consistently takes charge without prompting. Full accountability "
            "across every workstream I observed — artifacts land in "
            "client-ready shape with minimal edits, team looks to them for "
            "guidance, and they contribute visibly to firm initiatives. "
            "Technical depth and trajectory are excellent."
        )
        SOLID_SELF = (
            "Completed assigned tasks reliably and flagged issues early. "
            "Quality of deliverables improved through the cycle. Managed my "
            "workstreams with guidance from my mentor, supported peers during "
            "tooling onboarding, and picked up new frameworks this cycle."
        )
        SOLID_MENTOR = (
            "Dependable on assigned work; initiative is growing. Artifact "
            "quality is improving cycle over cycle and communications are "
            "becoming more proactive. Planning independence is growing and "
            "early mentoring instincts are starting to show."
        )
        DIRECTOR_SELF = (
            "Led multiple workstreams and practice initiatives in parallel. "
            "Maintained full accountability across client engagements, coached "
            "the team on strategic thinking and delivery standards, and drove "
            "firm-level initiatives on business development and knowledge management."
        )
        DIRECTOR_MENTOR = (
            "Exceptional leadership across all dimensions. Drives outcomes for "
            "clients and the firm simultaneously, builds team capability "
            "proactively, and maintains very high standards on every deliverable. "
            "A clear role model for the practice."
        )

        if db.query(AnnualReview).filter(AnnualReview.org_id == org.id).count() == 0:
            # ── FY25-26 — all completed ───────────────────────────────────────
            # Mentees
            _ar(arjun, priya, "FY25-26", "completed",
                self_overall_review=STRONG_SELF, self_performance_rating=1,
                mentor_overall_review=STRONG_MENTOR, mentor_performance_rating=1,
                management_performance_rating=1, final_performance_rating=1,
                management_comments="Ready for Senior Consultant — recommend for promotion.",
                final_rating_enabled=True,
            )
            _ar(neha, priya, "FY25-26", "completed",
                self_overall_review=SOLID_SELF, self_performance_rating=2,
                mentor_overall_review=SOLID_MENTOR, mentor_performance_rating=2,
                management_performance_rating=2, final_performance_rating=2,
                management_comments="Tracking toward Senior Consultant.",
                final_rating_enabled=True,
            )
            _ar(rahul, david, "FY25-26", "completed",
                self_overall_review=STRONG_SELF, self_performance_rating=1,
                mentor_overall_review=STRONG_MENTOR, mentor_performance_rating=1,
                management_performance_rating=1, final_performance_rating=1,
                management_comments="Strong Senior Consultant track — recommend for promotion.",
                final_rating_enabled=True,
            )
            _ar(meera, david, "FY25-26", "completed",
                self_overall_review=SOLID_SELF, self_performance_rating=3,
                mentor_overall_review=SOLID_MENTOR, mentor_performance_rating=3,
                management_performance_rating=3, final_performance_rating=3,
                management_comments="Progressing steadily as a Consultant.",
                final_rating_enabled=True,
            )
            _ar(ananya, vikram, "FY25-26", "completed",
                self_overall_review=STRONG_SELF, self_performance_rating=1,
                mentor_overall_review=STRONG_MENTOR, mentor_performance_rating=1,
                management_performance_rating=1, final_performance_rating=1,
                management_comments="Recommend for Senior Consultant with Manager-track consideration.",
                final_rating_enabled=True,
            )
            _ar(karan, vikram, "FY25-26", "completed",
                self_overall_review=SOLID_SELF, self_performance_rating=3,
                mentor_overall_review=SOLID_MENTOR, mentor_performance_rating=3,
                management_performance_rating=3, final_performance_rating=3,
                management_comments="Solid Consultant progressing steadily in RWE.",
                final_rating_enabled=True,
            )
            # Mentors (report to Sarah)
            _ar(priya, admin_user, "FY25-26", "completed",
                self_overall_review=DIRECTOR_SELF, self_performance_rating=1,
                mentor_overall_review=DIRECTOR_MENTOR, mentor_performance_rating=1,
                management_performance_rating=1, final_performance_rating=1,
                management_comments="Exceptional strategic leadership. Strong candidate for Director track.",
                final_rating_enabled=True,
            )
            _ar(david, admin_user, "FY25-26", "completed",
                self_overall_review=DIRECTOR_SELF, self_performance_rating=1,
                mentor_overall_review=DIRECTOR_MENTOR, mentor_performance_rating=1,
                management_performance_rating=1, final_performance_rating=1,
                management_comments="Outstanding technology leadership. Practice growth contribution is exemplary.",
                final_rating_enabled=True,
            )
            _ar(vikram, admin_user, "FY25-26", "completed",
                self_overall_review=DIRECTOR_SELF, self_performance_rating=2,
                mentor_overall_review=DIRECTOR_MENTOR, mentor_performance_rating=2,
                management_performance_rating=2, final_performance_rating=2,
                management_comments="Strong RWE methodology leadership. Continue expanding cross-practice influence.",
                final_rating_enabled=True,
            )
            # New Admin users (mentees of Sarah)
            _ar(amol, admin_user, "FY25-26", "completed",
                self_overall_review=DIRECTOR_SELF, self_performance_rating=1,
                mentor_overall_review=DIRECTOR_MENTOR, mentor_performance_rating=1,
                management_performance_rating=1, final_performance_rating=1,
                management_comments="Exceptional marketing and business development contribution.",
                final_rating_enabled=True,
            )
            _ar(founder1, admin_user, "FY25-26", "completed",
                self_overall_review=DIRECTOR_SELF, self_performance_rating=1,
                mentor_overall_review=DIRECTOR_MENTOR, mentor_performance_rating=1,
                management_performance_rating=1, final_performance_rating=1,
                management_comments="Strong strategic vision and organizational leadership.",
                final_rating_enabled=True,
            )
            _ar(founder2, admin_user, "FY25-26", "completed",
                self_overall_review=DIRECTOR_SELF, self_performance_rating=1,
                mentor_overall_review=DIRECTOR_MENTOR, mentor_performance_rating=1,
                management_performance_rating=1, final_performance_rating=1,
                management_comments="Excellent operational leadership and cross-functional impact.",
                final_rating_enabled=True,
            )
            # Amol's mentees
            _ar(riya, amol, "FY25-26", "completed",
                self_overall_review=SOLID_SELF, self_performance_rating=2,
                mentor_overall_review=SOLID_MENTOR, mentor_performance_rating=2,
                management_performance_rating=2, final_performance_rating=2,
                management_comments="Good early contribution. Marketing analytics fundamentals are solid.",
                final_rating_enabled=True,
            )
            _ar(tej, amol, "FY25-26", "completed",
                self_overall_review=STRONG_SELF, self_performance_rating=1,
                mentor_overall_review=STRONG_MENTOR, mentor_performance_rating=1,
                management_performance_rating=1, final_performance_rating=1,
                management_comments="Strong analytics leadership. Senior Consultant track.",
                final_rating_enabled=True,
            )
            db.commit()

            # ── FY26-27 — current cycle, mixed states ─────────────────────────
            # Mentees
            _ar(arjun, priya, "FY26-27", "pending_management",
                self_overall_review=STRONG_SELF, self_performance_rating=1,
                mentor_overall_review=STRONG_MENTOR, mentor_performance_rating=2,
            )
            _ar(neha, priya, "FY26-27", "pending_mentor",
                self_overall_review=STRONG_SELF, self_performance_rating=2,
            )
            _ar(rahul, david, "FY26-27", "draft",
                self_overall_review="Owning platform architecture evolution with cross-team coordination.",
            )
            _ar(meera, david, "FY26-27", "pending_mentor",
                self_overall_review=SOLID_SELF, self_performance_rating=3,
            )
            _ar(ananya, vikram, "FY26-27", "pending_mentor",
                self_overall_review=STRONG_SELF, self_performance_rating=1,
            )
            # karan — no FY26-27 review yet (exercises "Start Self-Review" CTA)
            # Mentors
            _ar(priya, admin_user, "FY26-27", "pending_mentor",
                self_overall_review=DIRECTOR_SELF, self_performance_rating=1,
            )
            _ar(david, admin_user, "FY26-27", "pending_mentor",
                self_overall_review=DIRECTOR_SELF, self_performance_rating=1,
            )
            _ar(vikram, admin_user, "FY26-27", "draft",
                self_overall_review="Leading RWE practice expansion and multi-site study governance.",
            )
            # New Admins
            _ar(amol, admin_user, "FY26-27", "pending_mentor",
                self_overall_review=DIRECTOR_SELF, self_performance_rating=1,
            )
            _ar(founder1, admin_user, "FY26-27", "draft",
                self_overall_review="Driving strategic partnerships and organizational growth.",
            )
            _ar(founder2, admin_user, "FY26-27", "draft",
                self_overall_review="Leading operational excellence and innovation pipeline.",
            )
            # Amol's mentees
            _ar(riya, amol, "FY26-27", "pending_mentor",
                self_overall_review=SOLID_SELF, self_performance_rating=2,
            )
            _ar(tej, amol, "FY26-27", "pending_mentor",
                self_overall_review=STRONG_SELF, self_performance_rating=1,
            )
            db.commit()

            print("  [+] Created Annual Reviews: FY25-26 (all completed), FY26-27 (mixed states)")
        else:
            # For existing DBs — add missing reviews for new users only
            for _u, _m in [(priya, admin_user), (david, admin_user), (vikram, admin_user),
                           (amol, admin_user), (founder1, admin_user), (founder2, admin_user),
                           (riya, amol), (tej, amol)]:
                if _u and _m:
                    _ar(_u, _m, "FY25-26", "completed",
                        self_overall_review=DIRECTOR_SELF, self_performance_rating=1,
                        mentor_overall_review=DIRECTOR_MENTOR, mentor_performance_rating=1,
                        management_performance_rating=1, final_performance_rating=1,
                        management_comments="Strong performance across all dimensions.",
                        final_rating_enabled=True,
                    )
                    _ar(_u, _m, "FY26-27", "pending_mentor",
                        self_overall_review=DIRECTOR_SELF, self_performance_rating=1,
                    )
            db.commit()
            print("  [~] Healthark Annual Reviews already exist — ensured new users covered.")

        # ── Miltenyi Annual Reviews ───────────────────────────────────
        def _ar_mil(user, mentor, cycle, status, **fields):
            if not user:
                return
            if not db.query(AnnualReview).filter_by(
                org_id=miltenyi_org.id, user_id=user.id, cycle_name=cycle,
            ).first():
                db.add(AnnualReview(
                    org_id=miltenyi_org.id, user_id=user.id,
                    mentor_id=mentor.id if mentor else None,
                    cycle_name=cycle, status=status, **fields,
                ))

        MIL_PAIRS = [
            (hans, alice_admin),  (greta, alice_admin),  (lukas, alice_admin),
            (bob_lead, hans),     (evan_mfg, greta),
            (charlie, bob_lead),  (dana, bob_lead),      (iris, bob_lead),
            (fiona, evan_mfg),    (klaus, evan_mfg),
            (mia, lukas),         (nils, lukas),
        ]

        # FY25-26 — fully completed history for everyone (used for Profile + Mentee summary).
        for _u, _m in MIL_PAIRS:
            _ar_mil(_u, _m, "FY25-26", "completed",
                self_overall_review=SOLID_SELF, self_performance_rating=2,
                mentor_overall_review=SOLID_MENTOR, mentor_performance_rating=2,
                management_performance_rating=2, final_performance_rating=2,
                management_comments="Strong contribution to the platform. Continue building depth.",
                final_rating_enabled=True,
            )
        db.commit()

        # FY26-27 (current) — mixed states for demo.
        # Hans + Greta + Lukas (Alice's mentees) → pending_management.
        _ar_mil(hans, alice_admin, "FY26-27", "pending_management",
            self_overall_review=DIRECTOR_SELF, self_performance_rating=1,
            mentor_overall_review=DIRECTOR_MENTOR, mentor_performance_rating=1,
        )
        _ar_mil(greta, alice_admin, "FY26-27", "pending_management",
            self_overall_review=DIRECTOR_SELF, self_performance_rating=1,
            mentor_overall_review=DIRECTOR_MENTOR, mentor_performance_rating=1,
        )
        _ar_mil(lukas, alice_admin, "FY26-27", "pending_mentor",
            self_overall_review=STRONG_SELF, self_performance_rating=2,
        )
        # Bob + Evan (under Hans / Greta) → one pending_mentor, one draft.
        _ar_mil(bob_lead, hans, "FY26-27", "pending_mentor",
            self_overall_review=STRONG_SELF, self_performance_rating=1,
        )
        _ar_mil(evan_mfg, greta, "FY26-27", "draft",
            self_overall_review="Drafting the year-end self review — leading the MACS Quant scale-up program.",
        )
        # Bob's mentees — varied states.
        _ar_mil(charlie, bob_lead, "FY26-27", "pending_mentor",
            self_overall_review=STRONG_SELF, self_performance_rating=1,
        )
        _ar_mil(dana, bob_lead, "FY26-27", "pending_mentor",
            self_overall_review=SOLID_SELF, self_performance_rating=2,
        )
        _ar_mil(iris, bob_lead, "FY26-27", "draft",
            self_overall_review="Drafting — strong Q1 with the validation pipeline.",
        )
        # Evan's mentees.
        _ar_mil(fiona, evan_mfg, "FY26-27", "pending_mentor",
            self_overall_review=STRONG_SELF, self_performance_rating=1,
        )
        _ar_mil(klaus, evan_mfg, "FY26-27", "pending_mentor",
            self_overall_review=SOLID_SELF, self_performance_rating=2,
        )
        # Lukas's mentees.
        _ar_mil(mia, lukas, "FY26-27", "pending_mentor",
            self_overall_review=STRONG_SELF, self_performance_rating=1,
        )
        _ar_mil(nils, lukas, "FY26-27", "draft",
            self_overall_review="Building my first commercial cycle self review — supporting the EMEA launch.",
        )
        db.commit()
        print("  [+] Ensured Miltenyi Annual Reviews (FY25-26 completed, FY26-27 mixed states)")

        # ================================================================== #
        # 10. ANNUAL GOALS + PER-HALF SELF REVIEWS                            #
        # ================================================================== #

        SELF_REVIEW_DEFAULT = (
            "Delivered all key tasks against the goal with disciplined execution and "
            "consistent quality checks. Took end-to-end ownership with proactive status "
            "updates and risk flagging, producing client-ready outputs that required "
            "minimal iteration post-review. Tracked milestones and dependencies with a "
            "well-maintained plan and early risk escalation, and supported teammates "
            "informally on methodology and tooling. The work fed into reusable playbooks "
            "and noticeably strengthened applicable skills — measurable on the scope and "
            "complexity handled independently."
        )

        def _goal(user, manager, title, desc, approval, cycle_name, fy_year,
                  progress_notes=None, manager_feedback=None, self_reviewed_halves=()):
            if db.query(Goal).filter_by(
                org_id=org.id, user_id=user.id, title=title, cycle_name=cycle_name,
            ).first():
                return
            approved_at = (
                datetime(fy_year, 4, 20, tzinfo=timezone.utc) if approval == "approved" else None
            )
            g = Goal(
                org_id=org.id, user_id=user.id,
                manager_id=manager.id if manager else None,
                title=title, description=desc,
                goal_type="annual", cycle_name=cycle_name,
                approval_status=approval,
                progress_notes=progress_notes,
                manager_feedback=manager_feedback,
                approved_at=approved_at,
            )
            db.add(g)
            db.flush()
            for half in self_reviewed_halves:
                db.add(GoalSelfReview(
                    goal_id=g.id,
                    org_id=org.id,
                    cycle_half=half,
                    self_overall_review=SELF_REVIEW_DEFAULT,
                ))
            # Advance status to reflect the latest review milestone present.
            # H2 wins over H1; we only stamp self-review rows here, so the
            # furthest milestone is *_self_reviewed.
            if approval == "approved":
                if "H2" in self_reviewed_halves:
                    g.approval_status = "h2_self_reviewed"
                elif "H1" in self_reviewed_halves:
                    g.approval_status = "h1_self_reviewed"

        if db.query(Goal).filter(Goal.org_id == org.id).count() == 0:

            # ── Arjun ──────────────────────────────────────────────────────
            _goal(arjun, priya, "Specialty Therapy Access Framework",
                  "Build and socialize a reusable specialty-therapy access framework across 4 priority EU markets.",
                  approval="approved", cycle_name="H1 2025", fy_year=2025,
                  progress_notes="Framework built and reused on 2 subsequent engagements. Client feedback positive.",
                  self_reviewed_halves=("H1", "H2"))
            _goal(arjun, priya, "Healthcare Financial Modeling Capability",
                  "Complete a structured financial-modeling course and apply it to an active project.",
                  approval="approved", cycle_name="H1 2025", fy_year=2025,
                  progress_notes="Course done; bottom-up forecast model applied to PRJ-101.",
                  self_reviewed_halves=("H1",))
            _goal(arjun, priya, "PM-Level Ownership on Payer Evidence Portfolio",
                  "Step into a PM-equivalent role on PRJ-104 with full delivery and client accountability.",
                  approval="approved", cycle_name="H1 2026", fy_year=2026,
                  progress_notes="Running the tracker and client comms independently. On track.")
            _goal(arjun, priya, "Build Proposal Development Capability",
                  "Lead or co-lead at least one client proposal end-to-end in FY 2026.",
                  approval="draft", cycle_name="H1 2026", fy_year=2026)
            _goal(arjun, priya, "Senior-Level Storyboarding Mastery",
                  "Independently craft full client deck storyboards with compelling narratives and minimal review rounds.",
                  approval="pending_approval", cycle_name="H1 2026", fy_year=2026)

            # ── Neha ───────────────────────────────────────────────────────
            _goal(neha, priya, "Independently Lead a Research Module",
                  "Own and deliver a complete research module on a live project with minimal supervision.",
                  approval="approved", cycle_name="H1 2025", fy_year=2025,
                  progress_notes="Led competitive landscape module on PRJ-101. Delivered on time with positive feedback.",
                  self_reviewed_halves=("H1", "H2"))
            _goal(neha, priya, "Lead a Complete Client Workstream Independently",
                  "Own end-to-end delivery of a client workstream with minimal supervision in FY 2026.",
                  approval="approved", cycle_name="H1 2026", fy_year=2026,
                  progress_notes="Leading the competitor benchmarking workstream independently.",
                  self_reviewed_halves=("H1",))
            _goal(neha, priya, "Author Firm Thought Leadership Piece",
                  "Research, draft, and publish a firm-branded thought-leadership article on specialty access.",
                  approval="changes_requested", cycle_name="H1 2026", fy_year=2026,
                  manager_feedback="Scope is too broad — narrow to 1 therapy area and define a clearer success metric.")

            # ── Rahul ──────────────────────────────────────────────────────
            _goal(rahul, david, "Clinical Trial Data Mart Modernization (Tech Lead)",
                  "Lead the technical architecture and delivery of the trial data mart modernization.",
                  approval="approved", cycle_name="H1 2025", fy_year=2025,
                  progress_notes="Architecture approved by ARB. Delivered 2 weeks ahead of schedule.",
                  self_reviewed_halves=("H1", "H2"))
            _goal(rahul, david, "Mentor Meera on Data Engineering Fundamentals",
                  "Run bi-weekly coaching sessions with Meera to build her data engineering capability.",
                  approval="approved", cycle_name="H1 2025", fy_year=2025,
                  progress_notes="Ran 10 coaching sessions. Meera now independently owns an ETL module.",
                  self_reviewed_halves=("H1",))
            _goal(rahul, david, "Introduce Agile Delivery Framework to IDT",
                  "Design and roll out an Agile sprint framework that improves delivery predictability for the practice.",
                  approval="approved", cycle_name="H1 2026", fy_year=2026,
                  progress_notes="Sprint framework piloted. Team velocity up ~25%.")

            # ── Meera ──────────────────────────────────────────────────────
            _goal(meera, david, "First Independent Analytics Module",
                  "Own an analytics module end-to-end on an active project.",
                  approval="approved", cycle_name="H1 2025", fy_year=2025,
                  progress_notes="Completed the data cleansing and visualization module for PRJ-102 with minimal guidance.",
                  self_reviewed_halves=("H1",))
            _goal(meera, david, "End-to-End Feature Delivery on Trial Data Mart",
                  "Take full-cycle ownership of a feature from requirements to production deployment.",
                  approval="pending_approval", cycle_name="H1 2026", fy_year=2026)

            # ── Ananya ─────────────────────────────────────────────────────
            _goal(ananya, vikram, "Long-Term Safety Study Protocol Lead",
                  "Lead protocol design and documentation for the long-term safety RWE study.",
                  approval="approved", cycle_name="H1 2025", fy_year=2025,
                  progress_notes="Protocol designed and submitted. IRB approved. Study launched.",
                  self_reviewed_halves=("H1", "H2"))
            _goal(ananya, vikram, "Firm-Wide RWE Knowledge Session",
                  "Organize and present a firm-wide knowledge session on chronic-therapy RWE best practices.",
                  approval="approved", cycle_name="H1 2026", fy_year=2026,
                  progress_notes="Session scheduled. Deck 80% complete.")

            # ── Karan ──────────────────────────────────────────────────────
            _goal(karan, vikram, "Cardiovascular RWE Literature Review Capability",
                  "Conduct structured literature reviews and synthesize findings for the cardiology outcomes study.",
                  approval="approved", cycle_name="H1 2025", fy_year=2025,
                  progress_notes="Completed systematic review of 150+ papers. Summary integrated into protocol.",
                  self_reviewed_halves=("H1",))
            _goal(karan, vikram, "Statistical Analysis for Long-Term Safety Study",
                  "Own the complete statistical analysis for the long-term safety RWE study in FY 2026.",
                  approval="draft", cycle_name="H1 2026", fy_year=2026)
            _goal(karan, vikram, "Client Presentation Readiness",
                  "Present study design updates to the client sponsor at least twice in FY 2026.",
                  approval="pending_approval", cycle_name="H1 2026", fy_year=2026)

            # ── Priya (mentor, now also mentee of Sarah) ───────────────────
            _goal(priya, admin_user, "Healthcare Strategy Practice Growth",
                  "Grow the strategy practice headcount by 20% and increase billable utilization across the team.",
                  approval="approved", cycle_name="H1 2025", fy_year=2025,
                  progress_notes="Headcount target achieved. Utilization up 18% — near target.",
                  self_reviewed_halves=("H1", "H2"))
            _goal(priya, admin_user, "Cross-Practice Collaboration Framework",
                  "Design and roll out a collaboration framework linking Strategy, IDT, and RWE practices.",
                  approval="approved", cycle_name="H1 2026", fy_year=2026,
                  progress_notes="Framework drafted and piloted on PRJ-104. Rolling out firm-wide.")
            _goal(priya, admin_user, "Senior Manager Development Goals",
                  "Complete executive leadership program and apply learnings to team management.",
                  approval="draft", cycle_name="H1 2026", fy_year=2026)

            # ── David ──────────────────────────────────────────────────────
            _goal(david, admin_user, "IDT Platform Excellence Program",
                  "Establish coding standards, peer review processes, and delivery metrics for the IDT practice.",
                  approval="approved", cycle_name="H1 2025", fy_year=2025,
                  progress_notes="Standards published. Code review cadence established. Defect rate down 30%.",
                  self_reviewed_halves=("H1", "H2"))
            _goal(david, admin_user, "Technology Leadership Initiative",
                  "Publish two thought leadership pieces on data platform modernization and lead one external talk.",
                  approval="approved", cycle_name="H1 2026", fy_year=2026,
                  progress_notes="First article published. External talk confirmed for Q2 FY26-27.")
            _goal(david, admin_user, "IDT Talent Pipeline",
                  "Build a structured campus hiring and onboarding pipeline for IDT consultants.",
                  approval="pending_approval", cycle_name="H1 2026", fy_year=2026)

            # ── Vikram ─────────────────────────────────────────────────────
            _goal(vikram, admin_user, "RWE Center of Excellence",
                  "Establish a RWE center of excellence with standardized methodologies and reusable study templates.",
                  approval="approved", cycle_name="H1 2025", fy_year=2025,
                  progress_notes="CoE launched. 3 study templates published and reused across 2 engagements.",
                  self_reviewed_halves=("H1", "H2"))
            _goal(vikram, admin_user, "Regulatory Insights Program",
                  "Build a regulatory insights tracker and publish quarterly briefs for the RWE practice.",
                  approval="pending_approval", cycle_name="H1 2026", fy_year=2026)
            _goal(vikram, admin_user, "RWE Talent Development",
                  "Design and run a structured RWE capability building program for Consultants and Senior Consultants.",
                  approval="draft", cycle_name="H1 2026", fy_year=2026)

            # ── Amol ───────────────────────────────────────────────────────
            _goal(amol, admin_user, "Marketing Analytics Platform Launch",
                  "Build and launch the internal marketing analytics platform (PRJ-105) with full adoption.",
                  approval="approved", cycle_name="H1 2025", fy_year=2025,
                  progress_notes="Platform launched. 85% team adoption in first month.",
                  self_reviewed_halves=("H1", "H2"))
            _goal(amol, admin_user, "Go-To-Market Strategy for New Practice Areas",
                  "Develop and execute GTM strategy for two new service offerings in FY 2026.",
                  approval="approved", cycle_name="H1 2026", fy_year=2026,
                  progress_notes="GTM strategy for both offerings finalized. Pipeline conversations underway.",
                  self_reviewed_halves=("H1",))
            _goal(amol, admin_user, "Client Engagement Excellence Program",
                  "Implement a structured client feedback loop and NPS tracking across all active engagements.",
                  approval="draft", cycle_name="H1 2026", fy_year=2026)

            # ── Founder1 (Rohan) ───────────────────────────────────────────
            _goal(founder1, admin_user, "Strategic Partnerships Program",
                  "Establish three strategic partnerships with academic and industry organizations.",
                  approval="approved", cycle_name="H1 2025", fy_year=2025,
                  progress_notes="Two partnerships signed. Third in final negotiation.",
                  self_reviewed_halves=("H1", "H2"))
            _goal(founder1, admin_user, "Organizational Growth Initiative",
                  "Lead organizational design review and implement updated structure for scale.",
                  approval="approved", cycle_name="H1 2026", fy_year=2026,
                  progress_notes="Org design review completed. New structure rollout in progress.")
            _goal(founder1, admin_user, "Investor Relations Framework",
                  "Build a structured IR framework including quarterly updates and stakeholder reporting.",
                  approval="pending_approval", cycle_name="H1 2026", fy_year=2026)

            # ── Founder2 (Nisha) ───────────────────────────────────────────
            _goal(founder2, admin_user, "Operational Excellence Program",
                  "Implement process standardization across all operational functions to improve efficiency by 25%.",
                  approval="approved", cycle_name="H1 2025", fy_year=2025,
                  progress_notes="Process standardization complete. Efficiency improvement measured at 22%.",
                  self_reviewed_halves=("H1", "H2"))
            _goal(founder2, admin_user, "Innovation Pipeline 2026",
                  "Build and manage an innovation pipeline with at least 5 new service ideas evaluated per half.",
                  approval="pending_approval", cycle_name="H1 2026", fy_year=2026)
            _goal(founder2, admin_user, "Culture and Engagement Initiative",
                  "Design and launch a structured employee engagement and culture program.",
                  approval="draft", cycle_name="H1 2026", fy_year=2026)

            # ── Riya ───────────────────────────────────────────────────────
            _goal(riya, amol, "Marketing Research Fundamentals",
                  "Build core marketing research skills and apply them independently on PRJ-105.",
                  approval="approved", cycle_name="H1 2025", fy_year=2025,
                  progress_notes="Completed core research modules and contributed reporting automation on PRJ-105.",
                  self_reviewed_halves=("H1",))
            _goal(riya, amol, "Brand Analytics Dashboard",
                  "Own the brand performance analytics dashboard end-to-end.",
                  approval="pending_approval", cycle_name="H1 2026", fy_year=2026)
            _goal(riya, amol, "Client Acquisition Research",
                  "Conduct structured research on target client segments for business development.",
                  approval="draft", cycle_name="H1 2026", fy_year=2026)

            # ── Tej ────────────────────────────────────────────────────────
            _goal(tej, amol, "Digital Analytics Framework",
                  "Design and implement the digital analytics framework for the marketing platform.",
                  approval="approved", cycle_name="H1 2025", fy_year=2025,
                  progress_notes="Framework implemented. Dashboard KPIs adopted by leadership.",
                  self_reviewed_halves=("H1", "H2"))
            _goal(tej, amol, "Campaign Performance Reporting",
                  "Build automated campaign performance reporting with real-time dashboards.",
                  approval="approved", cycle_name="H1 2026", fy_year=2026,
                  progress_notes="Reporting pipeline live. Weekly automated reports running.")
            _goal(tej, amol, "Analytics Capability Building",
                  "Lead internal analytics upskilling sessions for the marketing team.",
                  approval="draft", cycle_name="H1 2026", fy_year=2026)

            db.commit()
            print("  [+] Created Healthark Annual Goals + H1/H2 Self Reviews (all users)")
        else:
            # Idempotent add for new users — _goal checks existence before inserting
            _goal(priya, admin_user, "Healthcare Strategy Practice Growth",
                  "Grow the strategy practice headcount by 20% and increase billable utilization.",
                  approval="approved", cycle_name="H1 2025", fy_year=2025,
                  progress_notes="Headcount target achieved.", self_reviewed_halves=("H1", "H2"))
            _goal(priya, admin_user, "Cross-Practice Collaboration Framework",
                  "Design and roll out a collaboration framework linking Strategy, IDT, and RWE practices.",
                  approval="approved", cycle_name="H1 2026", fy_year=2026)

            _goal(david, admin_user, "IDT Platform Excellence Program",
                  "Establish coding standards, peer review processes, and delivery metrics for the IDT practice.",
                  approval="approved", cycle_name="H1 2025", fy_year=2025,
                  progress_notes="Standards published.", self_reviewed_halves=("H1", "H2"))
            _goal(david, admin_user, "Technology Leadership Initiative",
                  "Publish thought leadership pieces and lead an external talk.",
                  approval="approved", cycle_name="H1 2026", fy_year=2026)

            _goal(vikram, admin_user, "RWE Center of Excellence",
                  "Establish a RWE center of excellence with standardized methodologies.",
                  approval="approved", cycle_name="H1 2025", fy_year=2025,
                  progress_notes="CoE launched.", self_reviewed_halves=("H1", "H2"))
            _goal(vikram, admin_user, "Regulatory Insights Program",
                  "Build a regulatory insights tracker and publish quarterly briefs.",
                  approval="pending_approval", cycle_name="H1 2026", fy_year=2026)

            _goal(amol, admin_user, "Marketing Analytics Platform Launch",
                  "Build and launch the internal marketing analytics platform.",
                  approval="approved", cycle_name="H1 2025", fy_year=2025,
                  progress_notes="Platform launched.", self_reviewed_halves=("H1", "H2"))
            _goal(amol, admin_user, "Go-To-Market Strategy for New Practice Areas",
                  "Develop and execute GTM strategy for two new service offerings.",
                  approval="approved", cycle_name="H1 2026", fy_year=2026)

            _goal(founder1, admin_user, "Strategic Partnerships Program",
                  "Establish three strategic partnerships with academic and industry organizations.",
                  approval="approved", cycle_name="H1 2025", fy_year=2025,
                  progress_notes="Two partnerships signed.", self_reviewed_halves=("H1", "H2"))
            _goal(founder1, admin_user, "Organizational Growth Initiative",
                  "Lead organizational design review and implement updated structure.",
                  approval="approved", cycle_name="H1 2026", fy_year=2026)

            _goal(founder2, admin_user, "Operational Excellence Program",
                  "Implement process standardization across all operational functions.",
                  approval="approved", cycle_name="H1 2025", fy_year=2025,
                  progress_notes="Process standardization complete.", self_reviewed_halves=("H1", "H2"))
            _goal(founder2, admin_user, "Innovation Pipeline 2026",
                  "Build and manage an innovation pipeline with new service ideas.",
                  approval="pending_approval", cycle_name="H1 2026", fy_year=2026)

            _goal(riya, amol, "Marketing Research Fundamentals",
                  "Build core marketing research skills and apply them independently.",
                  approval="approved", cycle_name="H1 2025", fy_year=2025,
                  progress_notes="Completed core research modules.", self_reviewed_halves=("H1",))
            _goal(riya, amol, "Brand Analytics Dashboard",
                  "Own the brand performance analytics dashboard end-to-end.",
                  approval="pending_approval", cycle_name="H1 2026", fy_year=2026)

            _goal(tej, amol, "Digital Analytics Framework",
                  "Design and implement the digital analytics framework.",
                  approval="approved", cycle_name="H1 2025", fy_year=2025,
                  progress_notes="Framework implemented.", self_reviewed_halves=("H1", "H2"))
            _goal(tej, amol, "Campaign Performance Reporting",
                  "Build automated campaign performance reporting.",
                  approval="approved", cycle_name="H1 2026", fy_year=2026)

            db.commit()
            print("  [~] Healthark Goals exist — ensured new users (Priya/David/Vikram/Amol/Founders/Riya/Tej) covered.")

        # Miltenyi annual goals
        if db.query(Goal).filter(Goal.org_id == miltenyi_org.id).count() == 0:

            def _mil_goal(user, manager, title, desc, approval, cycle_name, fy_year,
                          progress_notes=None, manager_feedback=None, self_reviewed_halves=()):
                if db.query(Goal).filter_by(
                    org_id=miltenyi_org.id, user_id=user.id, title=title, cycle_name=cycle_name,
                ).first():
                    return
                approved_at = (
                    datetime(fy_year, 4, 20, tzinfo=timezone.utc) if approval == "approved" else None
                )
                g = Goal(
                    org_id=miltenyi_org.id, user_id=user.id,
                    manager_id=manager.id if manager else None,
                    title=title, description=desc,
                    goal_type="annual", cycle_name=cycle_name,
                    approval_status=approval,
                    progress_notes=progress_notes,
                    manager_feedback=manager_feedback,
                    approved_at=approved_at,
                )
                db.add(g)
                db.flush()
                for half in self_reviewed_halves:
                    db.add(GoalSelfReview(
                        goal_id=g.id,
                        org_id=miltenyi_org.id,
                        cycle_half=half,
                        self_overall_review=SELF_REVIEW_DEFAULT,
                    ))
                # Advance to the furthest *_self_reviewed milestone present.
                # Miltenyi runs on the quarterly cadence (Q1..Q4) — pick the
                # latest Q in the seeded set.
                if approval == "approved" and self_reviewed_halves:
                    order = ("Q1", "Q2", "Q3", "Q4", "H1", "H2")
                    latest = max(self_reviewed_halves, key=order.index)
                    g.approval_status = f"{latest.lower()}_self_reviewed"

            _mil_goal(charlie, bob_lead, "CAR-T Workflow Automation Module",
                      "Own the automation of the upstream CAR-T processing workflow on the new instrument.",
                      approval="approved", cycle_name="H1 2025", fy_year=2025,
                      progress_notes="Module deployed. Cycle time reduced by ~30%.",
                      self_reviewed_halves=("Q1", "Q2", "Q3", "Q4"))
            _mil_goal(dana, bob_lead, "Assay Validation for Next-Gen CAR-T",
                      "Design and run validation assays for the next-gen CAR-T platform.",
                      approval="approved", cycle_name="H1 2026", fy_year=2026,
                      progress_notes="Validation assays underway; first read scheduled.")
            _mil_goal(fiona, evan_mfg, "MACS Quant Scale-Up Documentation",
                      "Author the scale-up documentation package for the new MACS Quant platform.",
                      approval="pending_approval", cycle_name="H1 2026", fy_year=2026)

            db.commit()
            print("  [+] Created Miltenyi Annual Goals + Self Reviews")
        else:
            print("  [~] Miltenyi base goals already exist, ensuring expanded set...")

        # Idempotent additions for the expanded Miltenyi goal set so new
        # staff have something on the Annual Goals tab. `_mil_goal`
        # checks per-row existence so re-runs are safe.
        if "_mil_goal" not in dir():
            # Define a local `_mil_goal` for the case where the outer
            # block didn't run (existing DBs that already had base goals).
            def _mil_goal(user, manager, title, desc, approval, cycle_name, fy_year,
                          progress_notes=None, manager_feedback=None, self_reviewed_halves=()):
                if not user or not manager:
                    return
                if db.query(Goal).filter_by(
                    org_id=miltenyi_org.id, user_id=user.id, title=title, cycle_name=cycle_name,
                ).first():
                    return
                approved_at = (
                    datetime(fy_year, 4, 20, tzinfo=timezone.utc) if approval == "approved" else None
                )
                g = Goal(
                    org_id=miltenyi_org.id, user_id=user.id,
                    manager_id=manager.id,
                    title=title, description=desc,
                    goal_type="annual", cycle_name=cycle_name,
                    approval_status=approval,
                    progress_notes=progress_notes,
                    manager_feedback=manager_feedback,
                    approved_at=approved_at,
                )
                db.add(g)
                db.flush()
                for half in self_reviewed_halves:
                    db.add(GoalSelfReview(
                        goal_id=g.id,
                        org_id=miltenyi_org.id,
                        cycle_half=half,
                        self_overall_review=(
                            "Delivered on the goal with consistent quality and proactive "
                            "stakeholder updates."
                        ),
                    ))
                if approval == "approved" and self_reviewed_halves:
                    order = ("Q1", "Q2", "Q3", "Q4", "H1", "H2")
                    latest = max(self_reviewed_halves, key=order.index)
                    g.approval_status = f"{latest.lower()}_self_reviewed"

        # FY26-27 expanded goal set across the new staff.
        _mil_goal(charlie, bob_lead, "Cell Therapy Validation Lead",
                  "Lead protocol design + execution for the FY26 validation runs.",
                  approval="approved", cycle_name="H1 2026", fy_year=2026,
                  progress_notes="Protocol locked; runs underway.",
                  self_reviewed_halves=("Q1",))
        _mil_goal(dana, bob_lead, "Assay Optimisation Pipeline",
                  "Optimise turnaround time for the validation assay pipeline.",
                  approval="pending_approval", cycle_name="H1 2026", fy_year=2026)
        _mil_goal(iris, bob_lead, "Next-Gen Reagent Workstream",
                  "Drive evaluation + qualification of the next-gen reagents for FY26.",
                  approval="approved", cycle_name="H1 2026", fy_year=2026,
                  progress_notes="Vendor screening complete; lab evaluation in progress.")
        _mil_goal(klaus, evan_mfg, "Aseptic Process Documentation",
                  "Author the next revision of the aseptic processing SOPs.",
                  approval="draft", cycle_name="H1 2026", fy_year=2026)
        _mil_goal(mia, lukas, "EMEA Launch Readiness",
                  "Own EMEA launch readiness for the new MACS Quant product line.",
                  approval="approved", cycle_name="H1 2026", fy_year=2026,
                  progress_notes="Customer outreach kicked off; collateral 80% done.",
                  self_reviewed_halves=("Q1",))
        _mil_goal(nils, lukas, "APAC Customer Discovery",
                  "Run discovery interviews with target accounts across APAC.",
                  approval="pending_approval", cycle_name="H1 2026", fy_year=2026)
        _mil_goal(bob_lead, hans, "R&D Capability Uplift",
                  "Lift the R&D team's automation tooling capability for FY26.",
                  approval="approved", cycle_name="H1 2026", fy_year=2026,
                  progress_notes="Two new tooling tracks set up; trainings underway.",
                  self_reviewed_halves=("Q1",))
        _mil_goal(evan_mfg, greta, "Mfg Throughput +20%",
                  "Drive a 20% throughput uplift across the MACS Quant line by year-end.",
                  approval="pending_approval", cycle_name="H1 2026", fy_year=2026)
        _mil_goal(lukas, alice_admin, "FY26 Commercial Strategy",
                  "Own + execute the FY26 commercial strategy across EMEA + APAC.",
                  approval="approved", cycle_name="H1 2026", fy_year=2026,
                  progress_notes="Strategy locked; quarterly tracking cadence in place.",
                  self_reviewed_halves=("Q1",))
        db.commit()
        print("  [+] Ensured Miltenyi expanded goal set for FY26-27")

        # ================================================================== #
        # 11. 360 FEEDBACK (anonymous peer review)                            #
        # ================================================================== #
        #
        # Seeds enough reviews on a few targets so the four tabs of the
        # 360 module render their major UI states out-of-the-box:
        #   - Priya:  4 worked-with + 3 not-worked-with  → both bars
        #   - David:  3 worked-with + 2 not-worked-with  → only worked-with
        #   - Arjun:  3 worked-with + 1 not-worked-with  → only worked-with
        #   - Sarah:           0    + 4 not-worked-with  → only not-worked-with
        # The threshold is 3 per cohort (see feedback_360_routes.py); below
        # that the cohort is hidden behind the "Need 3+ reviewers" placeholder.
        #
        # We compute the reviewer hash inline using the same HMAC algorithm
        # as feedback_360_service.reviewer_hash so the uniqueness check
        # holds. The plaintext reviewer_id is consumed and dropped — the
        # rows persisted carry only the opaque hash.

        import hmac as _hmac
        import hashlib as _hashlib
        from app.core.config import settings as _settings

        # Active FY for the seeded "H1 FY26-27" cycle.
        _F360_FY = 2026

        def _f360_hash(reviewer_id: int, target_id: int, fy_year: int) -> str:
            msg = f"{reviewer_id}|{target_id}|{fy_year}".encode("utf-8")
            secret = _settings.FEEDBACK_HASH_SECRET.encode("utf-8")
            return _hmac.new(secret, msg, _hashlib.sha256).hexdigest()

        def _f360_did_work(reviewer_id: int, target_id: int, scoped_org_id: int) -> bool:
            """Mirrors feedback_360_service.did_work_together — true iff
            both users have at least one shared project assignment in the
            same org."""
            r_proj = {
                pid for (pid,) in db.query(ProjectAssignment.project_id)
                .filter(ProjectAssignment.user_id == reviewer_id,
                        ProjectAssignment.org_id == scoped_org_id)
                .all()
            }
            if not r_proj:
                return False
            t_proj = {
                pid for (pid,) in db.query(ProjectAssignment.project_id)
                .filter(ProjectAssignment.user_id == target_id,
                        ProjectAssignment.org_id == scoped_org_id)
                .all()
            }
            return bool(r_proj & t_proj)

        def _f360(reviewer, target, ratings: dict[str, int]):
            """Upsert a 360 review. If a review with the same reviewer
            hash already exists (re-running seed.py against an existing
            DB), its answers are dropped and re-inserted from `ratings`
            so the seed remains the source of truth across runs."""
            if not reviewer or not target:
                return
            rev_hash = _f360_hash(reviewer.id, target.id, _F360_FY)
            existing = db.query(Feedback360Review).filter_by(
                target_user_id=target.id,
                fy_year=_F360_FY,
                reviewer_hash=rev_hash,
            ).first()
            if existing:
                # Refresh: nuke the answers, keep the row + creation
                # timestamp + worked_with snapshot so anonymity isn't
                # disturbed for any consumers downstream.
                db.query(Feedback360Answer).filter_by(
                    review_id=existing.id
                ).delete(synchronize_session=False)
                db.flush()
                review = existing
            else:
                review = Feedback360Review(
                    org_id=reviewer.org_id,
                    target_user_id=target.id,
                    fy_year=_F360_FY,
                    reviewer_hash=rev_hash,
                    worked_with=_f360_did_work(
                        reviewer.id, target.id, reviewer.org_id
                    ),
                )
                db.add(review)
                db.flush()
            for key, rating in ratings.items():
                db.add(Feedback360Answer(
                    review_id=review.id,
                    question_key=key,
                    rating=rating,
                ))

        # All 12 question keys, in registry order. Helper below maps a
        # 12-element list of ratings onto these keys so each reviewer's
        # full ballot is one line. Every reviewer rates every question
        # so each cohort hits the per-question count we'd see at scale
        # — without that, individual questions can sit below the 3-per-
        # cohort anonymity threshold and the dot stays hidden even
        # though the header shows a non-zero total review count.
        _F360_KEYS = [
            "collab_inclusive_env",
            "empathy_consideration",
            "empower_support_autonomy",
            "empower_recognition",
            "equity_fair_treatment",
            "growth_dev_feedback",
            "impact_outcomes",
            "values_integrity",
            "comm_clarity",
            "comm_alignment",
            "core_expertise",
            "domain_knowledge",
        ]

        def _all_q(values: list[int]) -> dict[str, int]:
            assert len(values) == len(_F360_KEYS), "Need 12 ratings."
            return dict(zip(_F360_KEYS, values))

        # ── Priya — full demo: 4 worked-with + 3 not-worked-with ──────
        # Worked-with: Priya's project peers on PRJ-101 / PRJ-104.
        _f360(arjun,  priya, _all_q([5, 4, 5, 5, 4, 4, 5, 5, 5, 4, 4, 5]))
        _f360(neha,   priya, _all_q([4, 5, 4, 4, 4, 5, 4, 5, 4, 4, 4, 4]))
        _f360(david,  priya, _all_q([5, 4, 4, 4, 5, 4, 5, 5, 5, 5, 4, 5]))
        _f360(rahul,  priya, _all_q([4, 4, 4, 4, 4, 4, 5, 5, 5, 4, 5, 4]))
        # Not-worked-with: no shared project with Priya.
        _f360(meera,  priya, _all_q([3, 4, 3, 3, 4, 3, 3, 4, 3, 3, 3, 4]))
        _f360(karan,  priya, _all_q([4, 4, 3, 4, 4, 4, 4, 4, 3, 3, 4, 5]))
        _f360(riya,   priya, _all_q([3, 4, 3, 4, 4, 3, 3, 4, 3, 4, 3, 4]))

        # ── David — worked-with visible, not-worked-with hidden ──────
        _f360(priya,  david, _all_q([4, 4, 4, 4, 4, 4, 5, 5, 4, 4, 5, 5]))
        _f360(rahul,  david, _all_q([5, 4, 5, 4, 4, 5, 5, 5, 4, 5, 5, 5]))
        _f360(meera,  david, _all_q([5, 5, 5, 5, 4, 5, 4, 5, 4, 4, 5, 5]))
        # Below threshold (only 2 not-worked-with reviewers):
        _f360(ananya, david, _all_q([4, 4, 3, 3, 4, 4, 4, 4, 4, 4, 4, 4]))
        _f360(karan,  david, _all_q([4, 3, 4, 3, 4, 4, 4, 4, 4, 3, 4, 4]))

        # ── Arjun — worked-with visible, not-worked-with hidden ──────
        _f360(priya,  arjun, _all_q([5, 4, 4, 5, 4, 5, 4, 4, 4, 4, 4, 4]))
        _f360(neha,   arjun, _all_q([5, 5, 4, 4, 5, 4, 4, 4, 4, 4, 4, 3]))
        _f360(david,  arjun, _all_q([4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4]))
        # Below threshold (only 1 not-worked-with reviewer):
        _f360(meera,  arjun, _all_q([4, 4, 3, 4, 4, 4, 3, 4, 4, 4, 4, 4]))

        # ── Sarah — only the not-worked-with cohort populates ────────
        # Sarah has no project_assignments, so every reviewer lands
        # in the not-worked-with bucket.
        _f360(priya,  admin_user, _all_q([5, 5, 5, 5, 5, 4, 5, 5, 4, 5, 5, 5]))
        _f360(david,  admin_user, _all_q([5, 4, 4, 5, 5, 4, 5, 5, 4, 4, 5, 5]))
        _f360(vikram, admin_user, _all_q([5, 5, 5, 4, 5, 5, 4, 5, 4, 5, 4, 5]))
        _f360(amol,   admin_user, _all_q([4, 5, 4, 5, 5, 4, 5, 5, 4, 4, 5, 4]))

        # ── Miltenyi 360 feedback ─────────────────────────────────────
        # Bob (full demo): 4 worked-with + 3 not-worked-with → both cohorts.
        _f360(charlie, bob_lead, _all_q([5, 4, 5, 5, 4, 4, 5, 5, 5, 4, 4, 5]))
        _f360(dana,    bob_lead, _all_q([4, 5, 4, 4, 4, 5, 4, 5, 4, 4, 4, 4]))
        _f360(iris,    bob_lead, _all_q([5, 4, 4, 4, 5, 4, 5, 5, 5, 5, 4, 5]))
        _f360(evan_mfg, bob_lead, _all_q([4, 4, 4, 4, 4, 4, 5, 5, 5, 4, 5, 4]))
        _f360(mia,     bob_lead, _all_q([3, 4, 3, 3, 4, 3, 3, 4, 3, 3, 3, 4]))
        _f360(nils,    bob_lead, _all_q([4, 4, 3, 4, 4, 4, 4, 4, 3, 3, 4, 5]))
        _f360(klaus,   bob_lead, _all_q([3, 4, 3, 4, 4, 3, 3, 4, 3, 4, 3, 4]))

        # Charlie (worked-with only): 3 worked-with + 1 not-worked-with.
        _f360(bob_lead, charlie, _all_q([4, 4, 4, 4, 4, 4, 5, 5, 4, 4, 5, 5]))
        _f360(dana,     charlie, _all_q([5, 4, 5, 4, 4, 5, 5, 5, 4, 5, 5, 5]))
        _f360(iris,     charlie, _all_q([5, 5, 5, 5, 4, 5, 4, 5, 4, 4, 5, 5]))
        _f360(klaus,    charlie, _all_q([4, 4, 3, 3, 4, 4, 4, 4, 4, 4, 4, 4]))

        # Alice (top admin, no projects → only not-worked-with cohort).
        _f360(hans,     alice_admin, _all_q([5, 5, 5, 5, 5, 4, 5, 5, 4, 5, 5, 5]))
        _f360(greta,    alice_admin, _all_q([5, 4, 4, 5, 5, 4, 5, 5, 4, 4, 5, 5]))
        _f360(lukas,    alice_admin, _all_q([5, 5, 5, 4, 5, 5, 4, 5, 4, 5, 4, 5]))
        _f360(bob_lead, alice_admin, _all_q([4, 5, 4, 5, 5, 4, 5, 5, 4, 4, 5, 4]))

        db.commit()
        print(
            "  [+] Seeded 360 feedback (full 12-question coverage per reviewer; "
            "Priya: both cohorts; David/Arjun: worked-with only; "
            "Sarah: not-worked-with only; "
            "Bob: both cohorts; Charlie: worked-with only; "
            "Alice: not-worked-with only)"
        )

        # ================================================================== #
        # DONE                                                                #
        # ================================================================== #

        print("\n" + "=" * 60)
        print("Database seeding completed successfully!")
        print("=" * 60)
        print("\n--- HEALTHARK Accounts (all passwords: password123) ---")
        print("  ADMIN:    admin@healthark.com     Sarah Admin      (Admin, no mentor — top of hierarchy)")
        print("  ADMIN:    amol@healthark.com      Amol Kulkarni    (Admin, mentor: Sarah, mentors Riya + Tej)")
        print("  ADMIN:    founder1@healthark.com  Rohan Desai      (Admin, mentor: Sarah)")
        print("  ADMIN:    founder2@healthark.com  Nisha Patel      (Admin, mentor: Sarah)")
        print("  STRATEGY: priya@healthark.com     Priya Sharma     (mentor: Sarah, mentors Arjun + Neha)")
        print("            arjun@healthark.com     Arjun Patel      (mentor: Priya)")
        print("            neha@healthark.com      Neha Gupta       (mentor: Priya)")
        print("  IDT:      david@healthark.com     David Miller     (mentor: Sarah, mentors Rahul + Meera)")
        print("            rahul@healthark.com     Rahul Verma      (mentor: David)")
        print("            meera@healthark.com     Meera Joshi      (mentor: David)")
        print("  RWE:      vikram@healthark.com    Vikram Singh     (mentor: Sarah, mentors Ananya + Karan)")
        print("            ananya@healthark.com    Ananya Reddy     (mentor: Vikram)")
        print("            karan@healthark.com     Karan Mehta      (mentor: Vikram)")
        print("  MARKETING:riya@healthark.com      Riya Kapoor      (mentor: Amol)")
        print("            tej@healthark.com       Tej Nair         (mentor: Amol)")
        print()
        print("--- 360 FEEDBACK seeded for Healthark (FY26-27) ---")
        print("  Priya:  4 worked-with + 3 not-worked-with reviews -> both cohorts visible")
        print("  David:  3 worked-with + 2 not-worked-with reviews -> only worked-with shown")
        print("  Arjun:  3 worked-with + 1 not-worked-with reviews -> only worked-with shown")
        print("  Sarah:           0   + 4 not-worked-with reviews -> only not-worked-with shown")
        print("  Log in as Sarah (admin) to view Priya/David's aggregates via Mentee Feedback.")
        print("  Log in as Amol/founder1/founder2 to view all via Org Feedback (Management).")
        print()
        print("--- MILTENYI Accounts (Quarterly Cycle | all passwords: password123) ---")
        print("  ADMIN:    admin@miltenyi.com      Alice Admin      (Admin, no mentor — top of hierarchy)")
        print("  ADMIN:    hans@miltenyi.com       Hans Mueller     (Admin, mentor: Alice, mentors Bob)")
        print("  ADMIN:    greta@miltenyi.com      Greta Schmidt    (Admin, mentor: Alice, mentors Evan)")
        print("  R&D:      bob@miltenyi.com        Bob Builder      (mentor: Hans, mentors Charlie + Dana + Iris)")
        print("            charlie@miltenyi.com    Charlie Chemist  (mentor: Bob)")
        print("            dana@miltenyi.com       Dana DNA         (mentor: Bob)")
        print("            iris@miltenyi.com       Iris Immel       (mentor: Bob)")
        print("  MFG:      evan@miltenyi.com       Evan Engineer    (mentor: Greta, mentors Fiona + Klaus)")
        print("            fiona@miltenyi.com      Fiona Factory    (mentor: Evan)")
        print("            klaus@miltenyi.com      Klaus Koehler    (mentor: Evan)")
        print("  COMM:     lukas@miltenyi.com      Lukas Lange      (mentor: Alice, mentors Mia + Nils)")
        print("            mia@miltenyi.com        Mia Markt        (mentor: Lukas)")
        print("            nils@miltenyi.com       Nils Niedermeier (mentor: Lukas)")
        print()
        print("--- 360 FEEDBACK seeded for Miltenyi (FY26-27) ---")
        print("  Bob:     4 worked-with + 3 not-worked-with reviews -> both cohorts visible")
        print("  Charlie: 3 worked-with + 1 not-worked-with review  -> only worked-with shown")
        print("  Alice:           0   + 4 not-worked-with reviews   -> only not-worked-with shown")
        print("  Log in as Hans/Greta to demo Org Feedback (Management).")
        print()

    except Exception as e:
        print(f"\n[ERROR] Seeding failed: {e}")
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    seed_database()
