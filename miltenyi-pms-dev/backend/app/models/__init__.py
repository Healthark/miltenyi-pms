# Import all models here so Alembic can discover them easily
from app.models.organization_models import Organization
from app.models.reference_models import Department, Designation
from app.models.user_models import User
from app.models.goal_models import Goal
from app.models.system_settings_models import SystemSettings
from app.models.goal_criteria_models import GoalCriterion
from app.models.goal_self_review_models import GoalSelfReview, SelfReviewCycleHalf
from app.models.goal_mentor_review_models import GoalMentorReview
from app.models.goal_notification_models import GoalNotification
from app.models.annual_review_models import AnnualReview
from app.models.project_models import Project, ProjectAssignment
from app.models.project_review_models import ProjectReview, ProjectReviewEvaluator
from app.models.role_expectation_models import RoleExpectation
from app.models.password_reset_token_models import PasswordResetToken
