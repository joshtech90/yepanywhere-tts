import { resolve } from "node:path";
import extensionConfig from "../../packages/client/vite.config.extension";

// Build-only replacement: the real ArtifactPreview and extension manifest
// assembly remain unchanged in this worktree.
export default (env: Parameters<typeof extensionConfig>[0]) => {
  const config = extensionConfig(env);
  config.plugins ??= [];
  config.plugins.unshift({
    name: "research-extension-artifact-preview",
    enforce: "pre" as const,
    resolveId(source: string) {
      if (source.endsWith("/ArtifactPreview"))
        return resolve(import.meta.dirname, "ArtifactPreview.tsx");
    },
  });
  return config;
};
