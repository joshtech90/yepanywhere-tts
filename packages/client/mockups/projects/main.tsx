import { useState } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, useLocation } from "react-router-dom";
import { ProjectCard } from "../../src/components/ProjectCard";
import { I18nProvider } from "../../src/i18n";
import { UI_KEYS } from "../../src/lib/storageKeys";
import type { Project } from "../../src/types";
import "../../src/styles/index.css";
import styles from "./Projects.module.css";

const names = [
  "Yep Anywhere",
  "Documentation",
  "Mobile companion",
  "Relay service",
  "Design references",
  "Release notes",
  "Session archive",
  "Source review",
  "Provider adapters",
  "Browser tools",
  "Project queue",
  "Accessibility",
  "Local development",
  "Integration tests",
  "Translations",
  "Field notes",
];
const projects: Project[] = names.map((name, index) => ({
  id: `fixture-${index}`,
  name,
  path: `/workspace/${name.toLowerCase().replaceAll(" ", "-")}`,
  sessionCount: 3 + index,
  activeOwnedCount: 0,
  activeExternalCount: 0,
  lastActivity: null,
}));

function Projects() {
  const [selected, setSelected] = useState(
    new URLSearchParams(location.search).get("state") === "selected"
      ? "Yep Anywhere"
      : "",
  );
  const route = useLocation();
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Yep Anywhere · UI fixture</p>
          <h1>Project review</h1>
          <p>
            Real project cards with sample data. Open a card’s menu to review
            its settings.
          </p>
        </div>
        <a href="./ya-mockup.json">Export manifest</a>
      </header>
      <p className={styles.feedback} role="status">
        {route.pathname !== "/"
          ? `Preview navigation: ${route.pathname}${route.search}`
          : selected
            ? `Settings selected: ${selected}`
            : "Choose a project to review. Changes stay in this preview."}
      </p>
      <ul className={styles.grid} aria-label="Sample projects">
        {projects.map((project, index) => (
          <ProjectCard
            key={project.id}
            project={project}
            needsAttentionCount={index === 0 ? 2 : 0}
            thinkingCount={0}
            queueCount={index === 0 ? 3 : 0}
            onOpenSettings={(item) => setSelected(item.name)}
          />
        ))}
      </ul>
      <footer className={styles.footer}>
        End of sample projects. No provider or project service is connected.
      </footer>
    </main>
  );
}

localStorage.setItem(UI_KEYS.locale, "en");
createRoot(document.getElementById("root")!).render(
  <I18nProvider>
    <MemoryRouter>
      <Projects />
    </MemoryRouter>
  </I18nProvider>,
);
