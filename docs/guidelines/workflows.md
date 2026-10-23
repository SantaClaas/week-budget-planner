---
paths:
  - ".github/**"
---

# GitHub Actions

How the workflows in [`.github/workflows/`](../../.github/workflows/) are written. It adds to [`docs/guidelines/principles.md`](principles.md), which always applies.

- **Every action is pinned to a commit hash, with its version in a comment at the end of the line:** `uses: actions/checkout@<hash> # v7.0.1`. A moved tag then can't change what runs. A container image is pinned the same way, by digest.
- **CI lints the workflows** with actionlint and zizmor (pedantic, configured in [`.github/zizmor.yml`](../../.github/zizmor.yml)). zizmor also checks that each hash is the commit of the version in its comment, so update both together.
- **Least privilege.** The workflow grants no permissions (`permissions: {}`) and each job asks only for what it needs, with a comment saying why. Checkouts don't keep the token (`persist-credentials: false`).
- **A cache that a pull request could fill must not reach the build that gets deployed**, so the pnpm cache is only used on pull requests.
- **Dependabot** ([`.github/dependabot.yml`](../../.github/dependabot.yml)) proposes updates to the actions and the npm dependencies weekly, a week after each release, the same wait that [`pnpm-workspace.yaml`](../../pnpm-workspace.yaml) enforces.
- The Node version comes from [`.node-version`](../../.node-version), the same file local tools read.
