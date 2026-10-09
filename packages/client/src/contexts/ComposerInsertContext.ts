import { createContext } from "react";

/**
 * Inserts text into the session composer's draft, undoably and without
 * sending it. Null outside a session page.
 */
export const ComposerInsertContext = createContext<
  ((text: string) => unknown) | null
>(null);
