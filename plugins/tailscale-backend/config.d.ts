export interface Config {
  /** The Tailscale plugin. */
  tailscale?: {
    /**
     * The GitHub repositories (owner/name) Backstage may write a policy file
     * to. A policy entity's spec.publish names where its file goes; a
     * repository missing here isn't written to. Unset: none.
     */
    allowedRepos?: string[];
  };
}
