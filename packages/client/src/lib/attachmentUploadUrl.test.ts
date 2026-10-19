import { expect, it } from "vitest";
import { getPersistedAttachmentUploadUrl } from "./attachmentUploadUrl";

it("routes rendez snapshots and other absolute uploads through authorized local media", () => {
  for (const path of [
    "/work/project/.rendez/delivered/session/event/file.png",
    "/work/project/screenshots/example.png",
    "C:\\work\\project\\screenshots\\example.png",
  ]) {
    expect(getPersistedAttachmentUploadUrl(path)).toBe(
      `/api/local-image?path=${encodeURIComponent(path)}`,
    );
  }
  expect(getPersistedAttachmentUploadUrl("relative.png")).toBeNull();
});
