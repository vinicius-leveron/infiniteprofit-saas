import { describe, expect, it } from "vitest";
import { edgeFunctionErrorMessage } from "@/lib/edgeFunctionError";

describe("edgeFunctionErrorMessage", () => {
  it("returns the useful JSON error from an Edge Function response", async () => {
    const response = Response.json(
      { error: "Somente um Owner pode conceder o papel Owner." },
      { status: 403 },
    );
    const error = Object.assign(new Error("Edge Function returned a non-2xx status code"), {
      context: response,
    });

    await expect(
      edgeFunctionErrorMessage(error, "Falha ao administrar equipe."),
    ).resolves.toBe("Somente um Owner pode conceder o papel Owner.");
  });

  it("replaces the generic SDK error when the response is not JSON", async () => {
    const error = Object.assign(new Error("Edge Function returned a non-2xx status code"), {
      context: new Response("upstream failure", { status: 500 }),
    });

    await expect(
      edgeFunctionErrorMessage(error, "Falha ao administrar equipe."),
    ).resolves.toBe("Falha ao administrar equipe.");
  });
});
