import { DraftSyncNotice } from "../../src/components/DraftSyncNotice";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { I18nProvider } from "../../src/i18n";
import { CurrentSourceRuntimeProvider } from "../../src/contexts/SourceRuntimeContext";
import { useDraftPersistence } from "../../src/hooks/useDraftPersistence";
import "../../src/styles/index.css";

function Activity() {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((n) => n + 1), 40);
    return () => clearInterval(timer);
  }, []);
  return (
    <section aria-label="Session activity">
      <p>Session activity {tick}</p>
      {Array.from({ length: 1000 }, (_, i) => (
        <div key={i}>
          Session {i}: {i === tick % 1000 ? "working" : "ready"}
        </div>
      ))}
    </section>
  );
}
function Composer() {
  const [value, setValue, controls] = useDraftPersistence(
    "draft-new-session:local",
  );
  return (
    <>
      <DraftSyncNotice draftKey="draft-new-session:local" />
      <label htmlFor="prompt">Prompt</label>
      <textarea
        id="prompt"
        data-draft-key="draft-new-session:local"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        style={{ width: "100%", height: 180, margin: "12px 0" }}
      />
      <button
        type="button"
        style={{ minHeight: 44 }}
        onClick={() => {
          controls.clearInput();
          setTimeout(() => controls.confirmInputClear(), 100);
        }}
      >
        Send
      </button>
    </>
  );
}
createRoot(document.getElementById("root")!).render(
  <I18nProvider>
    <CurrentSourceRuntimeProvider>
      <main
        style={{ maxWidth: 820, margin: "96px auto 20px", padding: "0 16px" }}
      >
        <h1>New session</h1>
        <p>Your draft stays on this device and syncs when connected.</p>
        <Composer />
        <Activity />
      </main>
    </CurrentSourceRuntimeProvider>
  </I18nProvider>,
);
