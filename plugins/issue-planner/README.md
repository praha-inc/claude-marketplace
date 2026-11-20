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
6. **Draft**: Claude writes the draft to `.claude/issue-drafts/<slug>.md`. Where a picture would save the reader from assembling one out of prose, Claude adds a diagram drawn with [diagram-writer](../diagram-writer). A draft without one is missing nothing.
7. **Review**: The `reviewer` agent reads the draft with no knowledge of the conversation, as the eventual implementer will, and checks it against the code. It also checks that each issue stands without its diagrams. Claude fixes what it finds.
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

### Diagrams

A diagram is an aid to a body that is already complete. Claude writes the draft first, and only then looks for a place where the reader would have to build a picture in their head: how the parts connect today and afterwards, a flow that crosses services, the states something moves through. With sub-issues, the clearest sign is one behaviour told across three or more of them, so that no single one shows the whole path. When Claude asks you to review the draft, it says whether it drew a diagram, and what it considered drawing if it did not, so you can ask for one.

A body shows a diagram as `![alternative text](./<slug>-<name>.png)`, a file next to the draft. `create-issues.ts` uploads it with the issue, and the reference then points at the uploaded file. Everything a diagram shows is also said in the text, since whoever picks up the issue may read only the text.

If the `diagram-writer:draw` skill is not available or cannot render, the issues are created without diagrams.

## Notes

- The plugin needs the [GitHub CLI](https://cli.github.com/) (`gh`), authenticated for the repository, and Node.js 22.18 or later available as `node`, because its scripts are TypeScript files run with Node.js type stripping.
- Finding projects and adding issues to them needs the `project` scope, which `gh` does not request by default. Grant it with `gh auth refresh -s project`. Without it, issues can still be created, just not added to a project.
- Sub-issues must belong to the same owner as the parent issue.
- The plugin depends on [diagram-writer](../diagram-writer), which is installed with it. Drawing a diagram needs a Chromium-based browser, and uploading one needs a `gh` that has the `--attach` flag and push access to the repository of the issue. Without them the issues are still created, without diagrams.
- Drafts and the files of their diagrams are deleted after the issues are created. Add `.claude/issue-drafts/` to your `.gitignore` if you do not want unfinished drafts to show up in `git status`.

## Disabling

```
/plugin disable issue-planner@praha-claude-marketplace
```
