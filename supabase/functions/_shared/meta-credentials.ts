export type MetaCredentialFailureCode =
  | "expired_token"
  | "missing_ads_permission"
  | "invalid_token"
  | "account_access_denied"
  | "provider_error";

export type MetaAccessibleAdAccount = {
  id: string;
  account_id: string;
  name: string | null;
  account_status: number | null;
  currency: string | null;
  timezone: string | null;
};

export class MetaCredentialError extends Error {
  constructor(
    message: string,
    readonly code: MetaCredentialFailureCode,
    readonly httpStatus: number,
    readonly providerCode: number | null = null,
    readonly providerSubcode: number | null = null,
  ) {
    super(message);
    this.name = "MetaCredentialError";
  }
}

type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export async function listAccessibleMetaAdAccounts(
  accessToken: string,
  fetcher: FetchLike = fetch,
) {
  const token = String(accessToken ?? "").trim();
  if (!token) {
    throw new MetaCredentialError(
      "Token Meta é obrigatório.",
      "invalid_token",
      400,
    );
  }

  const accounts = new Map<string, MetaAccessibleAdAccount>();
  const baseUrl =
    "https://graph.facebook.com/v21.0/me/adaccounts?fields=id,account_id,name,account_status,currency,timezone_name&limit=200";
  let after: string | null = null;
  let hasNextPage = true;

  for (let page = 0; hasNextPage && page < 10; page += 1) {
    const url = new URL(baseUrl);
    if (after) url.searchParams.set("after", after);
    const response = await fetcher(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || hasMetaError(payload)) {
      throw metaCredentialErrorFromResponse(response.status, payload, token);
    }

    const rows = Array.isArray(
        (payload as { data?: unknown[] }).data,
      )
      ? (payload as { data: unknown[] }).data
      : [];
    for (const rawRow of rows) {
      if (!rawRow || typeof rawRow !== "object") continue;
      const row = rawRow as Record<string, unknown>;
      const rawId = stringOrNull(row.account_id) ?? stringOrNull(row.id);
      const accountId = normalizeMetaAccountId(rawId);
      if (!accountId) continue;
      accounts.set(accountId, {
        id: accountId,
        account_id: accountId,
        name: stringOrNull(row.name),
        account_status: finiteNumberOrNull(row.account_status),
        currency: stringOrNull(row.currency),
        timezone: stringOrNull(row.timezone_name),
      });
    }

    const paging = payload && typeof payload === "object"
      ? (payload as { paging?: unknown }).paging
      : null;
    const pagingRecord = paging && typeof paging === "object"
      ? paging as Record<string, unknown>
      : null;
    const cursors = pagingRecord?.cursors &&
        typeof pagingRecord.cursors === "object"
      ? pagingRecord.cursors as Record<string, unknown>
      : null;
    after = stringOrNull(cursors?.after);
    hasNextPage = Boolean(pagingRecord?.next && after);
  }

  return [...accounts.values()].sort((left, right) =>
    String(left.name ?? left.account_id).localeCompare(
      String(right.name ?? right.account_id),
      "pt-BR",
    )
  );
}

export function missingMetaAccountIds(
  configuredAccountIds: Iterable<unknown>,
  accessibleAccountIds: Iterable<unknown>,
) {
  const accessible = new Set(
    [...accessibleAccountIds]
      .map(normalizeMetaAccountId)
      .filter((value): value is string => Boolean(value)),
  );
  return [...new Set(
    [...configuredAccountIds]
      .map(normalizeMetaAccountId)
      .filter((value): value is string => Boolean(value)),
  )].filter((accountId) => !accessible.has(accountId));
}

export function isPermanentMetaCredentialError(error: unknown) {
  return error instanceof MetaCredentialError &&
    error.code !== "provider_error";
}

export async function validateMetaInsightsAccess(
  accountId: string,
  accessToken: string,
  fetcher: FetchLike = fetch,
) {
  const normalizedAccountId = normalizeMetaAccountId(accountId);
  const token = String(accessToken ?? "").trim();
  if (!normalizedAccountId || !token) {
    throw new MetaCredentialError(
      "Conta e token Meta são obrigatórios.",
      "invalid_token",
      400,
    );
  }

  const url = new URL(
    `https://graph.facebook.com/v21.0/${normalizedAccountId}/insights`,
  );
  url.searchParams.set("fields", "spend");
  url.searchParams.set("date_preset", "last_7d");
  url.searchParams.set("level", "account");
  url.searchParams.set("limit", "1");

  const response = await fetcher(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || hasMetaError(payload)) {
    throw metaCredentialErrorFromResponse(response.status, payload, token);
  }

  return {
    accountId: normalizedAccountId,
    canReadInsights: true as const,
  };
}

export function metaCredentialErrorFromResponse(
  httpStatus: number,
  payload: unknown,
  accessToken = "",
) {
  const error = metaErrorRecord(payload);
  const providerCode = finiteNumberOrNull(error?.code);
  const providerSubcode = finiteNumberOrNull(error?.error_subcode);
  const providerMessage = safeProviderMessage(error?.message, accessToken);
  const normalizedMessage = providerMessage.toLowerCase();

  if (
    providerCode === 190 &&
    (
      providerSubcode === 463 ||
      normalizedMessage.includes("session has expired") ||
      normalizedMessage.includes("access token has expired")
    )
  ) {
    return new MetaCredentialError(
      "Token Meta expirado. Gere um novo token com ads_read (ou ads_management) e tente novamente.",
      "expired_token",
      httpStatus,
      providerCode,
      providerSubcode,
    );
  }

  if (
    providerCode === 200 &&
    (
      normalizedMessage.includes("ads_management") ||
      normalizedMessage.includes("ads_read")
    )
  ) {
    return new MetaCredentialError(
      "Esta credencial não consegue ler investimento. Conceda ads_read (ou ads_management) e acesso a esta conta de anúncios.",
      "missing_ads_permission",
      httpStatus,
      providerCode,
      providerSubcode,
    );
  }

  if (
    providerCode === 190 ||
    normalizedMessage.includes("invalid oauth access token") ||
    normalizedMessage.includes("error validating access token")
  ) {
    return new MetaCredentialError(
      "Token Meta inválido. Gere uma nova credencial e tente novamente.",
      "invalid_token",
      httpStatus,
      providerCode,
      providerSubcode,
    );
  }

  if (
    providerCode === 200 ||
    providerCode === 10 ||
    normalizedMessage.includes("does not have permission") ||
    normalizedMessage.includes("unsupported get request")
  ) {
    return new MetaCredentialError(
      "A credencial não tem acesso a esta conta de anúncios. Revise os ativos e as permissões no Meta Business.",
      "account_access_denied",
      httpStatus,
      providerCode,
      providerSubcode,
    );
  }

  const suffix = providerMessage ? `: ${providerMessage}` : "";
  return new MetaCredentialError(
    `Não foi possível validar a leitura de investimento na Meta${suffix}`,
    "provider_error",
    httpStatus,
    providerCode,
    providerSubcode,
  );
}

export function metaPullResultError(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    return "Meta retornou uma resposta inválida.";
  }

  const rows = Array.isArray((payload as { results?: unknown }).results)
    ? (payload as { results: unknown[] }).results
    : [];
  const errors = rows
    .filter((row): row is Record<string, unknown> =>
      Boolean(row && typeof row === "object" && "error" in row)
    )
    .map((row) => String(row.error ?? "").trim())
    .filter(Boolean);

  if (errors.length > 0) return errors.slice(0, 3).join(" | ");

  const hasCompletedWork = rows.some((row) =>
    Boolean(
      row &&
        typeof row === "object" &&
        typeof (row as Record<string, unknown>).inserted === "number",
    )
  );
  if (!hasCompletedWork) {
    return "Meta não confirmou a sincronização da conta solicitada.";
  }

  return null;
}

export function normalizeMetaAccountId(value: unknown) {
  const accountId = String(value ?? "").trim();
  if (!accountId) return null;
  return accountId.startsWith("act_") ? accountId : `act_${accountId}`;
}

function hasMetaError(payload: unknown) {
  return Boolean(
    payload &&
      typeof payload === "object" &&
      (payload as Record<string, unknown>).error,
  );
}

function metaErrorRecord(payload: unknown) {
  if (!payload || typeof payload !== "object") return null;
  const error = (payload as Record<string, unknown>).error;
  return error && typeof error === "object"
    ? error as Record<string, unknown>
    : null;
}

function safeProviderMessage(value: unknown, accessToken: string) {
  let message = String(value ?? "")
    .replace(/[\r\n\t]+/g, " ")
    .trim()
    .slice(0, 300);
  if (accessToken) message = message.split(accessToken).join("[redacted]");
  return message;
}

function finiteNumberOrNull(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function stringOrNull(value: unknown) {
  const trimmed = String(value ?? "").trim();
  return trimmed ? trimmed : null;
}
