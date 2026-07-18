import { describe, expect, it } from "vitest";
import {
  githubEnvironmentLines,
  validateStagingTarget,
} from "../../scripts/staging-readiness-fixture-core.mjs";

describe("staging readiness fixture safety", () => {
  it("accepts only an explicitly acknowledged isolated project", () => {
    expect(validateStagingTarget({
      url: "https://staging-ref.supabase.co",
      projectRef: "staging-ref",
      acknowledgement: "staging-ref",
    })).toEqual({
      url: "https://staging-ref.supabase.co",
      projectRef: "staging-ref",
    });

    expect(() => validateStagingTarget({
      url: "https://nztnctrkmfrgclrnflfa.supabase.co",
      projectRef: "nztnctrkmfrgclrnflfa",
      acknowledgement: "nztnctrkmfrgclrnflfa",
    })).toThrow(/refuses the production/i);

    expect(() => validateStagingTarget({
      url: "https://staging-ref.supabase.co",
      projectRef: "staging-ref",
      acknowledgement: "another-ref",
    })).toThrow(/must exactly match/i);
  });

  it("exports only non-secret fixture identifiers", () => {
    expect(githubEnvironmentLines({
      organizationId: "org-id",
      workspaceId: "workspace-id",
      projectId: "project-id",
    })).toBe(
      "RLS_ORGANIZATION_ID=org-id\n" +
        "RLS_WORKSPACE_ID=workspace-id\n" +
        "RLS_PROJECT_ID=project-id\n" +
        "LOAD_TEST_WORKSPACE_ID=workspace-id\n",
    );
  });
});
