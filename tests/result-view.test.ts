import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { Disclaimer } from "@/components/disclaimer";
import { ResultView } from "@/components/result-view";
import { projectFakeReel } from "@/lib/fake-reel";

test("disclaimer markup contains the affiliation sentence", () => {
  const html = renderToStaticMarkup(Disclaimer());
  expect(html).toContain("not affiliated with Tesla");
  expect(html).toContain("cannot do this");
});

test("a finished fake reel offers four downloads and both retry buttons", () => {
  const reel = projectFakeReel("00000000-0000-4000-8000-000000000001", 0, 21_000);
  const html = renderToStaticMarkup(ResultView({ reel }));
  expect(html).toContain("Download still");
  expect(html).toContain("Download video");
  expect(html.match(/Download still/g)).toHaveLength(2);
  expect(html.match(/Try this scene again/g)).toHaveLength(2);
  expect(html).toContain("Filming the flyover");
  expect(html).toContain("not affiliated with Tesla");
});
