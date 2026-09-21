import { useState } from "react";
import { SettingsSection } from "../../src/pages/settings/SettingsSection";
import styles from "./Templates.module.css";

const initialReservations = [
  {
    name: "garden",
    project: "alex / Sketch garden",
    status: "Reserved · App stopped",
  },
  {
    name: "space",
    project: "morgan / Space game",
    status: "Serving · Port 4101",
  },
  {
    name: "old-notes",
    project: "alex / Project removed",
    status: "Reserved · Project removed",
  },
];

export function AppReservations() {
  const [reservations, setReservations] = useState(initialReservations);
  const [clearing, setClearing] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const reserve = () => {
    const normalized = name.trim().toLowerCase();
    if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(normalized)) {
      setMessage(
        "Use 1–63 letters, digits or hyphens, with no leading or trailing hyphen.",
      );
    } else if (reservations.some((item) => item.name === normalized)) {
      setMessage(
        `${normalized}.graehl.org is already reserved. Choose another name.`,
      );
    } else if (["www", "ya", "relay"].includes(normalized)) {
      setMessage("That name is reserved for this server's services.");
    } else {
      setReservations([
        ...reservations,
        {
          name: normalized,
          project: "alex / Sketch garden",
          status: "Reserved · App stopped",
        },
      ]);
      setMessage(`${normalized}.graehl.org reserved in this preview.`);
      setName("");
    }
  };
  return (
    <main className={styles.apps}>
      <h1>Apps</h1>
      <p className={styles.muted}>
        Public addresses and reserved names for this server.
      </p>
      <SettingsSection
        title="Public wildcard"
        description="Your configured domain provides an address for each app."
      >
        <div className={styles.domain}>
          <strong>*.graehl.org</strong>
          <span className={styles.badge}>Configured</span>
        </div>
        <details>
          <summary>Domain and routing settings</summary>
          <p>
            Existing wildcard and app-routing controls live here. This preview
            changes no DNS or public hosting.
          </p>
        </details>
      </SettingsSection>
      <SettingsSection
        title="Reserved app names"
        description="First come, first served. Names stay reserved until you clear them, even when an app stops or its project is removed."
      >
        <div className={styles.reservations}>
          {reservations.map((item) => (
            <div className={styles.reservation} key={item.name}>
              <div>
                <strong>{item.name}.graehl.org</strong>
                <small>{item.project}</small>
                <small>{item.status}</small>
              </div>
              <button
                type="button"
                aria-label={`Clear ${item.name}`}
                onClick={() => setClearing(item.name)}
              >
                Clear…
              </button>
              {clearing === item.name && (
                <div className={styles.clearPrompt}>
                  <p>
                    Release <strong>{item.name}.graehl.org</strong>? Someone
                    else can reserve it. Its app address will stop working;
                    project files stay intact.
                  </p>
                  <div className={styles.tabs}>
                    <button
                      type="button"
                      onClick={() => {
                        setReservations(
                          reservations.filter(
                            (entry) => entry.name !== item.name,
                          ),
                        );
                        setClearing(null);
                      }}
                    >
                      Release name
                    </button>
                    <button type="button" onClick={() => setClearing(null)}>
                      Keep reservation
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
        <details className={styles.account}>
          <summary>Reserve a name</summary>
          <label className={styles.field}>
            App name
            <input
              value={name}
              placeholder="e.g. field-notes"
              onChange={(event) => setName(event.target.value)}
            />
            <small>.graehl.org</small>
          </label>
          <p>For alex / Sketch garden</p>
          <button type="button" onClick={reserve} disabled={!name.trim()}>
            Reserve name
          </button>
          {message && <p role="status">{message}</p>}
        </details>
      </SettingsSection>
      <p className={styles.muted}>
        Only the superuser can release reservations. Publishing to a
        host-provided URL, such as GitHub Pages, remains available without a
        custom domain.
      </p>
    </main>
  );
}
