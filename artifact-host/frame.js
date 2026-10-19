(() => {
  const PROTOCOL = "yep-artifact-preview/1";
  const init = parent.__yepArtifactInit ?? {};
  let widgetState = init.widgetState ?? null;
  const theme = init.theme === "dark" ? "dark" : "light";
  const post = (message) =>
    parent.postMessage({ protocol: PROTOCOL, ...message }, location.origin);
  window.openai = {
    theme,
    get widgetState() {
      return widgetState;
    },
    setWidgetState(value) {
      const json = JSON.stringify(value);
      if (json.length > 65536) throw new Error("Widget state exceeds 64 KiB");
      widgetState = JSON.parse(json);
      post({ type: "widget-state", state: widgetState });
      return Promise.resolve();
    },
    sendFollowUpMessage(value) {
      const text = typeof value === "string" ? value : value?.prompt;
      if (typeof text !== "string" || !text.trim() || text.length > 8000)
        return Promise.reject(
          new Error("Expected a follow-up up to 8000 characters"),
        );
      post({ type: "followup", text });
      return Promise.resolve();
    },
  };
  window.theme = theme;
  window.__theme = theme;
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
})();
