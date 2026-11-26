---
'@spechtlabs/backstage-plugin-tailscale-backend': patch
---

`backstage-tailscale-diff` says which path doesn't exist, or isn't a directory, instead of failing with `spawnSync git ENOENT`.
