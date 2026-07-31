import { supabase } from "@/integrations/supabase/client";
import { publicConfig } from "@/lib/publicConfig";

export type ProductEventName =
  | "account_bootstrapped"
  | "funnel_setup_started"
  | "source_prepared"
  | "funnel_created"
  | "activation_viewed"
  | "first_dashboard_opened"
  | "share_created";

interface ProductEventInput {
  eventName: ProductEventName;
  organizationId?: string | null;
  workspaceId?: string | null;
  projectId?: string | null;
  properties?: Record<string, string | number | boolean | null>;
}

export function trackProductEvent({
  eventName,
  organizationId,
  workspaceId,
  projectId,
  properties = {},
}: ProductEventInput) {
  if (!isCanonicalAppOrigin()) return;

  try {
    const request = supabase.functions.invoke("product-event", {
      body: {
        event_name: eventName,
        organization_id: organizationId ?? null,
        workspace_id: workspaceId ?? null,
        project_id: projectId ?? null,
        properties,
      },
    });
    void request?.catch(() => {
      // Telemetria nunca bloqueia a jornada principal.
    });
  } catch {
    // Telemetria nunca bloqueia a jornada principal.
  }
}

function isCanonicalAppOrigin() {
  if (typeof window === "undefined") return false;
  try {
    return window.location.origin === new URL(publicConfig.appUrl).origin;
  } catch {
    return false;
  }
}
