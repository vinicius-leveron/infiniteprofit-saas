import { describe, expect, it } from "vitest";
import { correlateAdFunnel } from "./adFunnelCorrelation";

describe("correlateAdFunnel", () => {
  it("uses Meta link clicks and VTurb VSL rates when correlated by ad id", () => {
    const result = correlateAdFunnel({
      metaEvents: [{
        payload: {
          ad_id: "ad-1",
          ad_name: "Creative A",
          campaign_id: "campaign-1",
          campaign_name: "Campaign",
          adset_id: "adset-1",
          adset_name: "Adset",
          spend: 100,
          impressions: 1000,
          clicks: 99,
          actions: [{ action_type: "link_click", value: "10" }],
        },
      }],
      vturbEvents: [{
        payload: {
          utm_content: "ad-1",
          pageviews: 20,
          plays: 10,
          pitch_reached: 5,
        },
      }],
      gatewayEvents: [
        { event_type: "checkout_created", payload: { utm_content: "ad-1" } },
        { event_type: "purchase.approved", payload: { utm_content: "ad-1", total: 250 } },
      ],
    });

    expect(result.ads).toHaveLength(1);
    expect(result.ads[0]).toMatchObject({
      id: "ad-1",
      clicks: 10,
      vturb_pageviews: 20,
      vturb_plays: 10,
      vturb_pitch_reached: 5,
      gateway_checkouts: 1,
      gateway_purchases: 1,
      gateway_revenue: 250,
    });
    expect(result.ads[0].cpc).toBe(10);
    expect(result.ads[0].ctr).toBe(1);
    expect(result.ads[0].play_rate).toBe(50);
    expect(result.ads[0].pitch_retention).toBe(50);
    expect(result.ads[0].real_roas).toBe(2.5);
  });

  it("falls back to outbound clicks and click-to-view when VTurb pageviews are absent", () => {
    const result = correlateAdFunnel({
      metaEvents: [{
        payload: {
          ad_id: "ad-2",
          spend: 50,
          impressions: 500,
          clicks: 80,
          outbound_clicks: [{ action_type: "outbound_click", value: "25" }],
        },
      }],
      vturbEvents: [{
        payload: {
          utm_content: "ad-2",
          views: 5,
          pitch_reached: 2,
        },
      }],
      gatewayEvents: [],
    });

    expect(result.ads[0].clicks).toBe(25);
    expect(result.ads[0].play_rate).toBe(20);
    expect(result.ads[0].pitch_retention).toBe(40);
  });

  it("matches current VTurb traffic-origin fields when UTM content contains the ad id", () => {
    const result = correlateAdFunnel({
      metaEvents: [{
        payload: {
          ad_id: "238500123",
          spend: 100,
          impressions: 1000,
          actions: [{ action_type: "link_click", value: 40 }],
        },
      }],
      vturbEvents: [{
        payload: {
          query_key: "utm_content",
          grouped_field: "denise-238500123-feed",
          total_viewed_session_uniq: 30,
          total_started_session_uniq: 18,
          total_over_pitch: 9,
        },
      }],
      gatewayEvents: [],
    });

    expect(result.ads[0].play_rate).toBe(60);
    expect(result.ads[0].pitch_retention).toBe(50);
    expect(result.ads[0].has_vturb_data).toBe(true);
  });
});
