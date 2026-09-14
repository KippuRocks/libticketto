#!/usr/bin/env bash
# Vendors C4 — its document and its test vectors — from a pinned ticketto-offchain
# commit.
#
#   test/c4/vendor.sh <commit>   copy protocol/C4.md and protocol/vectors/c4-v0.json at
#                                <commit> into test/c4/, and record the commit and digests
#   test/c4/vendor.sh --check    fetch the recorded commit and fail if a vendored file
#                                differs from it
#
# C4 and its vectors are F-010's (protocol/C4.md §6). They are copied rather
# than read across repositories at test time, so this repository's tests never
# need a ticketto-offchain checkout. Fetching needs read access to the private
# repository; the tests themselves only check the recorded digest.
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
repository="https://github.com/KippuRocks/ticketto-offchain.git"
paths=("protocol/C4.md" "protocol/vectors/c4-v0.json")

mode=vendor
if [[ "${1:-}" == "--check" ]]; then
  mode=check
  commit=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).commit)' "$here/source.json")
elif [[ $# -eq 1 ]]; then
  commit=$1
  if [[ ! "$commit" =~ ^[0-9a-f]{40}$ ]]; then
    echo "pin a full 40-character commit hash" >&2
    exit 2
  fi
else
  echo "usage: $0 <commit> | --check" >&2
  exit 2
fi

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

git init --quiet "$work/src"
git -C "$work/src" fetch --quiet --depth 1 "$repository" "$commit"
for path in "${paths[@]}"; do
  git -C "$work/src" show "FETCH_HEAD:$path" > "$work/$(basename "$path")"
done

if [[ "$mode" == check ]]; then
  status=0
  for path in "${paths[@]}"; do
    file=$(basename "$path")
    if ! cmp -s "$work/$file" "$here/$file"; then
      echo "test/c4/$file differs from $path at $commit" >&2
      status=1
    fi
  done
  [[ $status -eq 0 ]] && echo "test/c4 matches ticketto-offchain at $commit"
  exit $status
fi

for path in "${paths[@]}"; do
  cp "$work/$(basename "$path")" "$here/$(basename "$path")"
done
node - "$here" "$commit" "$repository" "${paths[@]}" <<'NODE'
const { createHash } = require("node:crypto");
const { readFileSync, writeFileSync } = require("node:fs");
const { basename, join } = require("node:path");
const [dir, commit, repository, ...paths] = process.argv.slice(2);
const files = paths.map((path) => ({
  path,
  file: basename(path),
  sha256: createHash("sha256").update(readFileSync(join(dir, basename(path)))).digest("hex"),
}));
writeFileSync(join(dir, "source.json"), `${JSON.stringify({ repository, commit, files }, null, 2)}\n`);
NODE
echo "vendored ${paths[*]} at $commit"
