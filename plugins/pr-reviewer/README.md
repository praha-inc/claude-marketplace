# pr-reviewer

A Claude Code plugin that reviews a pull request and posts the result to GitHub as a single review. It runs the built-in `/code-review` and `/security-review` skills, comments on the affected lines with a severity you can read at a glance, follows up on what it said last time, and approves or requests changes.

## Installation

```
/plugin marketplace add praha-inc/claude-marketplace
/plugin install pr-reviewer@praha-claude-marketplace
```

## Usage

Run the skill with a pull request number or URL, or with nothing to review the pull request of the current branch:

```
/pr-reviewer:review 123
```

Claude also uses the skill on its own when you ask it to review a pull request. Running the skill posts to the pull request without asking again.

### In GitHub Actions

To review every pull request automatically, run the skill with [claude-code-action](https://github.com/anthropics/claude-code-action). Reviews are posted as `claude[bot]`, which needs the [Claude GitHub App](https://github.com/apps/claude) installed on the repository.

```yaml
name: Review

on:
  pull_request:
    types: [opened, synchronize, ready_for_review, reopened]

# Reviews of the same pull request run one after another. A review cancelled
# while it is being posted could leave a half-written review behind.
concurrency:
  group: review-${{ github.event.pull_request.number }}
  cancel-in-progress: false

jobs:
  review:
    name: Review
    if: ${{ !github.event.pull_request.draft }}
    runs-on: ubuntu-latest
    timeout-minutes: 30
    permissions:
      contents: read
      pull-requests: write
      id-token: write
    steps:
      - name: Checkout
        uses: actions/checkout@v6
        with:
          # The head commit rather than the default merge commit, because the
          # comments are placed on the code of the pull request itself.
          ref: ${{ github.event.pull_request.head.sha }}
          # The whole history, so the change can be compared with the base branch.
          fetch-depth: 0

      - name: Setup Node.js
        uses: actions/setup-node@v6
        with:
          node-version: latest

      - name: Review
        uses: anthropics/claude-code-action@v1
        with:
          anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
          plugin_marketplaces: https://github.com/praha-inc/claude-marketplace.git
          plugins: pr-reviewer@praha-claude-marketplace
          prompt: |
            Review pull request #${{ github.event.pull_request.number }} of ${{ github.repository }} with the pr-reviewer:review skill.
          claude_args: |
            --allowedTools "Skill,Agent,Read,Write,Edit,Glob,Grep,Bash(gh:*),Bash(git:*),Bash(node:*)"
```

- `id-token: write` lets the action obtain the Claude GitHub App's token, which is what makes the review appear as `claude[bot]`. The next review recognises its earlier comments by that author.
- `claude_code_oauth_token` can be used in place of `anthropic_api_key`.
- The allowed tools are what the skill needs: `Skill` and `Agent` to run the two review skills, `gh` to read and post the review, `git` to inspect the change, `node` to run the plugin's scripts, and `Write` and `Edit` for the review file, which is written to a temporary directory.
- The workflow reads the content of the pull request, so keep its permissions as narrow as above. Pull requests from forks do not receive the secrets and are not reviewed.

## How it works

1. **Read the state**: Claude finds the pull request, checks out its code, and reads what earlier reviews left on it.
2. **Follow up**: For every thread an earlier review left open, Claude checks the current code and replies in the thread with what it found. Threads that were addressed are resolved. This includes threads where the author gave a sound reason not to change the code, or declined an optional suggestion.
3. **Review**: Claude runs `/code-review` and `/security-review` on the change.
4. **Triage**: Claude drops duplicates and findings that do not hold up, keeps the ones the pull request introduced, and gives each a severity.
5. **Post**: The replies, the new inline comments and the verdict go up as one review, so the author gets one notification. The summary of an earlier review is then hidden as outdated, once every thread of that review is resolved. Until then it stays visible, because GitHub hides the comments of a review together with its summary.

### Severity

Every inline comment starts with its severity:

| Prefix | Meaning |
|--------|---------|
| 🔴 **Must fix** | Merging this would cause harm, such as a bug, a vulnerability or data loss. |
| 🟡 **Should fix** | Worth fixing, but merging without it is defensible. |
| 🔵 **Optional** | The author may ignore it. |

### Verdict

The review **requests changes** when a new finding is 🔴, or when a 🔴 finding from an earlier review is still open. Otherwise it **approves**. The summary is two or three sentences, followed by the number of findings at each severity.

### Earlier reviews

A thread or summary counts as an earlier review's when `claude[bot]` wrote it, or when the account running the skill wrote it through this plugin (those comments carry a hidden marker). Threads you wrote by hand are never answered or resolved for you.

## Notes

- The plugin needs the [GitHub CLI](https://cli.github.com/) (`gh`), authenticated with write access to pull requests, and Node.js 22.18 or later available as `node`, because its scripts are TypeScript files run with Node.js type stripping.
- The working tree must be the code of the pull request. The skill runs `gh pr checkout` when the tree is clean, and stops when there are uncommitted changes or unpushed commits.
- GitHub does not accept an approval or a request for changes on your own pull request, and some CI tokens may comment but not approve. In both cases the review is posted as a comment whose summary states the verdict.
- A finding on a line that is not part of the diff is posted on the file instead, or in the summary when the file is not in the diff either.
- The review file is written to a temporary directory outside the repository, which the plugin's scripts create and delete.

## Disabling

```
/plugin disable pr-reviewer@praha-claude-marketplace
```
