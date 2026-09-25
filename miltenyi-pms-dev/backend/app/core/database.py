from sqlalchemy import create_engine, event
from sqlalchemy.orm import declarative_base, sessionmaker, with_loader_criteria
from app.core.config import settings

# Enterprise trick: Automatically adapt based on the .env URL
if settings.DATABASE_URL.startswith("sqlite"):
    engine = create_engine(
        settings.DATABASE_URL,
        connect_args={"check_same_thread": False}
    )
else:
    engine = create_engine(
        settings.DATABASE_URL,
        pool_size=10, 
        max_overflow=20,
        pool_pre_ping=True
    )

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()


@event.listens_for(SessionLocal, "do_orm_execute")
def _hide_soft_deleted_goals(execute_state) -> None:
    """Goals are soft-deleted (goals.is_deleted, 25 Sep 2026). Every ORM
    SELECT through the app session — lists, lookups, dashboard counts,
    exports and relationship loads such as `user.goals` — hides deleted rows,
    so no query site has to remember the filter. Pass
    `.execution_options(include_deleted_goals=True)` to see them."""
    if not execute_state.is_select:
        return
    if execute_state.execution_options.get("include_deleted_goals", False):
        return
    from app.models.goal_models import Goal  # local import: models import Base from here

    execute_state.statement = execute_state.statement.options(
        with_loader_criteria(Goal, Goal.is_deleted == False, include_aliases=True)  # noqa: E712
    )

# Dependency to inject the database session into our FastAPI routes
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()