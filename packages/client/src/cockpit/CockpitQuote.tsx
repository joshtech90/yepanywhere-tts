import { useState } from "react";
import { useI18n } from "../i18n";
import styles from "./CockpitQuote.module.css";
import { COCKPIT_QUOTES, pickCockpitQuote } from "./core/quotes";

/**
 * The empty canvas shows a line of German literature, a new one on every
 * visit and on request (Joscha 26.09.2026: instead of an explanation).
 */
export function CockpitQuote() {
  const { t } = useI18n();
  const [index, setIndex] = useState(() => pickCockpitQuote(null));
  const quote = COCKPIT_QUOTES[index];
  if (!quote) return null;

  return (
    <figure aria-label={t("cockpitQuoteLabel")} className={styles.quote}>
      <blockquote lang="de">
        <p>{quote.text}</p>
      </blockquote>
      <figcaption>
        {quote.author}, <cite>{quote.work}</cite>
      </figcaption>
      <button
        className={styles.next}
        onClick={() => setIndex((current) => pickCockpitQuote(current))}
        type="button"
      >
        {t("cockpitQuoteNext")}
      </button>
    </figure>
  );
}
