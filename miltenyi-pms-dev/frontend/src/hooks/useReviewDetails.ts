import { useQuery } from "@tanstack/react-query";
import {
  projectReviewService,
  type ProjectReviewResponse,
} from "@/services/project-review.service";
import { queryKeys } from "@/lib/queryKeys";

/**
 * Fetches a single ProjectReview by id, exposing an atomic
 * `{ details, isFetching, error }` state.
 *
 * Both `ReviewDetailPanel` (My Reviews grid view) and `TableExpandedRow`
 * (My Reviews table view) need this exact loading lifecycle. Pass `null`
 * to clear/reset; the hook will return the idle state and skip the
 * network request.
 *
 * Internals:
 *   The hook used to wrap `useReducer + useEffect + dispatch + a
 *   cancelled-flag race-condition guard` to dodge cascading-render
 *   warnings (sonar S6447 / "calling setState within effect"). The
 *   useQuery-based version sidesteps that whole class of issue —
 *   TanStack Query commits a single state update per cache transition
 *   and handles unmount-mid-fetch via AbortController internally.
 *
 *   queryKey: queryKeys.projectReviews.detail(id) — same key used by
 *   MenteeProjectsTab's impact modal (PR #12). When an Employee's
 *   ReviewDetailPanel and a Mentor's MenteeProjectsTab impact modal
 *   reference the same review row at the same time (rare but possible),
 *   they share one cache entry.
 *
 * Return-shape note:
 *   The public contract `{ details, isFetching, error }` is preserved
 *   so the two existing consumers don't need updates. `isFetching`
 *   maps to useQuery's `isPending` (true only on first-ever fetch for
 *   a given queryKey). Background refetches caused by stale-while-
 *   revalidate or focus-refetch keep `data` visible without flipping
 *   the consumer's loading skeleton — same UX the legacy hook
 *   delivered, but with the upgrade of automatic freshness on the
 *   user returning to the page.
 */

interface ReviewDetailsState {
  readonly details: ProjectReviewResponse | null;
  readonly isFetching: boolean;
  readonly error: string;
}

export function useReviewDetails(reviewId: number | null): ReviewDetailsState {
  // `?? -1` is a closed-state sentinel — `enabled: false` keeps the
  // inert cache entry from ever firing a request, matching the
  // pattern from PR #11 (ManagementReview Rate modal) and PR #12
  // (MenteeProjectsTab impact modal).
  const query = useQuery({
    queryKey: queryKeys.projectReviews.detail(reviewId ?? -1),
    queryFn: () => projectReviewService.getReview(reviewId as number),
    enabled: reviewId !== null,
  });

  return {
    details: query.data ?? null,
    isFetching: reviewId !== null && query.isPending,
    error: query.isError ? "Failed to fetch evaluation details" : "",
  };
}
