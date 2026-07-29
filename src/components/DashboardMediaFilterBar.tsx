import { type ReactNode, useMemo, useState } from "react";
import { Check, ChevronsUpDown, Loader2, RotateCcw, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { DashboardFilterState } from "@/lib/dashboardFilters";
import type { DashboardAdDimension } from "@/lib/dashboardDimensions";

type FilterOption = { id: string; label: string };

export function DashboardMediaFilterBar({
  dimensions,
  value,
  onChange,
  loading = false,
  periodControl,
}: {
  dimensions: DashboardAdDimension[];
  value: DashboardFilterState;
  onChange: (value: DashboardFilterState) => void;
  loading?: boolean;
  periodControl?: ReactNode;
}) {
  const accountOptions = useMemo(
    () => uniqueOptions(dimensions, "account_id", "account_label"),
    [dimensions],
  );
  const campaignDimensions = useMemo(
    () => value.accountIds.length === 0
      ? dimensions
      : dimensions.filter((row) => row.account_id && value.accountIds.includes(row.account_id)),
    [dimensions, value.accountIds],
  );
  const campaignOptions = useMemo(
    () => uniqueOptions(campaignDimensions, "campaign_id", "campaign_name"),
    [campaignDimensions],
  );
  const adsetDimensions = useMemo(
    () => campaignDimensions.filter((row) =>
      value.campaignIds.length === 0 || Boolean(row.campaign_id && value.campaignIds.includes(row.campaign_id))
    ),
    [campaignDimensions, value.campaignIds],
  );
  const adsetOptions = useMemo(
    () => uniqueOptions(adsetDimensions, "adset_id", "adset_name"),
    [adsetDimensions],
  );
  const activeCount = value.accountIds.length + value.campaignIds.length + value.adsetIds.length;

  function updateAccounts(accountIds: string[]) {
    const allowedCampaigns = new Set(
      dimensions
        .filter((row) => accountIds.length === 0 || Boolean(row.account_id && accountIds.includes(row.account_id)))
        .map((row) => row.campaign_id)
        .filter(Boolean),
    );
    const campaignIds = value.campaignIds.filter((id) => allowedCampaigns.has(id));
    const allowedAdsets = new Set(
      dimensions
        .filter((row) =>
          (accountIds.length === 0 || Boolean(row.account_id && accountIds.includes(row.account_id))) &&
          (campaignIds.length === 0 || Boolean(row.campaign_id && campaignIds.includes(row.campaign_id)))
        )
        .map((row) => row.adset_id)
        .filter(Boolean),
    );
    onChange({
      accountIds,
      campaignIds,
      adsetIds: value.adsetIds.filter((id) => allowedAdsets.has(id)),
    });
  }

  function updateCampaigns(campaignIds: string[]) {
    const allowedAdsets = new Set(
      adsetDimensions
        .filter((row) => campaignIds.length === 0 || Boolean(row.campaign_id && campaignIds.includes(row.campaign_id)))
        .map((row) => row.adset_id)
        .filter(Boolean),
    );
    onChange({
      ...value,
      campaignIds,
      adsetIds: value.adsetIds.filter((id) => allowedAdsets.has(id)),
    });
  }

  return (
    <div className="rounded-2xl border border-border/50 bg-card/60 p-3 shadow-sm">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
        <div className={cn(
          "grid min-w-0 flex-1 gap-3",
          periodControl
            ? "sm:grid-cols-3"
            : "sm:grid-cols-3",
        )}>
          {periodControl && (
            <div className="min-w-0 sm:col-span-3">
              <span className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Período
              </span>
              <div className="min-h-11 rounded-xl border border-border/40 bg-background/30 p-1.5">
                {periodControl}
              </div>
            </div>
          )}
          <FilterMultiSelect
            label="Conta de anúncio"
            placeholder="Todas as contas"
            options={accountOptions}
            selected={value.accountIds}
            onChange={updateAccounts}
            loading={loading}
          />
          <FilterMultiSelect
            label="Campanha"
            placeholder="Todas as campanhas"
            options={campaignOptions}
            selected={value.campaignIds}
            onChange={updateCampaigns}
            loading={loading}
          />
          <FilterMultiSelect
            label="Conjunto"
            placeholder="Todos os conjuntos"
            options={adsetOptions}
            selected={value.adsetIds}
            onChange={(adsetIds) => onChange({ ...value, adsetIds })}
            loading={loading}
          />
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="min-h-11 shrink-0 gap-2"
          disabled={activeCount === 0}
          onClick={() => onChange({ accountIds: [], campaignIds: [], adsetIds: [] })}
        >
          <RotateCcw className="h-4 w-4" />
          Limpar filtros
          {activeCount > 0 && (
            <span className="rounded-full bg-primary/15 px-1.5 text-[11px] text-primary">{activeCount}</span>
          )}
        </Button>
      </div>

      {activeCount > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5 border-t border-border/40 pt-3">
          <FilterChips
            prefix="Conta"
            options={accountOptions}
            ids={value.accountIds}
            onRemove={(id) => updateAccounts(value.accountIds.filter((item) => item !== id))}
          />
          <FilterChips
            prefix="Campanha"
            options={campaignOptions}
            ids={value.campaignIds}
            onRemove={(id) => updateCampaigns(value.campaignIds.filter((item) => item !== id))}
          />
          <FilterChips
            prefix="Conjunto"
            options={adsetOptions}
            ids={value.adsetIds}
            onRemove={(id) => onChange({ ...value, adsetIds: value.adsetIds.filter((item) => item !== id) })}
          />
        </div>
      )}
    </div>
  );
}

function FilterMultiSelect({
  label,
  placeholder,
  options,
  selected,
  onChange,
  loading,
}: {
  label: string;
  placeholder: string;
  options: FilterOption[];
  selected: string[];
  onChange: (ids: string[]) => void;
  loading: boolean;
}) {
  const [query, setQuery] = useState("");
  const visible = options.filter((option) => option.label.toLocaleLowerCase("pt-BR").includes(query.toLocaleLowerCase("pt-BR")));
  const allVisibleSelected = visible.length > 0 && visible.every((option) => selected.includes(option.id));

  return (
    <div className="min-w-0">
      <span className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-label={`${label}: ${
              selected.length === 0
                ? placeholder
                : `${selected.length} selecionado${selected.length === 1 ? "" : "s"}`
            }`}
            className="min-h-11 w-full justify-between rounded-xl bg-background/60 px-3 font-normal"
          >
            <span className="truncate text-left text-sm">
              {loading
                ? "Carregando..."
                : selected.length === 0
                  ? placeholder
                  : selected.length === 1
                    ? options.find((option) => option.id === selected[0])?.label ?? "1 selecionado"
                    : `${selected.length} selecionados`}
            </span>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ChevronsUpDown className="h-4 w-4 opacity-50" />}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[min(340px,calc(100vw-32px))] p-2">
          <div className="relative mb-2">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={`Buscar ${label.toLocaleLowerCase("pt-BR")}...`}
              className="h-10 pl-9"
            />
          </div>
          <button
            type="button"
            className="flex min-h-11 w-full items-center gap-3 rounded-lg px-2 text-left text-sm hover:bg-muted"
            onClick={() => {
              if (allVisibleSelected) {
                const visibleIds = new Set(visible.map((option) => option.id));
                onChange(selected.filter((id) => !visibleIds.has(id)));
              } else {
                onChange([...new Set([...selected, ...visible.map((option) => option.id)])]);
              }
            }}
          >
            <Checkbox checked={allVisibleSelected} aria-label="Selecionar tudo" />
            Selecionar tudo
          </button>
          <div className="max-h-64 overflow-y-auto">
            {visible.map((option) => {
              const checked = selected.includes(option.id);
              return (
                <button
                  key={option.id}
                  type="button"
                  className={cn(
                    "flex min-h-11 w-full items-center gap-3 rounded-lg px-2 text-left text-sm hover:bg-muted",
                    checked && "bg-primary/5",
                  )}
                  onClick={() => onChange(
                    checked ? selected.filter((id) => id !== option.id) : [...selected, option.id],
                  )}
                >
                  <Checkbox checked={checked} aria-label={option.label} />
                  <span className="min-w-0 flex-1 truncate">{option.label}</span>
                  {checked && <Check className="h-4 w-4 text-primary" />}
                </button>
              );
            })}
            {!loading && visible.length === 0 && (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">Nenhum item encontrado.</p>
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

function FilterChips({
  prefix,
  options,
  ids,
  onRemove,
}: {
  prefix: string;
  options: FilterOption[];
  ids: string[];
  onRemove: (id: string) => void;
}) {
  return ids.map((id) => (
    <span key={id} className="inline-flex min-h-8 items-center gap-1 rounded-full bg-primary/10 px-2.5 text-xs text-primary">
      {prefix}: {options.find((option) => option.id === id)?.label ?? id}
      <button type="button" onClick={() => onRemove(id)} className="rounded-full p-1 hover:bg-primary/10" aria-label={`Remover ${prefix}`}>
        <X className="h-3 w-3" />
      </button>
    </span>
  ));
}

function uniqueOptions(
  rows: DashboardAdDimension[],
  idKey: "account_id" | "campaign_id" | "adset_id",
  labelKey: "account_label" | "campaign_name" | "adset_name",
) {
  const map = new Map<string, string>();
  for (const row of rows) {
    const id = row[idKey];
    if (!id) continue;
    map.set(id, row[labelKey] || id);
  }
  return [...map.entries()]
    .map(([id, label]) => ({ id, label }))
    .sort((left, right) => left.label.localeCompare(right.label, "pt-BR"));
}
