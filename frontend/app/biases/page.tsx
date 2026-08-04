import { Suspense } from "react";
import { RequireAuth } from "@/components/system/RequireAuth";
import { BiasLibrary } from "@/components/biases/BiasLibrary";
import { Spinner } from "@/components/ui/primitives";

export default function BiasLibraryPage() {
  return (
    <RequireAuth>
      {/* BiasLibrary reads ?focus= via useSearchParams, which opts its subtree
          into client-side rendering - the Suspense boundary keeps that from
          bubbling up to the whole route. */}
      <Suspense
        fallback={
          <div className="flex flex-1 items-center justify-center py-24">
            <Spinner className="text-ink-muted" />
          </div>
        }
      >
        <BiasLibrary />
      </Suspense>
    </RequireAuth>
  );
}
