import { useSyncExternalStore } from "react";
import { createLocalStorageBoolean } from "../lib/localStorageValue";
import { UI_KEYS } from "../lib/storageKeys";

const store = createLocalStorageBoolean(UI_KEYS.questionAsides, false);

export function useQuestionAsideSetting() {
  const questionAsidesEnabled = useSyncExternalStore(
    store.subscribe,
    store.read,
    store.read,
  );
  return { questionAsidesEnabled, setQuestionAsidesEnabled: store.set };
}
