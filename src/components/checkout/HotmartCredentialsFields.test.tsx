import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { HotmartCredentialsFields } from "@/components/checkout/HotmartCredentialsFields";

describe("HotmartCredentialsFields", () => {
  it("guides production credential setup and keeps values hidden by default", () => {
    render(
      <HotmartCredentialsFields
        idPrefix="test-hotmart"
        clientId="client-id"
        clientSecret="client-secret"
        basicToken="Basic YWJjZGVmZ2g="
        onClientIdChange={vi.fn()}
        onClientSecretChange={vi.fn()}
        onBasicTokenChange={vi.fn()}
      />,
    );

    expect(screen.getByText(/Sandbox desmarcado/)).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /instruções oficiais/i }),
    ).toHaveAttribute(
      "href",
      "https://developers.hotmart.com/docs/pt-BR/start/app-auth/",
    );

    const clientSecret = screen.getByLabelText("Client Secret");
    expect(clientSecret).toHaveAttribute("type", "password");
    fireEvent.click(
      screen.getByRole("button", { name: "Mostrar Client Secret" }),
    );
    expect(clientSecret).toHaveAttribute("type", "text");
  });
});
