---
'@spechtlabs/backstage-plugin-tailscale': patch
---

The plugin's styles survive an app's production build: the built stylesheet module (`tailscale.css.esm.js`) is listed as a side effect, so webpack no longer drops its import. Until now, every page and card rendered unstyled, and the access map's lines filled black.
