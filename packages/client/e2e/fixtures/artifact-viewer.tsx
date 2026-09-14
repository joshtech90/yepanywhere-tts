import { createRoot } from "react-dom/client";
import { ArtifactPreview } from "../../src/components/ArtifactPreview";
import { ArtifactSettings } from "../../src/pages/settings/ArtifactSettings";
import { useVersion } from "../../src/hooks/useVersion";
import { I18nProvider } from "../../src/i18n";
import "../../src/styles/index.css";

function Fixture() {
  useVersion();
  const query = new URLSearchParams(location.search);
  return query.has("settings") ? (
    <div style={{ padding: 20, maxWidth: 700 }}>
      <ArtifactSettings />
    </div>
  ) : (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
      <ArtifactPreview
        html="<h1>Static preview</h1>"
        path={query.get("path") ?? ""}
        title="Field notes"
      />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <I18nProvider>
    <Fixture />
  </I18nProvider>,
);
