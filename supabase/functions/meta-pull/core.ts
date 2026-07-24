export const META_INSIGHT_LEVELS = [
  "account",
  "campaign",
  "adset",
  "ad",
] as const;

export type MetaInsightLevel = typeof META_INSIGHT_LEVELS[number];

export function parseMetaInsightLevels(
  value: unknown,
  allowSelectiveLevels: boolean,
): MetaInsightLevel[] {
  if (!allowSelectiveLevels || !Array.isArray(value)) {
    return [...META_INSIGHT_LEVELS];
  }

  const allowed = new Set<MetaInsightLevel>(META_INSIGHT_LEVELS);
  const levels = [
    ...new Set(
      value
        .map((level) => String(level ?? "").trim())
        .filter((level): level is MetaInsightLevel =>
          allowed.has(level as MetaInsightLevel)
        ),
    ),
  ];

  return levels.length > 0 ? levels : [...META_INSIGHT_LEVELS];
}
