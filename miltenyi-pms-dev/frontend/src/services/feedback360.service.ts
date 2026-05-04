/**
 * feedback360.service.ts — API contract for the 360 Feedback module.
 *
 * Endpoints:
 *   GET  /feedback-360/questions                  → registry
 *   GET  /feedback-360/peers                      → peer list w/ worked-with + has-submitted flags
 *   POST /feedback-360/reviews                    → submit a review
 *   GET  /feedback-360/aggregate/{target_user_id} → per-question aggregate
 *
 * Reviewer identity is never sent or returned. The backend computes
 * `has_submitted` for the requester via their JWT — only the requester
 * themselves can resolve their own hash, so the answer is private.
 */

import apiClient from "./api.client";

// ── Question registry ───────────────────────────────────────────────

export interface FeedbackQuestion {
  key: string;
  bucket: string;
  text: string;
  order: number;
}

// ── Peer list ───────────────────────────────────────────────────────

export interface FeedbackPeer {
  user_id: number;
  full_name: string;
  designation_name: string | null;
  department_name: string | null;
  /** True iff the requester has already submitted a review on this
   *  peer for the active FY. Only the requester themselves can have
   *  this flag resolved — the backend uses the requester's JWT. */
  has_submitted: boolean;
  /** System-inferred from project_assignments. Drives the colour
   *  treatment in the UI. */
  worked_with: boolean;
  /** Total reviews this peer has received in the active FY. Org-wide
   *  info — used by the Org Feedback combobox to indicate at a glance
   *  whether an employee has any feedback to look at. */
  received_count: number;
}

// ── Submission ──────────────────────────────────────────────────────

export type FeedbackRatings = Record<string, number>;

export interface FeedbackSubmitPayload {
  target_user_id: number;
  ratings: FeedbackRatings;
}

// ── Single-peer + my-own-review (Give / Read-only page) ────────────

export interface FeedbackTargetInfo {
  user_id: number;
  full_name: string;
  designation_name: string | null;
  department_name: string | null;
  worked_with: boolean;
}

export interface FeedbackMyReview {
  target: FeedbackTargetInfo;
  fy_year: number;
  /** null when the requester hasn't submitted yet → page is in submit mode.
   *  Non-null → read-only mode, sliders pre-filled and disabled. */
  ratings: FeedbackRatings | null;
}

// ── Aggregate ───────────────────────────────────────────────────────

export interface FeedbackBucketAggregate {
  count: number;
  avg: number;
  /** Lowest rating any reviewer in this cohort gave for this question. */
  min: number;
  /** Highest rating any reviewer in this cohort gave for this question. */
  max: number;
}

export interface FeedbackQuestionAggregate {
  key: string;
  bucket: string;
  text: string;
  order: number;
  /** null when count < min_reviewers_threshold for that cohort. */
  worked_with: FeedbackBucketAggregate | null;
  not_worked_with: FeedbackBucketAggregate | null;
}

export interface FeedbackAggregate {
  target_user_id: number;
  fy_year: number;
  total_reviews: number;
  min_reviewers_threshold: number;
  questions: FeedbackQuestionAggregate[];
}

// ── Service ─────────────────────────────────────────────────────────

export const feedback360Service = {
  getQuestions: async (): Promise<FeedbackQuestion[]> => {
    const res = await apiClient.get<FeedbackQuestion[]>("/feedback-360/questions");
    return res.data;
  },

  getPeers: async (): Promise<FeedbackPeer[]> => {
    const res = await apiClient.get<FeedbackPeer[]>("/feedback-360/peers");
    return res.data;
  },

  submitReview: async (payload: FeedbackSubmitPayload): Promise<void> => {
    await apiClient.post("/feedback-360/reviews", payload);
  },

  getMyReview: async (targetUserId: number): Promise<FeedbackMyReview> => {
    const res = await apiClient.get<FeedbackMyReview>(
      `/feedback-360/my-review/${targetUserId}`,
    );
    return res.data;
  },

  getAggregate: async (targetUserId: number): Promise<FeedbackAggregate> => {
    const res = await apiClient.get<FeedbackAggregate>(
      `/feedback-360/aggregate/${targetUserId}`,
    );
    return res.data;
  },
};
