---
name: setup
description: Configure COMMIT_HOOK_COMMANDS for the commit-hook plugin by investigating the project's lint, format, type check and test commands, including the ones its CI runs.
disable-model-invocation: true
---

# Set up commit-hook

Configure the `COMMIT_HOOK_COMMANDS` environment variable for this project. The commit-hook plugin runs these commands from the project root before Claude runs `git commit`, and blocks the commit when any of them fail. Choose checks that run reliably on a local machine and whose output tells Claude what to fix.

## 1. Investigate

Collect candidate commands from the project root:

- **CI configuration**: the strongest signal of which checks the team requires. Read the jobs that run on pull requests or pushes, and the commands their steps run.
  - GitHub Actions: `.github/workflows/*.yml`, plus local composite actions under `.github/actions/` that the workflows use
  - Others: `.gitlab-ci.yml`, `.circleci/config.yml`, `azure-pipelines.yml`, `bitbucket-pipelines.yml`, `.buildkite/`, `Jenkinsfile`
- **Task definitions**: `package.json` scripts (take the package manager from the `packageManager` field or the lockfile), `Makefile`, `justfile`, `Taskfile.yml`, `pyproject.toml`, `Cargo.toml`, `go.mod`, and similar.
- **Existing Git hooks**: `.husky/`, `lefthook.yml`, `.pre-commit-config.yaml`, `lint-staged` configuration.
- **Current value**: `env.COMMIT_HOOK_COMMANDS` in `.claude/settings.json` and `.claude/settings.local.json`, if set.

When a CI step or script calls another script, follow it to see what it really runs, so that overlapping commands can be spotted (for example, a `lint` script that already runs every `lint:*` script).

## 2. Select

Include checks that verify the code without changing it: linting, format checks, type checks and unit tests.

Exclude:

- Commands that modify files, such as `--fix`, `--write` or a `format` script that rewrites files. Use the check variant instead, such as `prettier --check`.
- Setup, install, build-only, release, publish and deploy steps.
- Commands that need secrets, external services, databases, containers or network access that a local machine may not have.
- Slow suites such as end-to-end or browser tests, and anything that starts a watch mode or a server.
- Commands already covered by another selected command.

Adapt each command so it runs locally from the project root:

- Prefer the project's own script (`pnpm run lint`) over the raw tool invocation it wraps.
- Drop CI-only flags and values: lockfile enforcement such as `--frozen-lockfile`, CI reporters, `${{ ... }}` expressions and matrix values.
- If a CI job sets a `working-directory`, prefix the command with `cd <dir> &&` or use the package manager's filter option.
- If a check depends on an earlier step in CI, such as tests that need a build, chain them in one entry: `pnpm run build && pnpm run test`.

The hook runs the commands one after another in the order listed, each through a shell, and runs all of them even if one fails.

## 3. Confirm

Show the user a table of every candidate with its source (file and job or script), whether you recommend it, and a one-line reason for each one you leave out. Then ask the user to confirm or adjust the list, and where to save it:

- `.claude/settings.json` (recommended): shared with everyone on the project through Git
- `.claude/settings.local.json`: only for this user on this machine

Do not write anything until the user has confirmed.

## 4. Write

Set `env.COMMIT_HOOK_COMMANDS` in the chosen file. Create the file if it does not exist, and keep every other setting in it. The value must be a **string** that contains a JSON array of strings, so the quotes inside it are escaped:

```json
{
  "env": {
    "COMMIT_HOOK_COMMANDS": "[\"pnpm run lint\", \"pnpm run test\"]"
  }
}
```

Then confirm that the file parses and the value is an array of strings, replacing the path with the file you wrote:

```sh
node -e '
const fs = require("node:fs");
const settings = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const commands = JSON.parse(settings.env.COMMIT_HOOK_COMMANDS);
if (!Array.isArray(commands) || !commands.every((command) => typeof command === "string")) {
  throw new Error("COMMIT_HOOK_COMMANDS must be a JSON array of strings");
}
console.log(commands);
' .claude/settings.json
```

The new value applies to the next commit without restarting Claude Code.

## 5. Run the commands once

Run each configured command from the project root and report which pass and which fail. A failing command blocks every commit Claude makes, so for each failure tell the user why:

- The command itself is broken, for example not found or missing setup: fix the entry and write it again.
- The code has existing problems: the commit hook will block commits until they are fixed. Ask the user whether to keep the command or remove it for now.

Finish with a short summary of the configured commands and the file they were saved to.
