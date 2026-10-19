/** A page with a clock: the view a session or project showed most recently. */
export function LastViewIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 3h7l3 3v5M12 3v3h3M5 3v18h6" />
      <circle cx="17" cy="17" r="4.5" />
      <path d="M17 14.8V17l1.6 1" />
    </svg>
  );
}
