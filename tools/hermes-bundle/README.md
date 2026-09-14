# hermes-bundle

Checks that the packages running inside React Native apps — `@ticketto/sdk`,
`@ticketto/profile-v0` and `@ticketto/binding-offchain`
(`features/001-workspace/plan.md` §5.3) — bundle for React Native and compile
to Hermes bytecode. Traces `NFR-3`: Saifu produces passes on the device, so the
SDK path must run under Hermes.

```sh
pnpm build
pnpm hermes
```

For each package and each platform (`android`, `ios`) it:

1. bundles the package with **Metro**, using `@react-native/metro-config`'s
   defaults — the `react-native` export condition, React Native's platforms and
   polyfills — and `@react-native/babel-preset`, as an app would;
2. compiles the bundle with the **`hermesc`** React Native ships
   (`hermes-compiler`), `-emit-binary -O`, and checks the output is Hermes
   bytecode.

The only departure from an app's configuration is that `react-native`'s own
start-up module is not prepended: a library bundle has no app to start.

A Node.js built-in anywhere in the graph (`node:fs`, `crypto`, …) cannot be
resolved for React Native, and the bundle fails. `src/bundle.test.ts` proves it
by appending such an import to a copy of the built `sdk`. Node-only *globals*
(`Buffer`, `process`) are refused earlier, by the base TypeScript
configuration, which loads no Node types.

Output lands in `.hermes/` (ignored).
