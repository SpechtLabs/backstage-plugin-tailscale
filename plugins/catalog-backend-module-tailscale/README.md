# @spechtlabs/backstage-plugin-catalog-backend-module-tailscale

Catalog module of [Tailscale for Backstage](https://github.com/SpechtLabs/backstage-plugin-tailscale):
adds `kind: Tailscale` (apiVersion `specht-labs.de/v1alpha1`) to the catalog,
validates it, and relates each entity to its policy, owner, system and the
entities it applies to.

```sh
yarn --cwd packages/backend add @spechtlabs/backstage-plugin-catalog-backend-module-tailscale
```

```ts
backend.add(
  import('@spechtlabs/backstage-plugin-catalog-backend-module-tailscale'),
);
```

Allow the kind from the one location your policy lives in (catalog rules
match an entity's origin location):

```yaml
catalog:
  locations:
    - type: url
      target: https://github.com/acme/network/blob/main/tailscale/policy/*.yaml
      rules:
        - allow: [Tailscale]
```

Not made or endorsed by Tailscale Inc.
