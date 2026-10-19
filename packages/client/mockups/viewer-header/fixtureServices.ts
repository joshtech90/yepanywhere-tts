/** Isolated header fixture: links stay local; Git availability is supplied. */
export function useRemoteBasePath() {
  return "";
}

export function useFileVersionControl(): never {
  throw new Error("Header fixture must supply its own Git availability");
}
