import { useEffect, useReducer } from "react";
import {
  projectReviewService,
  type ProjectReviewResponse,
} from "../services/project-review.service";

/**
 * Fetches a single ProjectReview by id, exposing an atomic
 * `{ details, isFetching, error }` state.
 *
 * Both `ReviewDetailPanel` (My Reviews grid view) and `TableExpandedRow`
 * (My Reviews table view) need this exact loading lifecycle. Doing it
 * inline with multiple `useState` setters and a `useEffect` body that
 * called them synchronously triggered cascading-render warnings (sonar
 * S6447 / "calling setState within effect"). Folding everything into a
 * single `useReducer` collapses each transition into one dispatch, so
 * React only commits one update per state change.
 *
 * Pass `null` to clear/reset; the hook will return the idle state and
 * skip the network request.
 */

interface ReviewDetailsState {
  readonly details: ProjectReviewResponse | null;
  readonly isFetching: boolean;
  readonly error: string;
}

const INITIAL: ReviewDetailsState = {
  details: null,
  isFetching: false,
  error: "",
};

type Action =
  | { type: "reset" }
  | { type: "start" }
  | { type: "success"; details: ProjectReviewResponse }
  | { type: "error"; message: string };

function reducer(state: ReviewDetailsState, action: Action): ReviewDetailsState {
  switch (action.type) {
    case "reset":
      return INITIAL;
    case "start":
      return { details: null, isFetching: true, error: "" };
    case "success":
      return { details: action.details, isFetching: false, error: "" };
    case "error":
      return { details: null, isFetching: false, error: action.message };
    default:
      return state;
  }
}

export function useReviewDetails(reviewId: number | null) {
  const [state, dispatch] = useReducer(reducer, INITIAL);

  useEffect(() => {
    if (reviewId == null) {
      dispatch({ type: "reset" });
      return;
    }
    let cancelled = false;
    dispatch({ type: "start" });
    projectReviewService
      .getReview(reviewId)
      .then((details) => {
        if (!cancelled) dispatch({ type: "success", details });
      })
      .catch(() => {
        if (!cancelled)
          dispatch({
            type: "error",
            message: "Failed to fetch evaluation details",
          });
      });
    return () => {
      cancelled = true;
    };
  }, [reviewId]);

  return state;
}
