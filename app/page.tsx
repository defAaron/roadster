import { CatalogSearch } from "@/components/catalog-search";
import { HomeFlow } from "@/components/home-flow";
import { MagicHourKeyField } from "@/components/magic-hour-key";

export default function HomePage() {
  return (
    <main className="app-shell">
      <div className="ambient-layer" aria-hidden="true">
        <div className="ambient ambient-one" />
        <div className="ambient ambient-two" />
      </div>

      <section className="hero">
        <h1>
          Reimagine your car as the <em>Roadster</em>
        </h1>
      </section>

      <div className="control-panel">
        <MagicHourKeyField>
          <div className="panel-rule" />
          <section className="input-section" aria-labelledby="input-label">
            <div className="section-heading">
              <div>
                <h2 id="input-label">Choose your starting point</h2>
                <p>Use words or an image reference</p>
              </div>
            </div>
            <div className="creation-input">
              <CatalogSearch />
              <HomeFlow />
            </div>
          </section>
        </MagicHourKeyField>
      </div>
    </main>
  );
}
