export function sanitizeNextPath(next: string | null | undefined, fallback = "/") {
  if (!next) return fallback;
  if (!next.startsWith("/")) return fallback;
  if (next.startsWith("//")) return fallback;
  return next;
}

export function buildAuthRedirect(nextPath: string) {
  return `/auth?next=${encodeURIComponent(nextPath)}`;
}
