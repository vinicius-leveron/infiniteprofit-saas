export type HotmartCredentialDraft = {
  clientId: string;
  clientSecret: string;
  basicToken: string;
};

export function normalizeHotmartBasicTokenInput(value: string) {
  let token = value.trim();
  if (
    token.length >= 2
    && (
      (token.startsWith('"') && token.endsWith('"'))
      || (token.startsWith("'") && token.endsWith("'"))
    )
  ) {
    token = token.slice(1, -1).trim();
  }

  token = token.replace(/^authorization\s*:\s*/i, "").trim();
  if (/^bearer(?:\s|$)/i.test(token)) return "";
  token = token.replace(/^basic(?:\s+|$)/i, "").replace(/\s+/g, "");

  return token ? `Basic ${token}` : "";
}

export function validateHotmartCredentialDraft(
  draft: HotmartCredentialDraft,
) {
  if (!draft.clientId.trim()) return "Informe o Client ID.";
  if (!draft.clientSecret.trim()) return "Informe o Client Secret.";
  if (!draft.basicToken.trim()) return "Informe o Token Basic.";

  const normalizedBasicToken = normalizeHotmartBasicTokenInput(
    draft.basicToken,
  );
  if (!normalizedBasicToken) {
    return "Use o Token Basic da credencial, não um Access Token ou Bearer token.";
  }

  const token = normalizedBasicToken.slice("Basic ".length);
  if (token.length < 8 || !/^[A-Za-z0-9+/_=-]+$/.test(token)) {
    return "O Token Basic parece incompleto. Copie o valor inteiro em Credenciais Developers.";
  }

  return null;
}
