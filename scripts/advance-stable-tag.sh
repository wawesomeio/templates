#!/usr/bin/env bash
#
# Move one template's stable ref to the commit CI is running on.
#
# The indirection that keeps template fixes off both release cadences: the
# catalogue names this tag once and never changes again, and rolling a bad
# template back is moving one ref — no gateway deploy, no CLI release.
#
# Shared by the two jobs that publish (see .github/workflows/templates.yml), so
# what "advance the tag" means cannot drift between the gated path and the
# scaffolding-phase one. Which of them may call it is the workflow's decision;
# this script only does it.
#
# Usage: scripts/advance-stable-tag.sh <template-directory>

set -euo pipefail

template="${1:?usage: advance-stable-tag.sh <template-directory>}"
sha="${GITHUB_SHA:?GITHUB_SHA must be set}"

ref=$(jq -r '.ref' "$template/template.json")

# Flat, never slashed: git cannot hold both a ref named for a template and refs
# nested beneath that name, and a slash is rewritten as a hyphen inside the
# fetched archive's root directory. The manifest schema enforces this too; here
# it guards the push itself.
case "$ref" in
  */* | "" | null)
    echo "::error::ref '$ref' must be a flat tag."
    exit 1
    ;;
esac

git config user.name "github-actions[bot]"
git config user.email "github-actions[bot]@users.noreply.github.com"
git tag -f "$ref" "$sha"
git push -f origin "refs/tags/$ref"
echo "Stable ref '$ref' now points at $sha"
