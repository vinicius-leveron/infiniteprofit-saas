import { describe, expect, it } from "vitest";
import { getProjectMetaBindingChanges } from "./projectMetaBindings";

describe("getProjectMetaBindingChanges", () => {
  it("adds newly selected accounts without removing saved selections", () => {
    expect(getProjectMetaBindingChanges(["meta-1", "meta-2"], ["meta-1"])).toEqual({
      nextIds: ["meta-1", "meta-2"],
      idsToAdd: ["meta-2"],
      idsToRemove: [],
    });
  });

  it("removes only accounts that were explicitly deselected", () => {
    expect(getProjectMetaBindingChanges(["meta-2"], ["meta-1", "meta-2"])).toEqual({
      nextIds: ["meta-2"],
      idsToAdd: [],
      idsToRemove: ["meta-1"],
    });
  });

  it("deduplicates selected account ids before persisting", () => {
    expect(getProjectMetaBindingChanges(["meta-1", "meta-1"], [])).toEqual({
      nextIds: ["meta-1"],
      idsToAdd: ["meta-1"],
      idsToRemove: [],
    });
  });
});
