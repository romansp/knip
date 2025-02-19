---
title: Known Issues
---

This page contains a list of known issues when running Knip.

## TS config files using ESM features

Knip may fail when a plugin tries to load a TypeScript configuration file (e.g.
`vite.config.ts`) with an error message like one of these:

```
SyntaxError: Cannot use 'import.meta' outside a module
...
SyntaxError: await is only valid in async functions and the top level bodies of modules
...
SyntaxError: missing ) after argument list
...
SyntaxError: Unexpected identifier 'Promise'
```

This is caused by Knip using [jiti][1] to load and execute TypeScript
configuration files that contains ESM syntax (such as top-level await), which
may incorrectly consider it as CommonJS (instead of not transforming ESM).

Potential workarounds:

- Turn the configuration file from TS into JS (e.g. `vitest.config.ts` →
  `vitest.config.js`). Knip loads modules directly using native `import()`
  calls. This is the recommended workaround.
- Add the config file to the list of [ignore][2] patterns.
- [Disable the plugin][3].

Use `knip --debug` in a monorepo to help locate where the error is coming from.

Issues like [#72][4] and [#194][5] are hopefully fixed in [jiti v2][6]. By the
way, nothing but love for jiti (it's awesome).

[GitHub Issue #346][7]

## Reflect.metadata is not a function

Similar to the previous known issue, this is caused through (not by) jiti:

```sh
TypeError: Reflect.metadata is not a function
```

[GitHub Issue #355][8]

[1]: https://github.com/unjs/jiti
[2]: ./configuration.md#ignore
[3]: ./configuration.md#plugins
[4]: https://github.com/unjs/jiti/issues/72
[5]: https://github.com/unjs/jiti/issues/194
[6]: https://github.com/unjs/jiti/issues/174
[7]: https://github.com/webpro/knip/issues/346
[8]: https://github.com/webpro/knip/issues/355
