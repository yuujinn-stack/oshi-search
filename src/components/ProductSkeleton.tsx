export default function ProductSkeleton() {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
      {[...Array(4)].map((_, i) => (
        <div
          key={i}
          className="bg-white rounded-xl border border-gray-100 overflow-hidden animate-pulse"
        >
          <div className="aspect-[3/4] bg-gray-200" />
          <div className="p-3 space-y-2">
            <div className="h-3 bg-gray-200 rounded w-full" />
            <div className="h-3 bg-gray-200 rounded w-3/4" />
            <div className="h-3 bg-gray-200 rounded w-1/2 mt-1" />
            <div className="h-3 bg-gray-200 rounded w-1/3" />
            <div className="h-9 bg-gray-200 rounded mt-2" />
          </div>
        </div>
      ))}
    </div>
  );
}
