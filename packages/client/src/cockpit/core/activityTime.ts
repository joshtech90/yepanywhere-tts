export interface CockpitActivityTime {
  label: string;
  title?: string;
}

function sameDay(left: Date, right: Date): boolean {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

/**
 * A list only needs the clock for today and the day for anything older; the
 * full date stays in the tooltip.
 */
export function formatCockpitActivityTime(
  value: string | undefined,
  locale: string,
  now: Date = new Date(),
): CockpitActivityTime | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return null;
  const date = new Date(parsed);
  const title = new Intl.DateTimeFormat(locale, {
    dateStyle: "full",
    timeStyle: "short",
  }).format(date);
  if (sameDay(date, now)) {
    return {
      label: new Intl.DateTimeFormat(locale, { timeStyle: "short" }).format(
        date,
      ),
      title,
    };
  }
  return {
    label: new Intl.DateTimeFormat(locale, {
      day: "2-digit",
      month: "2-digit",
      ...(date.getFullYear() === now.getFullYear()
        ? {}
        : { year: "2-digit" as const }),
    }).format(date),
    title,
  };
}
