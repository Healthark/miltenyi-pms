"""Miltenyi "CY 2026 Indicative Goal Themes" — seed content for goal_frameworks.

Generated from the seven documents Gautham shared on 2 Sep 2026 (one per
function; Pharmacovigilance has no document). Each function has four
rows, one per GCC career level; each row carries the role title as printed
in the document's first column, the two illustrative paragraphs, and the
KPIs with their weightages (every row totals 100).

Two KPI texts were truncated in the source and completed by hand; they are
marked with a comment. Regenerate with scratch/gen_goal_themes.py if the
documents change.
"""

# Goal years are labelled as spans (the year ends around April): "CY 26-27".
PERIOD_LABEL = "CY 26-27"

# function name -> level -> row
GOAL_THEMES: dict[str, dict[int, dict]] = {
    "Biostatistics": {
        1: {
            "title": "Statistical Programmer",
            "business_outcomes": "Deliver accurate, compliant, and analysis-ready datasets to support timely statistical analyses, regulatory submissions and high quality evidence generation",
            "functional_goals": "Ensure statistical programming activities in accordance to approved specifications, programming standards, study timelines, and quality requirements including analysis datasets preparation, TLF (Tables, Listings and Figures), programming validation, data quality checks, and complete programming documentation",
            "kpis": [
                ("Ensures accurate and timely statistical reporting", 30),
                ("Quality & validation of outputs : programming accuracy, no critical/recurrent QC findings attributed to programming", 30),
                ("Analysis datasets & TLF delivery generated accurately in accordance with approved specifications and study requirements", 20),
                ("Fulfilling compliance and documentation requirements to programming standards, specifications & QC", 10),
                ("Maintain complete, and accurate statistical programming documentation", 10),
            ],
        },
        2: {
            "title": "Biostatistician",
            "business_outcomes": "Provide statistical expertise to support study design, meaningful data collection and interpretation, and generation of high-quality evidence for study outcome and regulatory decision-making",
            "functional_goals": "Provide statistical leadership across assigned studies through protocol and CRF review, study design and endpoint input, development and review of statistical analysis plan and analysis specifications, interpretation of clinical study data, statistical reporting and contribution to clinical study reports and regulatory deliverable.",
            "kpis": [
                ("Timely and scientifically appropriate statistical input to protocol, endpoints, estimands, sample size considerations and CRF/data collection requirements", 25),
                ("Deliver high-quality statistical analysis and interpretation in accordance to study objectives and methodology", 30),
                ("Provide timely statistical support for study documents (SAP, SAR, specifications)", 20),
                ("Effective statistical contribution to CSR and regulatory queries", 15),
                ("Compliance with approved statistical methodology, standards, SOPs and regulatory requirements", 10),
            ],
        },
        3: {
            "title": "Senior BioStatistician",
            "business_outcomes": "Provide statistical leadership across studies and programs by providing guidance on study design, overseeing/developing statistical strategy and data interpretation for high high-quality, submission-ready statistical outputs.",
            "functional_goals": "Lead statistical activities across assigned studies/programs by providing strategic input to protocol and CRF development, overseeing statistical methodology and analysis plans, guiding interpretation of study results, ensuring high quality statistical deliverables, and coordinating statistical inputs to regulatory submissions, (including application of advanced methodologies for complex study designs and analysis).",
            "kpis": [
                ("Accountability for timely statistical inputs to protocol, endpoints, estimands, sample size and study design", 25),
                ("High-quality analyses and scientifically sound interpretation supporting decisions on study objectives and outcomes", 25),
                ("Provide statistical support for timely and high-quality statistical contributions and documents (SAR, CSR, etc.) for regulatory submissions", 25),
                ("Effective oversight of deliverables, timeliness, risk assessment and mitigation, and quality across studies", 15),
                ("Effective team mentoring management and resource allocation.", 10),
            ],
        },
        4: {
            "title": "Lead Biostatistician/Specialist",
            "business_outcomes": "Drive and implement biostatistics strategy, governance, and operational excellence and governance framework to enable high-quality scientific decisions across clinical development projects, regulatory success, and organizational objectives in line with global strategy",
            "functional_goals": "Drives functional excellence through statistical strategy and governance, oversight of study and program level statistical deliverables, strengthens data quality frameworks, capability development and collaboration with global team.",
            "kpis": [
                ("Define & lead the statistical strategy, standards, methodologies and governance across multiple clinical programs.", 30),
                ("Oversee & handle complex analysis and support in regulatory interactions.", 25),
                ("Ensures compliance to global regulatory submission strategies and achievement of agreed statistical milestones with high quality scientific and statistical deliverables.", 20),
                ("People leadership and capability development", 15),
                ("Accountable to manage budget assigned", 10),
            ],
        },
    },
    "Clinical Data Management": {
        1: {
            "title": "Clinical Data Management Associate",
            "business_outcomes": "Deliver accurate, complete, and timely clinical data through high quality data management activities while maintaining the compliance to processes, documentation needs and audit worthiness",
            "functional_goals": "Perform timely data review and query management, maintain high quality EDC data, support data base cleaning activities, ensure adherence to agreed SLAs/KPIs for data management activities, maintain TMF documentation as per required standards",
            "kpis": [
                ("Achieve high-quality data validation : ≥ 98% data review accuracy", 20),
                ("Query management - Timely and accurate resolution of queries. ≥ 95% queries resolved within agreed SLAs", 20),
                ("Database cleaning : major milestones achieved within timelines", 20),
                ("Compliance : No deviations to critical processes", 25),
                ("Quality : No major/critical findings in TMF audit for CDM documents", 15),
            ],
        },
        2: {
            "title": "Clinical Data Manager",
            "business_outcomes": "Deliver high-quality, submission ready clinical database(s) within agreed timelines through effective study-level planning, oversight and cross-functional collaboration.",
            "functional_goals": "Leads study-level clinical data management activities by overseeing database build, data cleaning, reconciliation, vendor coordination and database lock readiness while driving operational excellence through proactive study metrics review, risk based quality oversight, quality management and timely delivery of submission ready clinical datasets.",
            "kpis": [
                ("Complete database build activities as per study timelines", 20),
                ("Database validation – zero critical validation defects", 15),
                ("Timely resolution of queries, query aging maintained within threshold", 20),
                ("Timely Completion of Data Reconciliation Activities including SAE reconciliation", 15),
                ("Database locked within planned timelines", 15),
                ("TMF Document Management: No major/critical findings in TMF audit for CDM documents", 15),
            ],
        },
        3: {
            "title": "Senior Clinical Data Manager",
            "business_outcomes": "Leads and delivers end-to-end data management activities across assigned clinical studies to ensure timely study milestones, regulatory submission, high quality clinical data and compliance to clinical data management processes",
            "functional_goals": "Provide strategic oversight to the studies by overseeing operational excellence through implementing risk based data and metrics reviews, strengthening vendor oversight, facilitating cross functional collaboration, adequate resource planning, optimizing database lock readiness to consistently deliver high quality submission ready clinical datasets.",
            "kpis": [
                ("Data delivery : >90% database milestones (interim locks, final database lock, data transfer) achieved within agreed timelines", 25),
                ("Implement and monitor risk-based data review strategies with critical data risks identified, reviewed and mitigated without impacting study timelines", 25),
                ("Data quality : No recurring critical data issues or major quality findings", 15),
                ("Vendor management : >90% compliance to vendor SLAs, periodic performance review completed within timelines", 10),
                ("Database lock readiness within timelines for all studies and no delays attributed to data management activities", 15),
                ("CAPAs implemented within timelines", 10),
            ],
        },
        4: {
            "title": "Lead - Clinical Data Manager",
            "business_outcomes": "Provide strategic leadership for the Clinical Data Management function by establishing governance, standardization, innovation and operational excellence to enable high-quality, inspection-ready clinical data supporting global development programs",
            "functional_goals": "Drives clinical data management strategy, governs cross-study data oversight, and strengthens data quality frameworks. Establish enterprise-wide data governance Standardize global data management processes Lead operational excellence initiatives Drive digital transformation and automation Optimize vendor governance Build organizational capability Strengthen inspection readiness Optimize resource utilization and financial performance",
            "kpis": [
                (">95% compliance to global data standards across the portfolio/program/studies", 30),
                ("Achieve >90% performance against agreed operational KPIs including database timelines, data quality, inspection readiness and process compliance", 25),
                ("Vendor oversight : ≥90% vendor SLA achievement with quarterly performance reviews completed", 20),
                ("Effective people leadership and capability development. Team capability development plans completed with measurable improvement in competency and engagement", 15),
                ("Budget management : operate within approved budget while meeting agreed business objectives", 10),
            ],
        },
    },
    "Clinical Trial Finance": {
        1: {
            "title": "Clinical Finance Analyst",
            "business_outcomes": "Support effective financial management of clinical trials by ensuring accurate budget tracking, financial reporting, invoice processing, and compliance with organizational financial policies.",
            "functional_goals": "Deliver operational excellence through timely financial reconciliation, accurate invoice processing, reliable financial reporting, and adherence to financial controls and compliance requirements.",
            "kpis": [
                ("Timely and Accurate Budget Tracking & Financial Reporting", 30),
                ("Invoice Processing and Financial Reconciliation", 25),
                ("Financial Data Accuracy and Documentation", 20),
                ("Compliance with Financial Policies and Controls", 15),
                ("Operational Support and Stakeholder Coordination", 10),
            ],
        },
        2: {
            "title": "Senior Clinical Finance Analyst",
            "business_outcomes": "Manage study-level clinical trial finances by ensuring accurate budget planning, financial forecasting and reporting, cost control, and compliance to support successful study execution.",
            "functional_goals": "Drive operational excellence through effective budget management, financial forecasting, vendor payment oversight, reconciliation accuracy, and adherence to financial governance and audit requirements.",
            "kpis": [
                ("Study Budget Management and Financial Forecasting", 30),
                ("Financial Reconciliation and Vendor Invoice Management against SOW", 25),
                ("Financial Reporting and Data Accuracy", 20),
                ("Budget Compliance and Financial Governance", 15),
                ("Cross-functional Coordination and Operational Support", 10),
            ],
        },
        3: {
            "title": "Clinical Finance Manager",
            "business_outcomes": "Lead the financial management of clinical trial programs by ensuring effective budget planning, financial governance, cost optimization, and compliance to support successful study delivery and business objectives.",
            "functional_goals": "Drive operational excellence through accurate forecasting and reconciliations, effective vendor financial oversight including negotiations during SOW stage, robust financial governance including tracking spend against budgets and controlling variances, and optimal utilization of people and resources.",
            "kpis": [
                ("Clinical Trial Budget Planning and Financial Forecasting", 30),
                ("Financial Performance and Cost Variance Management", 25),
                ("Financial Governance, Compliance, and Audit Readiness", 20),
                ("Vendor Financial Oversight and Cross-functional Collaboration", 15),
                ("People Leadership and Resource Management", 10),
            ],
        },
        4: {
            "title": "Lead Clinical Finance Manager",
            "business_outcomes": "Provide strategic leadership for clinical trial financial operations by driving portfolio/program financial governance including budget management, maintaining global compliance requirements, and financial stewardship to support the organization's clinical development strategy.",
            "functional_goals": "Strengthen clinical finance through standardized financial governance, portfolio budget optimization, proactive financial risk management, regulatory compliance, and effective leadership of people, resources, and budgets.",
            "kpis": [
                ("Clinical Finance Strategy and Portfolio Budget Governance", 30),
                ("Portfolio Financial Performance and Resource Optimization", 25),
                ("Global Financial Compliance and Governance", 20),
                ("People Leadership and Capability Development", 15),
                ("Department Budget and Operational Excellence", 10),
            ],
        },
    },
    "Clinical Trial Management": {
        1: {
            "title": "Clinical Trial Associate",
            "business_outcomes": "Support efficient clinical trial execution by ensuring accurate trial documentation, efficient coordination and timely operational support while ensuring adherence to Good Clinical Practice (GCP), protocol requirements, and clinical trial processes/SOPs.",
            "functional_goals": "Maintain high-quality eTMF/TMF documentation; Maintain CTMS data integrity; Trial Coordination: Support timely start-up and maintenance activities; Contribute to audit and inspection readiness; Providing timely site support and coordination",
            "kpis": [
                ("≥98% TMF completeness", 30),
                ("≥98% data accuracy", 25),
                ("≥95% study deliverables completed on time", 20),
                ("No major/critical finding in TMF audit", 15),
                ("Site queries resolved within agreed timelines", 10),  # completed by hand; truncated in the source PDF
            ],
        },
        2: {
            "title": "Clinical Trial Manager",
            "business_outcomes": "Deliver assigned clinical trial(s) as per schedule, and in compliance with expected quality standards, while ensuring adherence to QMS and processes, GCP & regulatory requirements and proactively managing operational risks.",
            "functional_goals": "Drive operational excellence through effective trial planning & progress tracking, enrolment oversight, site management, vendor governance, proactive risk management, and continuous monitoring of study performance and compliance. Maintain financial oversight. Ensure audit readiness.",
            "kpis": [
                ("Study Milestones : ≥ 90% of milestones achieved within planned timelines", 20),
                ("Enrolment : actual versus planned rate within +/- 10%", 20),
                ("Risk Management and Study Monitoring Oversight", 20),
                ("Vendor performance : SLA achievement ≥ 90%", 10),
                ("Quality : No major/critical audit findings in audits", 20),
                ("Data quality : reduction is recurring protocol deviations, overdue queries, and data queries", 10),
            ],
        },
        3: {
            "title": "Senior Clinical Trial Manager",
            "business_outcomes": "Deliver successful delivery of regional or global clinical trial programs through effective governance, project/program oversight, cross functional leadership, and operational excellence, while ensuring high quality, GCP adherence, inspection readiness and predictable delivery",
            "functional_goals": "Ensure efficient clinical trial delivery through robust study governance, proactive risk assessment and management, adherence to QMS/SOPs/ processes, effective vendor oversight, optimal utilization of people and resources, performing operational reviews and sharing timely project status dashboards with leadership.",
            "kpis": [
                ("Global/Regional Clinical Trial Delivery and Program Execution : studies delivered within timelines", 30),
                ("Vendor Governance : vendor performance reviews within defined timeframes", 10),
                ("Risk-Based Study Oversight and Operational Excellence : reduction is recurring protocol deviations, overdue queries, and data queries through proactive oversight, risk assessment and timely risk mitigation", 30),
                ("Data quality : Zero major/critical findings in audits", 30),
            ],
        },
        4: {
            "title": "Lead - Clinical Trial Manager",
            "business_outcomes": "Provide strategic leadership for the clinical trial portfolio by establishing operational excellence, robust governance, resource & process optimization and organizational capability while ensuring achievement of program/project objectives.",
            "functional_goals": "Strengthen clinical trial operations through effective portfolio governance, standardized execution, organizational capability building, process harmonization, resource planning, stakeholder management and providing guidance on compliance and regulatory requirements",
            "kpis": [
                ("Clinical Trial Portfolio Strategy and Governance : % portfolio/program meeting major milestones", 20),
                ("Quality : Inspection and audit outcomes", 15),
                ("Financial performance : Budget adherence", 15),
                ("Resource utilization : planned versus actual utilization", 5),
                ("Continuous improvement : Lead or implement at least 2-3 process improvement or risk reduction initiatives annually that improve study efficiency, quality or cycle time", 15),
                ("Quality : ≥ 95% CAPA implemented withing agreed timelines with no/ not more than 10% incidence recurrence of critical issues", 15),
                ("Operational governance : Reviews completed within planned timelines, with timely escalation of risks & challenges, and closure of key operational risks (≥ 90%) within agreed timelines", 15),
            ],
        },
    },
    "Legal": {
        1: {
            "title": "Legal Associate",
            "business_outcomes": "Support the delivery of legal services by ensuring accurate contract documentation, effective legal support, and compliance with organizational policies and applicable regulatory requirements.",
            "functional_goals": "Deliver operational excellence through timely contract development/review support, accurate legal documentation, effective compliance tracking, and efficient coordination with internal/external stakeholders.",
            "kpis": [
                ("Timely and Accurate Contract Review Support", 30),
                ("Legal Documentation and Record Management", 25),
                ("Compliance with Legal and Regulatory Requirements", 20),
                ("Legal Research and Regulatory Support", 15),
                ("Stakeholder Coordination and Operational Support", 10),
            ],
        },
        2: {
            "title": "Legal Counsel",
            "business_outcomes": "Provide proactive legal advisory and contract management support to enable business objectives while ensuring legal compliance, effective risk management, and protection of organizational interests.",
            "functional_goals": "Drive operational excellence through timely legal advisory, effective contract development & negotiation, regulatory compliance, legal risk mitigation, and strong collaboration with business stakeholders.",
            "kpis": [
                ("Contract Review, discussions, and Management", 30),
                ("Legal Advisory and Risk Management", 25),
                ("Regulatory Compliance and Legal Governance", 20),
                ("Contract Compliance Monitoring and Documentation", 15),
                ("Cross-functional Collaboration and Business Partnership", 10),
            ],
        },
        3: {
            "title": "Senior Legal Counsel / Legal Manager",
            "business_outcomes": "Lead legal support across business operations by providing strategic legal guidance, managing legal risk, strengthening governance, and ensuring regulatory compliance to enable business objectives.",
            "functional_goals": "Drive operational excellence through effective contract governance, proactive legal risk management, regulatory compliance, dispute resolution, and efficient leadership of legal resources and cross-functional initiatives.",
            "kpis": [
                ("Legal Strategy, Advisory and Complex Contract Management", 30),
                ("Legal Risk Management and Dispute Resolution", 25),
                ("Legal Governance and Regulatory Compliance", 20),
                ("Cross-functional Legal Partnership and Business Support", 15),
                ("People Leadership and Resource Management", 10),
            ],
        },
        4: {
            "title": "Lead Legal Counsel",
            "business_outcomes": "Provide strategic legal leadership across the organization by driving enterprise legal strategy, corporate governance, regulatory compliance, and risk management to support sustainable business growth and protect organizational interests.",
            "functional_goals": "Strengthen legal operations through robust governance frameworks, proactive legal risk management, regulatory compliance, effective stakeholder engagement, and efficient leadership of people, resources, and budgets.",
            "kpis": [
                ("Enterprise Legal Strategy and Corporate Governance", 30),
                ("Legal Risk Management and Regulatory Compliance", 25),
                ("Strategic Legal Advisory and Executive Stakeholder Support", 20),
                ("People Leadership and Capability Development", 15),
                ("Budget Management and Operational Excellence", 10),
            ],
        },
    },
    "Medical Writing": {
        1: {
            "title": "Medical Writing Associate",
            "business_outcomes": "Support the development of high-quality scientifically accurate, regulatory compliant clinical and regulatory documents by ensuring adherence to global medical writing standards including document formatting, quality requirements, submission timelines and in compliance to established processes.",
            "functional_goals": "Deliver high-quality medical writing support through accurate document preparation, literature management, effective coordination with global cross-functional teams, version control, quality review to ensure efficient document delivery",
            "kpis": [
                ("Timely and Accurate Document Preparation : 95% documents delivered within agreed timelines", 30),
                ("Scientific Writing Accuracy and Literature Review : minimal scientific quality review comments and accurate referencing and interpretation", 25),
                ("Document Quality and Formatting Compliance with templates and document standards", 20),
                ("Regulatory and GCP Compliance : no critical audit findings", 15),
                ("Cross-functional Coordination and Operational Support: Positive stakeholder feedback and timely response to request", 10),
            ],
        },
        2: {
            "title": "Medical Writer",
            "business_outcomes": "Develop high-quality clinical and regulatory documents that support successful clinical development and regulatory submissions through scientific accuracy, regulatory compliance, timely delivery and effective stakeholder coordination.",
            "functional_goals": "Lead study level medical writing activities by planning, authoring, reviewing, coordinating, document development, accurate interpretation of scientific data, integrating cross functional inputs, managing timelines, and ensuring submission ready deliverables in compliance with applicable processes, quality and regulatory standards.",
            "kpis": [
                ("Timely Delivery of Clinical and Regulatory Documents : 95% documents delivered within agreed timelines", 30),
                ("Scientific Quality and Data Interpretation : minimal major review comments and accurate interpretation of scientific and clinical data", 25),
                ("Regulatory Writing Compliance and Submission Readiness", 20),
                ("Document Quality Management and Review : No major/critical audit findings attributable to medical writing function", 15),
                ("Cross-functional Collaboration and Operational Coordination: timely resolution of review comments and stakeholder satisfaction", 10),
            ],
        },
        3: {
            "title": "Senior Medical Writer",
            "business_outcomes": "Lead the medical writing activities across multiple clinical programs by providing scientific leadership, document stewardship and expertise to support development of high-quality clinical and regulatory documents and supporting successful global clinical development and regulatory submissions across programs.",
            "functional_goals": "Drive operational excellence by establishing robust document planning, program/project oversight, quality governance, workload prioritization, risk based document management and review, cross functional collaboration and submission readiness as well as team mentoring and capability development.",
            "kpis": [
                ("Development and Delivery of Complex Clinical & Regulatory Documents : ≥90-95% document milestones achieved across assigned projects", 30),
                ("Document quality & governance: Program/project(s) quality matrix maintained within agreed thresholds", 25),
                ("Regulatory Submission Support and Inspection Readiness : minimal regulatory review comments attributable to medical writing", 20),
                ("Cross-functional Leadership and Program Coordination : timely resolution with >90% action closure within agreed timelines", 15),
                ("People Leadership and Capability Development with measurable team development", 10),
            ],
        },
        4: {
            "title": "Lead - Medical Writer",
            "business_outcomes": "Provide strategic leadership for the medical writing function by driving implementation of organizational writing strategy, development of standardized processes, providing operational and strategic governance, scientific excellence, regulatory guidance, development of scalable delivery model that supports high-quality global clinical development documents and submissions",
            "functional_goals": "Drive medical writing excellence by strengthening global document governance, standardized medical writing processes, optimizing resource and capacity planning, inspection readiness, driving continuous process improvement & compliance adherence, fostering strategic global collaboration",
            "kpis": [
                ("Medical Writing Strategy and Document Governance : ≥90% achievement of agreed functional objectives and governance KPIs", 30),
                ("Operational excellence & delivery management : document delivery, quality, and productivity metrics consistently meet agreed targets across program/projects", 25),
                ("Regulatory Submission Readiness and Compliance : packages delivered on schedule with no critical quality observations attributable to medical writing", 20),
                ("People Leadership and Capability Development: measurable improvements in competency, engagement, and succession readiness", 15),
                ("Budget and Resource Management", 10),
            ],
        },
    },
    "Regulatory Affairs": {
        1: {
            "title": "Regulatory Affairs Associate",
            "business_outcomes": "Support timely and compliant regulatory submissions through high quality accurate documentation, dossier preparation while ensuring compliance to regulatory requirements.",
            "functional_goals": "Prepare, format, track and maintain regulatory submission documents accurately and within timelines. Ensure regulatory documents and submission records are organized and complete as per required regulatory requirements, and maintained within the specified regulatory document management system. Maintain effective coordination with global stakeholders to support submission readiness",
            "kpis": [
                ("Timely and Accurate Preparation of Regulatory Documentation", 30),
                ("Compliance with Regulatory Requirements and Documentation Standards with minimal QC findings", 25),
                ("100% compliance with Regulatory Guidelines and SOPs", 20),
                ("Accurate maintenance of submission records within the regulatory information management system", 15),
                ("Timely response to global team requests and positive stakeholder feedback", 10),
            ],
        },
        2: {
            "title": "Senior Regulatory Affairs Associate / Regulatory Affairs Specialist",
            "business_outcomes": "Deliver high-quality regulatory submissions within timelines and ensuring compliance submissions through effective submission planning, dossier compilation, documents review, submission tracking, regulatory intelligence, and effective coordination with global team members",
            "functional_goals": "Manage, assigned regulatory submission activities within timelines and compliant dossier submissions through effective planning, preparing, formatting, tracking and maintaining regulatory submission documents. Ensure regulatory documents and submission records are organized and complete as per required regulatory requirements, and maintained within the specified regulatory document management system. Maintain effective coordination with global stakeholders to support submission readiness",
            "kpis": [
                ("Timely and Accurate Regulatory Submission Management", 30),
                ("Compliance with Regulatory Requirements and Submission Standards with minimal QC findings", 25),
                ("100% compliance with Regulatory Guidelines and SOPs", 20),
                ("Accurate maintenance of submission records within the regulatory information management system", 15),
                ("Timely assessment and communication regarding relevant regulatory updates impacting the dossier activities", 10),
            ],
        },
        3: {
            "title": "Regulatory Affairs Manager",
            "business_outcomes": "Lead and execute global regulatory strategies that enable timely, high-quality regulatory submissions, ensure compliance with global regulatory requirements, and support successful product development and approvals across assigned programs.",
            "functional_goals": "Drive operational excellence by establishing robust submission planning and execution, regulatory governance, proactive risk management, effective health authority interactions, resource optimization and cross functional collaboration to ensure predictable regulatory delivery and inspection readiness.",
            "kpis": [
                ("Regulatory Strategy Development and Execution milestone achieved as per plans", 30),
                ("Timely Regulatory Submission Delivery", 25),
                ("No major compliance observations", 20),
                ("Proactive risk identification and mitigation to maintain delivery within agreed timelines", 15),
                ("Effective and optimal resource utilization", 10),
            ],
        },
        4: {
            "title": "Regulatory Affairs Lead",
            "business_outcomes": "Provide strategic regulatory leadership across the portfolio by establishing scalable capability and capacity, defining global regulatory strategies, ensuring regulatory compliance and governance that support global product development, regulatory compliance and market authorizations.",
            "functional_goals": "Drive regulatory excellence by establishing robust and effective global regulatory governance, standardizing submission management process, proactive regulatory risk management, participating/supporting in health authority engagement, optimized resource utilization, and continuous capability development.",
            "kpis": [
                ("Global Regulatory Strategy and Portfolio Leadership", 30),
                ("Delivery & operational excellence. Submission milestones achieved as per portfolio/program plans, measurable improvement in productivity and cycle time", 25),
                ("No critical findings in submission dossier quality and compliance requirements", 20),
                ("Health authority engagement and regulatory intelligence", 15),  # completed by hand; truncated in the source PDF
                ("Effective people leadership and capability development including budget management", 10),
            ],
        },
    },
}
