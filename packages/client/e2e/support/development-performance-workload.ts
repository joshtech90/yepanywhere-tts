import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { getDevelopmentPerformanceSnapshot } from "../../src/lib/developmentPerformance";

function MeasurementRow({ revision }: { revision: number }) {
  return createElement("span", null, revision);
}

export function runDevelopmentPerformanceWorkload() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  performance.clearMeasures();
  try {
    for (let revision = 0; revision < 20; revision++) {
      flushSync(() =>
        root.render(
          createElement(
            "div",
            null,
            Array.from({ length: 200 }, (_, key) =>
              createElement(MeasurementRow, { key, revision }),
            ),
          ),
        ),
      );
    }
    const entries = performance.getEntriesByType(
      "measure",
    ) as PerformanceMeasure[];
    return {
      renderedRows: container.querySelectorAll("span").length,
      finalText: container.querySelector("span")?.textContent,
      nativeEntries: entries.length,
      entriesWithDetail: entries.filter((entry) => entry.detail !== null)
        .length,
      snapshot: getDevelopmentPerformanceSnapshot(),
    };
  } finally {
    flushSync(() => root.unmount());
    container.remove();
  }
}
