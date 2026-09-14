/**
 * Shared issue/ticket glyph for navigation and session controls.
 *
 * The "#" that both Jira keys and GitHub issue numbers are written with. It
 * carries no frame of its own: the settings category already draws a rounded
 * tile around it, and an outlined card collapses into a dense block at sidebar
 * and chip sizes, where this has to stay scannable.
 */
export function IssueIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <line x1="4" x2="20" y1="9" y2="9" />
      <line x1="4" x2="20" y1="15" y2="15" />
      <line x1="10" x2="8" y1="3" y2="21" />
      <line x1="16" x2="14" y1="3" y2="21" />
    </svg>
  );
}
