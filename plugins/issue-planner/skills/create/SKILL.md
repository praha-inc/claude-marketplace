---
name: create
description: Plan and create a GitHub issue by interviewing the user, investigating the codebase, its history and related repositories, and splitting the work into sub-issues that each map to one pull request. Use this whenever the user wants to file, write, draft or plan a GitHub issue, turn an idea, bug or feature request into an issue, or break work down into issues or tasks before starting on it, even if they do not name this skill.
argument-hint: "[what you want to achieve]"
---

# Create an issue

Turn what the user wants to achieve into a GitHub issue that someone else, or another Claude session, could pick up and start on without asking questions. When the work is larger than one pull request, split it into sub-issues so that each sub-issue is completed by exactly one pull request.

The request, if the user gave one with the command: $ARGUMENTS

Talk to the user in the language they use. Write the issues in the language the repository's existing issues are written in, and ask if that is unclear.

Nothing is created on GitHub until the user approves in step 10. Issues notify people and cannot be cleanly taken back, so everything before that step is reading and writing a local draft.

## 1. Interview

Find out what the issue is for. If the request is empty or vague, ask the user what they want to achieve. You need to understand:

- **The goal and its reason**: what should be different when this is done, and why it matters now. The reason is what lets the implementer make good decisions the issue did not anticipate.
- **Scope**: what is included, and what is deliberately left out.
- **Done**: how someone will tell that the work is complete.
- **Constraints**: deadlines, compatibility, things that must not change, people who must be involved.

Ask only what the user can answer and you cannot find out yourself. Anything the code or GitHub can tell you belongs in step 2. Ask a few questions at a time, and use AskUserQuestion when the answer is a choice between concrete options.

Before moving on, say back what you understood in a few lines (the goal, the reason, what is in and out of scope, and what done means) and ask the user to confirm or correct it. The investigation is the expensive part of this process, and it is aimed by this understanding, so a misreading caught here costs one message instead of a wasted investigation.

## 2. Investigate

Ground the issue in how things are today. An issue written without reading the code tends to describe work that is already done, impossible as described, or much bigger than it looks. One written without reading the history tends to repeat something that was already tried or decided against.

Check these yourself, as they are quick:

- The target repository: `gh repo view --json nameWithOwner,description,hasIssuesEnabled`. If the user wants the issue in another repository, use that one.
- Conventions for issues: templates under `.github/ISSUE_TEMPLATE/`, contributing guides, and a few recent issues (`gh issue list --limit 10`) for their language and structure.

Delegate the rest to the agents below, so that file contents and long threads stay out of this conversation and only the findings come back. Start them in a single message so they run in parallel. Give each one the confirmed understanding from step 1 and the specific questions you need answered.

- `issue-planner:investigator` reads the code: how the relevant part works today, what the change would touch, and which related repositories are involved. Related repositories are ones the change touches or depends on, such as an API server and its client, shared libraries, or infrastructure definitions. When more than one repository is involved, or the questions are independent, start one investigator for each.
- `issue-planner:historian` reads the history: past issues, pull requests, discussions and commits on the topic, decisions already made, and approaches that were dropped.

If the historian finds open work on the same topic, tell the user and ask whether to continue, since a duplicate may not be wanted. If a question is small enough to answer with a couple of searches, do them yourself instead of starting an agent.

## 3. Resolve what is still open

Compare what the investigation found against what the user asked for. Go back to the user when:

- The findings contradict the request, or show it is larger or smaller than they assumed.
- The request goes against an earlier decision, or repeats an approach that was dropped. Tell them what was decided and why, and ask whether the reason still holds.
- There is more than one reasonable approach and the choice changes the scope or the split. Present the options with their trade-offs and your recommendation.
- Something the issue needs is still unknown and cannot be found in the code or the history.

Decide the small things yourself and state them in the draft as assumptions, so the user can correct them there. A decision is small when a wrong guess is cheap to fix in review.

## 4. Design the issue and its sub-issues

Decide whether the work fits in one pull request. If it does, write a single issue with no sub-issues. Splitting small work only adds things to track.

Otherwise the parent issue describes the whole outcome, and each sub-issue describes one pull request. A good sub-issue:

- Can be merged on its own and leaves the main branch working. Work that only functions once a later sub-issue lands is hidden behind a flag or left unused until then.
- Is small enough to review in one sitting and has one clear purpose. Refactoring that prepares for a change is its own sub-issue, separate from the change.
- Names the sub-issues that must be merged before it, if any. Order the sub-issues so they can be worked on from top to bottom, and keep these dependencies to the real ones: sub-issues that do not block each other can be worked on in parallel.
- Has acceptance criteria that can be checked from the pull request alone.
- Lives in the repository where its pull request will be opened. A change spanning repositories needs at least one sub-issue for each.

Write each body for a reader who has not seen this conversation. Follow the repository's issue template if it has one. Otherwise use these sections, leaving out any that would be empty:

- Parent issue: background and reason, goal, scope and what is out of scope, acceptance criteria for the whole, and notes such as decisions made with the user, earlier decisions that still apply (with their links), and assumptions.
- Sub-issue: what to change and why, pointers to the relevant code (paths and symbols from the investigation, since these save the implementer the search you already did), and acceptance criteria.

Do not list the sub-issues in the parent body, and do not write the dependencies between sub-issues into the bodies. GitHub shows both once the issues are created, from the links the script in step 10 registers.

## 5. Loop until nothing is missing

Designing the split usually raises new questions: an unclear boundary between two sub-issues, a dependency nobody mentioned, a part nobody has investigated. Go back to step 1, 2 or 3 as needed, and repeat until every issue could be started without further questions. Stop looping when the remaining unknowns are ones the implementer is better placed to answer. Record those in the issue as open questions.

## 6. Write the draft

Write the draft to `.claude/issue-drafts/<short-slug>.md` in the project. Use this exact structure, because the script in step 10 creates the issues from this file:

```markdown
---
repository: owner/repo
project:
---

# Issue: Title of the parent issue

Body of the parent issue, using `##` and deeper headings.

# Sub-issue: Title of the first sub-issue

Body of the first sub-issue.

# Sub-issue: Title of the second sub-issue

Blocked by: 1

Body of the second sub-issue.

# Sub-issue: Title of the third sub-issue

Repository: owner/another-repo
Blocked by: 1, 2

Body of the third sub-issue.
```

- `repository` is where the parent issue, and every sub-issue without its own `Repository:` line, is created.
- `project` stays empty until step 9.
- The lines directly under a heading are optional metadata. `Repository:` puts a sub-issue in another repository of the same owner. `Blocked by:` lists, comma separated, the sub-issues that must be merged before this one, each by its position in the draft (1 is the first sub-issue). It can only name sub-issues above it. To depend on an issue that already exists, give its URL instead.
- A blank line ends the metadata, and everything up to the next `# Issue:` or `# Sub-issue:` heading is the body.

Check the structure of the draft:

```sh
node "${CLAUDE_SKILL_DIR}/scripts/create-issues.ts" --dry-run .claude/issue-drafts/<short-slug>.md
```

## 7. Have the draft reviewed

Start the `issue-planner:reviewer` agent and give it only the path of the draft. Do not tell it what the user asked for, what you investigated, or what you think of the draft. It reads the draft the way the eventual implementer will, with none of this conversation, so whatever it cannot work out is something the issue fails to say. Context from you would hide exactly those gaps.

Fix the blocking problems it reports. If fixing one needs an answer from the user or more investigation, go back to the step it belongs to. After changes that alter the scope, the split or the dependencies, run the review again on the new draft. Use your judgment on its suggested improvements, and carry any question you cannot settle into step 8.

## 8. Ask the user to review

Tell the user the path of the draft and give a short summary in the conversation: the parent title, the sub-issues in order with one line each and what blocks what, the assumptions you made, and anything the reviewer raised that needs their decision. Ask them to review it. They may edit the file directly or tell you what to change. Read the file again after they respond, because their edits are the source of truth. If the feedback changes the scope or the split, go back to the step it affects, including the review in step 7.

## 9. Find a GitHub Project

Look for projects the issues could be added to:

```sh
node "${CLAUDE_SKILL_DIR}/scripts/find-projects.ts" owner/repo
```

The output lists the open projects linked to the repository in `linked`, and the owner's other open projects in `others`. Ask the user whether to add the issues to a project, offering the linked ones first and "do not add" as a choice. Offer the others only when no project is linked. If the user picks one, set `project` in the draft to its URL.

If the script reports that the token lacks the project scope, tell the user they can grant it by running `gh auth refresh -s project` themselves, and ask whether to do that or to continue without a project. If there are no projects at all, say so and move on without asking.

## 10. Create the issues

Ask for approval to create the issues, stating how many will be created, in which repositories, and the project they will be added to. Create them only after the user clearly approves. Approval of an earlier draft does not cover a draft that changed since.

```sh
node "${CLAUDE_SKILL_DIR}/scripts/create-issues.ts" .claude/issue-drafts/<short-slug>.md
```

The script creates the parent issue and the sub-issues in order, links each sub-issue to the parent, registers the `Blocked by:` dependencies, and adds every issue to the project. It records each created issue in the draft as a `URL:` line under its heading. If it fails partway, fix the cause and run the same command again: issues that already have a `URL:` line are not created twice, and links that already exist are skipped.

Finish by giving the user the URL of the parent issue and of each sub-issue, and mention anything that did not succeed. Then delete the draft file, unless the user wants to keep it, since its content now lives on GitHub.
