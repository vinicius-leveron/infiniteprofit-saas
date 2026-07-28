const DEFAULT_APP_URL = "https://infiniteprofit-saas.onrender.com";
const DEFAULT_HOTMART_CANARY_WORKSPACE_IDS =
  "ce21f804-5915-40fa-8499-e43092d2884b";

function cleanValue(value: string | undefined) {
  const cleaned = value?.trim();
  return cleaned || null;
}

function commaSeparatedValues(value: string | undefined) {
  return new Set(
    (cleanValue(value) ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  );
}

export const publicConfig = {
  appUrl: cleanValue(import.meta.env.VITE_APP_PUBLIC_URL) ?? DEFAULT_APP_URL,
  hotmartCheckoutEnabled:
    cleanValue(import.meta.env.VITE_ENABLE_HOTMART_CHECKOUT)?.toLowerCase()
      === "true",
  hotmartCanaryWorkspaceIds: commaSeparatedValues(
    import.meta.env.VITE_HOTMART_CANARY_WORKSPACE_IDS
      ?? DEFAULT_HOTMART_CANARY_WORKSPACE_IDS,
  ),
  supportEmail:
    cleanValue(import.meta.env.VITE_SUPPORT_EMAIL) ??
    "suporte@infiniteprofit.com.br",
  statusUrl: cleanValue(import.meta.env.VITE_STATUS_URL),
  legalEntityName:
    cleanValue(import.meta.env.VITE_LEGAL_ENTITY_NAME) ?? "Infinite Profit",
};

export function isHotmartCheckoutEnabled(workspaceId?: string | null) {
  if (publicConfig.hotmartCheckoutEnabled) return true;
  return Boolean(
    workspaceId && publicConfig.hotmartCanaryWorkspaceIds.has(workspaceId),
  );
}
