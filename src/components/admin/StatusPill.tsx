import { AlertCircle, CheckCircle2, Circle, Clock3, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export type StatusTone = "neutral" | "info" | "success" | "warning" | "danger";

interface StatusPillProps {
  label: string;
  tone: StatusTone;
  pulse?: boolean;
}

const toneClasses: Record<StatusTone, string> = {
  neutral: "border-border bg-muted/50 text-muted-foreground",
  info: "border-blue-500/25 bg-blue-500/10 text-blue-700 dark:text-blue-300",
  success: "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  warning: "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  danger: "border-destructive/25 bg-destructive/10 text-destructive",
};

const toneIcons = {
  neutral: Circle,
  info: Clock3,
  success: CheckCircle2,
  warning: AlertCircle,
  danger: AlertCircle,
} as const;

export function StatusPill({ label, tone, pulse = false }: StatusPillProps) {
  const Icon = pulse ? Loader2 : toneIcons[tone];

  return (
    <span
      className={cn(
        "inline-flex min-h-7 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium",
        toneClasses[tone],
      )}
    >
      <Icon className={cn("h-3.5 w-3.5", pulse && "animate-spin")} aria-hidden="true" />
      {label}
    </span>
  );
}
