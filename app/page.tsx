import { CatalogSearch } from "@/components/catalog-search";
import { HomeFlow } from "@/components/home-flow";

export default function HomePage() {
  return (
    <main className="mx-auto max-w-xl px-4 py-10">
      <h1 className="text-4xl">Roadster</h1>
      <p className="mt-3">See your car do the kickflip and the flyover.</p>
      <HomeFlow />
      <h2 className="mt-10 text-2xl">Or name the car</h2>
      <CatalogSearch />
    </main>
  );
}
