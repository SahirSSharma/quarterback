// Placeholders sized like the content they stand in for, so nothing jumps when data lands.
export function Line({ w = 'w-full', h = 'h-4', className = '' }: { w?: string; h?: string; className?: string }) {
  return <div aria-hidden="true" className={`${w} ${h} animate-pulse rounded bg-line motion-reduce:animate-none ${className}`} />;
}

export function ImpactSkeleton() {
  return (
    <div role="status" aria-label="Loading impact" className="rounded-xl border border-line bg-surface p-5">
      <Line w="w-2/5" h="h-6" />
      <div className="mt-5 space-y-3">
        <Line w="w-1/3" h="h-3" />
        <Line h="h-12" /><Line h="h-12" /><Line h="h-12" />
      </div>
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <Line h="h-16" /><Line h="h-16" />
      </div>
      <div className="mt-6 space-y-2"><Line w="w-1/4" h="h-3" /><Line h="h-8" /></div>
    </div>
  );
}

export function PlansSkeleton() {
  return (
    <div role="status" aria-label="Loading plans" className="space-y-4">
      {[0, 1, 2].map((i) => (
        <div key={i} className="rounded-xl border border-line bg-surface p-5">
          <div className="flex items-center gap-3"><Line w="w-5" h="h-5" /><Line w="w-1/4" h="h-5" /></div>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <Line h="h-28" /><Line h="h-28" /><Line h="h-28" />
          </div>
          <Line className="mt-4" h="h-10" />
        </div>
      ))}
    </div>
  );
}

export function PageSkeleton() {
  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-12 sm:px-6">
      <Line w="w-1/3" h="h-8" />
      <Line w="w-2/3" h="h-4" className="mt-4" />
      <div className="mt-10 grid gap-6 lg:grid-cols-2">
        <Line h="h-64" /><Line h="h-64" />
      </div>
    </div>
  );
}
