import { describe, expect, it, vi } from "vitest";
import {
  isPermanentMetaCredentialError,
  listAccessibleMetaAdAccounts,
  MetaCredentialError,
  metaPullResultError,
  missingMetaAccountIds,
  validateMetaInsightsAccess,
} from "../../supabase/functions/_shared/meta-credentials";

describe("Meta credential validation", () => {
  it("validates the exact Insights capability without putting the token in the URL", async () => {
    const fetcher = vi.fn(async () =>
      new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    await expect(
      validateMetaInsightsAccess("123", "secret-token", fetcher),
    ).resolves.toEqual({
      accountId: "act_123",
      canReadInsights: true,
    });

    const [input, init] = fetcher.mock.calls[0];
    expect(String(input)).not.toContain("secret-token");
    expect(new Headers(init?.headers).get("Authorization")).toBe(
      "Bearer secret-token",
    );
  });

  it("maps expired tokens to an actionable permanent error", async () => {
    const fetcher = vi.fn(async () =>
      new Response(
        JSON.stringify({
          error: {
            message: "Session has expired",
            code: 190,
            error_subcode: 463,
          },
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        },
      )
    );

    const error = await validateMetaInsightsAccess(
      "act_123",
      "expired-token",
      fetcher,
    ).catch((caught) => caught);
    expect(error).toBeInstanceOf(MetaCredentialError);
    expect(error).toMatchObject({ code: "expired_token", httpStatus: 400 });
    expect(error.message).toContain("Token Meta expirado");
    expect(isPermanentMetaCredentialError(error)).toBe(true);
  });

  it("rejects tokens that cannot read advertising insights", async () => {
    const fetcher = vi.fn(async () =>
      new Response(
        JSON.stringify({
          error: {
            message: "Requires ads_management or ads_read permission",
            code: 200,
          },
        }),
        {
          status: 403,
          headers: { "Content-Type": "application/json" },
        },
      )
    );

    const error = await validateMetaInsightsAccess(
      "act_123",
      "limited-token",
      fetcher,
    ).catch((caught) => caught);
    expect(error).toMatchObject({
      code: "missing_ads_permission",
      httpStatus: 403,
    });
    expect(error.message).toContain("ads_read");
  });

  it("turns embedded Meta pull errors into worker failures", () => {
    expect(
      metaPullResultError({
        ok: true,
        results: [{ account_id: "act_123", error: "Session has expired" }],
      }),
    ).toBe("Session has expired");
    expect(
      metaPullResultError({
        ok: true,
        results: [{ account_id: "act_123", inserted: 0, dates: [] }],
      }),
    ).toBeNull();
    expect(metaPullResultError({ ok: true, results: [] })).toContain(
      "não confirmou",
    );
  });

  it("discovers accounts without exposing the token in the URL", async () => {
    const fetcher = vi.fn(async () =>
      new Response(
        JSON.stringify({
          data: [
            {
              id: "act_123",
              account_id: "123",
              name: "Conta principal",
              account_status: 1,
              currency: "BRL",
              timezone_name: "America/Sao_Paulo",
            },
          ],
          paging: {},
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      )
    );

    await expect(
      listAccessibleMetaAdAccounts("shared-secret", fetcher),
    ).resolves.toEqual([
      expect.objectContaining({
        account_id: "act_123",
        name: "Conta principal",
      }),
    ]);
    const [input, init] = fetcher.mock.calls[0];
    expect(String(input)).not.toContain("shared-secret");
    expect(new Headers(init?.headers).get("Authorization")).toBe(
      "Bearer shared-secret",
    );
  });

  it("blocks an atomic replacement when any configured account is missing", () => {
    expect(
      missingMetaAccountIds(
        ["act_1", "2", "act_3", "act_2"],
        ["act_1", "act_3"],
      ),
    ).toEqual(["act_2"]);
  });
});
