/* Sample data for the Project Goals wireframes.
   Framework rows are transcribed from the CY 2026 "Indicative Goal Themes"
   PDFs (Biostatistics, Clinical Trial Management, Regulatory Affairs: all four
   levels each). Pharmacovigilance has no document, so it has designations but no
   rows. People, trials, goals and comments are fictional sample text. */
window.WF = (function () {
  const PERIOD = "CY 2026";
  const BAND = { 1: "Entry", 2: "Mid", 3: "Senior", 4: "Lead" };

  /* Per function: GCC designations per level (as seeded) and the framework
     rows (one per level = one row of the PDF, whose first column is headed
     "Function"). */
  const FUNCTIONS = {
    Biostatistics: {
      designations: { 1: ["Statistical Programmer", "Data Analyst"], 2: ["Biostatistician"], 3: ["Senior BioStatistician"], 4: ["Lead Biostatistician"] },
      rows: {
        1: { title: "Statistical Programmer",
          outcomes: "Deliver accurate, compliant, and analysis-ready datasets to support timely statistical analyses, regulatory submissions and high quality evidence generation.",
          functional: "Ensure statistical programming activities in accordance to approved specifications, programming standards, study timelines, and quality requirements including analysis datasets preparation, TLF (Tables, Listings and Figures), programming validation, data quality checks, and complete programming documentation.",
          kpis: [
            { text: "Ensures accurate and timely statistical reporting", weight: 30 },
            { text: "Quality & validation of outputs: programming accuracy, no critical/recurrent QC findings attributed to programming", weight: 30 },
            { text: "Analysis datasets & TLF delivery generated accurately in accordance with approved specifications and study requirements", weight: 20 },
            { text: "Fulfilling compliance and documentation requirements to programming standards, specifications & QC", weight: 10 },
            { text: "Maintain complete and accurate statistical programming documentation", weight: 10 },
          ] },
        2: { title: "Biostatistician",
          outcomes: "Provide statistical expertise to support study design, meaningful data collection and interpretation, and generation of high-quality evidence for study outcome and regulatory decision-making.",
          functional: "Provide statistical leadership across assigned studies through protocol and CRF review, study design and endpoint input, development and review of statistical analysis plan and analysis specifications, interpretation of clinical study data, statistical reporting and contribution to clinical study reports and regulatory deliverables.",
          kpis: [
            { text: "Timely and scientifically appropriate statistical input to protocol, endpoints, estimands, sample size considerations and CRF/data collection requirements", weight: 25 },
            { text: "Deliver high-quality statistical analysis and interpretation in accordance to study objectives and methodology", weight: 30 },
            { text: "Provide timely statistical support for study documents (SAP, SAR, specifications)", weight: 20 },
            { text: "Effective statistical contribution to CSR and regulatory queries", weight: 15 },
            { text: "Compliance with approved statistical methodology, standards, SOPs and regulatory requirements", weight: 10 },
          ] },
        3: { title: "Senior BioStatistician",
          outcomes: "Provide statistical leadership across studies and programs by providing guidance on study design, overseeing/developing statistical strategy and data interpretation for high-quality, submission-ready statistical outputs.",
          functional: "Lead statistical activities across assigned studies/programs by providing strategic input to protocol and CRF development, overseeing statistical methodology and analysis plans, guiding interpretation of study results, ensuring high quality statistical deliverables, and coordinating statistical inputs to regulatory submissions (including application of advanced methodologies for complex study designs and analysis).",
          kpis: [
            { text: "Accountability for timely statistical inputs to protocol, endpoints, estimands, sample size and study design", weight: 25 },
            { text: "High-quality analyses and scientifically sound interpretation supporting decisions on study objectives and outcomes", weight: 25 },
            { text: "Provide statistical support for timely and high-quality statistical contributions and documents (SAR, CSR, etc.) for regulatory submissions", weight: 25 },
            { text: "Effective oversight of deliverables, timeliness, risk assessment and mitigation, and quality across studies", weight: 15 },
            { text: "Effective team mentoring, management and resource allocation", weight: 10 },
          ] },
        4: { title: "Lead Biostatistician/Specialist",
          outcomes: "Drive and implement biostatistics strategy, governance, and operational excellence framework to enable high-quality scientific decisions across clinical development projects, regulatory success, and organizational objectives in line with global strategy.",
          functional: "Drives functional excellence through statistical strategy and governance, oversight of study and program level statistical deliverables, strengthens data quality frameworks, capability development and collaboration with global team.",
          kpis: [
            { text: "Define & lead the statistical strategy, standards, methodologies and governance across multiple clinical programs", weight: 30 },
            { text: "Oversee & handle complex analysis and support in regulatory interactions", weight: 25 },
            { text: "Ensures compliance to global regulatory submission strategies and achievement of agreed statistical milestones with high quality scientific and statistical deliverables", weight: 20 },
            { text: "People leadership and capability development", weight: 15 },
            { text: "Accountable to manage budget assigned", weight: 10 },
          ] },
      },
    },
    "Clinical Trial Management": {
      designations: { 1: ["Clinical Trial Associate"], 2: ["Clinical Trial Manager"], 3: ["Senior Clinical Trial Manager"], 4: ["Lead - Clinical Trial Manager"] },
      rows: {
        1: { title: "Clinical Trial Associate",
          outcomes: "Support efficient clinical trial execution by ensuring accurate trial documentation, efficient coordination and timely operational support while ensuring adherence to Good Clinical Practice (GCP), protocol requirements, and clinical trial processes/SOPs.",
          functional: "Maintain high-quality eTMF/TMF documentation; maintain CTMS data integrity; support timely start-up and maintenance activities; contribute to audit and inspection readiness; provide timely site support and coordination.",
          kpis: [
            { text: "≥98% TMF completeness", weight: 30 },
            { text: "≥98% data accuracy", weight: 25 },
            { text: "≥95% study deliverables completed on time", weight: 20 },
            { text: "No major/critical finding in TMF audit", weight: 15 },
            { text: "Site queries resolved within agreed timelines", weight: 10 },
          ] },
        2: { title: "Clinical Trial Manager",
          outcomes: "Deliver assigned clinical trial(s) as per schedule, and in compliance with expected quality standards, while ensuring adherence to QMS and processes, GCP & regulatory requirements and proactively managing operational risks.",
          functional: "Drive operational excellence through effective trial planning & progress tracking, enrolment oversight, site management, vendor governance, proactive risk management, and continuous monitoring of study performance and compliance. Maintain financial oversight. Ensure audit readiness.",
          kpis: [
            { text: "Study milestones: ≥90% of milestones achieved within planned timelines", weight: 20 },
            { text: "Enrolment: actual versus planned rate within +/- 10%", weight: 20 },
            { text: "Risk management and study monitoring oversight", weight: 20 },
            { text: "Vendor performance: SLA achievement ≥90%", weight: 10 },
            { text: "Quality: no major/critical audit findings", weight: 20 },
            { text: "Data quality: reduction in recurring protocol deviations, overdue queries and data queries", weight: 10 },
          ] },
        3: { title: "Senior Clinical Trial Manager",
          outcomes: "Deliver successful regional or global clinical trial programs through effective governance, project/program oversight, cross-functional leadership and operational excellence, while ensuring high quality, GCP adherence, inspection readiness and predictable delivery.",
          functional: "Ensure efficient clinical trial delivery through robust study governance, proactive risk assessment and management, adherence to QMS/SOPs/processes, effective vendor oversight, optimal utilisation of people and resources, operational reviews and timely project status dashboards for stakeholders.",
          kpis: [
            { text: "Global/Regional Clinical Trial Delivery and Program Execution: studies delivered within timelines", weight: 30 },
            { text: "Vendor Governance: vendor performance reviews within defined timeframes", weight: 10 },
            { text: "Risk-Based Study Oversight and Operational Excellence: reduction in recurring protocol deviations, overdue queries and data queries through proactive oversight", weight: 30 },
            { text: "Data quality: zero major/critical findings in audits", weight: 30 },
          ] },
        4: { title: "Lead - Clinical Trial Manager",
          outcomes: "Provide strategic leadership for the clinical trial portfolio by establishing operational excellence, robust governance, resource and process optimisation and organisational capability while ensuring achievement of program/project objectives.",
          functional: "Strengthen clinical trial operations through effective portfolio governance, standardised execution, organisational capability building, process harmonisation, resource planning, stakeholder management and guidance on compliance and regulatory requirements.",
          kpis: [
            { text: "Clinical Trial Portfolio Strategy and Governance: % of portfolio/program meeting major milestones", weight: 20 },
            { text: "Quality: inspection and audit outcomes", weight: 15 },
            { text: "Financial performance: budget adherence", weight: 15 },
            { text: "Resource utilisation: planned versus actual utilisation", weight: 5 },
            { text: "Continuous improvement: lead or implement at least 2-3 process-improvement or risk-reduction initiatives annually that improve study efficiency, quality or cycle time", weight: 15 },
            { text: "Quality: ≥95% CAPA implemented within agreed timelines with no more than 10% recurrence of critical issues", weight: 15 },
            { text: "Operational governance: reviews completed within planned timelines, with timely escalation of risks and challenges, and closure of key operational risks (≥90%)", weight: 15 },
          ] },
      },
    },
    "Regulatory Affairs": {
      designations: { 1: ["Regulatory Affairs Associate"], 2: ["Senior Regulatory Affairs Associate", "Regulatory Affairs Specialist"], 3: ["Regulatory Affairs Manager"], 4: ["Regulatory Affairs Lead"] },
      rows: {
        1: { title: "Regulatory Affairs Associate",
          outcomes: "Support timely and compliant regulatory submissions through high quality accurate documentation and dossier preparation while ensuring compliance to regulatory requirements.",
          functional: "Prepare, format, track and maintain regulatory submission documents accurately and within timelines. Ensure regulatory documents and submission records are organised and complete as per regulatory requirements, and maintained within the specified regulatory document management system.",
          kpis: [
            { text: "Timely and accurate preparation of regulatory documentation", weight: 30 },
            { text: "Compliance with regulatory requirements and documentation standards with minimal QC findings", weight: 25 },
            { text: "100% compliance with regulatory guidelines and SOPs", weight: 20 },
            { text: "Accurate maintenance of submission records within the regulatory information management system", weight: 15 },
            { text: "Timely response to global team requests and positive stakeholder feedback", weight: 10 },
          ] },
        2: { title: "Senior Regulatory Affairs Associate / Regulatory Affairs Specialist",
          outcomes: "Deliver high-quality regulatory submissions within timelines and ensure compliant submissions through effective submission planning, dossier compilation, document review, submission tracking, regulatory intelligence and effective coordination with global team members.",
          functional: "Manage assigned regulatory submission activities within timelines and compliant dossier submissions through effective planning, preparing, formatting, tracking and maintaining regulatory submission documents. Ensure regulatory documents and submission records are organised and complete as required.",
          kpis: [
            { text: "Timely and accurate regulatory submission management", weight: 30 },
            { text: "Compliance with regulatory requirements and submission standards with minimal QC findings", weight: 25 },
            { text: "100% compliance with regulatory guidelines and SOPs", weight: 20 },
            { text: "Accurate maintenance of submission records within the regulatory information management system", weight: 15 },
            { text: "Timely assessment and communication regarding relevant regulatory updates impacting the dossier activities", weight: 10 },
          ] },
        3: { title: "Regulatory Affairs Manager",
          outcomes: "Lead and execute global regulatory strategies that enable timely, high-quality regulatory submissions, ensure compliance with global regulatory requirements, and support successful product development and approvals across assigned programs.",
          functional: "Drive operational excellence by establishing robust submission planning and execution, regulatory governance, proactive risk management, effective health authority interactions, resource optimisation and cross-functional collaboration to ensure predictable regulatory delivery and inspection readiness.",
          kpis: [
            { text: "Regulatory strategy development and execution milestones achieved as per plans", weight: 30 },
            { text: "Timely regulatory submission delivery", weight: 25 },
            { text: "No major compliance observations", weight: 20 },
            { text: "Proactive risk identification and mitigation to maintain delivery within agreed timelines", weight: 15 },
            { text: "Effective and optimal resource utilisation", weight: 10 },
          ] },
        4: { title: "Regulatory Affairs Lead",
          outcomes: "Provide strategic regulatory leadership across the portfolio by establishing scalable capability and capacity, defining global regulatory strategies, ensuring regulatory compliance and governance that support global product development, regulatory compliance and market authorisations.",
          functional: "Drive regulatory excellence by establishing robust and effective global regulatory governance, standardising submission management processes, proactive regulatory risk management, participating in health authority engagement, optimised resource utilisation, and continuous capability development.",
          kpis: [
            { text: "Global regulatory strategy and portfolio leadership", weight: 30 },
            { text: "Delivery & operational excellence: submission milestones achieved as per portfolio/program plans, measurable improvement in productivity and cycle time", weight: 25 },
            { text: "No critical findings in submission dossier quality and compliance requirements", weight: 20 },
            { text: "Health authority engagement and regulatory intelligence", weight: 15 },
            { text: "Effective people leadership and capability development including budget management", weight: 10 },
          ] },
      },
    },
    Pharmacovigilance: {
      designations: { 1: ["Pharmacovigilance Associate"], 2: ["Pharmacovigilance Analyst"], 3: ["Senior Pharmacovigilance Analyst"], 4: ["Pharmacovigilance Lead"] },
      rows: {},
      note: "No CY 2026 goal-themes document was shared for Pharmacovigilance.",
    },
  };

  /* Flat framework rows used by the goals table, keyed as before. */
  function rowOf(fn, level) {
    const r = FUNCTIONS[fn].rows[level];
    return Object.assign({ key: `${fn}:${level}`, functionName: fn, level, band: BAND[level], period: PERIOD }, r);
  }
  const FRAMEWORK = {
    bio_l2: rowOf("Biostatistics", 2),
    ctm_l3: rowOf("Clinical Trial Management", 3),
    ctm_l4: rowOf("Clinical Trial Management", 4),
  };
  const LEVEL_TITLES = {};
  Object.keys(FUNCTIONS).forEach((fn) => { LEVEL_TITLES[fn] = [1, 2, 3, 4].map((l) => (FUNCTIONS[fn].rows[l] || {}).title || ""); });

  /* The employee's Mentor is the Healthark reviewer of record (decision 7 Sep):
     the mentor enters the Miltenyi reviewer's inputs. */
  const MENTOR = "Rahul Verma";

  const PERSONAS = {
    aditi: {
      id: "aditi", name: "Aditi Rao", email: "aditi.rao@miltenyi.com", code: "MIL-EMP-014",
      designation: "Biostatistician", frameworkKey: "bio_l2", trials: ["CT-2201 (EU)", "CT-2308 (US)"],
      mentor: MENTOR, reviewerOfRecord: MENTOR,
      miltenyiReviewer: "Dr. Katrin Weber", miltenyiReviewerRole: "Head of Biostatistics, EU",
      dates: { submitted: "12 Oct 2026", approved: "20 Oct 2026", selfReviewed: "8 Jan 2027", reviewed: "22 Jan 2027" },
      goals: [
        "CT-2201 (EU): deliver the sample-size re-estimation and estimand wording for protocol amendment 3 before the November steering committee. CT-2308 (US): return statistical comments on CRF v2.0 within 5 working days of each draft.",
        "Deliver the CT-2201 interim analysis with zero critical QC findings attributable to statistics; keep TLF re-runs caused by specification errors below 5% across both trials.",
        "SAP v1.0 for CT-2308 signed off by 15 Nov 2026. Analysis specifications for both trials delivered within 10 working days of SAP approval.",
        "Answer statistical CSR review comments and EMA questions on CT-2201 within the agreed 3-working-day turnaround, with no query reopened for a statistical reason.",
        "Every analysis documented per SOP-BST-004; ADaM compliance checks completed and filed before each delivery on both trials.",
      ],
      selfReview: [
        "Amendment 3 sample-size work was delivered two weeks ahead of the steering committee and accepted without change. CRF comments on CT-2308 averaged 3.5 working days across four drafts.",
        "The interim analysis went to the DMC with no critical QC findings. Two TLF re-runs were needed on CT-2308 (both from a late specification change), about 3% of outputs.",
        "SAP v1.0 was signed off on 11 Nov. Specifications for CT-2201 slipped by three days because the ADaM specs depended on a delayed data transfer agreement.",
        "All EMA statistical questions were answered within the SLA; one CSR comment thread reopened, on wording rather than method.",
        "Documentation is complete for all deliveries; the ADaM compliance report for the interim analysis is filed in the TMF.",
      ],
      selfRating: 2,
      primaryComments: [
        "Strong, early input on the amendment; the estimand section was used verbatim. CRF turnaround was reliable.",
        "Interim analysis quality was excellent and well presented to the DMC. The late specification change was outside Aditi's control.",
        "SAP on time. The three-day slip on CT-2201 specifications was communicated early and had no downstream effect.",
        "Regulatory responses were precise and within timelines; appreciated by the EU regulatory lead.",
        "Fully compliant; documentation is audit-ready.",
      ],
      secondaryComments: [
        "Consistent with what we saw in the H1 mentor review: proactive on design questions.",
        "Suggest Aditi presents the interim results approach at the next Healthark biostatistics forum.",
        "", "", "No additions.",
      ],
      finalRating: 2,
    },
    rohan: {
      id: "rohan", name: "Rohan Iyer", email: "rohan.iyer@miltenyi.com", code: "MIL-EMP-021",
      designation: "Senior Clinical Trial Manager", frameworkKey: "ctm_l3", trials: ["CT-2405 (EU)", "CT-2411 (EU)"],
      mentor: MENTOR, reviewerOfRecord: MENTOR,
      miltenyiReviewer: "Marc Dubois", miltenyiReviewerRole: "Regional Clinical Operations Lead, EU",
      dates: { submitted: "14 Oct 2026", approved: "21 Oct 2026", selfReviewed: "9 Jan 2027", reviewed: "25 Jan 2027" },
      goals: [
        "CT-2405: last patient in by 30 Nov 2026 and database lock readiness review completed in December. CT-2411: all 9 EU sites activated by end of Q4 2026 against the recruitment plan.",
        "Quarterly vendor performance reviews completed for the CRO and central lab on both trials within 15 days of quarter end, with action logs tracked to closure.",
        "Reduce recurring protocol deviations on CT-2405 by 30% versus H1 through monthly risk-based site reviews; keep overdue queries under 5% at every monthly cut.",
        "No major or critical findings in the Q4 sponsor audit of CT-2405; TMF completeness above 98% at each monthly check.",
      ],
      selfReview: [
        "CT-2405 reached last patient in on 26 Nov; the lock readiness review is scheduled for 15 Dec. Eight of nine CT-2411 sites are active; the ninth is waiting on an ethics resubmission.",
        "Both Q3 vendor reviews were completed within 12 days; the Q4 reviews are booked for the second week of January.",
        "Recurring deviations dropped 35% versus H1; overdue queries peaked at 6% in September and are now at 3%.",
        "The Q4 audit closed with two minor findings and no majors; TMF completeness has been at 98.5% or above since August.",
      ],
      selfRating: 2,
      primaryComments: [
        "Delivered the recruitment plan on CT-2405 with good site engagement. CT-2411 activation is on track given the ethics delay.",
        "Vendor governance is disciplined; the CRO commented positively on the review format.",
        "The deviation reduction is real and visible in the monthly dashboards.",
        "Audit outcome was strong. Keep the TMF discipline through lock.",
      ],
      secondaryComments: ["", "", "Consider sharing the risk-based review template with the CTM group.", ""],
      finalRating: 2,
    },
    meera: {
      id: "meera", name: "Meera Krishnan", email: "meera.krishnan@miltenyi.com", code: "MIL-EMP-007",
      designation: "Lead - Clinical Trial Manager", frameworkKey: "ctm_l4", trials: ["Portfolio (EU + US)"],
      mentor: MENTOR, reviewerOfRecord: MENTOR,
      miltenyiReviewer: "Dr. Elena Rossi", miltenyiReviewerRole: "VP Clinical Development Operations",
      dates: { submitted: "16 Oct 2026", approved: "23 Oct 2026", selfReviewed: "10 Jan 2027", reviewed: "27 Jan 2027" },
      goals: [
        "At least 85% of portfolio programs meet their CY 2026 major milestones as tracked in the monthly portfolio review.",
        "No critical findings in any sponsor or regulatory inspection across the portfolio in CY 2026.",
        "Portfolio spend within 5% of the approved CY 2026 budget, with variances explained at each quarterly review.",
        "Planned versus actual utilisation of the CTM team within 10% each quarter.",
        "Lead two process-improvement initiatives: the risk-based monitoring template rollout and the site activation playbook.",
        "95% of CAPAs closed within agreed timelines; no critical issue recurring within 12 months.",
        "Monthly operational reviews held on schedule; 90% of key operational risks closed within the quarter they were raised.",
      ],
      selfReview: [
        "88% of programs met their major milestones; two slipped for enrolment reasons and were re-baselined in Q3.",
        "No critical inspection findings; one major finding in the Q2 sponsor audit was closed in Q3.",
        "Spend closed at 3.8% under budget.",
        "Utilisation stayed within 8% in every quarter.",
        "Both initiatives were completed; the playbook is now used on all new EU studies.",
        "97% CAPA closure within timelines; no recurrence.",
        "All reviews were held; 92% of key risks closed within quarter.",
      ],
      selfRating: 1,
      primaryComments: [
        "Portfolio delivery was strong and transparently reported.",
        "The Q2 major finding was handled well and did not recur.",
        "Budget discipline was exemplary.",
        "Good balance between utilisation and quality.",
        "The site activation playbook is a genuine improvement.",
        "CAPA governance is a model for other functions.",
        "Operational governance was consistent all year.",
      ],
      secondaryComments: ["", "", "", "", "Worth presenting the playbook to the wider Healthark CTM practice.", "", ""],
      finalRating: 1,
    },
  };

  /* Team queue seen by the mentor (reviewer of record). The selected persona's
     row follows the prototype stage; the others are static illustrations. */
  const QUEUE = [
    { personaId: "aditi" },
    { personaId: "rohan", stage: "self_reviewed" },
    { personaId: "meera", stage: "approved" },
    { name: "Kabir Singh", title: "Regulatory Affairs Specialist", functionName: "Regulatory Affairs", level: 2, trials: ["CT-2201 (EU)"], miltenyiReviewer: "Stefan Bauer", stage: "submitted" },
    { name: "Diya Mehta", title: "Regulatory Affairs Associate", functionName: "Regulatory Affairs", level: 1, trials: ["CT-2308 (US)"], miltenyiReviewer: "Stefan Bauer", stage: "draft" },
    { name: "Riya Nair", title: "Clinical Trial Manager", functionName: "Clinical Trial Management", level: 2, trials: ["CT-2405 (EU)"], miltenyiReviewer: "Marc Dubois", stage: "reviewed" },
    { name: "Ishaan Joshi", title: "Pharmacovigilance Analyst", functionName: "Pharmacovigilance", level: null, trials: ["CT-2201 (EU)", "CT-2405 (EU)"], miltenyiReviewer: "—", stage: "unmapped" },
    { name: "Saanvi Reddy", title: "Senior Pharmacovigilance Analyst", functionName: "Pharmacovigilance", level: null, trials: ["CT-2308 (US)"], miltenyiReviewer: "—", stage: "unmapped" },
  ];

  /* HR Framework Mapping: Employee · Function · GCC Designation · Level ·
     Reviewer (Mentor) · Miltenyi Reviewer · Status (derived). */
  const MAPPING = [
    { name: "Aditi Rao", email: "aditi.rao@miltenyi.com", functionName: "Biostatistics", designation: "Biostatistician", level: 2, mentor: MENTOR, miltenyiReviewer: "Dr. Katrin Weber" },
    { name: "Rohan Iyer", email: "rohan.iyer@miltenyi.com", functionName: "Clinical Trial Management", designation: "Senior Clinical Trial Manager", level: 3, mentor: MENTOR, miltenyiReviewer: "Marc Dubois" },
    { name: "Meera Krishnan", email: "meera.krishnan@miltenyi.com", functionName: "Clinical Trial Management", designation: "Lead - Clinical Trial Manager", level: 4, mentor: MENTOR, miltenyiReviewer: "Dr. Elena Rossi" },
    { name: "Kabir Singh", email: "kabir.singh@miltenyi.com", functionName: "Regulatory Affairs", designation: "Regulatory Affairs Specialist", level: 2, mentor: MENTOR, miltenyiReviewer: "Stefan Bauer" },
    { name: "Diya Mehta", email: "diya.mehta@miltenyi.com", functionName: "Regulatory Affairs", designation: "Regulatory Affairs Associate", level: 1, mentor: MENTOR, miltenyiReviewer: "Stefan Bauer" },
    { name: "Riya Nair", email: "riya.nair@miltenyi.com", functionName: "Clinical Trial Management", designation: "Clinical Trial Manager", level: 2, mentor: "Vikram Iyer", miltenyiReviewer: "Marc Dubois" },
    { name: "Ishaan Joshi", email: "ishaan.joshi@miltenyi.com", functionName: "Pharmacovigilance", designation: "Pharmacovigilance Analyst", level: 2, mentor: "Neha Kapoor", miltenyiReviewer: "" },
    { name: "Saanvi Reddy", email: "saanvi.reddy@miltenyi.com", functionName: "Pharmacovigilance", designation: "Senior Pharmacovigilance Analyst", level: 3, mentor: "Neha Kapoor", miltenyiReviewer: "" },
  ];

  const MENTORS = ["Rahul Verma", "Neha Kapoor", "Vikram Iyer"];

  return { PERIOD, BAND, FUNCTIONS, FRAMEWORK, LEVEL_TITLES, PERSONAS, QUEUE, MAPPING, MENTORS };
})();
