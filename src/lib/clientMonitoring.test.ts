import { describe, expect, it } from "vitest";
import { redactClientErrorMessage } from "@/lib/clientMonitoring";

describe("client monitoring redaction", () => {
  it("removes common PII and credential shapes before telemetry", () => {
    const redacted = redactClientErrorMessage(
      "user@example.com Bearer abc.def.ghi /x?token=secret-value " +
        "c4f027b4-f867-4d7f-a522-dfb272c33104 " +
        "0123456789abcdef0123456789abcdef",
    );

    expect(redacted).not.toContain("user@example.com");
    expect(redacted).not.toContain("abc.def.ghi");
    expect(redacted).not.toContain("secret-value");
    expect(redacted).not.toContain("c4f027b4-f867-4d7f-a522-dfb272c33104");
    expect(redacted).not.toContain("0123456789abcdef0123456789abcdef");
    expect(redacted).toContain("[email]");
    expect(redacted).toContain("[redacted]");
    expect(redacted).toContain("[id]");
  });
});
