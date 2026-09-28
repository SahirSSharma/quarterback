// Placeholders sized like the content they stand in for, so nothing jumps when data lands.
export function Line({ w = 'w-full', h = 'h-4', className = '' }: { w?: string; h?: string; className?: string }) {
  return <div aria-hidden="true" className={`${w} ${h} animate-pulse rounded bg-line motion-reduce:animate-none ${className}`} />;
}

export function ImpactSkeleton() {
  return (
    <div role="status" aria-label="Loading impact" className="rounded-xl border border-line bg-surface p-5">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><Line w="w-48" h="h-7" /><Line w="w-64" h="h-4" className="mt-1.5" /></div><Line w="w-36" h="h-6" className="rounded-full" /></div>
      <div className="mt-6 space-y-2">
        <Line w="w-1/3" h="h-3" /><Line w="w-3/4" h="h-4" />
        <div className="divide-y divide-line rounded-lg border border-line">
          {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => <div key={i} className="px-3 py-2.5"><Line w="w-2/3" h="h-4" /><Line w="w-1/2" h="h-3" className="mt-1.5" /><Line w="w-1/3 sm:hidden" h="h-3" className="mt-1.5" /></div>)}
        </div>
        <Line w="w-56" h="h-5" />
      </div>
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <Line h="h-28" /><Line h="h-28" />
      </div>
      <div className="mt-6 space-y-2"><Line w="w-1/4" h="h-3" /><Line h="h-8" /></div>
      <div className="mt-6 space-y-2"><Line w="w-1/4" h="h-3" /></div>
      <div className="mt-6 space-y-2 border-t border-line pt-4"><Line h="h-5" /><Line h="h-5" /><Line h="h-5" /><Line h="h-5" /><Line h="h-5" /><Line h="h-5" /></div>
    </div>
  );
}

export function PlansSkeleton() {
  return (
    <div role="status" aria-label="Loading plans" className="space-y-4">
      <Line w="w-48" h="h-5" />
      {[0, 1, 2].map((i) => (
        <div key={i} className="rounded-xl border border-line bg-surface p-5">
          <div className="flex items-start gap-3"><Line w="w-4" h="h-4" className="mt-1" /><div><Line w="w-24" h="h-6" /><Line w="w-40" h="h-4" className="mt-1.5" /></div></div>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <Line h="h-52" /><Line h="h-52" /><Line h="h-52" />
          </div>
          <Line className="mt-4" h="h-4" /><Line className="mt-1.5" w="w-5/6" h="h-4" /><Line className="mt-1.5 sm:hidden" w="w-2/3" h="h-4" />
          <div className="mt-4 grid gap-1.5 border-t border-line pt-4 sm:grid-cols-2">
            <Line h="h-5" /><Line h="h-5" /><Line h="h-5" /><Line h="h-5" /><Line h="h-5" /><Line h="h-5" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function PageSkeleton() {
  return (
    <div className="mx-auto min-h-screen w-full max-w-7xl px-4 py-12 sm:px-6">
      <Line w="w-1/3" h="h-8" />
      <Line w="w-2/3" h="h-4" className="mt-4" />
      <div className="mt-10 grid gap-6 lg:grid-cols-2">
        <Line h="h-64" /><Line h="h-64" />
      </div>
    </div>
  );
}
