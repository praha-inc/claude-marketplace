---
name: create
description: Plan and create a GitHub issue by interviewing the user, investigating the codebase, its history and related repositories, and splitting the work into sub-issues that each map to one pull request. Use this whenever the user wants to file, write, draft or plan a GitHub issue, turn an idea, bug or feature request into an issue, or break work down into issues or tasks before starting on it, even if they do not name this skill.
argument-hint: "[what you want to achieve]"
---

# Create an issue

Turn what the user wants to achieve into a GitHub issue that someone else, or another Claude session, could pick up and start on without asking questions. When the work is larger than one pull request, split it into sub-issues so that each sub-issue is completed by exactly one pull request.

The request, if the user gave one with the command: $ARGUMENTS

Talk to the user in the language they use. Write the issues in the language the repository's existing issues are written in, and ask if that is unclear.

Nothing is created on GitHub until the user approves in step 12. Issues notify people and cannot be cleanly taken back, so everything before that step is reading and writing a local draft.

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

Do not list the sub-issues in the parent body, and do not write the dependencies between sub-issues into the bodies. GitHub shows both once the issues are created, from the links the script in step 12 registers.

## 5. Loop until nothing is missing

Designing the split usually raises new questions: an unclear boundary between two sub-issues, a dependency nobody mentioned, a part nobody has investigated. Go back to step 1, 2 or 3 as needed, and repeat until every issue could be started without further questions. Stop looping when the remaining unknowns are ones the implementer is better placed to answer. Record those in the issue as open questions.

## 6. Write the draft

Write the draft to `.claude/issue-drafts/<short-slug>.md` in the project. Use this exact structure, because the script in step 12 creates the issues from this file:

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
- `project` stays empty until step 11.
- The lines directly under a heading are optional metadata. `Repository:` puts a sub-issue in another repository of the same owner. `Blocked by:` lists, comma separated, the sub-issues that must be merged before this one, each by its position in the draft (1 is the first sub-issue). It can only name sub-issues above it. To depend on an issue that already exists, give its URL instead.
- A blank line ends the metadata, and everything up to the next `# Issue:` or `# Sub-issue:` heading is the body.

Check the structure of the draft:

```sh
node "${CLAUDE_SKILL_DIR}/scripts/create-issues.ts" --dry-run .claude/issue-drafts/<short-slug>.md
```

## 7. Decide on screenshots

The draft is finished and says in words which screens the work is about. Now decide whether a body also shows them. This is a step of its own because a decision made in passing here is always "no": the draft is written, and the review is the next thing to do. It ends with a decision you state before step 8.

Whoever picks up the issue has to find the screen first: which page, in which state, reached how. A screenshot of how it looks today answers that at a glance. For a bug it is also the record of what was seen, which the text alone leaves to the reader's imagination, and which is gone once someone changes the screen.

The work has something to show when the draft is about something that is rendered for a person:

- **A bug that can be seen**: a broken layout, a wrong text, a state that should not appear. Capture it as it is seen, in the state the steps to reproduce lead to.
- **A change to a screen or component that exists**: how it looks today, with the part that is to change in view.
- **Images the user gave you**: a screenshot of the problem, a mockup, a design. They are part of the request. Attach a file as it is. A link to a design tool goes into the body as a link.

It has nothing to show when no screen is involved, as in backend work, a refactoring or tooling, and when the screen does not exist yet and nobody gave a design for it. Do not draw a mockup of your own: a picture of a screen reads as a decision about its design, and nobody made one.

How to capture, in this order:

1. What the repository already has for it: a Storybook, end-to-end tests that can take screenshots, a preview command. Start the application the way its instructions say.
2. What the session has: a browser tool for a web application, a simulator tool for a mobile one.
3. A Chromium-based browser run headless (`--headless --screenshot=<file> --window-size=<width>,<height> <url>`), which is enough for a page that needs no sign-in and no interaction.

Write what you capture as PNG files next to the draft, as `.claude/issue-drafts/<short-slug>-<name>.png`, named for what they show. Copy a file the user gave you there under the same kind of name, in the format it has, and ask for the file when they pasted an image into the conversation and you have no path to it. A few images that each show one thing are better than a whole page the reader has to search. Show data that was made to be shown, such as seed data, fixtures or a test account: the images are uploaded to GitHub with the issue, so they must not show personal data of real people, credentials, tokens or anything else the repository would not publish. Stop the servers you started.

Open each image with the Read tool before using it. It must show the screen and the state the body is about, fully rendered, and not a spinner, an error page or a sign-in form. When the screen turns out to differ from what the draft says, such as a bug that does not reproduce, the draft is what is wrong: go back to step 2 or 3.

Then:

- Put `![<alternative text>](./<file name>)` in the body whose text it illustrates, next to that text, with an alternative text that names the screen and its state. A screen one sub-issue changes goes in that sub-issue, not in the parent.
- Leave the text as it was. The body must still say in words which screen it is, how to reach it, and what is wrong or what is to change: the person or agent who picks up the issue may read only the text.
- Run the dry run of step 6 again. It checks that every image a body shows is a file next to the draft.

State the decision in one line before going on: which screens the draft shows and in which bodies, or why the work has nothing to show.

Go on without screenshots when the application cannot be run in this session, or when nothing in it can capture a screen. The issue does not depend on them, but tell the user in step 10 which screens you could not capture: they are often looking at the very screen, and can add the image themselves.

## 8. Decide on a diagram

The draft is finished and says everything in words. Now decide whether a body also shows a diagram. This is a step of its own for the same reason as the last one: a decision made in passing here is always "no". It ends with a decision you state before step 9.

Most issues have nothing to draw, and a diagram that carries nothing makes the reader look for a point that is not there. But when the work has a shape, the person who picks up the issue has to rebuild it from prose before they can start, and that costs them more than the diagram costs you. So decide from what the work is, not from whether the draft is clear enough without one.

The work has a shape when the draft describes one of these, as it is today or as it will be:

- **How three or more parts connect**: services, modules, repositories or external systems, and what the work places between them, takes away or points another way.
- **A path that crosses three or more places and branches**, such as a screen, an API and a domain module, or several services or repositories, where the branches end in different places.
- **An order of calls between three or more participants that run apart from each other**, such as a browser, the application and an identity provider: a login, a chain of redirects, a webhook, a job that hands work on.
- **Three or more states something moves through**, and what moves it from one to the next.
- **A schema**: tables or types added or removed, or a relation between them changed.

In a draft with sub-issues, the clearest sign is one behaviour that is told across three or more of them, so that the reader of any single one cannot see the whole path: a branch that one sub-issue decides, another acts on, and a third falls back from. Each sub-issue is complete on its own and still nobody is shown how they meet.

The work has no shape when none of these is there. Three kinds of work look bigger than they are:

- What changes is inside one function or one file, and what calls it and what it calls stay as they were. A sub-issue that stays inside one module is usually this.
- It is the same edit in many places: a rename, a move to another helper, a dependency updated.
- What there is to show is a set of separate things, with no order and no connection between them. A list or a table says that better. The order of the sub-issues is one of these, and GitHub shows it.

When you are unsure, name the boxes the diagram would have and the lines between them. Three or more boxes, with a box or a line that the work adds, removes or redirects, is a shape. Fewer boxes, or lines that all stay as they were, is not. A passage of the draft that walks the reader from one part to the next is a reason to do this count.

**That the text already says it is not a reason to leave the diagram out.** A body has to say everything in words with or without a diagram, so by that test no issue would ever have one. You are also the wrong judge of it: you wrote the text with the code and the investigation in your head, and the reader has neither.

A diagram goes in the body whose text it illustrates, so one that shows how the sub-issues meet goes in the parent issue. When the parent issue already exists and the draft does not write its body, do not move that diagram into a sub-issue. Tell the user in step 10 what it would show, and add it to the parent only when they ask for it.

State the decision in one line before going on: what the diagram will show and which body it goes in, or why the work has nothing to draw.

To draw it, invoke the `diagram-writer:draw` skill with the Skill tool. Tell it what the diagram should show and which part of the draft it illustrates, and have it write its files next to the draft, as `.claude/issue-drafts/<short-slug>-<name>.html`. It hands back the path of a PNG and an alternative text. It may also find, once it has read the code, that no diagram helps, and that is a result to accept. Then:

- Put `![<alternative text>](./<short-slug>-<name>.png)` in the body, next to the text it illustrates.
- Leave the text as it was. Everything the diagram shows must still be said in words: the person or agent who picks up the issue may read only the text, and a body that says "see the diagram" has lost what it was meant to say. When the diagram brings together what several sub-issues say, the body it goes in may not say it yet: write those few sentences next to the image.
- Run the dry run of step 6 again. It checks that every image a body shows is a file next to the draft.

Go on without a diagram when the skill is not available in this session, or when it reports that it could not render one. The issue does not depend on it, but tell the user in step 10, since the work did call for one.

## 9. Have the draft reviewed

Start the `issue-planner:reviewer` agent and give it only the path of the draft. Do not tell it what the user asked for, what you investigated, or what you think of the draft. It reads the draft the way the eventual implementer will, with none of this conversation, so whatever it cannot work out is something the issue fails to say. Context from you would hide exactly those gaps.

Fix the blocking problems it reports. If fixing one needs an answer from the user or more investigation, go back to the step it belongs to. When a change to the draft makes a diagram say something the text no longer says, draw it again with `diagram-writer:draw` or take it out, and take out a screenshot of a screen the draft is no longer about. After changes that alter the scope, the split or the dependencies, run the review again on the new draft. Use your judgment on its suggested improvements, and carry any question you cannot settle into step 10.

## 10. Ask the user to review

Tell the user the path of the draft and give a short summary in the conversation: the parent title, the sub-issues in order with one line each and what blocks what, the assumptions you made, and anything the reviewer raised that needs their decision. Repeat the decisions of steps 7 and 8 in a line each: the paths of the screenshots and of the diagram's PNG, so they can look at them before they are uploaded, or why the work had nothing to show or to draw, so they can ask for one. Name the screens you could not capture. Ask them to review it. They may edit the file directly or tell you what to change. Read the file again after they respond, because their edits are the source of truth. If the feedback changes the scope or the split, go back to the step it affects, including the review in step 9.

## 11. Find a GitHub Project

Look for projects the issues could be added to:

```sh
node "${CLAUDE_SKILL_DIR}/scripts/find-projects.ts" owner/repo
```

The output lists the open projects linked to the repository in `linked`, and the owner's other open projects in `others`. Ask the user whether to add the issues to a project, offering the linked ones first and "do not add" as a choice. Offer the others only when no project is linked. If the user picks one, set `project` in the draft to its URL.

If the script reports that the token lacks the project scope, tell the user they can grant it by running `gh auth refresh -s project` themselves, and ask whether to do that or to continue without a project. If there are no projects at all, say so and move on without asking.

## 12. Create the issues

Ask for approval to create the issues, stating how many will be created, in which repositories, and the project they will be added to. Create them only after the user clearly approves. Approval of an earlier draft does not cover a draft that changed since.

```sh
node "${CLAUDE_SKILL_DIR}/scripts/create-issues.ts" .claude/issue-drafts/<short-slug>.md
```

The script creates the parent issue and the sub-issues in order, links each sub-issue to the parent, registers the `Blocked by:` dependencies, and adds every issue to the project. It records each created issue in the draft as a `URL:` line under its heading. If it fails partway, fix the cause and run the same command again: issues that already have a `URL:` line are not created twice, and links that already exist are skipped.

An image a body shows is uploaded with its issue. That needs push access to the repository of the issue, which creating an issue alone does not. When an upload fails, the issue is created all the same, with a body that still shows the local path, and the script says so. Remove the image from the body of that issue with `gh issue edit`, and tell the user: the issue is complete without it.

Finish by giving the user the URL of the parent issue and of each sub-issue, and mention anything that did not succeed. Then delete the draft file and the files of its images, unless the user wants to keep them, since their content now lives on GitHub.
