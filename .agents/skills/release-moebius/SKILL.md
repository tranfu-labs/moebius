---
name: release-moebius
description: Publish or repair a Moebius GitHub Release with synchronized versions and CHANGELOG, signed and Apple-notarized macOS arm64 DMG/ZIP artifacts, stapled tickets, hashes, tag, and remote verification. Use when the user asks to release Moebius, publish a version, resume a failed release, replace release artifacts, or add/fix signing or notarization on an existing Moebius release. Do not use for feature development, website-only deployment, non-Moebius repositories, or Windows, Linux, x64, or universal artifacts.
---

# Release Moebius

Publish or repair one production version of `tranfu-labs/moebius`. The target outcome is a verified, non-draft, non-prerelease GitHub Release `v<VERSION>` containing exactly one macOS arm64 DMG, one final ZIP, one `latest-mac.yml`, and any ZIP blockmap sidecar explicitly referenced by that YML.

A fresh release request authorizes release-metadata edits, a release commit, annotated tag, push, and GitHub Release creation. Replacing assets or changing an existing public Release requires an explicit repair/resume request. NEVER modify product behavior, move an existing tag, or include unrelated files.

## Constants

- Require Developer ID Application Team `QV657S58FL`.
- Use notarytool Keychain profile `${MOEBIUS_NOTARY_PROFILE:-moebius-notary-qv657}`. The profile name is not a secret; NEVER print, store, or request the Apple ID password or app-specific password after the profile exists.
- Produce only `Moebius-<VERSION>-mac-arm64.dmg`, `Moebius-<VERSION>-mac-arm64.zip`, `latest-mac.yml`, and the final ZIP's `.blockmap` sidecar when the YML references it. The `.app` is inside the final ZIP; it is signed, notarized, and stapled before that ZIP is frozen. The ZIP itself is not described as stapled.

## Workflow

Create a TODO list for the applicable steps and update it after every step.

### 1. Select fresh-release or repair mode

- Accept a semantic version without `v`, or an explicit confirmation of a version previously recommended by this skill.
- If no version is given, inspect the latest stable `v*` Release and the real diff through current `main`; recommend exactly one patch/minor/major version and stop for explicit confirmation without mutation.
- Verify this is the Moebius repository, activate `.nvmrc`, require Node 24 and pnpm 9.15.4, and verify `gh` repository write access.
- Fetch `origin/main` and tags without merging.
- If `v<VERSION>` does not exist, use **fresh-release mode**. Require local `main` synchronized with `origin/main` and no unrelated changes.
- If the tag or Release exists, continue only for an explicit resume/repair request and use **repair mode**. Resolve the annotated tag to its release commit; NEVER move it or build replacement artifacts from a newer `main`. Reuse artifacts proven to come from that commit, or rebuild in an isolated temporary worktree at the tag.

### 2. Prepare a fresh release

Skip this section in repair mode unless the user explicitly asks to repair missing metadata.

- Read the previous stable tag, Release, and commit diff. Require `<VERSION>` greater than the previous semantic version.
- Set `<VERSION>` in `package.json`, `desktop/package.json`, `packages/console-ui/package.json`, and `prototypes/package.json`.
- Update `CHANGELOG.md` in Keep a Changelog format using only changes since the previous tag. Preserve `[Unreleased]` and update compare links.
- Require only expected release-metadata changes, then run `git diff --check`.

### 3. Run release gates

- Run all pnpm commands under Node 24.
- Default gates are `pnpm install --frozen-lockfile`, `pnpm test`, `pnpm typecheck`, and `pnpm --filter @moebius/prototypes check`; build only after applicable gates pass.
- A user may explicitly waive tests, typecheck, prototype checks, or remote CI. NEVER infer a waiver. Record every skipped gate in the final report and do not describe the release as fully gated.
- Redirect long output to `/tmp` and inspect exit codes plus relevant tails.
- If an unwaived gate fails, stop before commit, tag, or Release mutation.

### 4. Build and identify the signing identity

- Run `pnpm --filter @moebius/desktop dist` for macOS arm64 only.
- Inspect `security find-identity -v -p codesigning`. Select a valid `Developer ID Application` identity whose Team ID is exactly `QV657S58FL`; stop if none or the selection is ambiguous. Prefer Team ID and full identity over a certificate fingerprint because certificates rotate.
- Verify the generated `.app` with `codesign --verify --deep --strict --verbose=2`, require Team ID `QV657S58FL`, bundle short/build versions equal `<VERSION>`, and an arm64 executable.

### 5. Notarize the App before final packaging

- Verify the Keychain profile with `xcrun notarytool history --keychain-profile <PROFILE>` without exposing credentials.
- Submit a ditto-created ZIP containing the signed `.app` with `xcrun notarytool submit ... --wait`. Require status `Accepted` and retain the submission ID; on rejection, retrieve the notary log and stop.
- Run `xcrun stapler staple <APP>` and `xcrun stapler validate <APP>`.
- Require `spctl --assess --type execute -vvv <APP>` to report `accepted` and `source=Notarized Developer ID`.
- Rebuild the final ZIP and DMG from this stapled App using electron-builder `--prepackaged`. Do not upload artifacts produced before the App was stapled.
- After every final signing/stapling operation, copy the final builder output into a clean staging directory with `pnpm release:prepare-update --input <builder-output> --output <release-dir> --version <VERSION>`. This copies only the final DMG, final ZIP, and final ZIP blockmap, generates `latest-mac.yml` from the frozen ZIP bytes, and excludes the DMG blockmap/intermediate files. Then run `pnpm release:validate-update --dir <release-dir> --version <VERSION>`; the validator parses the generated YML, requires its version and ZIP filename to match the final arm64 ZIP, and recomputes the ZIP byte size and SHA-512.

### 6. Sign and notarize the outer DMG

- Sign the final DMG with `codesign --force --timestamp --sign <IDENTITY> <DMG>`, then verify its signature and Team ID.
- Submit the signed DMG with notarytool and require `Accepted`; retain the submission ID.
- Only after acceptance, staple and validate the DMG ticket. NEVER sign or otherwise rewrite the DMG after stapling because that invalidates the ticket.
- Require all final checks:
  - DMG: `codesign --verify`, `xcrun stapler validate`, Gatekeeper open assessment using `spctl --assess --type open --context context:primary-signature -vvv`, and `hdiutil verify`.
  - App: strict deep codesign verification, stapler validation, Gatekeeper execute acceptance, Team ID, versions, and arm64 architecture.
  - ZIP: extract with `ditto` into a fresh system temporary directory and repeat the App codesign, stapler, Gatekeeper, version, and architecture checks on the extracted App.
- Record DMG/ZIP byte sizes and SHA-256 only after all final signing and stapling operations.

### 7. Commit, CI, and tag a fresh release

Skip this section in repair mode.

- Commit release metadata as `chore(release): prepare v<VERSION>`.
- Fetch again; if remote moved, stop before tagging. Push `main` without the tag.
- Unless explicitly waived, find the push-triggered `CI` run whose `headSha` exactly equals the release commit, allow up to five minutes for it to appear, wait for completion, and require success.
- Fetch again. Before tagging, require local `main`, `origin/main`, and any required successful CI `headSha` to equal the release commit.
- Create annotated tag `v<VERSION>` with message `Moebius v<VERSION>` and push only that tag.

### 8. Publish or repair the GitHub Release

- Write Chinese notes from the tagged diff. State macOS arm64-only support, Developer ID Team `QV657S58FL`, successful Apple notarization with stapled App/DMG tickets, and final SHA-256 hashes.
- Fresh mode: create a verified-tag Draft Release titled `Moebius v<VERSION>`.
- Repair mode: preserve the tag and release highlights. If the Release is public, temporarily change it to Draft immediately before asset replacement so users cannot download a mixed pair.
- Run `pnpm release:upload-assets --tag v<VERSION> --dir <release-dir> --version <VERSION>` to validate the local directory and upload an explicit whitelist of the final DMG, final ZIP, `latest-mac.yml`, and the YML-referenced ZIP blockmap sidecar. This command passes exact file paths to `gh`, never a globbed output directory, and never uploads a builder intermediate. Add `--replace` only in repair mode.
- The upload command reads the Release asset list, rejects non-whitelisted remote assets, downloads the remote YML and final ZIP into a system temporary directory, and repeats the version, filename, byte-size, SHA-512, and sidecar checks before reporting success. Publish only when this passes and the notes describe the notarized App/DMG artifacts.
- If replacement or upload fails, keep the Release as Draft, report uploaded/missing assets, and give the exact resumable step.

### 9. Verify completion

- Require `isDraft=false`, `isPrerelease=false`, the expected HTTPS Release URL, the exact updater asset set validated above, and a remote annotated tag that still dereferences to the release commit. The final ZIP must contain the signed, notarized, stapled `.app`; do not describe the ZIP itself as stapled.
- In fresh mode, require synchronized `main` immediately before tagging. Do not fail a later completion check merely because `main` advanced after publication; require the tag to remain unchanged and report whether current `main` descends from the release commit.
- Require a clean working tree apart from unrelated pre-existing user files. Never delete, stash, or include them.
- Report the Release URL, release commit/tag, gate results and explicit waivers, signing Team, App and DMG notarization submission IDs, Gatekeeper results, architecture, artifact sizes/hashes, and remaining risks.

## Failure paths

- Missing tools, credentials, files, signing identity, or Keychain profile: stop before external mutation and name the missing requirement.
- Notary rejection: retrieve the submission log, keep existing public assets unchanged, and report the submission ID and diagnosis.
- Dirty worktree with unrelated changes: stop; NEVER stash, overwrite, delete, or commit them.
- CI failure after pushing a fresh release commit: leave `main` at the untagged release commit and resume from that exact commit after its exact CI run succeeds.
- Failure after creating or drafting a Release: leave it Draft and report the exact asset/note state. Never publish a partially replaced pair.
- Unexpected tracked files produced by validation: stop and report. Remove only untracked artifacts proven to be created by the current run.

## Examples

- “把当前 main 发布为 0.2.1”：prepare metadata, run unwaived gates, sign and notarize App/DMG, tag, upload the verified arm64 DMG/ZIP pair, and publish.
- “给已经发布的 v0.2.0 补公证”：keep the existing tag fixed, rebuild from that tag or proven artifacts, notarize and staple, temporarily draft the Release, atomically replace both assets, verify digests, and republish.
- “发布 v0.2.1，不跑测试，CI 不用管”：skip only those explicitly waived gates, complete signing/notarization and artifact verification, and list the waivers as release risks.
