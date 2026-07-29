export type EffectiveRole = "owner" | "admin" | "moderator" | "member";

export function bearerToken(authHeader: string | null | undefined) {
  const match = authHeader?.match(/^Bearer\s+(\S+)$/i);
  return match?.[1] ?? null;
}

export function roleWeight(role: EffectiveRole) {
  return { owner: 4, admin: 3, moderator: 1, member: 1 }[role];
}

export function canGrantRole(
  actorRole: EffectiveRole,
  targetRole: EffectiveRole,
) {
  return targetRole !== "owner" || actorRole === "owner";
}

export function highestEffectiveAccess<T extends { role: EffectiveRole }>(
  candidates: Array<T | null | undefined>,
) {
  return candidates
    .filter((candidate): candidate is T => Boolean(candidate))
    .sort((left, right) => roleWeight(right.role) - roleWeight(left.role))[0] ??
    null;
}
