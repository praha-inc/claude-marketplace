---
name: create
description: Implement a piece of work, from a description or a GitHub issue, and open a draft pull request for it. Asks once whether to run on its own or to check the risky decisions with the user, implements the change on a branch, reviews it with the code-review and security-review skills, fixes the findings that hold up and reviews again until nothing is left, then opens a draft pull request linked to the issue so that merging closes it. Use this whenever the user asks to implement an issue or a change and open a pull request for it, to take an issue through to a pull request, or to open a pull request for work that is already on the branch, even if they do not name this skill.
argument-hint: "[issue number or URL, or what to implement]"
---

# Create a pull request

Take a piece of work from a description or an issue to a draft pull request: implement it, review it yourself until the review finds nothing, and open the pull request linked to its issue.

The work, if it was given with the command: $ARGUMENTS

Talk to the user in the language they use. Write commits and the pull request in the language the repository's recent pull requests are written in.

The pull request is opened as a draft, and only after the self-review comes back clean. A draft tells reviewers the author is not asking for their time yet, which is right for work no person has looked at. Marking it ready is the user's decision.

## 1. Understand the work

Work out what is to be built and which issue it belongs to.

- **An issue** (a number, a URL, or a description that names one): read it with the script. Pass a URL as it is, since a number means "in the repository of the current directory".

  ```sh
  node "${CLAUDE_SKILL_DIR}/scripts/fetch-issue.ts" <issue URL or number>
  ```

  It prints the `issue` with its body and latest comments, its `parent`, its `subIssues`, the `openBlockers` that must be merged first, the `openPullRequests` that already close it, and the repository's `defaultBranch`. Read the comments as well as the body: decisions made after the issue was written are in the thread. Read the parent too when there is one, for the reason behind the work.
- **A description**: that is the work. If it mentions an issue, read it as above. Otherwise there is no issue to link, and that is fine.
- **Nothing**: if the current branch already has commits that are not on the base branch, the work is what is on the branch, and the task is to review it and open its pull request. Otherwise ask what to implement.

Stop and tell the user, instead of starting, when:

- The issue is closed, or `openPullRequests` is not empty. Someone may already be doing this.
- `openBlockers` is not empty. The work is meant to be built on changes that are not merged yet.
- The issue has open `subIssues`. It is a parent that describes a whole outcome, and each sub-issue is its own pull request. Ask which sub-issue to implement.
- The issue belongs to a different repository than the working tree.

The user may tell you to go ahead anyway, and then you do.

## 2. Ask how to proceed

Ask the user once, with AskUserQuestion, how much to check with them on the way:

- **Run on its own**: go all the way to the draft pull request without asking. You make every decision yourself and list the important ones in the pull request, where they are reviewed together with the code.
- **Confirm the risky decisions**: you stop and ask at each decision that would be expensive to get wrong, and decide everything else yourself.

Skip the question when the user already said which they want, and run on your own when nobody is there to answer, as in CI.

A **risky decision** is one where a wrong guess means redoing work, not adjusting it:

- A requirement that can be read in more than one way, where the readings lead to different implementations.
- An interface other code or other people will depend on: the path, parameters and response of an API endpoint, a public function or type, an event or message format, a database schema or migration.
- How a frontend is cut into components: where the boundaries are, which component owns which state, what the props are.
- Anything else that the rest of the implementation is built on top of, or that is hard to change once merged, such as a new dependency or the place a new module lives.

Naming, the internals of a function, how to write a test: these are not risky decisions. Getting them wrong costs a review comment. Asking about them makes the user do the work they handed over.

## 3. Prepare the branch

- Check `git status`. If there are uncommitted changes that are not part of this work, stop and ask, rather than carrying someone's unfinished work into the pull request or moving it aside.
- Find the base branch: the repository's default branch, unless the user or the issue names another.
- If the current branch is the base branch, update it (`git pull --ff-only`) and create a branch from it. Name it the way the repository does: look at the contributing guide, the workflows under `.github/workflows/` that check branch names, and the branches of recent pull requests (`gh pr list --state merged --limit 10 --json headRefName,title,labels`). The same output shows the conventions for titles and labels, which step 7 needs.
- If the current branch is already a branch for this work, stay on it.

## 4. Implement

Read the code the change touches before writing any: the conventions, the neighbouring code, how similar things were done, and the project's instructions such as `CLAUDE.md` and the contributing guide. Then list the risky decisions this work contains, with the choice you would make for each.

- **Confirming the risky decisions**: before writing code, show the user the plan in a few lines and ask about the risky decisions together, each with its options, their trade-offs and your recommendation. Use AskUserQuestion where the answer is a choice. If another risky decision turns up while implementing, stop and ask again at that point, not after building on a guess.
- **Running on its own**: make each decision as the issue, the code and the repository's conventions suggest, and keep a note of each with its reason. The notes go into the pull request in step 7. That is what makes it safe to decide alone: the reviewer sees the decision instead of having to notice it.

In either mode, stop when the work cannot be done as described: the issue contradicts the code, or depends on something that does not exist. A pull request that quietly builds something else than was asked is worse than a question.

Implement the change, with the tests it needs. Keep to the work: what you notice on the way that is not part of it belongs in a note to the user, not in this pull request.

Then run the project's own checks, such as lint, type check, tests and build, as its scripts, CI workflows or instructions define them, and fix what fails. A check that already failed before the change is not yours to fix, but say so in the pull request.

Commit the work, following the repository's conventions for commits. The review in the next step reads the branch against its base, so what is not committed may not be reviewed.

## 5. Review, fix, and review again

Run both of these skills on the branch's changes with the Skill tool, one after the other, in this conversation rather than in a subagent, because they start their own subagents:

1. `code-review`. Do not pass `--fix` or `--comment`: the findings come to you first, and there is no pull request yet.
2. `security-review`.

A skill may run in the background and report later, so wait until both have reported. If one of them is not available in this session, do that part of the review yourself with the same aim (correctness bugs for the first, exploitable vulnerabilities for the second), and say so in the pull request.

Then judge every finding. A review skill reads the change without knowing why it was written, so some findings are wrong, and fixing a wrong finding makes the code worse.

- **Valid**: the problem is real, and the change introduced it or made it worse. Open the code and confirm it, with the input or situation that triggers it. Fix it.
- **Not valid**: the code is right as it is, the finding misreads it, it is about code this change did not touch, or it asks for something outside the work. Do not change the code. Keep a one-line note of the reason.
- **A risky decision**: the fix would change one of the decisions from step 2, such as an interface. When confirming with the user, ask. When running on your own, decide and note it.

Fix the valid findings at their cause, not only where they were noticed, run the project's checks again, and commit.

Then run both reviews again, on the whole change and not only on the fixes: a fix can break something the earlier round had passed. Repeat until a round ends with no valid finding. Do not report a finding again that you already judged not valid, unless the new round gives a reason you had not considered.

The loop is meant to end. Stop and tell the user where things stand, without opening the pull request, when:

- Five rounds have passed and valid findings still come up.
- A finding comes back after its fix, or two fixes undo each other. That usually means the design is the problem, which another round does not solve.
- A valid finding cannot be fixed within this work.

Say what was fixed, what remains and why it does not converge, and let the user decide whether to open the pull request as it is.

## 6. Decide how the pull request refers to the issue

Skip this step when there is no issue.

GitHub closes an issue when a pull request whose description says `Closes #123` is merged into the default branch. Use it only when merging this pull request really finishes the issue:

- **Close it** (`Closes #123`) when the change does everything the issue asks for, including its acceptance criteria, and the issue has no open sub-issues.
- **Only refer to it** (`Part of #123`) when the change does part of the issue, when more pull requests are planned for it, or when the issue is a parent whose other sub-issues are still open. An issue that closes with work left undone gets lost.
- When the issue is a sub-issue, close the sub-issue and do not mention its parent with a closing keyword. GitHub shows the parent's progress on its own.
- For an issue in another repository, write `Closes owner/repo#123`.
- When the base is not the default branch, GitHub ignores the keyword. Write it anyway, and tell the user the issue will not close on merge.

If the change deliberately leaves out something the issue asks for, it is "part of", and the pull request says what is left.

## 7. Open the draft pull request

Push the branch (`git push -u origin <branch>`) and write the description to a file outside the working tree's tracked files, so it cannot be committed by accident. Follow the repository's pull request template if it has one (`.github/pull_request_template.md` and its variants). Otherwise use these sections, leaving out any that would be empty:

- **Summary**: what changed and why, for a reader who has not seen this conversation.
- The line from step 6, on its own line.
- **Decisions**: the risky decisions and what was chosen, with the reason. When running on your own, mark the ones nobody confirmed, so the reviewer knows where to look first.
- **Self-review**: how many rounds were run, what they found and fixed in a line each, and the findings judged not valid with their reason, so the reviewer does not raise them again.
- **Test plan**: the checks that were run and their result, and what was not verified.

Create it as a draft, with a title and labels in the repository's conventions from step 3:

```sh
gh pr create --draft --base <base> --title "<title>" --body-file <file>
```

Then confirm the link, because a closing keyword that GitHub did not recognise fails silently:

```sh
gh pr view --json url,isDraft,closingIssuesReferences
```

`closingIssuesReferences` must contain the issue when step 6 chose to close it, and must not when it chose only to refer. Edit the description with `gh pr edit --body-file <file>` if it does not match, then delete the file.

Finish by telling the user the URL of the pull request, whether merging it will close the issue, the decisions you made without them, how the self-review went, and anything that was left out or could not be verified.
