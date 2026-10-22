export const COMPOSER_BEACON_ATTRIBUTE = "data-ya-composer-beacon";
const BEACON_SUFFIX =
  / (?:[↥◷✓!] )?\[YA1 f=\d+ r=\d+ a=\d+ s=(?:idle|sending|queued|delivered|error)\](?: w=[01])?$/u;

/** Keep the machine-readable composer beacon outside human title formatting. */
export function stripComposerBeacon(title: string): string {
  return title.replace(BEACON_SUFFIX, "");
}

export function appendComposerBeacon(title: string): string {
  const beacon = document
    .querySelector("title")
    ?.getAttribute(COMPOSER_BEACON_ATTRIBUTE);
  const humanTitle = stripComposerBeacon(title);
  return beacon ? `${humanTitle} ${beacon}` : humanTitle;
}
