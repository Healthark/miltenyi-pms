"""
GCC career-path reference data for the Miltenyi PMS.

Single source of truth for:
  • LEVEL_LABEL              — Integer band (1..4) → human label
                               (Entry / Mid / Senior / Lead).
  • GCC_DESIGNATIONS         — One row per (function, career_level) bucket,
                               with the list of titles that share that
                               bucket. Some career levels host multiple
                               titles (e.g. Biostatistics L1 hosts both
                               "Statistical Programmer" and "Data Analyst")
                               — each title becomes its own Designation
                               row but they all point at the same
                               (function, career_level) RoleExpectation.
  • GCC_ROLE_EXPECTATIONS    — 32 rows (8 functions × 4 career levels)
                               of the GCC career-path text. Verbatim
                               transcription of the v1.1 GCC spreadsheet.

Consumed by:
  backend/seed.py
  backend/miltenyi-test-seed.py

If a field needs editing here it propagates to both seeds on next run.
"""

from __future__ import annotations


# ── Career-level integer → human label ────────────────────────────────
LEVEL_LABEL: dict[int, str] = {
    1: "Entry",
    2: "Mid",
    3: "Senior",
    4: "Lead",
}


# ── Functions × career_level × titles ─────────────────────────────────
#
# 8 GCC functions. Each (function, career_level) bucket holds 1+ titles.
# All titles at the same band share one RoleExpectation row (keyed on
# (function_id, career_level) after the gcc_framework_replacement
# migration).
#
# Format: (function_name, career_level, [titles...])
GCC_DESIGNATIONS: list[tuple[str, int, list[str]]] = [
    # Clinical Data Management
    ("Clinical Data Management", 1, ["Clinical Data Management Associate"]),
    ("Clinical Data Management", 2, ["Clinical Data Manager"]),
    ("Clinical Data Management", 3, ["Senior Clinical Data Manager"]),
    ("Clinical Data Management", 4, ["Lead - Clinical Data Manager"]),
    # Biostatistics
    ("Biostatistics", 1, ["Statistical Programmer", "Data Analyst"]),
    ("Biostatistics", 2, ["Biostatistician"]),
    ("Biostatistics", 3, ["Senior BioStatistician"]),
    ("Biostatistics", 4, ["Lead Biostatistician"]),
    # Regulatory Affairs
    ("Regulatory Affairs", 1, ["Regulatory Affairs Associate"]),
    ("Regulatory Affairs", 2, ["Senior Regulatory Affairs Associate",
                               "Regulatory Affairs Specialist"]),
    ("Regulatory Affairs", 3, ["Regulatory Affairs Manager"]),
    ("Regulatory Affairs", 4, ["Regulatory Affairs Lead"]),
    # Pharmacovigilance
    ("Pharmacovigilance", 1, ["Pharmacovigilance Associate"]),
    ("Pharmacovigilance", 2, ["Pharmacovigilance Analyst"]),
    ("Pharmacovigilance", 3, ["Senior Pharmacovigilance Analyst"]),
    ("Pharmacovigilance", 4, ["Pharmacovigilance Lead"]),
    # Clinical Trial Management
    ("Clinical Trial Management", 1, ["Clinical Trial Associate"]),
    ("Clinical Trial Management", 2, ["Clinical Trial Manager"]),
    ("Clinical Trial Management", 3, ["Senior Clinical Trial Manager"]),
    ("Clinical Trial Management", 4, ["Lead - Clinical Trial Manager"]),
    # Medical Writing
    ("Medical Writing", 1, ["Medical Writing Associate"]),
    ("Medical Writing", 2, ["Medical Writer"]),
    ("Medical Writing", 3, ["Senior Medical Writer"]),
    ("Medical Writing", 4, ["Lead Medical Writing"]),
    # Clinical Trial Finance
    ("Clinical Trial Finance", 1, ["Clinical Finance Analyst"]),
    ("Clinical Trial Finance", 2, ["Senior Clinical Finance Analyst"]),
    ("Clinical Trial Finance", 3, ["Clinical Finance Manager"]),
    ("Clinical Trial Finance", 4, ["Lead Clinical Finance Manager"]),
    # Legal
    ("Legal", 1, ["Legal Associate"]),
    ("Legal", 2, ["Legal Counsel"]),
    ("Legal", 3, ["Senior Legal Counsel", "Legal Manager"]),
    ("Legal", 4, ["Lead Legal Counsel"]),
]


# ── (function, career_level) → 6 GCC content columns ──────────────────
#
# 32 rows. Verbatim transcription of the v1.1 Miltenyi GCC career-path
# spreadsheet. Inserted into role_expectations such that every
# designation at a given (function, career_level) bucket points at the
# same row.
GCC_ROLE_EXPECTATIONS: dict[tuple[str, int], dict[str, str]] = {
    # ── Clinical Data Management ─────────────────────────────
    ("Clinical Data Management", 1): {
        "exp_scope_of_role": "Supports CRF review, data entry validation, and data cleaning activities",
        "exp_key_responsibilities": "Performs data review, query generation, discrepancy management, and study data tracking.",
        "exp_technical_competencies": "EDC systems (Medidata Rave/Oracle Clinical), data validation, query management, CDISC awareness.",
        "exp_delivery_ownership": "Task level",
        "exp_regulatory_compliance": "Query management, data validation checks.",
        "exp_project_resource_management": "Works under supervision",
    },
    ("Clinical Data Management", 2): {
        "exp_scope_of_role": "Manages study-level data review cycles and query resolution.",
        "exp_key_responsibilities": "Oversees data cleaning, database updates, reconciliation activities, and data quality checks.",
        "exp_technical_competencies": "Database build review, edit checks, reconciliation (SAE/lab/vendor data), CDISC standards.",
        "exp_delivery_ownership": "Study / functional deliverables",
        "exp_regulatory_compliance": "Database lock activities, SAE reconciliation.",
        "exp_project_resource_management": "Limited project coordination",
    },
    ("Clinical Data Management", 3): {
        "exp_scope_of_role": "Leads data management activities across clinical studies.",
        "exp_key_responsibilities": "Manages database lock readiness, vendor coordination, and cross-functional data governance.",
        "exp_technical_competencies": "Advanced CDISC implementation (SDTM/ADaM), vendor data integration, database governance.",
        "exp_delivery_ownership": "Study or program ownership",
        "exp_regulatory_compliance": "Vendor coordination, risk-based data review.",
        "exp_project_resource_management": "Team management and resource allocation",
    },
    ("Clinical Data Management", 4): {
        "exp_scope_of_role": "Provides strategic oversight of clinical data management across programs",
        "exp_key_responsibilities": "Defines CDM strategy, oversees multi-study data governance, and drives data quality frameworks",
        "exp_technical_competencies": "Enterprise data standards, global CDISC compliance, data architecture strategy.",
        "exp_delivery_ownership": "Portfolio or organizational oversight",
        "exp_regulatory_compliance": "Data strategy, inspection readiness, CDISC governance.",
        "exp_project_resource_management": "Department leadership and budget accountability",
    },
    # ── Biostatistics ─────────────────────────────────────────
    ("Biostatistics", 1): {
        "exp_scope_of_role": "Supports statistical programming and clinical data analysis activities.",
        "exp_key_responsibilities": "Assists in generating datasets, statistical outputs, and data summaries for clinical studies",
        "exp_technical_competencies": "SAS/R programming, clinical data standards awareness, data validation, statistical reporting.",
        "exp_delivery_ownership": "Task Level",
        "exp_regulatory_compliance": "Compliance with CDISC standards and statistical documentation requirements.",
        "exp_project_resource_management": "Works under supervision",
    },
    ("Biostatistics", 2): {
        "exp_scope_of_role": "Performs statistical analysis and supports study design and data interpretation.",
        "exp_key_responsibilities": "Develops statistical analysis plans, performs data analysis, and interprets clinical study data",
        "exp_technical_competencies": "Statistical modeling, SAS/R programming, clinical trial design, CDISC standards (SDTM/ADaM).",
        "exp_delivery_ownership": "Task level/functional deliverables",
        "exp_regulatory_compliance": "Statistical analysis compliance for regulatory submissions.",
        "exp_project_resource_management": "Limited project coordination",
    },
    ("Biostatistics", 3): {
        "exp_scope_of_role": "Leads statistical analysis for clinical studies and ensures methodological accuracy.",
        "exp_key_responsibilities": "Oversees statistical analysis plans, reviews outputs, and supports regulatory submissions.",
        "exp_technical_competencies": "Advanced biostatistics methods, trial design strategy, regulatory submission support.",
        "exp_delivery_ownership": "Study or program ownership/functional deliverables",
        "exp_regulatory_compliance": "Health authority statistical review readiness and regulatory compliance",
        "exp_project_resource_management": "Team management and resource allocation",
    },
    ("Biostatistics", 4): {
        "exp_scope_of_role": "Provides strategic statistical leadership across clinical programs.",
        "exp_key_responsibilities": "Defines statistical strategy, oversees complex analyses, and supports regulatory interactions.",
        "exp_technical_competencies": "Advanced statistical methodologies, regulatory strategy alignment, portfolio-level analytics.",
        "exp_delivery_ownership": "Portfolio or organizational oversight",
        "exp_regulatory_compliance": "Global regulatory submission strategy and statistical governance.",
        "exp_project_resource_management": "Department leadership and budget accountability",
    },
    # ── Regulatory Affairs ────────────────────────────────────
    ("Regulatory Affairs", 1): {
        "exp_scope_of_role": "Supports regulatory documentation and submission preparation activities.",
        "exp_key_responsibilities": "Assists in preparation, formatting, and tracking of regulatory submission documents and correspondence.",
        "exp_technical_competencies": "Regulatory guidelines awareness, document management systems, submission formatting, regulatory research.",
        "exp_delivery_ownership": "Task level",
        "exp_regulatory_compliance": "Basic awareness of regulatory frameworks (ICH, GCP)",
        "exp_project_resource_management": "Works under supervision",
    },
    ("Regulatory Affairs", 2): {
        "exp_scope_of_role": "Manages regulatory submission preparation and supports regulatory strategy execution.",
        "exp_key_responsibilities": "Prepares regulatory submissions, tracks approval timelines, and coordinates with cross-functional teams.",
        "exp_technical_competencies": "Regulatory submission preparation, regulatory intelligence, dossier management, submission systems (eCTD).",
        "exp_delivery_ownership": "Study / functional deliverables",
        "exp_regulatory_compliance": "Submission compliance monitoring and regulatory documentation management.",
        "exp_project_resource_management": "Limited project coordination",
    },
    ("Regulatory Affairs", 3): {
        "exp_scope_of_role": "Leads regulatory submission activities and ensures compliance with global regulatory requirements.",
        "exp_key_responsibilities": "Oversees regulatory submissions, manages health authority interactions, and drives regulatory strategy implementation.",
        "exp_technical_competencies": "Regulatory strategy development, submission management, regulatory intelligence, risk assessment",
        "exp_delivery_ownership": "Study or program ownership",
        "exp_regulatory_compliance": "Regulatory authority interactions and submission governance.",
        "exp_project_resource_management": "Team management and resource allocation",
    },
    ("Regulatory Affairs", 4): {
        "exp_scope_of_role": "Provides strategic regulatory oversight across programs and ensures global regulatory compliance.",
        "exp_key_responsibilities": "Defines regulatory strategy, oversees global submissions, and manages regulatory risk and governance.",
        "exp_technical_competencies": "Global regulatory strategy, health authority negotiation, regulatory policy interpretation, governance frameworks.",
        "exp_delivery_ownership": "Portfolio or organizational oversight",
        "exp_regulatory_compliance": "Global regulatory compliance leadership and health authority engagement.",
        "exp_project_resource_management": "Department leadership and budget accountability",
    },
    # ── Pharmacovigilance ─────────────────────────────────────
    ("Pharmacovigilance", 1): {
        "exp_scope_of_role": "Performs individual case safety report (ICSR) processing under supervision.",
        "exp_key_responsibilities": "• Review source documents to identify AEs/SAEs. • Enter safety data into PV database (Argus/ArisG) as per CDSCO/DCGI timelines. • Draft medically sound case narratives. • Code adverse events using MedDRA. • Track follow-up requests to ensure case completeness.",
        "exp_technical_competencies": "MedDRA coding, safety database systems (Argus/ArisG), ICSR processing basics.",
        "exp_delivery_ownership": "Task level",
        "exp_regulatory_compliance": "ICSR data entry, MedDRA coding, narrative writing, follow-up tracking.",
        "exp_project_resource_management": "Works under supervision",
    },
    ("Pharmacovigilance", 2): {
        "exp_scope_of_role": "Independently manages case processing, literature review, and supports signal detection activities.",
        "exp_key_responsibilities": "• Independently process and QC AE/SAE cases. • Perform database reconciliation and ensure timely reporting. • Monitor safety signal trends and escalate potential risks. • Contribute to aggregate reports (PSUR/PBRER). • Support audit and inspection documentation readiness.",
        "exp_technical_competencies": "Advanced case processing, safety database management, signal monitoring basics.",
        "exp_delivery_ownership": "Study / functional deliverables",
        "exp_regulatory_compliance": "Quality review of cases, reconciliation activities, aggregate report inputs (PSUR/PBRER/DSUR).",
        "exp_project_resource_management": "Limited project coordination",
    },
    ("Pharmacovigilance", 3): {
        "exp_scope_of_role": "Leads PV case teams, oversees aggregate reporting and signal management processes.",
        "exp_key_responsibilities": "• Lead signal detection and benefit-risk evaluations. • Oversee SAE reporting compliance and quality metrics. • Manage vendor oversight and workload distribution. • Interface with Regulatory and Medical teams for safety strategy.",
        "exp_technical_competencies": "Advanced GVP knowledge, signal detection methods, safety data analysis.",
        "exp_delivery_ownership": "Study or program ownership",
        "exp_regulatory_compliance": "Signal detection review, health authority response coordination, vendor oversight.",
        "exp_project_resource_management": "Team management and resource allocation",
    },
    ("Pharmacovigilance", 4): {
        "exp_scope_of_role": "Drives PV strategy, inspection readiness, global safety governance.",
        "exp_key_responsibilities": "• Define pharmacovigilance governance framework. • Lead regulatory authority inspections (CDSCO/FDA/EMA). • Drive risk management strategy and signal governance. • Ensure enterprise-level compliance and PV system optimization.",
        "exp_technical_competencies": "Global pharmacovigilance strategy, safety governance frameworks, regulatory risk management.",
        "exp_delivery_ownership": "Portfolio or organizational oversight",
        "exp_regulatory_compliance": "Risk management strategy, global audit readiness, HA inspections (FDA/EMA/MHRA).",
        "exp_project_resource_management": "Department leadership and budget accountability",
    },
    # ── Clinical Trial Management ─────────────────────────────
    ("Clinical Trial Management", 1): {
        "exp_scope_of_role": "Supports clinical trial operations and documentation activities.",
        "exp_key_responsibilities": "Assists in site documentation review, trial tracking, and coordination of study activities.",
        "exp_technical_competencies": "GCP awareness, clinical trial documentation, CTMS usage, site communication.",
        "exp_delivery_ownership": "Task level",
        "exp_regulatory_compliance": "Protocol compliance and trial documentation standards.",
        "exp_project_resource_management": "Works under supervision supporting study coordination, tracker updates, and operational task execution.",
    },
    ("Clinical Trial Management", 2): {
        "exp_scope_of_role": "Manages operational execution of clinical trials across sites.",
        "exp_key_responsibilities": "Oversees site performance, trial timelines, vendor coordination, and monitoring activities.",
        "exp_technical_competencies": "Clinical trial management, CTMS tools, site management, risk mitigation.",
        "exp_delivery_ownership": "Study / functional deliverables",
        "exp_regulatory_compliance": "Monitoring compliance and audit readiness support.",
        "exp_project_resource_management": "Limited project coordination including site performance tracking, vendor coordination, and milestone monitoring.",
    },
    ("Clinical Trial Management", 3): {
        "exp_scope_of_role": "Leads global or regional clinical trial operations and delivery.",
        "exp_key_responsibilities": "Manages cross-functional coordination, study timelines, vendor oversight, and quality compliance.",
        "exp_technical_competencies": "Global trial management, risk-based monitoring, vendor governance.",
        "exp_delivery_ownership": "Study or program ownership",
        "exp_regulatory_compliance": "Health authority inspection readiness and regulatory compliance.",
        "exp_project_resource_management": "Team management and resource allocation across study-level clinical trial activities and operational deliverables.",
    },
    ("Clinical Trial Management", 4): {
        "exp_scope_of_role": "Provides strategic oversight for clinical trial programs across the portfolio.",
        "exp_key_responsibilities": "Defines trial execution strategy, oversees multiple studies, and drives operational excellence.",
        "exp_technical_competencies": "Clinical development strategy, portfolio trial governance, operational leadership.",
        "exp_delivery_ownership": "Portfolio or organizational oversight",
        "exp_regulatory_compliance": "Global clinical trial compliance and regulatory governance.",
        "exp_project_resource_management": "Team management and resource allocation across study-level clinical trial activities and operational deliverables.",
    },
    # ── Medical Writing ───────────────────────────────────────
    ("Medical Writing", 1): {
        "exp_scope_of_role": "Supports preparation and formatting of clinical and regulatory documents under supervision while ensuring adherence to scientific accuracy and regulatory guidelines.",
        "exp_key_responsibilities": "Assists in drafting, editing, formatting, and quality checking of clinical and regulatory documents while coordinating with cross-functional teams.",
        "exp_technical_competencies": "Scientific writing fundamentals, literature review, clinical study document structure, referencing tools, and basic regulatory writing guidelines.",
        "exp_delivery_ownership": "Basic awareness of ICH GCP / regulatory frameworks",
        "exp_regulatory_compliance": "Document formatting, literature citation compliance, basic regulatory document review.",
        "exp_project_resource_management": "Works under supervision",
    },
    ("Medical Writing", 2): {
        "exp_scope_of_role": "Independently develops clinical and regulatory documents by interpreting scientific data and collaborating with cross-functional teams.",
        "exp_key_responsibilities": "Drafts and manages clinical and regulatory documents such as protocols, CSRs, and study reports while ensuring consistency and adherence to timelines.",
        "exp_technical_competencies": "Regulatory writing expertise, data interpretation, clinical document development, referencing systems, and document management systems.",
        "exp_delivery_ownership": "Working knowledge of regulatory submission requirements",
        "exp_regulatory_compliance": "Submission document preparation, regulatory writing compliance, document QC for submission readiness.",
        "exp_project_resource_management": "Limited project coordination",
    },
    ("Medical Writing", 3): {
        "exp_scope_of_role": "Leads development of complex clinical and regulatory documents while ensuring quality, regulatory compliance, and strategic alignment with clinical programs.",
        "exp_key_responsibilities": "Oversees preparation of complex regulatory documents, reviews deliverables, mentors junior writers, and ensures consistency across clinical programs.",
        "exp_technical_competencies": "Advanced regulatory writing strategy, complex document development, clinical data interpretation, publication planning, and quality review expertise.",
        "exp_delivery_ownership": "Regulatory inspection readiness",
        "exp_regulatory_compliance": "Regulatory submission documentation oversight, health authority response coordination, and audit readiness support.",
        "exp_project_resource_management": "Team management and resource allocation",
    },
    ("Medical Writing", 4): {
        "exp_scope_of_role": "Provides strategic oversight of medical writing activities across programs, ensuring consistency, regulatory compliance, and alignment with global clinical development objectives.",
        "exp_key_responsibilities": "Defines medical writing strategy, oversees global document development, ensures regulatory submission readiness, and drives writing standards and governance.",
        "exp_technical_competencies": "Global regulatory writing strategy, document governance frameworks, enterprise writing standards, submission strategy alignment, and digital authoring tools.",
        "exp_delivery_ownership": "Global regulatory and compliance oversight",
        "exp_regulatory_compliance": "Global regulatory submission strategy, health authority interactions, and enterprise compliance oversight.",
        "exp_project_resource_management": "Department leadership and budget accountability",
    },
    # ── Clinical Trial Finance ────────────────────────────────
    ("Clinical Trial Finance", 1): {
        "exp_scope_of_role": "Supports financial tracking and reporting for clinical trials, including budget monitoring, invoice processing, and financial data reconciliation under supervision.",
        "exp_key_responsibilities": "Assists in study budget tracking, invoice processing, financial reconciliation, and preparation of financial reports for clinical trials.",
        "exp_technical_competencies": "Clinical trial budgeting basics, financial data analysis, Excel-based financial tracking, invoice reconciliation, and financial reporting fundamentals.",
        "exp_delivery_ownership": "Task level",
        "exp_regulatory_compliance": "Financial documentation accuracy, invoice verification, and compliance with internal financial policies.",
        "exp_project_resource_management": "Works under supervision",
    },
    ("Clinical Trial Finance", 2): {
        "exp_scope_of_role": "Independently manages study-level financial tracking, budget reconciliation, and financial reporting while coordinating with clinical operations and vendors.",
        "exp_key_responsibilities": "Monitors study budgets, reviews vendor invoices, manages financial reconciliation, and prepares financial reports aligned with study timelines.",
        "exp_technical_competencies": "Clinical trial budget management, financial forecasting, cost tracking tools, financial reconciliation, and financial analytics",
        "exp_delivery_ownership": "Study / functional deliverables",
        "exp_regulatory_compliance": "Budget compliance monitoring, audit documentation support, and financial reporting accuracy.",
        "exp_project_resource_management": "Limited project coordination",
    },
    ("Clinical Trial Finance", 3): {
        "exp_scope_of_role": "Leads financial management of clinical trials including budget planning, forecasting, financial risk monitoring, and oversight of study financial performance.",
        "exp_key_responsibilities": "Oversees clinical trial budget planning, financial forecasting, cost variance analysis, and vendor financial performance monitoring.",
        "exp_technical_competencies": "Advanced clinical finance strategy, budget forecasting, financial risk assessment, contract and vendor financial oversight.",
        "exp_delivery_ownership": "Study or program ownership",
        "exp_regulatory_compliance": "Financial governance, regulatory financial audit readiness, and compliance with clinical trial financial regulations.",
        "exp_project_resource_management": "Team management and resource allocation",
    },
    ("Clinical Trial Finance", 4): {
        "exp_scope_of_role": "Provides strategic oversight of clinical trial financial operations across programs, ensuring budget governance, financial compliance, and alignment with global clinical development strategy.",
        "exp_key_responsibilities": "Defines financial governance frameworks, oversees portfolio-level budgets, manages financial risk strategies, and aligns clinical finance with global R&D strategy.",
        "exp_technical_competencies": "Enterprise financial strategy, portfolio budget governance, financial analytics frameworks, and global financial compliance.",
        "exp_delivery_ownership": "Portfolio or organizational oversight",
        "exp_regulatory_compliance": "Global financial compliance oversight, audit leadership, and enterprise clinical finance governance.",
        "exp_project_resource_management": "Department leadership and budget accountability",
    },
    # ── Legal ────────────────────────────────────────────────
    ("Legal", 1): {
        "exp_scope_of_role": "Supports legal documentation review and contract management activities.",
        "exp_key_responsibilities": "Assists in contract review, legal documentation preparation, and compliance tracking.",
        "exp_technical_competencies": "Contract review basics, legal research, regulatory awareness, document management.",
        "exp_delivery_ownership": "Task level",
        "exp_regulatory_compliance": "Legal documentation compliance and regulatory policy awareness.",
        "exp_project_resource_management": "Works under supervision/Limited project coordination",
    },
    ("Legal", 2): {
        "exp_scope_of_role": "Provides legal advisory and contract management support across business functions.",
        "exp_key_responsibilities": "Reviews commercial contracts, provides legal advice, and ensures regulatory compliance.",
        "exp_technical_competencies": "Contract negotiation, legal risk analysis, regulatory interpretation, compliance frameworks.",
        "exp_delivery_ownership": "Functional deliverables",
        "exp_regulatory_compliance": "Contract compliance monitoring and regulatory advisory support.",
        "exp_project_resource_management": "Limited project coordination",
    },
    ("Legal", 3): {
        "exp_scope_of_role": "Leads legal support for business operations and manages legal risk across projects.",
        "exp_key_responsibilities": "Oversees complex contracts, manages legal disputes, and ensures governance compliance.",
        "exp_technical_competencies": "Legal strategy development, risk management, regulatory interpretation, dispute management.",
        "exp_delivery_ownership": "Study or program ownership/functional deliverables",
        "exp_regulatory_compliance": "Legal governance oversight and regulatory compliance management.",
        "exp_project_resource_management": "Team management and resource allocation",
    },
    ("Legal", 4): {
        "exp_scope_of_role": "Provides strategic legal oversight and governance across organizational operations.",
        "exp_key_responsibilities": "Defines legal strategy, manages corporate governance, and leads regulatory risk management.",
        "exp_technical_competencies": "Enterprise legal strategy, corporate governance, regulatory compliance frameworks.",
        "exp_delivery_ownership": "Portfolio or organizational oversight",
        "exp_regulatory_compliance": "Global regulatory compliance leadership and legal governance.",
        "exp_project_resource_management": "Department leadership and budget accountability",
    },
}
