"""
role_expectations — the GCC role expectations that apply to one person.

Resolved by (function, designation.career_level). Shared by the staff
member's own lookup (GET /users/me/expectations) and the annual goal table,
where the mentor and the Admin read the goal owner's expectations
(GET /goals/annual/{goal_id}/expectations, 7 Oct 2026). The project-reviews
endpoint that used to serve the mentor is switched off with that feature.
"""

from sqlalchemy.orm import Session

from app.models.role_expectation_models import RoleExpectation
from app.models.user_models import User
from app.schemas.user_schemas import UserRoleExpectationResponse

CAREER_LEVEL_LABELS = {1: "Entry", 2: "Mid", 3: "Senior", 4: "Lead"}
EXPECTATION_NOT_DEFINED = "Role expectation not defined"


def role_expectation_for(db: Session, user: User) -> UserRoleExpectationResponse:
    """The six expectation texts for `user`. When the user has no function, no
    designation, a designation without a career level, or the (function,
    career_level) row hasn't been seeded yet, every field carries the same
    'Role expectation not defined' placeholder so the UI needs no null checks."""
    func_name = user.function.name if user.function else "Unassigned"
    desig = user.designation
    desig_name = desig.name if desig else "Unassigned"
    career_level = desig.career_level if desig and desig.career_level is not None else None
    career_level_label = CAREER_LEVEL_LABELS.get(career_level) if career_level is not None else None

    expectation = None
    if user.function_id and career_level is not None:
        expectation = (
            db.query(RoleExpectation)
            .filter(
                RoleExpectation.org_id == user.org_id,
                RoleExpectation.function_id == user.function_id,
                RoleExpectation.career_level == career_level,
            )
            .first()
        )

    def text(value):
        return (value if expectation else None) or EXPECTATION_NOT_DEFINED

    return UserRoleExpectationResponse(
        function_name=func_name,
        designation_name=desig_name,
        career_level=career_level,
        career_level_label=career_level_label,
        exp_scope_of_role=text(expectation and expectation.exp_scope_of_role),
        exp_key_responsibilities=text(expectation and expectation.exp_key_responsibilities),
        exp_technical_competencies=text(expectation and expectation.exp_technical_competencies),
        exp_delivery_ownership=text(expectation and expectation.exp_delivery_ownership),
        exp_regulatory_compliance=text(expectation and expectation.exp_regulatory_compliance),
        exp_project_resource_management=text(expectation and expectation.exp_project_resource_management),
    )
