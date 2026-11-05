import { CatalogSearch } from "@/components/catalog-search";
import { HomeFlow } from "@/components/home-flow";

export default function HomePage() {
  return (
    <main className="mx-auto max-w-xl px-5 py-14">
      <h1 className="text-4xl">Roadster</h1>
      <p className="mt-3 max-w-sm text-[var(--quiet)]">See your car do the kickflip and the flyover.</p>
      <HomeFlow />
      <div className="mt-14 flex items-center gap-3" aria-hidden="true">
        <span className="h-px flex-1 bg-[var(--line)]" />
        <span className="text-sm text-[var(--quiet)]">or</span>
        <span className="h-px flex-1 bg-[var(--line)]" />
      </div>
      <h2 className="sr-only">Or name the car</h2>
      <CatalogSearch />
    </main>
  );
}
