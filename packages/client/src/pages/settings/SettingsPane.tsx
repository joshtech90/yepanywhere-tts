import { type ReactNode, Suspense } from "react";
import { ErrorBoundary } from "../../components/ErrorBoundary";
import { useI18n } from "../../i18n";

/** Keep pane acquisition and failure inside the Settings navigation shell. */
export function SettingsPane({
  children,
  label,
}: {
  children: ReactNode;
  label?: string;
}) {
  const { t } = useI18n();
  return (
    <div data-settings-pane>
      <ErrorBoundary>
        <Suspense
          fallback={
            <p role="status">
              {label && `${label}: `}
              {t("loading")}
            </p>
          }
        >
          <div data-settings-pane-ready>{children}</div>
        </Suspense>
      </ErrorBoundary>
    </div>
  );
}
