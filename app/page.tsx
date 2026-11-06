import { CreationFrame } from "@/components/creation-frame";
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
          <CreationFrame>
            <section className="input-section" aria-labelledby="input-label">
              <div className="section-heading">
                <div>
                  <h2 id="input-label">Choose your starting point</h2>
                  <p>Use a photo of your car</p>
                </div>
              </div>
              <div className="creation-input">
                <HomeFlow />
              </div>
            </section>
          </CreationFrame>
        </MagicHourKeyField>
      </div>
    </main>
  );
}
