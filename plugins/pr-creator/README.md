# pr-creator

A Claude Code plugin that takes a piece of work to a draft pull request. Claude implements an issue or a change you describe, reviews its own work with the built-in `/code-review` and `/security-review` skills, fixes what holds up and reviews again until nothing is left, and opens a draft pull request linked to the issue.

## Installation

```
/plugin marketplace add praha-inc/claude-marketplace
/plugin install pr-creator@praha-claude-marketplace
```

## Usage

Run the skill with an issue number or URL, or with what you want implemented:

```
/pr-creator:create 123
/pr-creator:create Let users export their invoices as CSV
```

Run it with nothing on a branch that already has commits to review that work and open its pull request.

Claude also uses the skill on its own when you ask it to implement something and open a pull request.

## How it works

1. **Understand**: Claude reads the issue with its comments, its parent, its sub-issues and what blocks it. It stops when the issue is closed, already has an open pull request, is blocked by unmerged work, or is a parent whose sub-issues are the real units of work.
2. **Ask how to proceed**: Claude asks once whether to run on its own or to confirm the risky decisions with you.
3. **Branch**: Claude creates a branch from the base branch, named the way the repository names its branches.
4. **Implement**: Claude reads the surrounding code, implements the change with its tests, runs the project's checks, and commits.
5. **Self-review**: Claude runs `/code-review` and `/security-review`, judges each finding, fixes the valid ones, and runs both again on the whole change. This repeats until a round finds nothing valid.
6. **Link the issue**: Claude decides whether merging the pull request finishes the issue.
7. **Open**: Claude pushes the branch and opens a draft pull request, then checks that GitHub registered the link to the issue.

### The two modes

| Mode | What Claude does |
|------|------------------|
| Run on its own | Goes all the way to the draft pull request without asking. The important decisions it made are listed in the pull request, marked as unconfirmed. |
| Confirm the risky decisions | Shows the plan and asks about the risky decisions before writing code, and again whenever a new one turns up. Everything else it decides itself. |

A risky decision is one where a wrong guess means redoing work: a requirement that can be read in more than one way, an interface others depend on (an API endpoint, a public type, a database schema), how a frontend is cut into components, or anything else the rest of the implementation is built on.

### Self-review

A finding is fixed only when Claude confirms the problem is real and the change caused it. Findings that misread the code, or are about code the change did not touch, are left alone and listed in the pull request with the reason.

The loop stops without opening a pull request, and Claude reports where things stand, when five rounds still leave valid findings, when a finding comes back after its fix, or when a finding cannot be fixed within the work.

### Linking the issue

| Situation | In the pull request | On merge |
|-----------|---------------------|----------|
| The change does everything the issue asks for | `Closes #123` | The issue closes |
| The change does part of it, or the issue is a parent with open sub-issues | `Part of #123` | The issue stays open |

GitHub closes issues only from pull requests merged into the default branch. With another base branch, Claude tells you the issue will not close.

## Notes

- The plugin needs the [GitHub CLI](https://cli.github.com/) (`gh`), authenticated with write access to the repository, and Node.js 22.18 or later available as `node`, because its script is a TypeScript file run with Node.js type stripping.
- The pull request is always a draft. Mark it ready for review yourself once you have looked at it.
- Each round of self-review runs both review skills, which start their own subagents, so a change that needs several rounds takes a while.
- To have the pull request reviewed on GitHub afterwards, see [pr-reviewer](../pr-reviewer).

## Disabling

```
/plugin disable pr-creator@praha-claude-marketplace
```
