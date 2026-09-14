#!/usr/bin/env bash
# Vendors the C4 test vectors from a pinned ticketto-offchain commit.
#
#   test/c4/vendor.sh <commit>   copy protocol/vectors/c4-v0.json at <commit> into
#                                test/c4/, and record the commit and the file's digest
#   test/c4/vendor.sh --check    fetch the recorded commit and fail if the vendored
#                                file differs from it
#
# The vectors are C4's (protocol/C4.md §6, owned by F-010). They are copied rather
# than read across repositories at test time, so this repository's tests never
# need a ticketto-offchain checkout. Fetching needs read access to the private
# repository; the tests themselves only check the recorded digest.
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
repository="https://github.com/KippuRocks/ticketto-offchain.git"
path="protocol/vectors/c4-v0.json"

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
git -C "$work/src" show "FETCH_HEAD:$path" > "$work/c4-v0.json"

if [[ "$mode" == check ]]; then
  if ! cmp -s "$work/c4-v0.json" "$here/c4-v0.json"; then
    echo "test/c4/c4-v0.json differs from $path at $commit" >&2
    exit 1
  fi
  echo "test/c4/c4-v0.json matches $path at $commit"
  exit 0
fi

cp "$work/c4-v0.json" "$here/c4-v0.json"
node - "$here" "$commit" "$repository" "$path" <<'NODE'
const { createHash } = require("node:crypto");
const { readFileSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const [dir, commit, repository, path] = process.argv.slice(2);
const sha256 = createHash("sha256").update(readFileSync(join(dir, "c4-v0.json"))).digest("hex");
const source = { repository, commit, path, file: "c4-v0.json", sha256 };
writeFileSync(join(dir, "source.json"), `${JSON.stringify(source, null, 2)}\n`);
NODE
echo "vendored $path at $commit"
