"""database_url_for — DB_SCHEMA picks the Postgres schema without a new connection string."""
from app.core.config import database_url_for

PG = "postgresql://u:p@host:5432/postgres"


def test_sqlite_and_empty_schema_are_untouched() -> None:
    assert database_url_for("sqlite:///./x.db", "miltenyi_uat") == "sqlite:///./x.db"
    assert database_url_for(PG, None) == PG
    assert database_url_for(PG, "") == PG


def test_schema_is_added_in_the_pooler_safe_form() -> None:
    assert database_url_for(PG, "miltenyi_uat") == PG + "?options=-c%20search_path%3Dmiltenyi_uat"


def test_existing_search_path_is_replaced_and_other_params_kept() -> None:
    url = PG + "?sslmode=require&options=-c%20search_path%3Dmiltenyi"
    assert database_url_for(url, "miltenyi_uat") == PG + "?sslmode=require&options=-c%20search_path%3Dmiltenyi_uat"
