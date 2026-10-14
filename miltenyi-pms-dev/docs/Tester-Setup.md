# Healthark-Miltenyi PMS — tester setup

You will run the app on your own machine, connected to the shared **testing database** (schema `miltenyi`). No real staff data is in it. Anything you change there is visible to anyone else testing at the same time.

## 1. Install

- Git
- Python 3.12
- Node.js 22.12 or newer (or 20.19 or newer)
- Access to the GitHub repository `Healthark/miltenyi-pms`

## 2. Get the code

```bash
git clone https://github.com/Healthark/miltenyi-pms.git
cd miltenyi-pms/miltenyi-pms-dev
```

## 3. Start the backend

In a terminal, from `miltenyi-pms-dev`:

```bash
cd backend
python -m venv .venv
```

Activate the environment. Windows (PowerShell): `.\.venv\Scripts\Activate.ps1`. macOS / Linux: `source .venv/bin/activate`. Then:

```bash
pip install -r requirements.txt
python gen-key.py
```

`gen-key.py` prints a random key. Create a file named `.env` in the `backend` folder with these four lines:

```
DATABASE_URL=<the connection string Zaahid sends you separately>
DB_SCHEMA=miltenyi
SECRET_KEY=<the key gen-key.py printed>
DIGEST_ENABLED=false
```

Leave out any `SMTP_` settings, so the app sends no email. Do **not** run `alembic` or any seed script: the database is already set up.

```bash
uvicorn main:app --reload
```

The backend listens on `http://localhost:8000`.

## 4. Start the frontend

In a second terminal, from `miltenyi-pms-dev`:

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173`.

## 5. Log in

Every account uses the password `password123`.

| Role | Login | Notes |
|---|---|---|
| Admin | aanya.sharma@healthark.ai | Users, System Settings, Framework, every goal and review |
| Mentor | rahul.verma@healthark.ai | Mentors Aarav, Diya and Kabir (Regulatory Affairs) |
| Mentor | neha.kapoor@healthark.ai | Mentors Ishaan, Saanvi and Ayaan (Pharmacovigilance) |
| Mentor | vikram.iyer@healthark.ai | Mentors Riya, Arjun and Myra (Clinical Trial Management) |
| Staff | aarav.patel@healthark.ai, diya.mehta@healthark.ai, kabir.singh@healthark.ai | Regulatory Affairs |
| Staff | ishaan.joshi@healthark.ai, saanvi.reddy@healthark.ai, ayaan.khan@healthark.ai | Pharmacovigilance |
| Staff | riya.nair@healthark.ai, arjun.gupta@healthark.ai, myra.desai@healthark.ai | Clinical Trial Management |

These are invented people; the addresses are logins only.

## 6. Starting point

- Goal year **CY 26-27**, quarter **Q3** current, so annual goals are in **H2**. Q1 and Q2 stay open for backfill.
- Every switch is open: goal entry, annual reviews, mentor reviews visible, management review.
- Nobody has goals or reviews yet, so every flow can be run from the start.

## 7. Good to know

- **Shared database.** The Admin's quarter roll-out (System Settings) moves the quarter for everyone testing. Tell Zaahid before rolling a quarter or a year forward.
- **No email.** "Forgot password" cannot deliver a link. If an account is locked out or its password changed, ask Zaahid.
- **New users** you add in Admin Panel → Users get a temporary password shown on screen (email is off) and must change it at first login.
- **What to test.** Start with `docs/UAT-Guide.md` (a walkthrough by role), then the test cases in `docs/QA-Test-Cases-01-Foundational.md` to `docs/QA-Test-Cases-07-ProjectGoals.md`.
- **Starting over.** Zaahid can clear all goals and reviews again with `backend/scripts/reset_testing_data.py`; accounts and settings are kept.
