const DEFAULT_APP_URL = "https://infiniteprofit-saas.onrender.com";

function cleanValue(value: string | undefined) {
  const cleaned = value?.trim();
  return cleaned || null;
}

export const publicConfig = {
  appUrl: cleanValue(import.meta.env.VITE_APP_PUBLIC_URL) ?? DEFAULT_APP_URL,
  hotmartCheckoutEnabled:
    cleanValue(import.meta.env.VITE_ENABLE_HOTMART_CHECKOUT)?.toLowerCase()
      === "true",
  supportEmail:
    cleanValue(import.meta.env.VITE_SUPPORT_EMAIL) ??
    "suporte@infiniteprofit.com.br",
  statusUrl: cleanValue(import.meta.env.VITE_STATUS_URL),
  legalEntityName:
    cleanValue(import.meta.env.VITE_LEGAL_ENTITY_NAME) ?? "Infinite Profit",
};
