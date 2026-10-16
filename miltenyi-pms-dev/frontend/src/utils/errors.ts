/**
 * Extracts a human-readable message from an unknown Axios error.
 *
 * Per architecture standards: never use `as SomeType` in catch blocks.
 * This guard function narrows the unknown error safely so callers never
 * need to cast anything themselves.
 *
 * Usage:
 *   } catch (err) {
 *     setError(getErrorMessage(err));
 *   }
 */
export function getErrorMessage(err: unknown): string {
  const detail = errorDetail(err);
  if (typeof detail === "string") return detail;
  if (detail !== null && typeof detail === "object" && "message" in detail && typeof detail.message === "string") {
    return detail.message;
  }
  return "An unexpected error occurred. Please try again.";
}

/**
 * The machine-readable code of an error the backend sends as
 * `{"detail": {"code": "...", "message": "..."}}` (e.g. "personal_framework"
 * when a confirmation is needed), or null.
 */
export function getErrorCode(err: unknown): string | null {
  const detail = errorDetail(err);
  if (detail !== null && typeof detail === "object" && "code" in detail && typeof detail.code === "string") {
    return detail.code;
  }
  return null;
}

function errorDetail(err: unknown): unknown {
  if (
    err !== null &&
    typeof err === "object" &&
    "response" in err &&
    err.response !== null &&
    typeof err.response === "object" &&
    "data" in err.response &&
    err.response.data !== null &&
    typeof err.response.data === "object" &&
    "detail" in err.response.data
  ) {
    return err.response.data.detail;
  }
  return null;
}
