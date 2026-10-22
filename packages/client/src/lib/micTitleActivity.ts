export const MIC_TITLE_ATTRIBUTE = "data-ya-mic-phase";
export type MicTitlePhase = "starting" | "capturing";

// One entry per live recording/control; owners remove themselves on teardown.
// Unlike playback ducking, this excludes idle retained microphone tracks.
const owners = new Map<object, MicTitlePhase>();

export function setMicTitleActivity(
  owner: object,
  phase: MicTitlePhase | null,
) {
  if (phase) owners.set(owner, phase);
  else owners.delete(owner);
  const title = document.querySelector("title");
  if (!title) return;
  const aggregate = [...owners.values()].includes("capturing")
    ? "capturing"
    : owners.size > 0
      ? "starting"
      : null;
  if (aggregate) title.setAttribute(MIC_TITLE_ATTRIBUTE, aggregate);
  else title.removeAttribute(MIC_TITLE_ATTRIBUTE);
}

export function getMicTitlePrefix(): string {
  const phase = document
    .querySelector("title")
    ?.getAttribute(MIC_TITLE_ATTRIBUTE);
  return phase === "capturing" ? "🎙 " : phase === "starting" ? "◷🎙 " : "";
}
