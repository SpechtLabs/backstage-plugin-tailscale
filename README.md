# Tailscale for Backstage

Keep your [Tailscale](https://tailscale.com) tailnet policy in the Backstage
software catalog. Grants come from what the catalog already knows (which
Component consumes which API, where an API is reached, who may use it), and
everything else from `kind: Tailscale` entities. Backstage puts the policy
file together, shows it, and keeps a pull request open with it in the
repository it is applied from.

> This is a community plugin by SpechtLabs. It is not made, endorsed or
> supported by Tailscale Inc. "Tailscale" is a trademark of Tailscale Inc.

## What you get

- **A policy console** at `/tailscale`, and as a _Policy_ tab on each policy
  entity:
  - an access map of every grant, with destinations grouped by what they are
    (Services, peer meshes, capability targets, autogroups) and capability
    grants drawn as a layer of their own;
  - grants, Tailscale SSH, groups, tags, hosts, node attributes, auto
    approvers and tests, each linked to the entity it comes from;
  - **Preview access**: pick a user, group or tag and see what it can reach,
    or pick a destination and see who reaches it;
  - the rendered policy file, with each entity's lines highlighted;
  - health checks: selectors that don't resolve, devices reached without a
    reason, capabilities or Services on every port.
- **Cards on entity pages**: a Component, API, Resource, Group or User shows
  how it is on the tailnet (what it reaches, who reaches it, SSH, tags); a
  Tailscale entity shows its rule and the lines it renders to.
- **Publishing**: the rendered file goes to a GitHub repository as a pull
  request kept up to date, or as a direct push.
- **A local check**: `backstage-tailscale-diff` renders a policy from local
  checkouts and compares it with a policy file, so a change can be checked
  before it is pushed.

## Packages

| Package                                                                                                     | What                                                                                                             |
| ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| [`@spechtlabs/backstage-plugin-tailscale`](plugins/tailscale)                                               | Frontend plugin (new frontend system): the page, the Policy tab, the entity cards                                |
| [`@spechtlabs/backstage-plugin-tailscale-backend`](plugins/tailscale-backend)                               | Backend plugin: renders the policies, serves `/api/tailscale`, publishes; the `backstage-tailscale-diff` command |
| [`@spechtlabs/backstage-plugin-catalog-backend-module-tailscale`](plugins/catalog-backend-module-tailscale) | Catalog module: `kind: Tailscale`, its validation and relations                                                  |
| [`@spechtlabs/backstage-plugin-tailscale-common`](plugins/tailscale-common)                                 | Shared: the entity model, validation, relations, API types                                                       |

## Install

Backend (new backend system):

```sh
yarn --cwd packages/backend add \
  @spechtlabs/backstage-plugin-tailscale-backend \
  @spechtlabs/backstage-plugin-catalog-backend-module-tailscale
```

```ts
// packages/backend/src/index.ts
backend.add(import('@spechtlabs/backstage-plugin-tailscale-backend'));
backend.add(
  import('@spechtlabs/backstage-plugin-catalog-backend-module-tailscale'),
);
```

Frontend (new frontend system):

```sh
yarn --cwd packages/app add @spechtlabs/backstage-plugin-tailscale
```

With feature discovery (`app.packages: all`) there is nothing else to do.
Otherwise add it to `createApp({ features: [...] })`:

```ts
import tailscalePlugin from '@spechtlabs/backstage-plugin-tailscale';
```

### Where the entities may come from

A tailnet policy decides who reaches what, so allow `kind: Tailscale` from
one location only. Catalog rules match an entity's _origin_ location, so
register the directory that holds the policy as a location of its own, with
a rule for just that location, and keep it out of any other `Location`:

```yaml
catalog:
  locations:
    - type: url
      target: https://github.com/acme/network/blob/main/tailscale/policy/*.yaml
      rules:
        - allow: [Tailscale]
```

## Modelling a tailnet

### The policy and its parts

Every policy is one entity of `spec.type: policy`; every other Tailscale
entity names it in `spec.target`. Fields other than `type`, `target`,
`owner`, `system` and `appliesTo` are the policy file's own, written as in
the file.

```yaml
apiVersion: specht-labs.de/v1alpha1
kind: Tailscale
metadata:
  name: my-tailnet
  title: Our tailnet
spec:
  type: policy
  owner: group:platform
  tailnet: example.ts.net
  # Grants from the catalog's annotations (below).
  catalogGrants: true
  hosts:
    build-box: 100.64.0.10
  # Other top-level keys, rendered as they are.
  settings:
    randomizeClientPort: true
  # Where the rendered file goes (see Publishing).
  publish:
    repo: acme/network
    path: tailscale/policy.hujson
    flow: pullRequest
---
apiVersion: specht-labs.de/v1alpha1
kind: Tailscale
metadata:
  name: tag-ci-runner
  title: CI runners
spec:
  type: tag
  target: tailscale:my-tailnet
  owner: group:platform
  tag: tag:ci-runner
  owners: [group:platform]
  appliesTo: [resource:ci-runners]
---
apiVersion: specht-labs.de/v1alpha1
kind: Tailscale
metadata:
  name: grant-admins
  title: Admins reach everything
spec:
  type: grant
  target: tailscale:my-tailnet
  owner: group:platform
  src: [group:admins]
  dst: ['*']
  ip: ['*']
```

| `spec.type`     | Renders to                        | Fields                                                                  |
| --------------- | --------------------------------- | ----------------------------------------------------------------------- |
| `policy`        | the file                          | `tailnet`, `hosts`, `catalogGrants`, `settings`, `publish`              |
| `grant`         | one entry of `grants`             | `src`, `dst`, `ip`, `app`, `via`, `srcPosture`                          |
| `ssh`           | one entry of `ssh`                | `action`, `src`, `dst`, `users`, `checkPeriod`, `acceptEnv`, `recorder` |
| `tag`           | one tag of `tagOwners`            | `tag`, `owners`                                                         |
| `nodeAttr`      | one entry of `nodeAttrs`          | `nodes` (the file's `target`), `attr`, `app`, `ipPool`                  |
| `autoApprovers` | part of `autoApprovers`           | `routes`, `services`, `exitNode`                                        |
| `test`          | entries of `tests` and `sshTests` | `tests`, `sshTests`: one test or a list                                 |

`appliesTo` names catalog entities a part is about (a tag's devices, a
grant's services): their pages list it.

### Users and groups

Users and groups are the catalog's own. `group:<name>` in a Tailscale entity
is the Backstage Group annotated with it, and its members are the Group's
Users:

```yaml
apiVersion: backstage.io/v1alpha1
kind: Group
metadata:
  name: tailnet-admins
  annotations:
    specht-labs.de/tailnet-group: group:admins
spec:
  type: team
  children: []
---
apiVersion: backstage.io/v1alpha1
kind: User
metadata:
  name: alice
  annotations:
    specht-labs.de/tailnet-login: alice@github
spec:
  memberOf: [tailnet-admins]
```

`user:alice` (a User's ref) renders as her login, `alice@github`.

### Grants from the catalog

With `catalogGrants: true`, the services say who reaches them, through
annotations:

| On                     | Annotation                             | Says                                                                        |
| ---------------------- | -------------------------------------- | --------------------------------------------------------------------------- |
| API                    | `specht-labs.de/tailnet-dst`           | where it is reached: `svc:<name>` or `tag:<name>`                           |
| API                    | `specht-labs.de/tailnet-ports`         | on which ports: `tcp:443, tcp:8080`                                         |
| API                    | `specht-labs.de/tailnet-allow`         | who else may use it: groups, users, autogroups, tags                        |
| API                    | `specht-labs.de/tailnet-client-tag`    | the tag every consumer reaches it as, when that is an attribute of using it |
| Component              | `specht-labs.de/tailnet-src`           | the tags its traffic comes from                                             |
| Tailscale `tag` entity | `specht-labs.de/tailnet-device-reason` | why traffic goes to devices carrying the tag rather than to a Service       |

A Component that consumes an API from outside the provider's
`kubernetes-cluster` Resource (by `dependsOn`) gets a grant to it; whoever
`tailnet-allow` names gets one too. Grants to the same destination and ports
are merged. A consumption that a grant entity already allows by naming its
destination gets none of its own.

### Destinations

A destination should be a Tailscale Service. Backstage says what each one
is: a **Service**, a **peer mesh** (a tag that reaches itself: every member
at its own address), a **capability target** (reached by a grant with
`app`), an **autogroup**, or **everything**. Any other tag destination is a
device: say why on its tag entity (`specht-labs.de/tailnet-device-reason`),
or the policy warns.

## Publishing

A policy's `spec.publish` says where its file goes:

| Field               |                                                                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `repo`              | `owner/name` on GitHub                                                                                                               |
| `path`              | the file, e.g. `tailscale/policy.hujson`                                                                                             |
| `flow`              | `pullRequest` (default): one pull request kept up to date, closed once the base branch has the file; or `push`: commit to the branch |
| `branch`            | the branch the file lands on; the repository's default if unset                                                                      |
| `pullRequestBranch` | for `pullRequest`, the branch Backstage owns and force-pushes; default `backstage/tailscale-<policy>`                                |

Backstage writes only to repositories listed in its config, and uses the
GitHub integration's credentials (a GitHub App needs contents and pull
requests write access):

```yaml
tailscale:
  allowedRepos:
    - acme/network
```

It publishes every hour (task `tailscale-publish`, which DevTools' Scheduled
Tasks can trigger). Applying the file to the tailnet stays with the
repository, for example with Tailscale's
[GitOps action](https://github.com/tailscale/gitops-acl-action).

## Checking a change locally

```sh
npx -p @spechtlabs/backstage-plugin-tailscale-backend backstage-tailscale-diff \
  path/to/policy.hujson path/to/catalog-repo another/catalog-repo
```

It reads every catalog YAML in the given checkouts (tracked and untracked
files), rebuilds the relations the catalog would add, prints each
destination's class and the policy's problems, and lists what each section
allows that the other file doesn't. A grant to a Service on `*` counts as the
ports the Service's APIs list. Exit status 1 means a difference or an error.
`--policy <name>` picks a policy, `--out` writes the rendered file, `--json`
what `/api/tailscale/overview` serves.

## API

|                                                     |                                                                                                      |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `GET /api/tailscale/overview`                       | every policy: its parts, rules, groups, destinations, problems, the rendered file, publishing status |
| `GET /api/tailscale/policies/:namespace/:name/file` | one policy's file                                                                                    |
| `GET /api/tailscale/access?entity=<ref>`            | what concerns one catalog entity                                                                     |

## Development

Tools are pinned in `mise.toml` (Node, Yarn).

```sh
yarn install
yarn tsc && yarn lint:all && yarn test && yarn build
```

Every change to a package comes with a changeset (`yarn changeset`).
Merging to `main` keeps a release pull request open; merging that publishes
to npm.

## License

[Apache-2.0](LICENSE)
