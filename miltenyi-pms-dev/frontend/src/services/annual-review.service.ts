/**
 * annual-review.service.ts — API Contract for the 3-Stage Review.
 *
 * Covers:
 *   Stage 1: Employee self-review (create, draft save, get mine, get history)
 *   Stage 2: Mentor evaluation (get mentees, submit eval)
 *   Stage 3: Management calibration (get grid, finalize)
 *   Shared:  Get single review by ID
 *
 * Each stage captures a single free-text overall review plus a 1–5
 * performance rating (1 = beyond expectations … 5 = did not achieve goals,
 * same guide as Project Review).
 */

import apiClient from "@/services/api.client";
import type { Paginated } from "@/lib/pagination";

// ── Enums ───────────────────────────────────────────────────────────

export type ReviewStatus =
  | "not_started"
  | "draft"
  | "pending_mentor"
  | "pending_management"
  | "completed";

// ── Response Types ──────────────────────────────────────────────────

export interface AnnualReview {
  id: number;
  org_id: number;
  user_id: number;
  mentor_id: number | null;
  cycle_name: string;
  status: ReviewStatus;

  /** Resolved names — populated by org-wide endpoints (/all). Null on
   *  per-user endpoints where the caller already knows the names. */
  employee_name?: string | null;
  mentor_name?: string | null;
  /** Employee's org context — populated by /all so the HR table can
   *  filter by Function / Designation without per-row lookups. */
  function?: string | null;
  designation?: string | null;

  // Stage 1 — employee self-review
  self_overall_review: string | null;
  self_performance_rating: number | null;

  // Stage 2 — mentor evaluation
  mentor_overall_review: string | null;
  mentor_performance_rating: number | null;
  /** Mentor's in-progress draft, surfaced only to the mentor (the
   *  backend strips these for the mentee). Cleared on submit. */
  mentor_overall_review_draft: string | null;
  mentor_performance_rating_draft: number | null;

  // Stage 3 — management calibration
  management_performance_rating: number | null;
  final_performance_rating: number | null;
  final_rating_enabled: boolean;

  created_at: string;
  updated_at: string | null;
}

export interface MenteeAnnualReview extends AnnualReview {
  employee_name: string;
  employee_email: string | null;
  function: string | null;
  designation: string | null;
}

export interface CalibrationRow {
  /** Null when the Employee hasn't created a review yet (status === "not_started"). */
  review_id: number | null;
  user_id: number;
  employee_name: string;
  employee_email: string | null;
  mentor_name: string | null;
  function: string | null;
  designation: string | null;
  self_performance_rating: number | null;
  mentor_performance_rating: number | null;
  management_performance_rating: number | null;
  final_performance_rating: number | null;
  status: ReviewStatus;
  final_rating_enabled: boolean;
}

export interface ManagementRatingPayload {
  management_performance_rating: number;
}

// ── Request Payload Types ───────────────────────────────────────────

export interface SelfReviewPayload {
  self_overall_review: string;
  self_performance_rating: number;
}

export type SelfReviewDraftPayload = Partial<SelfReviewPayload>;

export interface MentorEvalPayload {
  mentor_overall_review: string;
  mentor_performance_rating: number;
}

/** Save-draft payload — both fields optional. The mentor can park work
 *  before having committed to either the text or the rating. */
export type MentorEvalDraftPayload = Partial<MentorEvalPayload>;

// ── Service ─────────────────────────────────────────────────────────

export const annualReviewService = {
  // ── Stage 1: Employee ───────────────────────────────────────────
  submitSelfReview: async (
    payload: SelfReviewPayload,
  ): Promise<AnnualReview> => {
    const res = await apiClient.post<AnnualReview>(
      "/annual-reviews/self",
      payload,
    );
    return res.data;
  },

  /** Create a new annual self-review in DRAFT state. Use when no row
   *  exists yet for the active cycle; for updating an existing draft,
   *  use saveDraft. */
  createSelfDraft: async (
    payload: SelfReviewDraftPayload,
  ): Promise<AnnualReview> => {
    const res = await apiClient.post<AnnualReview>(
      "/annual-reviews/self/draft",
      payload,
    );
    return res.data;
  },

  saveDraft: async (
    reviewId: number,
    payload: SelfReviewDraftPayload,
  ): Promise<AnnualReview> => {
    const res = await apiClient.patch<AnnualReview>(
      `/annual-reviews/${reviewId}/draft`,
      payload,
    );
    return res.data;
  },

  /** Full history of the current user's reviews across cycles, newest-first. */
  getMyReviewHistory: async (): Promise<AnnualReview[]> => {
    const res = await apiClient.get<AnnualReview[]>(
      "/annual-reviews/mine/history",
    );
    return res.data;
  },

  // ── Stage 2: Mentor ─────────────────────────────────────────────
  /** Mentor's mentees' annual reviews across every cycle.
   *
   *  Paginated as of PR #40 (doc 23) — consistency-play pagination.
   *  Mentor scale is small (most callers see one page), but the same
   *  template applies for predictability + uniform Load More UI.
   *
   *  Server-side filters added in PR #46 (doc 29). Filter set is small:
   *  fy_year (LIKE-OR vs cycle_name), status (direct column), mentee
   *  (exact equality), search (substring ILIKE on mentee name).
   *  Server defaults: limit=50, max=200. Pair with `useInfiniteQuery`. */
  getMenteeReviews: async (
    params: MenteeReviewsRequestParams = {},
  ): Promise<PaginatedMenteeReviews> => {
    const res = await apiClient.get<PaginatedMenteeReviews>(
      "/annual-reviews/mentees",
      { params },
    );
    return res.data;
  },

  submitMentorEval: async (
    reviewId: number,
    payload: MentorEvalPayload,
  ): Promise<AnnualReview> => {
    const res = await apiClient.patch<AnnualReview>(
      `/annual-reviews/${reviewId}/mentor-eval`,
      payload,
    );
    return res.data;
  },

  /** Mentor saves an in-progress evaluation as a draft. Both fields are
   *  optional; the row stays in pending_mentor status, the draft cols on
   *  the row carry the in-progress text/rating. */
  saveMentorDraft: async (
    reviewId: number,
    payload: MentorEvalDraftPayload,
  ): Promise<AnnualReview> => {
    const res = await apiClient.patch<AnnualReview>(
      `/annual-reviews/${reviewId}/mentor-draft`,
      payload,
    );
    return res.data;
  },

  // ── Stage 3: Management ─────────────────────────────────────────
  /** Calibration grid for the active cycle (every active Employee in
   *  the org, LEFT-joined against their AnnualReview).
   *
   *  Paginated as of PR #38 (doc 21). Standard offset/limit shape; each
   *  row corresponds to exactly one Employee, so unlike /goals/all
   *  (doc 20) `total` and `items.length` are the same unit — the
   *  user-row count for the page. Pair with `useInfiniteQuery`.
   *
   *  Server-side filters added in PR #46 (doc 29). Five dimensions:
   *  function, designation, mentor (user-attribute filters);
   *  status (EXISTS / NOT EXISTS against active-cycle review);
   *  search (substring ILIKE on User.full_name AND User.email).
   *  Server defaults: limit=50, max=200. */
  getCalibrationGrid: async (
    params: CalibrationRequestParams = {},
  ): Promise<PaginatedCalibration> => {
    const res = await apiClient.get<PaginatedCalibration>(
      "/annual-reviews/calibration",
      { params },
    );
    return res.data;
  },

  /** Lightweight inline action from the Management Review tab — sets only
   * management_performance_rating and unlocks the per-row visibility flag. */
  setManagementRating: async (
    reviewId: number,
    payload: ManagementRatingPayload,
  ): Promise<AnnualReview> => {
    const res = await apiClient.patch<AnnualReview>(
      `/annual-reviews/${reviewId}/management-rating`,
      payload,
    );
    return res.data;
  },

  // ── Shared ──────────────────────────────────────────────────────
  getReview: async (reviewId: number): Promise<AnnualReview> => {
    const res = await apiClient.get<AnnualReview>(
      `/annual-reviews/${reviewId}`,
    );
    return res.data;
  },

  // ── HR_MyOrg view-only ─────────────────────────────────────────
  /** Every annual review across the org, every cycle. HR_MyOrg-only;
   *  the backend 403s any other role. Powers the "All Reviews" tab.
   *
   *  Paginated as of PR #19. The frontend pairs this with TanStack
   *  Query's useInfiniteQuery — see doc #19 for the full pattern.
   *  Server defaults: limit=50, offset=0. Server max: limit=200.
   *  Response carries `has_more` so the UI can disable the "Load
   *  more" button without arithmetic.
   *
   *  Server-side filters added in PR #43 (doc 26). Each filter narrows
   *  the universe BEFORE pagination, so `total` is the count of rows
   *  matching ALL active filters and Load More pages through what
   *  matches. Filters apply with AND. Pass `undefined` (or omit) to
   *  not filter on a dimension. The frontend bakes the filter object
   *  into the queryKey, so changing a filter triggers a fresh
   *  paginated fetch from offset 0. */
  getAllReviews: async (
    params: AllReviewsRequestParams = {},
  ): Promise<PaginatedAnnualReviews> => {
    const res = await apiClient.get<PaginatedAnnualReviews>(
      "/annual-reviews/all",
      { params },
    );
    return res.data;
  },

  /** Distinct `cycle_name` values that have at least one annual review
   *  in this org (e.g. ["FY26-27", "FY25-26"]). Powers the Cycle
   *  filter dropdown on the HR "All Reviews" tab so its options don't
   *  shrink to only the selected value once a filter is applied to
   *  the visible rows. HR_MyOrg-only. */
  getDistinctCycles: async (): Promise<string[]> => {
    const res = await apiClient.get<string[]>("/annual-reviews/all/distinct-cycles");
    return res.data;
  },
};

/** Filter set accepted by GET /annual-reviews/all (PR #43, doc 26).
 *  All fields optional; omitted fields don't narrow. All matches are
 *  exact-equality (the frontend's combobox/select UI commits exact
 *  values — substring search is a future PR). */
export interface AllReviewsFilters {
  /** Exact match on cycle_name (e.g. "Q1 FY26-27"). */
  cycle?: string;
  /** Exact match on ReviewStatus (e.g. "draft", "pending_mentor"). */
  status?: ReviewStatus;
  /** Exact match on the employee's Function name. */
  function?: string;
  /** Exact match on the employee's Designation name. */
  designation?: string;
  /** Exact match on the employee's full_name. */
  employee?: string;
}

/** Sort columns accepted by GET /annual-reviews/all (PR #47, doc 30).
 *  Mirrors the backend's `_ALL_REVIEWS_SORT_COLUMNS` map exactly.
 *  The frontend's `AllReviewsSortKey` enum in AnnualReviews.tsx is the
 *  same literal-union. */
export type AllReviewsSortBy =
  | "employee_name"
  | "function"
  | "designation"
  | "cycle_name"
  | "status"
  | "self_performance_rating"
  | "mentor_performance_rating"
  | "final_performance_rating";

export interface AllReviewsSort {
  /** Primary sort column. Omit for default ordering
   *  (cycle_name DESC, created_at DESC). */
  sort_by?: AllReviewsSortBy;
  /** Direction. Default "asc". */
  sort_dir?: "asc" | "desc";
}

/** Full request shape: pagination + filters + sort. */
export type AllReviewsRequestParams = AllReviewsFilters &
  AllReviewsSort & {
    limit?: number;
    offset?: number;
  };

/** Generic paginated-response wrapper lives in `@/lib/pagination` so it
 *  can be reused across services (PR #37 extracted it once a second
 *  caller — /goals/all — needed it). Re-exported here so existing
 *  consumers that imported `Paginated` / `PaginatedAnnualReviews` from
 *  this module keep compiling without churn. */
export type { Paginated };
export type PaginatedAnnualReviews = Paginated<AnnualReview>;
/** Paginated response from GET /annual-reviews/calibration (PR #38).
 *  Per-row identity is the Employee; `total` and `items.length` are
 *  the same unit (one calibration row per user). */
export type PaginatedCalibration = Paginated<CalibrationRow>;
/** Paginated response from GET /annual-reviews/mentees (PR #40).
 *  Per-row identity is the AnnualReview; `total` and `items.length`
 *  are the same unit (review-row count). */
export type PaginatedMenteeReviews = Paginated<MenteeAnnualReview>;

/** Filter set for GET /annual-reviews/calibration (PR #46, doc 29).
 *  All optional. function/designation/mentor are exact-match user
 *  attributes. status is the lifecycle state (or "not_started" for
 *  users without a review in the active cycle). search is a substring
 *  match on User.full_name OR User.email. */
export interface CalibrationFilters {
  function?: string;
  designation?: string;
  mentor?: string;
  status?: ReviewStatus;
  /** Substring match; frontend debounces before piping into queryKey. */
  search?: string;
}

/** Sort columns accepted by GET /annual-reviews/calibration (PR #48,
 *  doc 31). Review-derived dimensions (status + ratings) require an
 *  outer join on the backend; users with no active-cycle review sort
 *  as NULL. */
export type CalibrationSortBy =
  | "employee_name"
  | "employee_email"
  | "mentor_name"
  | "function"
  | "designation"
  | "status"
  | "self_performance_rating"
  | "mentor_performance_rating"
  | "management_performance_rating";

export interface CalibrationSort {
  sort_by?: CalibrationSortBy;
  sort_dir?: "asc" | "desc";
}

export type CalibrationRequestParams = CalibrationFilters &
  CalibrationSort & {
    limit?: number;
    offset?: number;
  };

/** Filter set for GET /annual-reviews/mentees (PR #46, doc 29). */
export interface MenteeReviewsFilters {
  /** Fiscal-year integer (e.g. 2026); matches AnnualReview.cycle_name
   *  via the same LIKE-OR pattern as /goals/all (doc 27). */
  fy_year?: number;
  status?: ReviewStatus;
  /** Exact match on mentee full_name. */
  mentee?: string;
  /** Substring match on mentee full_name. Frontend debounces. */
  search?: string;
}

/** Sort columns accepted by GET /annual-reviews/mentees (PR #48, doc 31). */
export type MenteeReviewsSortBy =
  | "employee_name"
  | "cycle_name"
  | "status"
  | "self_performance_rating"
  | "mentor_performance_rating"
  | "management_performance_rating";

export interface MenteeReviewsSort {
  sort_by?: MenteeReviewsSortBy;
  sort_dir?: "asc" | "desc";
}

export type MenteeReviewsRequestParams = MenteeReviewsFilters &
  MenteeReviewsSort & {
    limit?: number;
    offset?: number;
  };
