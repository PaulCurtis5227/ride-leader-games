# Maintaining Ride Leader Games

Maintainer/developer notes: how to cut a release and how to list the mod in the Sauce Mod Store.
End users don't need any of this — see the [README](README.md) to install and use the mod.

## Releasing

The version lives in `package.json` and is mirrored into `manifest.json` (Sauce shows it as
`v<version>` in **Settings → Mods**). Never edit `manifest.json`'s version by hand — bump both
together with `npm version`, which also runs the tests, commits, tags, and builds the zip:

```
# 1. commit all your work first (npm version requires a clean tree)
npm version patch          # or minor / major
#   → runs tests, bumps package.json + manifest.json to the same version,
#     makes one commit tagged vX.Y.Z, then builds dist/ride-leader-games-vX.Y.Z.zip
git push --follow-tags     # push the commit and tag to GitHub
npm run release            # scans the shipped files, then attaches the zip to a GitHub Release
```

- **Pre-release scan:** `npm run release` first runs `npm run scan` automatically (npm's
  `prerelease` step). It scans every file that ships in the zip (all git-tracked files) for leaked
  secrets/keys, this machine's own absolute paths (e.g. `C:\Users\<you>\…`), personal info, and any
  source file missing its copyright/SPDX header — and **aborts the release on a blocking finding**
  so private data can't escape. Run it standalone any time with `npm run scan`. Flags:
  `--since <ref>` (only files changed since a ref), `--staged`, `--warn-only` (report but never
  fail), or pass explicit paths. A verified false positive can be silenced by adding a comment
  containing `release-scan-allow` on that line. Detection logic lives in
  `scripts/release-scan.mjs` (pure, unit-tested in `test/release-scan.mjs`); the CLI is
  `scripts/scan-release.mjs`.

- **Artifact:** `npm run package` (also run automatically by `npm version`) produces
  `dist/ride-leader-games-v<version>.zip` — a `git archive` of exactly the committed files
  (so `CLAUDE.md` and anything untracked/gitignored are excluded), prefixed with a
  `ride-leader-games/` folder so it unzips ready to drop into `SauceMods`.
- **GitHub Release:** `npm run release` uses the [`gh` CLI](https://cli.github.com) if it is
  installed and authenticated (`gh release create v<version> … --generate-notes`). If `gh` is not
  installed it prints the manual steps: push the tag, open the repo's **Releases → Draft a new
  release** page, and upload the zip from `dist/`.

A test (`test/version.test.mjs`) fails the build if `manifest.json` and `package.json` versions ever
drift, so a mislabeled release can't be cut.

## Listing in the Sauce Mod Store

The [Official Sauce Mod Store](https://mods.sauce.llc) lists mods from a single `directory.json` in
[`SauceLLC/sauce4zwift-mod-store`](https://github.com/SauceLLC/sauce4zwift-mod-store); listing/updating
is a pull request against that file. The store's web release tool uploads your zip to Sauce's asset
host and hands you an entry to paste in by hand. `npm run submit-mod-store` automates the whole flow:

```
npm run submit-mod-store                 # DRY RUN (default): build + print the entry, no network writes
npm run submit-mod-store -- --upload-only  # upload the zip to Sauce's asset host, print the finished entry
npm run submit-mod-store -- --submit       # upload the zip AND open the store PR via the gh CLI
```

Extra flags: `-- --notes "…"` (release notes for this version) and `-- --branch NAME` (PR branch on
your fork).

What it does, mirroring the manual steps:

1. Computes the release zip's SHA-256 and size (from `dist/ride-leader-games-vX.Y.Z.zip`, so run
   `npm run package`/`npm version` first).
2. On `--upload-only`/`--submit`, `PUT`s the zip to `https://mod-api.sauce.llc/edit/release/asset`
   (the same anonymous call the web tool makes) and uses the hosted asset URL it returns.
3. Builds the `directory.json` entry from `manifest.json` + **`mod-store.json`** (the store metadata:
   a **stable `id`** — never change it once listed — plus description, tags, URLs, author, logo).
4. On `--submit`, forks the store repo, edits `directory.json` on a branch, and opens the PR with
   [`gh`](https://cli.github.com). (On this machine `gh` lives outside the default PATH — see
   `CLAUDE.md`.)

The **default dry run touches nothing external** — it only reads the public `directory.json` and
prints the entry that *would* be submitted, so you can eyeball it first. Uploading and opening a PR
happen only with the explicit flags.

**Logo:** `mod-store.json`'s `logoURL` points at `images/RLG.png` (1024×1024, a square badge). The
store wants a **square (1:1) image, 384–1500 px**; PNG/WebP work well served from GitHub raw. (Avoid
SVG here — GitHub's raw host sends `.svg` as `text/plain` with `nosniff`, so it often won't render in
an `<img>`.) The logo is served straight from your pushed repo, so commit and push it before you
submit (the URL resolves against the pushed repo).
