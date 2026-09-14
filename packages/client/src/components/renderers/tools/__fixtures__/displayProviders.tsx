import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { I18nProvider } from "../../../../i18n";
import { SchemaValidationProvider } from "../../../../contexts/SchemaValidationContext";
import { SessionMetadataProvider } from "../../../../contexts/SessionMetadataContext";
import { ToastProvider } from "../../../../contexts/ToastContext";
export function displayProviders(node: ReactNode) {
  return (
    <MemoryRouter>
      <I18nProvider>
        <ToastProvider>
          <SchemaValidationProvider>
            <SessionMetadataProvider
              projectId="L3RtcA"
              projectPath="/tmp"
              sessionId="contracts"
              provider="claude"
            >
              {node}
            </SessionMetadataProvider>
          </SchemaValidationProvider>
        </ToastProvider>
      </I18nProvider>
    </MemoryRouter>
  );
}
