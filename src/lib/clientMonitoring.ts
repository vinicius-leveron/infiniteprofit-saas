import { supabase } from "@/integrations/supabase/client";

export function redactClientErrorMessage(value: string) {
  return value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, "Bearer [redacted]")
    .replace(/[?&](token|secret|key|code)=[^&\s]+/gi, "$1=[redacted]")
    .replace(/[0-9a-f]{8}-[0-9a-f-]{27}/gi, "[id]")
    .replace(/[A-Fa-f0-9]{32,}/g, "[redacted]")
    .slice(0, 500);
}

function fingerprint(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `client-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function reportClientError(error: unknown, route = window.location.pathname) {
  const caught = error instanceof Error ? error : new Error(String(error));
  const safeMessage = redactClientErrorMessage(
    caught.message || "Unexpected client error",
  );
  void supabase.functions
    .invoke("client-error", {
      body: {
        environment: import.meta.env.VITE_APP_ENVIRONMENT || import.meta.env.MODE,
        release: import.meta.env.VITE_APP_RELEASE || "unversioned",
        route: route.split("?")[0].split("#")[0],
        error_type: caught.name || "Error",
        fingerprint: fingerprint(`${caught.name}:${safeMessage}:${route}`),
        safe_message: safeMessage,
      },
    })
    .catch(() => {
      // O fallback precisa continuar utilizável mesmo durante indisponibilidade do backend.
    });
}
