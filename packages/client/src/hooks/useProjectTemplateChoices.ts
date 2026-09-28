import {
  SERVER_CAPABILITIES,
  serverHasCapability,
  templateGrantFor,
} from "@yep-anywhere/shared";
import { useEffect, useState } from "react";
import {
  projectTemplatesApi,
  type ProjectTemplateChoices,
} from "../api/projectTemplatesClient";
import { useActingPrincipal } from "./useActingPrincipal";
import { useVersion } from "./useVersion";
import { useClientSummarySourceKey } from "../lib/clientSummaryStore";
import type { MessageKey } from "../i18n";

/** Acquires template choices only after server and acting-principal gates settle. */
export function useProjectTemplateChoices(chooserOpen = false) {
  const { version } = useVersion();
  const sourceKey = useClientSummarySourceKey();
  const { principal, resolved } = useActingPrincipal();
  const limited = principal.username !== null;
  const restricted =
    resolved &&
    limited &&
    serverHasCapability(
      version,
      SERVER_CAPABILITIES.limitedUserProjectTemplates.name,
    );
  const supported =
    resolved &&
    (!limited ||
      (!!principal.grants?.projectRoot &&
        templateGrantFor(principal.grants).mode !== "none")) &&
    serverHasCapability(
      version,
      limited
        ? SERVER_CAPABILITIES.limitedUserProjectTemplates.name
        : SERVER_CAPABILITIES.projectTemplateCreation.name,
    );
  const [choices, setChoices] = useState<ProjectTemplateChoices | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadedSource, setLoadedSource] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const identityKey = JSON.stringify([
    sourceKey,
    principal.username,
    principal.grants,
  ]);
  const requestKey = `${identityKey}:${chooserOpen}`;
  const currentIdentity = loadedSource?.startsWith(`${identityKey}:`) === true;
  useEffect(() => {
    const controller = new AbortController();
    setError(null);
    setLoading(supported);
    if (!supported) setChoices(null);
    if (supported)
      void projectTemplatesApi
        .choices(controller.signal)
        .then((result) => {
          if (!controller.signal.aborted) {
            setChoices(result);
            setLoadedSource(requestKey);
            setLoading(false);
          }
        })
        .catch((error: unknown) => {
          if (!controller.signal.aborted) {
            setChoices(null);
            setLoadedSource(requestKey);
            setLoading(false);
            setError(error instanceof Error ? error.message : String(error));
          }
        });
    return () => controller.abort();
  }, [supported, requestKey]);
  const emptyMessageKey: MessageKey =
    restricted && !supported
      ? "templateNotPermitted"
      : loading || (supported && !currentIdentity)
        ? "templateLoading"
        : restricted && choices?.enabled === false
          ? "templateDisabledForServer"
          : limited
            ? "templateNoneForUser"
            : "templateNoReady";
  return {
    emptyMessageKey,
    choices: restricted
      ? {
          enabled: true,
          templates:
            supported && currentIdentity ? (choices?.templates ?? []) : [],
        }
      : supported && currentIdentity
        ? choices
        : null,
    error: supported && currentIdentity ? error : null,
  };
}
