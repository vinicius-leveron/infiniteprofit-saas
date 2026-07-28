import { describe, expect, it } from "vitest";
import {
  boundedHotmartDateRange,
  hotmartEventForStatus,
  hotmartRangeEpoch,
  splitHotmartWindows,
} from "../../supabase/functions/hotmart-sync/core";

describe("Hotmart sync core", () => {
  it("defaults to 90 days and splits work into windows of at most seven days", () => {
    const range = boundedHotmartDateRange({
      now: new Date("2026-07-28T15:00:00.000Z"),
    });
    const windows = splitHotmartWindows(range.startDate, range.endDate);

    expect(range).toEqual({
      startDate: "2026-04-30",
      endDate: "2026-07-28",
      totalDays: 90,
    });
    expect(windows).toHaveLength(13);
    expect(windows[0]).toEqual({
      startDate: "2026-04-30",
      endDate: "2026-05-06",
    });
    expect(windows.at(-1)).toEqual({
      startDate: "2026-07-23",
      endDate: "2026-07-28",
    });
  });

  it("rejects backfills longer than 365 days", () => {
    expect(() =>
      boundedHotmartDateRange({
        startDate: "2025-01-01",
        endDate: "2026-01-01",
      }),
    ).toThrow(/365 dias/);
  });

  it("maps sales API statuses to the same webhook event vocabulary", () => {
    expect(hotmartEventForStatus("APPROVED")).toBe("PURCHASE_APPROVED");
    expect(hotmartEventForStatus("PARTIALLY_REFUNDED")).toBe(
      "PURCHASE_PARTIALLY_REFUNDED",
    );
    expect(hotmartEventForStatus("CHARGEBACK")).toBe("PURCHASE_CHARGEBACK");
    expect(hotmartEventForStatus("PROTESTED")).toBe("PURCHASE_PROTEST");
    expect(hotmartEventForStatus("WAITING_PAYMENT")).toBe(
      "PURCHASE_BILLET_PRINTED",
    );
    expect(hotmartEventForStatus("UNKNOWN")).toBeNull();
  });

  it("uses São Paulo day boundaries for Hotmart API epoch filters", () => {
    const range = hotmartRangeEpoch("2026-07-01", "2026-07-01");
    expect(new Date(range.start).toISOString()).toBe(
      "2026-07-01T03:00:00.000Z",
    );
    expect(new Date(range.end).toISOString()).toBe(
      "2026-07-02T02:59:59.999Z",
    );
  });
});
