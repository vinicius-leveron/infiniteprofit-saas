import { Skeleton } from "@/components/ui/skeleton";

export const DashboardSkeleton = () => (
  <main className="min-h-screen" aria-busy="true" aria-label="Carregando dashboard">
    <div className="mx-auto max-w-[1200px] space-y-6 px-4 py-6 animate-fade-in md:px-6 md:py-8 lg:px-8">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <Skeleton className="h-11 w-11 shrink-0 rounded-xl" />
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-6 w-48 max-w-full" />
            <Skeleton className="h-3 w-64 max-w-full" />
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2 sm:flex">
          <Skeleton className="h-9 min-w-0 sm:w-24" />
          <Skeleton className="h-9 min-w-0 sm:w-24" />
          <Skeleton className="h-9 min-w-0 sm:w-32" />
        </div>
      </div>

      {/* Tabs */}
      <div className="grid grid-cols-3 gap-2 border-b border-border/60 pb-2 sm:flex">
        {[...Array(5)].map((_, i) => (
          <Skeleton key={i} className="h-8 min-w-0 sm:w-28" />
        ))}
      </div>

      {/* Period filter */}
      <Skeleton className="h-10 w-80 max-w-full" />

      {/* Featured KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="kpi-card space-y-3">
            <div className="flex justify-between">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="w-10 h-10 rounded-lg" />
            </div>
            <Skeleton className="h-9 w-32" />
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-11 w-full" />
          </div>
        ))}
      </div>

      {/* Secondary KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {[...Array(8)].map((_, i) => (
          <div key={i} className="kpi-card space-y-3">
            <div className="flex justify-between">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="w-8 h-8 rounded-lg" />
            </div>
            <Skeleton className="h-7 w-24" />
            <Skeleton className="h-3 w-16" />
          </div>
        ))}
      </div>

      {/* Chart */}
      <div className="section-card space-y-4">
        <Skeleton className="h-5 w-48 max-w-full" />
        <Skeleton className="h-72 w-full" />
      </div>
    </div>
  </main>
);

export const ProjectsSkeleton = () => (
  <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 animate-fade-in">
    {[...Array(6)].map((_, i) => (
      <div key={i} className="section-card space-y-3">
        <div className="flex items-start justify-between">
          <Skeleton className="w-10 h-10 rounded-lg" />
          <Skeleton className="h-3 w-12" />
        </div>
        <Skeleton className="h-5 w-3/4" />
        <Skeleton className="h-3 w-1/2" />
        <Skeleton className="h-3 w-2/3" />
        <div className="pt-3 border-t border-border/40 flex justify-end">
          <Skeleton className="h-8 w-20" />
        </div>
      </div>
    ))}
  </div>
);
