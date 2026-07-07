import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { supabase } from "@/integrations/supabase/client";
import { AdsPanel } from "./AdsPanel";

const tableData: Record<string, unknown> = {
  projects: { workspace_id: "workspace-1" },
  creative_assets: [
    {
      id: "asset-1",
      creative_id: "creative-1",
      asset_key: "video:123",
      media_type: "video",
      thumbnail_url: "https://example.com/asset.jpg",
      media_storage_path: null,
      headline: "Hook criativo forte",
      primary_text: "Copy principal",
      cta: "Saiba mais",
      landing_url: "https://example.com",
      analysis_status: "ready",
      last_meta_synced_at: "2026-06-03T12:00:00Z",
      source_media_url: "https://example.com/asset.mp4",
      source_fetched_at: "2026-06-03T12:00:00Z",
      media_bytes: 1024,
      media_duration_ms: 12000,
      media_fingerprint: "fingerprint-1",
      poster_storage_path: "project/poster.jpg",
      last_processed_at: "2026-06-03T12:00:00Z",
      processing_version: "creative-sync-v2",
    },
  ],
  creative_asset_ads: [
    {
      asset_id: "asset-1",
      ad_id: "ad-1",
      ad_name: "Anúncio 1",
      adset_id: "adset-1",
      adset_name: "Adset Escala",
      campaign_id: "camp-1",
      campaign_name: "Campanha Escala",
    },
  ],
  creative_asset_daily_metrics: [
    {
      asset_id: "asset-1",
      event_date: "2026-06-01",
      spend: 100,
      impressions: 1000,
      clicks: 30,
      outbound_clicks: 15,
      ctr: 3,
      link_ctr: 1.5,
      cpm: 100,
      purchases: 4,
      revenue: 320,
      roas: 3.2,
      cpa: 25,
      hook_rate: 40,
      has_meta_data: true,
      has_gateway_data: true,
    },
  ],
  creative_asset_analysis: [
    {
      asset_id: "asset-1",
      status: "ready",
      transcript_status: "ready",
      transcript: "Transcrição pronta",
      transcript_segments: [{ start_ms: 0, end_ms: 1000, text: "Transcrição pronta" }],
      transcript_language: "pt",
      transcript_provider: "openai",
      transcript_model: "gpt-4o-mini-transcribe",
      transcript_error_message: null,
      summary: "Resumo do criativo",
      hook: "Hook",
      hook_timestamps: [{ start_ms: 0, end_ms: 1000, label: "Abertura", reason: "Promessa forte" }],
      angle: "Ângulo",
      copy: "Copy",
      cta: "CTA",
      visual: "Visual",
      visual_evidence: [{ timestamp_ms: 0, observation: "Close no rosto" }],
      tags: ["hook"],
      scores: { hook: 90 },
      analysis_coverage: "full",
      analysis_error_message: null,
      error_message: null,
      processed_at: "2026-06-03T12:00:00Z",
    },
  ],
  creative_groups: [],
  sync_runs: [
    {
      source: "creative",
      status: "succeeded",
      error_message: null,
      created_at: "2026-06-03T12:30:00Z",
    },
  ],
};

function createQuery(tableName: string) {
  const response = { data: tableData[tableName] ?? [], error: null };
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({
      data: Array.isArray(response.data) ? response.data[0] ?? null : response.data,
      error: null,
    }),
    single: vi.fn().mockResolvedValue({
      data: Array.isArray(response.data) ? response.data[0] ?? null : response.data,
      error: null,
    }),
    then(onFulfilled: (value: typeof response) => unknown, onRejected?: (reason: unknown) => unknown) {
      return Promise.resolve(response).then(onFulfilled, onRejected);
    },
  };
}

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "user-1" } }),
}));

vi.mock("@/components/ads/AdsFunnelView", () => ({
  AdsFunnelView: ({ dateRange }: { dateRange?: { from: string | null; to: string | null } }) => (
    <div data-testid="funnel-range">
      Funil mockado {dateRange?.from} {dateRange?.to}
    </div>
  ),
}));

vi.mock("@/components/ads/AdsPathsView", () => ({
  AdsPathsView: ({ dateRange }: { dateRange?: { from: string | null; to: string | null } }) => (
    <div data-testid="paths-range">
      Caminhos mockado {dateRange?.from} {dateRange?.to}
    </div>
  ),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: vi.fn((tableName: string) => createQuery(tableName)),
    functions: {
      invoke: vi.fn().mockResolvedValue({ data: { ok: true }, error: null }),
    },
  },
}));

describe("AdsPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("defaults to cards view, expands analysis, and switches to funnel", async () => {
    render(<AdsPanel projectId="project-1" dateRange={{ from: "2026-06-01", to: "2026-06-03" }} />);

    await waitFor(() => {
      expect(screen.getByText("Hook criativo forte")).toBeInTheDocument();
    });

    expect(screen.getByRole("button", { name: "Cards" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Funil" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Detalhes/i }));
    expect(screen.getByRole("tab", { name: "Resumo" })).toBeInTheDocument();
    expect(screen.getByText("Resumo do criativo")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Transcrição" })).toBeInTheDocument();
    expect(screen.getByText(/Abertura/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Funil" }));
    expect(screen.getByText(/Funil mockado/)).toBeInTheDocument();
    expect(screen.getByTestId("funnel-range")).toHaveTextContent("2026-06-01 2026-06-03");
  });

  it("syncs creative inventory without enqueueing analysis", async () => {
    render(<AdsPanel projectId="project-1" dateRange={{ from: "2026-06-01", to: "2026-06-03" }} />);

    await waitFor(() => {
      expect(screen.getByText("Hook criativo forte")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /Sincronizar/i }));

    await waitFor(() => {
      expect(supabase.functions.invoke).toHaveBeenCalledWith("creative-sync", {
        body: {
          project_id: "project-1",
          days: 30,
          enqueue_analysis: false,
        },
      });
    });
  });

  it("queues analysis from the card action", async () => {
    render(<AdsPanel projectId="project-1" dateRange={{ from: "2026-06-01", to: "2026-06-03" }} />);

    await waitFor(() => {
      expect(screen.getByText("Hook criativo forte")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /Reanalisar/i }));

    await waitFor(() => {
      expect(supabase.functions.invoke).toHaveBeenCalledWith("creative-sync", {
        body: {
          project_id: "project-1",
          asset_id: "asset-1",
          reprocess: true,
          reprocess_scope: "analysis",
          enqueue_analysis: true,
        },
      });
    });
  });
});
