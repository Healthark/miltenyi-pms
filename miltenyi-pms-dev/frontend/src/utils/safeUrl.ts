/**
 * Attachment links on goals are free text from the user. Only http(s)
 * links are ever rendered as clickable; anything else (a `javascript:`
 * value stored before the server-side rule existed, a bare word) is shown
 * as inert text so no script can run in a reviewer's session.
 */
export function isSafeHttpUrl(value: string | null | undefined): boolean {
  if (!value) return false;
  const text = value.trim();
  if (!/^https?:\/\//i.test(text) || /\s/.test(text)) return false;
  try {
    const u = new URL(text);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}
