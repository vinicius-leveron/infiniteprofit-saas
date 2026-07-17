import type { ReactNode } from "react";

interface AdminPageProps {
  title: string;
  description: string;
  context?: string;
  action?: ReactNode;
  children: ReactNode;
}

export function AdminPage({
  title,
  description,
  context,
  action,
  children,
}: AdminPageProps) {
  return (
    <main className="mx-auto w-full max-w-[1200px] px-4 py-6 md:px-6 md:py-8 xl:px-8">
      <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          {context && (
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-primary">
              {context}
            </p>
          )}
          <h1 className="text-2xl font-bold leading-8 text-foreground">{title}</h1>
          <p className="mt-1 max-w-2xl text-sm leading-5 text-muted-foreground">
            {description}
          </p>
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </header>
      <div className="space-y-6 md:space-y-8">{children}</div>
    </main>
  );
}
