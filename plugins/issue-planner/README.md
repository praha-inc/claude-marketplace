# issue-planner

A Claude Code plugin that turns what you want to achieve into a GitHub issue. Claude interviews you, investigates the codebase, its history and related repositories, and splits the work into sub-issues that each map to one pull request. Nothing is created on GitHub until you approve the draft.

## Installation

```
/plugin marketplace add praha-inc/claude-marketplace
/plugin install issue-planner@praha-claude-marketplace
```

## Usage

Run the skill in your project, optionally with what you want to achieve:

```
/issue-planner:create Let users export their invoices as CSV
```

Claude also uses the skill on its own when you ask it to file or plan an issue.

## How it works

1. **Interview**: Claude asks about the goal and its reason, the scope, how to tell the work is done, and any constraints. It then says back what it understood and asks you to confirm before investigating.
2. **Investigate**: Claude checks the repository's issue templates and recent issues, and runs two agents in parallel. The `investigator` reads the code, including related repositories. The `historian` reads past issues, pull requests, discussions and commits for earlier decisions and approaches that were dropped.
3. **Resolve**: When the findings contradict the request, or a decision changes the scope, Claude comes back to you with the options.
4. **Design**: Claude writes a parent issue for the whole outcome and one sub-issue for each pull request, with the dependencies between them. Work that fits in one pull request becomes a single issue.
5. **Loop**: Steps 1 to 4 repeat until every issue could be started without further questions.
6. **Draft**: Claude writes the draft to `.claude/issue-drafts/<slug>.md`.
7. **Review**: The `reviewer` agent reads the draft with no knowledge of the conversation, as the eventual implementer will, and checks it against the code. Claude fixes what it finds.
8. **Your review**: Claude asks you to review the draft. You can edit the file directly or tell Claude what to change.
9. **Project**: Claude looks for GitHub Projects linked to the repository and asks whether to add the issues to one.
10. **Create**: After you approve, Claude creates the issues, links the sub-issues to the parent, registers which sub-issues block which, and adds them to the project.

The three agents only read. They do not edit files or change anything on GitHub.

### Draft format

```markdown
---
repository: owner/repo
project: https://github.com/orgs/owner/projects/1
---

# Issue: Title of the parent issue

Body of the parent issue.

# Sub-issue: Title of the first sub-issue

Body of the first sub-issue.

# Sub-issue: Title of the second sub-issue

Repository: owner/another-repo
Blocked by: 1

Body of the second sub-issue.
```

The lines directly under a heading are optional metadata:

- `Repository`: puts a sub-issue in another repository of the same owner.
- `Blocked by`: the sub-issues that must be merged first, as their positions in the draft (1 is the first sub-issue) or the URLs of existing issues. These become [issue dependencies](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/creating-issue-dependencies) on GitHub.
- `URL`: recorded once an issue is created. If creation fails partway, running it again continues where it stopped without creating duplicates.

Labels, assignees and issue types are not set. Add them on GitHub after the issues are created.

## Notes

- The plugin needs the [GitHub CLI](https://cli.github.com/) (`gh`), authenticated for the repository, and Node.js 22.18 or later available as `node`, because its scripts are TypeScript files run with Node.js type stripping.
- Finding projects and adding issues to them needs the `project` scope, which `gh` does not request by default. Grant it with `gh auth refresh -s project`. Without it, issues can still be created, just not added to a project.
- Sub-issues must belong to the same owner as the parent issue.
- Drafts are deleted after the issues are created. Add `.claude/issue-drafts/` to your `.gitignore` if you do not want unfinished drafts to show up in `git status`.

## Disabling

```
/plugin disable issue-planner@praha-claude-marketplace
```
