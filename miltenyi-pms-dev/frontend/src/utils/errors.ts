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
  if (
    err !== null &&
    typeof err === "object" &&
    "response" in err &&
    err.response !== null &&
    typeof err.response === "object" &&
    "data" in err.response &&
    err.response.data !== null &&
    typeof err.response.data === "object" &&
    "detail" in err.response.data &&
    typeof err.response.data.detail === "string"
  ) {
    return err.response.data.detail;
  }
  return "An unexpected error occurred. Please try again.";
}
