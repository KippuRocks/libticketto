#!/usr/bin/env bash
# Builds the Hermes VM from the facebook/hermes release that matches the
# `hermes-compiler` React Native ships, so the bytecode test/hermes/run.ts
# compiles runs on the engine that produced its compiler.
#
#   test/hermes/build-vm.sh <dir>      prints <dir>/bin/hermes
#
# Needs git, cmake, ninja and a C++ toolchain (on Linux also libicu-dev). Reuses
# an existing build in <dir>.
set -euo pipefail

out="${1:?usage: build-vm.sh <dir>}"
package_root="$(cd "$(dirname "$0")/../.." && pwd)"
version="$(cd "$package_root" && node -p 'require("hermes-compiler/package.json").version')"
mkdir -p "$out"
out="$(cd "$out" && pwd)"

if [ -x "$out/bin/hermes" ] && [ "$(cat "$out/VERSION" 2>/dev/null)" = "$version" ]; then
  echo "$out/bin/hermes"
  exit 0
fi

rm -rf "$out/src" "$out/build" "$out/bin"
git clone --quiet --depth 1 --branch "hermes-v$version" https://github.com/facebook/hermes.git "$out/src" >&2
cmake -S "$out/src" -B "$out/build" -G Ninja -DCMAKE_BUILD_TYPE=Release >&2
cmake --build "$out/build" --target hermes >&2
mkdir -p "$out/bin"
cp "$out/build/bin/hermes" "$out/bin/hermes"
echo "$version" > "$out/VERSION"
rm -rf "$out/src" "$out/build"
echo "$out/bin/hermes"
