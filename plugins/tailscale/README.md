# @spechtlabs/backstage-plugin-tailscale

The frontend of [Tailscale for Backstage](https://github.com/SpechtLabs/backstage-plugin-tailscale)
(new frontend system): a tailnet policy console at `/tailscale` (access map,
grants, SSH, access preview, groups, tags, tests and the rendered policy
file), a _Policy_ tab on policy entities, and cards on Component, API,
Resource, Group, User and Tailscale entity pages.

```sh
yarn --cwd packages/app add @spechtlabs/backstage-plugin-tailscale
```

With feature discovery there is nothing else to do; otherwise add the default
export to `createApp({ features })`. It needs the backend plugin,
`@spechtlabs/backstage-plugin-tailscale-backend`. See the
[repository's README](https://github.com/SpechtLabs/backstage-plugin-tailscale#readme)
for modelling a tailnet in the catalog.

Not made or endorsed by Tailscale Inc.
