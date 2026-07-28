/* eslint-disable @typescript-eslint/no-explicit-any */
// deno-lint-ignore-file no-explicit-any

export type HotmartCredential = {
  access_token: string;
  client_id?: string | null;
  client_secret?: string | null;
  basic_token?: string | null;
  token_type?: string | null;
  expires_at?: string | null;
  scope?: string | null;
};

export class HotmartApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "HotmartApiError";
  }
}

type SupabaseLike = {
  rpc: (
    name: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { message?: string } | null }>;
};

const DEFAULT_TOKEN_URL =
  "https://api-sec-vlc.hotmart.com/security/oauth/token";

export async function readHotmartCredential(
  sb: SupabaseLike,
  integrationId: string,
) {
  const { data, error } = await sb.rpc("read_checkout_integration_secret", {
    _integration_id: integrationId,
    _kind: "credential",
  });
  if (error) throw new Error(error.message ?? "Falha ao ler credencial Hotmart");
  if (typeof data !== "string" || !data.trim()) {
    throw new HotmartApiError(
      "A conta Hotmart precisa ser reconectada.",
      401,
      false,
    );
  }

  try {
    const credential = JSON.parse(data) as HotmartCredential;
    if (!credential.access_token) throw new Error("missing token");
    return credential;
  } catch {
    throw new HotmartApiError(
      "A credencial Hotmart armazenada é inválida.",
      401,
      false,
    );
  }
}

export async function storeHotmartCredential(
  sb: SupabaseLike,
  integrationId: string,
  credential: HotmartCredential,
) {
  const { error } = await sb.rpc("store_checkout_integration_secret", {
    _integration_id: integrationId,
    _kind: "credential",
    _secret: JSON.stringify(credential),
  });
  if (error) throw new Error(error.message ?? "Falha ao salvar credencial Hotmart");
}

export async function hotmartAccessToken(
  sb: SupabaseLike,
  integrationId: string,
  forceRefresh = false,
) {
  const credential = await readHotmartCredential(sb, integrationId);
  const expiresAt = Date.parse(credential.expires_at ?? "");
  if (
    !forceRefresh
    && credential.access_token
    && (!Number.isFinite(expiresAt) || expiresAt > Date.now() + 60_000)
  ) {
    return credential.access_token;
  }

  if (
    credential.client_id
    && credential.client_secret
    && credential.basic_token
  ) {
    const refreshed = await exchangeHotmartToken({
      grantType: "client_credentials",
      clientId: credential.client_id,
      clientSecret: credential.client_secret,
      basicToken: credential.basic_token,
    });
    await storeHotmartCredential(sb, integrationId, {
      ...credential,
      ...refreshed,
      client_id: credential.client_id,
      client_secret: credential.client_secret,
      basic_token: credential.basic_token,
    });
    return refreshed.access_token;
  }

  throw new HotmartApiError(
    "A autorização Hotmart expirou. Reconecte a conta.",
    401,
    false,
  );
}

export async function authorizeHotmartClientCredentials(args: {
  clientId: string;
  clientSecret: string;
  basicToken: string;
}) {
  const token = await exchangeHotmartToken({
    grantType: "client_credentials",
    clientId: args.clientId,
    clientSecret: args.clientSecret,
    basicToken: args.basicToken,
  });
  return {
    ...token,
    client_id: args.clientId,
    client_secret: args.clientSecret,
    basic_token: args.basicToken,
  } satisfies HotmartCredential;
}

async function exchangeHotmartToken(args: {
  grantType: "client_credentials";
  clientId: string;
  clientSecret: string;
  basicToken: string;
}) {
  const tokenUrl = Deno.env.get("HOTMART_OAUTH_TOKEN_URL") || DEFAULT_TOKEN_URL;
  const basicValue = args.basicToken;
  const url = new URL(tokenUrl);
  url.searchParams.set("grant_type", args.grantType);
  url.searchParams.set("client_id", args.clientId);
  url.searchParams.set("client_secret", args.clientSecret);

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: basicValue.startsWith("Basic ")
        ? basicValue
        : `Basic ${basicValue}`,
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.access_token) {
    throw new HotmartApiError(
      response.status === 401
        ? "A Hotmart recusou a autorização."
        : "Não foi possível concluir a autorização Hotmart.",
      response.status,
      response.status >= 500,
    );
  }

  const expiresIn = Number(payload.expires_in);
  return {
    access_token: String(payload.access_token),
    token_type: payload.token_type ? String(payload.token_type) : "bearer",
    scope: payload.scope ? String(payload.scope) : null,
    expires_at: Number.isFinite(expiresIn)
      ? new Date(Date.now() + expiresIn * 1000).toISOString()
      : null,
  } satisfies HotmartCredential;
}

export async function hotmartApiJson<T>(
  url: string | URL,
  accessToken: string,
  options: { attempts?: number } = {},
): Promise<{ data: T; headers: Headers }> {
  const attempts = Math.max(1, Math.min(options.attempts ?? 4, 6));
  let lastError: HotmartApiError | null = null;

  for (let attempt = 0; attempt < attempts; attempt++) {
    let response: Response;
    try {
      response = await fetch(url, {
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
      });
    } catch {
      lastError = new HotmartApiError(
        "Falha temporária ao acessar a Hotmart.",
        503,
        true,
      );
      await retryDelay(attempt, null);
      continue;
    }

    if (response.ok) {
      return {
        data: await response.json() as T,
        headers: response.headers,
      };
    }

    const payload = await response.json().catch(() => ({}));
    const message = publicHotmartError(response.status, payload);
    const retryable =
      response.status === 429
      || response.status === 502
      || response.status === 503
      || response.status === 504;
    lastError = new HotmartApiError(message, response.status, retryable);
    if (!retryable || attempt === attempts - 1) throw lastError;
    await retryDelay(attempt, response.headers);
  }

  throw lastError ?? new HotmartApiError(
    "Falha ao acessar a Hotmart.",
    500,
    false,
  );
}

function publicHotmartError(status: number, payload: any) {
  if (status === 401) return "A autorização Hotmart expirou.";
  if (status === 403) return "A conta Hotmart não autorizou este recurso.";
  if (status === 429) return "A Hotmart limitou temporariamente as consultas.";
  if (status >= 500) return "A Hotmart está temporariamente indisponível.";
  const description = String(
    payload?.error_description ?? payload?.message ?? "",
  ).trim();
  return description || "A Hotmart recusou a consulta.";
}

async function retryDelay(attempt: number, headers: Headers | null) {
  const resetSeconds = Number(
    headers?.get("RateLimit-Reset")
      ?? headers?.get("X-RateLimit-Reset")
      ?? "",
  );
  const waitMs = Number.isFinite(resetSeconds) && resetSeconds > 0
    ? Math.min(resetSeconds * 1000, 15_000)
    : Math.min(500 * 2 ** attempt, 8_000);
  await new Promise((resolve) => setTimeout(resolve, waitMs));
}
