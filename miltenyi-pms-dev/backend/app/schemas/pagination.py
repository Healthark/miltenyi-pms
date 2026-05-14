"""
pagination.py — Shared paginated-response wrapper.

Used by any list endpoint that wants to return a windowed subset of a
larger result set instead of the full list. The frontend pairs this
with TanStack Query's `useInfiniteQuery` to fetch and stitch pages.

Wire shape:
    {
        "items":    [<T>, <T>, ...],   # this page's rows
        "total":    1234,               # total rows matching the query
        "limit":    50,                 # rows requested
        "offset":   100,                # rows skipped before this page
        "has_more": True                # convenience: True iff (offset + len(items)) < total
    }

Frontend uses `has_more` to decide whether to render a "Load more"
button or stop fetching. `total` lets the UI render a "Showing N of T"
indicator without computing it from accumulated pages.

Why offset/limit (and not cursor) — see doc #19 part 5. Short version:
within a calibration window the underlying data is stable enough that
offset's lower complexity wins. Cursor-based becomes preferable when
the dataset churns mid-paging (frequent inserts/deletes between page
fetches). We'll revisit if/when that becomes a concern.

Pydantic v2 generic via `typing.Generic[T]`. Each endpoint declares its
own concrete instantiation:

    @router.get("/all", response_model=Paginated[AnnualReviewResponse])
    def get_all(...):
        ...
        return Paginated[AnnualReviewResponse](
            items=rows, total=total, limit=limit, offset=offset,
            has_more=(offset + len(rows)) < total,
        )
"""

from typing import Generic, List, TypeVar

from pydantic import BaseModel, ConfigDict

T = TypeVar("T")


class Paginated(BaseModel, Generic[T]):
    """Generic paginated response wrapper.

    Attribute semantics:
        items     — the rows on THIS page (length == min(limit, total - offset))
        total     — count of rows matching the underlying query, NOT just this page
        limit     — the page size that was honoured (may differ from what
                    the client requested if the server clamps to a max)
        offset    — rows skipped before this page
        has_more  — convenience flag; saves the frontend an arithmetic
                    check. True iff (offset + len(items)) < total.
    """

    # `from_attributes=True` so item conversion via `model_validate` /
    # FastAPI's response_model machinery picks up SQLAlchemy ORM models
    # (or any duck-typed object with the expected attributes). Without
    # this, returning ORM instances inside `items` would fail to
    # serialize for downstream nested response models that depend on
    # the same flag.
    model_config = ConfigDict(from_attributes=True)

    items: List[T]
    total: int
    limit: int
    offset: int
    has_more: bool
