import { Link } from "react-router-dom";
import { useRemoteBasePath } from "../hooks/useRemoteBasePath";
import { useI18n } from "../i18n";
import styles from "./CockpitPage.module.css";
import { createCockpitNavigation } from "./core/navigation";

function SessionsIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 6.5h14M5 12h14M5 17.5h9" />
    </svg>
  );
}

function ProjectsIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3.5 7.5h6l1.7 2H20.5v8.7a1.8 1.8 0 0 1-1.8 1.8H5.3a1.8 1.8 0 0 1-1.8-1.8V7.5Z" />
      <path d="M3.5 10h17" />
    </svg>
  );
}

function NewSessionIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19 12a7 7 0 0 0-.1-1.2l2-1.6-2-3.4-2.5 1a7.4 7.4 0 0 0-2.1-1.2L14 3h-4l-.4 2.6a7.4 7.4 0 0 0-2.1 1.2l-2.5-1-2 3.4 2 1.6A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.6 2 3.4 2.5-1a7.4 7.4 0 0 0 2.1 1.2L10 21h4l.4-2.6a7.4 7.4 0 0 0 2.1-1.2l2.5 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2Z" />
    </svg>
  );
}

export function CockpitPage() {
  const { t } = useI18n();
  const navigation = createCockpitNavigation(useRemoteBasePath());
  const destinations = [
    {
      href: navigation.sessions,
      label: t("sidebarAllSessions"),
      icon: <SessionsIcon />,
    },
    {
      href: navigation.projects,
      label: t("sidebarProjects"),
      icon: <ProjectsIcon />,
    },
    {
      href: navigation.newSession,
      label: t("sidebarNewSession"),
      icon: <NewSessionIcon />,
    },
    {
      href: navigation.settings,
      label: t("sidebarSettings"),
      icon: <SettingsIcon />,
    },
  ];

  return (
    <main className={styles.root}>
      <aside className={styles.sidebar} aria-label="Cockpit">
        <Link className={styles.brand} to={navigation.cockpit}>
          <span className={styles.brandMark}>C</span>
          <span>Cockpit</span>
        </Link>

        <nav className={styles.navigation}>
          {destinations.map((destination) => (
            <Link
              className={styles.navigationItem}
              key={destination.href}
              to={destination.href}
            >
              <span className={styles.icon}>{destination.icon}</span>
              <span>{destination.label}</span>
            </Link>
          ))}
        </nav>

        <div className={styles.sidebarFooter}>Yep Anywhere</div>
      </aside>

      <section className={styles.workspace} aria-labelledby="cockpit-title">
        <header className={styles.header}>
          <div>
            <div className={styles.eyebrow}>Yep Anywhere</div>
            <h1 id="cockpit-title">Cockpit</h1>
          </div>
          <Link className={styles.primaryAction} to={navigation.newSession}>
            <NewSessionIcon />
            <span>{t("sidebarNewSession")}</span>
          </Link>
        </header>

        <div className={styles.canvas}>
          <div className={styles.launchPanel}>
            <span className={styles.launchMark}>C</span>
            <h2>{t("sidebarAllSessions")}</h2>
            <div className={styles.launchGrid}>
              {destinations.map((destination) => (
                <Link
                  className={styles.launchCard}
                  key={destination.href}
                  to={destination.href}
                >
                  <span className={styles.icon}>{destination.icon}</span>
                  <span>{destination.label}</span>
                </Link>
              ))}
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
