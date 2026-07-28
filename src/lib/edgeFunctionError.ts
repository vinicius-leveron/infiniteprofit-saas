export async function edgeFunctionErrorMessage(
  error: unknown,
  fallback: string,
) {
  const context =
    error && typeof error === "object" && "context" in error
      ? (error as { context?: unknown }).context
      : null;

  if (typeof Response !== "undefined" && context instanceof Response) {
    try {
      const payload = (await context.clone().json()) as { error?: unknown };
      if (typeof payload.error === "string" && payload.error.trim()) {
        return payload.error.trim();
      }
    } catch {
      // Use the stable client message below when the function did not return JSON.
    }
  }

  const message = error instanceof Error ? error.message.trim() : "";
  if (
    !message ||
    message.toLowerCase().includes("edge function returned a non-2xx")
  ) {
    return fallback;
  }
  return message;
}
