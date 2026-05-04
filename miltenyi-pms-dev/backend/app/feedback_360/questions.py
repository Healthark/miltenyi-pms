"""
360 Feedback question registry.

Hard-coded list of questions with stable string keys. The keys are what
get persisted on `feedback_360_answers.question_key` rows, so question
text or bucket names can change later without breaking history. Adding
or removing a question is a code change with no migration required —
the answers table is key-based, not column-based.

Bucket → display grouping in the form and the aggregate view. Buckets
are *visual only*: the aggregate does not roll up section averages,
each question is rendered with its own pair of stacked bars.
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class FeedbackQuestion:
    key: str       # stable identifier; never changes once shipped
    bucket: str    # display grouping
    text: str      # current copy (mutable across releases)
    order: int     # render order


# Order matters — render order in the form mirrors this list.
FEEDBACK_QUESTIONS: list[FeedbackQuestion] = [
    FeedbackQuestion(
        key="collab_inclusive_env",
        bucket="Collaboration",
        text="Creates a collaborative, inclusive environment that promotes open communication and welcomes new ideas",
        order=1,
    ),
    FeedbackQuestion(
        key="empathy_consideration",
        bucket="Empathy",
        text="Shows genuine consideration for others as individuals, supports their wellbeing, and makes them feel valued",
        order=2,
    ),
    FeedbackQuestion(
        key="empower_support_autonomy",
        bucket="Empowerment",
        text="Provides the right level of support and autonomy while ensuring clarity of roles, expectations, and context",
        order=3,
    ),
    FeedbackQuestion(
        key="empower_recognition",
        bucket="Empowerment",
        text="Recognizes contributions and gives credit where it is due",
        order=4,
    ),
    FeedbackQuestion(
        key="equity_fair_treatment",
        bucket="Equity",
        text="Treats people fairly, respects diverse perspectives, and ensures equal opportunity for all to contribute and be heard",
        order=5,
    ),
    FeedbackQuestion(
        key="growth_dev_feedback",
        bucket="Growth",
        text="Supports professional development, helps build new skills, and provides constructive and actionable feedback",
        order=6,
    ),
    FeedbackQuestion(
        key="impact_outcomes",
        bucket="Impact",
        text="Drives meaningful outcomes, prioritizes high-value work, and reliably removes obstacles to progress",
        order=7,
    ),
    FeedbackQuestion(
        key="values_integrity",
        bucket="Values",
        text="Models company values in day-to-day interactions and operates with integrity, honesty, and transparency",
        order=8,
    ),
    FeedbackQuestion(
        key="comm_clarity",
        bucket="Communication",
        text="Communicates clearly, shares information in a timely manner, and is approachable for open dialogue",
        order=9,
    ),
    FeedbackQuestion(
        key="comm_alignment",
        bucket="Communication",
        text="Ensures alignment and smooth coordination across work and stakeholders",
        order=10,
    ),
    FeedbackQuestion(
        key="core_expertise",
        bucket="Core Expertise",
        text="Demonstrates strong core skills and upholds high standards of quality, documentation, and deliverables",
        order=11,
    ),
    FeedbackQuestion(
        key="domain_knowledge",
        bucket="Domain Knowledge",
        text="Has strong domain knowledge and applies it to solve problems, enable others, and improve outputs",
        order=12,
    ),
]


VALID_QUESTION_KEYS: frozenset[str] = frozenset(q.key for q in FEEDBACK_QUESTIONS)
