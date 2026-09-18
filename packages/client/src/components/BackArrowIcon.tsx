/** Shared back arrow so every viewer-level back control reads the same. */
export function BackArrowIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M13.5 8h-11M6.5 4l-4 4 4 4" />
    </svg>
  );
}
