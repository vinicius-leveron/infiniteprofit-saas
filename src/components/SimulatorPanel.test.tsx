import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DailyRow } from "@/lib/csv";
import { SimulatorPanel } from "./SimulatorPanel";

class ResizeObserverMock {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}

globalThis.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver;

type SimulationRow = {
  id: string;
  name: string | null;
  inputs: Record<string, unknown>;
  result: Record<string, unknown>;
  created_at: string;
};

let historyRows: SimulationRow[] = [];
let lastInsertedPayload: Record<string, unknown> | null = null;

const makeSimulationRow = (overrides: Partial<SimulationRow> = {}): SimulationRow => ({
  id: "sim-history-1",
  name: "Cenario salvo",
  created_at: "2026-07-10T12:00:00Z",
  inputs: {
    schemaVersion: 2,
    actualInputs: {
      ticketFront: 100,
      ticketBump: 100,
      ticketUpsell: 0,
      takeRateBump: 20,
      takeRateUpsell: 0,
      impressoes: 100000,
      investimento: 3500,
      ctr: 1,
      connectRate: 80,
      playRate: 50,
      pitchRet: 20,
      pitchChk: 200,
      chkVenda: 10,
    },
    projectedInputs: {
      ticketFront: 100,
      ticketBump: 100,
      ticketUpsell: 0,
      takeRateBump: 20,
      takeRateUpsell: 0,
      impressoes: 100000,
      investimento: 13000,
      ctr: 1,
      connectRate: 80,
      playRate: 50,
      pitchRet: 20,
      pitchChk: 200,
      chkVenda: 10,
    },
  },
  result: {},
  ...overrides,
});

function createSimulationQuery() {
  const query = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    insert: vi.fn((payload: Record<string, unknown>) => {
      lastInsertedPayload = payload;
      const row = makeSimulationRow({
        id: "sim-new",
        name: (payload.name as string | null) ?? null,
        inputs: payload.inputs as Record<string, unknown>,
        result: payload.result as Record<string, unknown>,
        created_at: "2026-07-10T13:00:00Z",
      });
      historyRows = [row, ...historyRows.filter((item) => item.id !== row.id)];
      return {
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: row, error: null }),
      };
    }),
    delete: vi.fn(() => ({
      eq: vi.fn().mockResolvedValue({ error: null }),
    })),
    then(onFulfilled: (value: { data: SimulationRow[]; error: null }) => unknown, onRejected?: (reason: unknown) => unknown) {
      return Promise.resolve({ data: historyRows, error: null }).then(onFulfilled, onRejected);
    },
  };
  return query;
}

vi.mock("@/hooks/useWorkspace", () => ({
  useWorkspace: () => ({ currentWorkspace: { id: "workspace-1" } }),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } }, error: null }),
    },
    from: vi.fn(() => createSimulationQuery()),
  },
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

const rows: DailyRow[] = [
  {
    data: "01/07/2026",
    date: new Date(2026, 6, 1),
    diaSemana: "quarta-feira",
    investimento: 1000,
    vendasFront: 10,
    vendasTotais: 13,
    cpaFront: null,
    fatBruto: 2000,
    fatLiquido: 1800,
    impostoMeta: 121.5,
    roi: null,
    lucro: null,
    cac: null,
    aov: null,
    fatFront: 1000,
    fatOrderbump: 500,
    fatFunil: 1500,
    reembolsos: 0,
    taxaReembolso: null,
    valorReembolsado: 0,
    aprovCartao: null,
    aprovPix: null,
    impressoes: 100000,
    cliques: 1000,
    landingPageviews: 800,
    pageviews: 500,
    checkouts: 100,
    cpm: null,
    ctr: null,
    cpc: null,
    custoPageview: null,
    custoIC: null,
    taxaCarreg: null,
    passChk: null,
    playRate: 50,
    retPitch: null,
    viewsUnicas: 1000,
    playsUnicos: 250,
    chegaramPitch: 50,
    pitchChk: null,
    pitchVenda: null,
    chkVenda: null,
    obs: "",
    convGeralOrderbump: null,
    proporcaoFunilFront: null,
    bumps: [
      { name: "Bump", type: "orderbump", count: 2, revenue: 200, rate: 20 },
      { name: "Upsell", type: "upsell", count: 1, revenue: 300, rate: 10 },
    ],
  },
];

function renderSimulator() {
  const view = render(
    <MemoryRouter initialEntries={["/dashboard?project=project-1"]}>
      <SimulatorPanel rows={rows} />
    </MemoryRouter>,
  );

  const numberInputs = () => Array.from(view.container.querySelectorAll<HTMLInputElement>("input[type='number']"));

  return { ...view, numberInputs };
}

describe("SimulatorPanel", () => {
  beforeEach(() => {
    historyRows = [];
    lastInsertedPayload = null;
    window.localStorage.clear();
    vi.clearAllMocks();
  });

  it("keeps current and simulated acquisition fields independent", () => {
    const { numberInputs } = renderSimulator();

    const currentInvestment = numberInputs()[4];
    const projectedInvestment = numberInputs()[9];

    expect(currentInvestment.value).toBe("1000");
    expect(projectedInvestment.value).toBe("1000");

    fireEvent.change(currentInvestment, { target: { value: "3500" } });

    expect(currentInvestment.value).toBe("3500");
    expect(projectedInvestment.value).toBe("1000");
  });

  it("infers order bump and upsell tickets from their own product sales", () => {
    const { numberInputs } = renderSimulator();

    expect(numberInputs()[1].value).toBe("100");
    expect(numberInputs()[2].value).toBe("300");
    expect(screen.getByText("ROAS")).toBeInTheDocument();
  });

  it("saves current and simulated scenarios in history and restores both", async () => {
    const { numberInputs } = renderSimulator();

    fireEvent.change(numberInputs()[4], { target: { value: "3500" } });
    fireEvent.change(numberInputs()[9], { target: { value: "13000" } });

    fireEvent.click(screen.getAllByRole("button", { name: /Salvar/i })[0]);
    fireEvent.click(screen.getAllByRole("button", { name: /Salvar/i }).at(-1)!);

    await waitFor(() => {
      expect(lastInsertedPayload).not.toBeNull();
    });

    expect(lastInsertedPayload?.inputs).toMatchObject({
      actualInputs: { investimento: 3500 },
      projectedInputs: { investimento: 13000 },
    });
    expect(lastInsertedPayload?.result).toMatchObject({
      actualInputs: { investimento: 3500 },
      projectedInputs: { investimento: 13000 },
    });

    fireEvent.change(numberInputs()[4], { target: { value: "777" } });
    fireEvent.change(numberInputs()[9], { target: { value: "888" } });

    fireEvent.click(screen.getByRole("button", { name: /Historico/i }));
    fireEvent.click(await screen.findByRole("button", { name: /Carregar/i }));

    await waitFor(() => {
      expect(numberInputs()[4].value).toBe("3500");
      expect(numberInputs()[9].value).toBe("13000");
    });
  });

  it("restores the last saved scenario after refresh", async () => {
    const first = renderSimulator();

    fireEvent.change(first.numberInputs()[4], { target: { value: "3500" } });
    fireEvent.change(first.numberInputs()[9], { target: { value: "13000" } });

    fireEvent.click(screen.getAllByRole("button", { name: /Salvar/i })[0]);
    fireEvent.click(screen.getAllByRole("button", { name: /Salvar/i }).at(-1)!);

    await waitFor(() => {
      expect(lastInsertedPayload).not.toBeNull();
    });

    first.unmount();

    const second = renderSimulator();

    await waitFor(() => {
      expect(second.numberInputs()[4].value).toBe("3500");
      expect(second.numberInputs()[9].value).toBe("13000");
    });
  });
});
