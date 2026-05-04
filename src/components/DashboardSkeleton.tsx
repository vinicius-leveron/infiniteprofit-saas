import { Skeleton } from "@/components/ui/skeleton";

export const DashboardSkeleton = () => (
  <main className="min-h-screen">
    <div className="max-w-[1400px] mx-auto px-4 md:px-6 py-6 md:py-8 space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Skeleton className="w-11 h-11 rounded-xl" />
          <div className="space-y-2">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-3 w-64" />
          </div>
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-9 w-24" />
          <Skeleton className="h-9 w-24" />
          <Skeleton className="h-9 w-32" />
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-border/60 pb-2">
        {[...Array(5)].map((_, i) => (
          <Skeleton key={i} className="h-8 w-28" />
        ))}
      </div>

      {/* Period filter */}
      <Skeleton className="h-10 w-80" />

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
        <Skeleton className="h-5 w-48" />
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
