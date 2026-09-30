import { type RefObject, useEffect, useRef } from "react";
import {
  type CopySourceMode,
  type MarkdownCopySourceContext,
  registerMarkdownCopySource,
} from "../lib/markdownSelectionCopy";

export function useRegisterQuoteableTextSource<T extends HTMLElement>(
  ref: RefObject<T | null>,
  source: string | null | undefined,
  context?: MarkdownCopySourceContext,
  mode: CopySourceMode = "rendered",
): void {
  useEffect(() => {
    const element = ref.current;
    if (!element || !source?.trim()) {
      return;
    }
    return registerMarkdownCopySource(element, source, context, mode);
  }, [context, ref, source, mode]);
}

export function useQuoteableTextSource<T extends HTMLElement>(
  source: string | null | undefined,
  context?: MarkdownCopySourceContext,
  mode: CopySourceMode = "rendered",
): RefObject<T | null> {
  const ref = useRef<T | null>(null);
  useRegisterQuoteableTextSource(ref, source, context, mode);
  return ref;
}
