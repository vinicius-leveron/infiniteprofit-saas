import { supabase } from "@/integrations/supabase/client";

export type PreparedHotmartImport = {
  csv: string;
  fileName: string;
  kind: "csv" | "xlsx";
  sheetName?: string;
  discardedColumns: number;
};

export type HotmartImportResult = {
  imported: number;
  excluded: number;
  skipped: number;
  dates: string[];
  warnings: string[];
  headers: string[];
  kind: string | null;
};

export async function runHotmartImport(
  projectId: string,
  csv: string,
  dryRun: boolean,
): Promise<HotmartImportResult> {
  const { data, error } = await supabase.functions.invoke("hubla-csv-import", {
    body: {
      project_id: projectId,
      provider: "hotmart",
      csv,
      dry_run: dryRun,
    },
  });

  if (error) throw error;
  if (data?.error) throw new Error(String(data.error));

  return {
    imported: finiteNumber(data?.imported),
    excluded: finiteNumber(data?.excluded),
    skipped: finiteNumber(data?.skipped),
    dates: stringArray(data?.dates),
    warnings: stringArray(data?.warnings),
    headers: stringArray(data?.headers),
    kind: typeof data?.kind === "string" ? data.kind : null,
  };
}

function finiteNumber(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}
