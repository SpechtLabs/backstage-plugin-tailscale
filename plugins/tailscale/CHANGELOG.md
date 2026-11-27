# @spechtlabs/backstage-plugin-tailscale

## 0.1.2

### Patch Changes

- 06ace4f: The plugin's styles survive an app's production build: the built stylesheet module (`tailscale.css.esm.js`) is listed as a side effect, so webpack no longer drops its import. Until now, every page and card rendered unstyled, and the access map's lines filled black.

## 0.1.1

### Patch Changes

- c978c8d: Published through npm trusted publishing, with provenance. No other change.
- Updated dependencies [c978c8d]
  - @spechtlabs/backstage-plugin-tailscale-common@0.1.1
