# @spechtlabs/backstage-plugin-tailscale-backend

The backend of [Tailscale for Backstage](https://github.com/SpechtLabs/backstage-plugin-tailscale):
renders each tailnet policy from the catalog's `kind: Tailscale` entities,
Users and Groups, and the services' `specht-labs.de/tailnet-*` annotations;
serves it under `/api/tailscale`; and publishes the policy file to GitHub as
a pull request or a push.

```sh
yarn --cwd packages/backend add @spechtlabs/backstage-plugin-tailscale-backend
```

```ts
backend.add(import('@spechtlabs/backstage-plugin-tailscale-backend'));
```

```yaml
tailscale:
  # The repositories a policy's spec.publish may name.
  allowedRepos: [acme/network]
```

It also ships `backstage-tailscale-diff`, which renders a policy from local
catalog checkouts and compares it with a policy file:

```sh
npx -p @spechtlabs/backstage-plugin-tailscale-backend backstage-tailscale-diff \
  path/to/policy.hujson path/to/catalog-repo...
```

See the [repository's README](https://github.com/SpechtLabs/backstage-plugin-tailscale#readme).
Not made or endorsed by Tailscale Inc.
