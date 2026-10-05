import { runGit } from "./gitExec.js";

/** GitHub permalink backed by a locally known remote branch containing the commit. */
export async function githubFileLink(
  cwd: string,
  commit: string,
  path: string,
  git: typeof runGit = runGit,
): Promise<{ url: string; pushed: boolean } | null> {
  const { stdout: config } = await git(cwd, ["config", "--null", "--list"]);
  const remoteNames = [
    ...new Set(
      config.split("\0").flatMap((entry) => {
        const match = /^remote\.(.+)\.url\n/.exec(entry);
        return match?.[1] ? [match[1]] : [];
      }),
    ),
  ];
  const remotes = await Promise.all(
    remoteNames.map(async (name) => {
      const { stdout } = await git(cwd, ["remote", "get-url", name]);
      return { name, repository: githubRepositoryUrl(stdout.trim()) };
    }),
  );
  const githubRemotes = remotes.filter((remote) => remote.repository !== null);
  if (!githubRemotes.length) return null;

  const [tree, prefix, refs] = await Promise.all([
    git(cwd, ["ls-tree", "-z", commit, "--", `:(literal)${path}`]),
    git(cwd, ["rev-parse", "--show-prefix"]),
    git(cwd, [
      "for-each-ref",
      `--contains=${commit}`,
      "--format=%(refname)",
      "refs/remotes/",
    ]),
  ]);
  // Deleted paths and directories cannot name a committed file on GitHub.
  if (!/^\d+ blob /.test(tree.stdout)) return null;
  const containingRefs = refs.stdout.trim().split("\n");
  const pushedRemote = githubRemotes.find(({ name }) =>
    containingRefs.some((ref) => ref.startsWith(`refs/remotes/${name}/`)),
  );
  const remote = pushedRemote ?? githubRemotes[0];
  if (!remote) return null;
  const repositoryPath = `${prefix.stdout.trimEnd()}${path}`;
  return {
    url: `${remote.repository}/blob/${commit}/${repositoryPath.split("/").map(encodeURIComponent).join("/")}`,
    pushed: pushedRemote !== undefined,
  };
}

function githubRepositoryUrl(remote: string): string | null {
  const match =
    /^(?:git@github\.com:|(?:https?|git):\/\/github\.com\/|ssh:\/\/(?:git@)?github\.com(?::22)?\/)([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)\/?$/i.exec(
      remote,
    );
  if (!match) return null;
  const owner = match[1];
  const repository = match[2]?.replace(/\.git$/i, "");
  if (
    !owner ||
    owner === "." ||
    owner === ".." ||
    !repository ||
    repository === "." ||
    repository === ".."
  )
    return null;
  return `https://github.com/${owner}/${repository}`;
}
