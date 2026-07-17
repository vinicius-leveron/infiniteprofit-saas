import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AsyncState } from "./AsyncState";

describe("AsyncState", () => {
  it("keeps failures distinct from empty data and offers retry", () => {
    const retry = vi.fn();
    const { rerender } = render(
      <AsyncState status="error" errorMessage="Consulta indisponível" onRetry={retry}>
        <p>Conteúdo</p>
      </AsyncState>,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("Consulta indisponível");
    fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
    expect(retry).toHaveBeenCalledOnce();

    rerender(
      <AsyncState
        status="empty"
        emptyTitle="Nenhum cliente"
        emptyDescription="Crie o primeiro cliente."
      >
        <p>Conteúdo</p>
      </AsyncState>,
    );
    expect(screen.getByRole("heading", { name: "Nenhum cliente" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
