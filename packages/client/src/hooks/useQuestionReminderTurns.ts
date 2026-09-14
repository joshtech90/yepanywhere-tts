import { useSyncExternalStore } from "react";
import { createLocalStorageValue } from "../lib/localStorageValue";
import { UI_KEYS } from "../lib/storageKeys";

const store = createLocalStorageValue(
  UI_KEYS.questionReminderTurns,
  3,
  (raw) => {
    const value = Number(raw);
    return Number.isInteger(value) && value >= 0 && value <= 12
      ? value
      : undefined;
  },
);

export function setQuestionReminderTurns(value: number): void {
  if (!Number.isInteger(value) || value < 0 || value > 12) {
    throw new RangeError(
      "Question reminder turns must be an integer from 0 to 12",
    );
  }
  store.set(value);
}

export function useQuestionReminderTurns(): number {
  return useSyncExternalStore(store.subscribe, store.read, store.read);
}
