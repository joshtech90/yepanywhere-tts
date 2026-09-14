import { useCallback, useMemo, useState } from "react";
import { useRecentProjectPathLinks } from "../../../hooks/useRecentProjectPathLinks";
import { getCachedWebTranscriptProjection } from "../../../lib/webTranscriptProjection";
import type { Message } from "../../../types";
import { RenderItemComponent } from "../../RenderItemComponent";

export function TaskNestedContent({
  messages,
  isStreaming,
}: {
  messages: Message[];
  isStreaming: boolean;
}) {
  const { recentProjectPathLinksEnabled } = useRecentProjectPathLinks();
  const [thinkingExpanded, setThinkingExpanded] = useState(false);
  const toggleThinkingExpanded = useCallback(() => {
    setThinkingExpanded((prev) => !prev);
  }, []);

  const renderItems = useMemo(
    () =>
      getCachedWebTranscriptProjection(
        messages,
        undefined,
        recentProjectPathLinksEnabled,
      ),
    [messages, recentProjectPathLinksEnabled],
  );

  return (
    <div className="task-nested-content">
      {renderItems.map((item) => (
        <RenderItemComponent
          key={item.id}
          item={item}
          isStreaming={isStreaming}
          thinkingExpanded={thinkingExpanded}
          toggleThinkingExpanded={toggleThinkingExpanded}
        />
      ))}
    </div>
  );
}

export function Spinner() {
  return (
    <svg
      className="spinner"
      viewBox="0 0 16 16"
      width="12"
      height="12"
      aria-hidden="true"
    >
      <circle
        cx="8"
        cy="8"
        r="6"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeDasharray="24"
        strokeDashoffset="8"
      />
    </svg>
  );
}

/**
 * Task tool result - shows agent response with nested content
 * (Legacy - used when expanded in standard tool row)
 */
