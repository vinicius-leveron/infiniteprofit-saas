export function sanitizeNextPath(next: string | null | undefined, fallback = "/") {
  if (!next) return fallback;
  if (!next.startsWith("/")) return fallback;
  if (next.startsWith("//")) return fallback;
  return next;
}

export const PENDING_INVITE_AUTH_STORAGE_KEY =
  "infiniteprofit.pendingInviteAuth";

export type PendingInviteAuth = {
  email: string;
  nextPath: string;
};

export function readPendingInviteAuth(): PendingInviteAuth | null {
  try {
    const stored = sessionStorage.getItem(PENDING_INVITE_AUTH_STORAGE_KEY);
    if (!stored) return null;
    const parsed = JSON.parse(stored) as Partial<PendingInviteAuth>;
    if (typeof parsed.email !== "string" || typeof parsed.nextPath !== "string") {
      return null;
    }
    const email = parsed.email.trim().toLowerCase();
    const nextPath = sanitizeNextPath(parsed.nextPath, "");
    if (!email || !nextPath.startsWith("/accept-invite?")) return null;
    return { email, nextPath };
  } catch {
    return null;
  }
}

export function writePendingInviteAuth(value: PendingInviteAuth) {
  sessionStorage.setItem(
    PENDING_INVITE_AUTH_STORAGE_KEY,
    JSON.stringify({
      email: value.email.trim().toLowerCase(),
      nextPath: sanitizeNextPath(value.nextPath, "/"),
    }),
  );
}

export function clearPendingInviteAuth() {
  sessionStorage.removeItem(PENDING_INVITE_AUTH_STORAGE_KEY);
}

export function buildAuthRedirect(
  nextPath: string,
  options?: { mode?: "login" | "signup" },
) {
  const params = new URLSearchParams({ next: nextPath });
  if (options?.mode) params.set("mode", options.mode);
  return `/auth?${params.toString()}`;
}
