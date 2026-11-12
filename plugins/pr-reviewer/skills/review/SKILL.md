---
name: review
description: Review a GitHub pull request and post the result to it. Runs the code-review and security-review skills, leaves each finding as a comment on its line with a severity prefix, follows up on the threads an earlier review left open and resolves the ones that were fixed, submits "Approve" or "Request changes" with a short summary, and hides the summaries of earlier reviews as outdated once their threads are all resolved. Use this whenever the user asks to review a pull request, to re-review one after new commits, or to check whether earlier review comments were addressed, and when running as an automated reviewer in CI, even if they do not name this skill.
argument-hint: "[pull request number or URL]"
---

# Review a pull request

Review a pull request and post the result as a single GitHub review: inline comments for new findings, a reply on every thread an earlier review left open, and a verdict with a short summary.

The pull request, if one was given with the command: $ARGUMENTS

Write everything you post in the language the pull request's title and description are written in.

Two scripts do the reading and writing on GitHub, so that the mechanical parts (which comments are from an earlier review, the severity prefix, the verdict, resolving and hiding) come out the same every time. Your part is the judgment: what is wrong with the change, how much it matters, and whether an earlier finding was really addressed.

## 1. Find the pull request and check out its code

Work out the URL of the pull request. If the argument is a URL, use it as it is. Otherwise ask GitHub: `gh pr view <number> --json url` for a number, or `gh pr view --json url` with no argument for the pull request of the current branch. If there is neither an argument nor a pull request for the branch, ask which pull request to review, or stop with that message when nobody can answer.

Use the URL, not the number, in every command from here on. A number means "in the repository of the current directory", which is the wrong pull request when the user gave a URL from another repository, and can be the fork instead of the repository that owns the pull request when working in a clone of a fork. If the URL belongs to a different repository than the one in the working tree, stop and say so, because the code to review is not here.

Read the state of the pull request:

```sh
node "${CLAUDE_SKILL_DIR}/scripts/fetch-review-state.ts" <url>
```

It prints JSON with:

- `repository` and `pullRequest`: its `number`, `state`, `headSha`, `headRef`, `baseRef` and `author`.
- `openThreads`: the unresolved threads started by an earlier review, each with its `id`, `path`, `line`, `severity`, whether it `isOutdated` (the code under it changed), and the conversation in `comments`, starting with the finding. When the code changed, `line` is `null`, and `originalLine` and `diffHunk` show where the finding was left and what the code looked like then.
- `changedFiles`: the paths of the files the pull request changes, which are the only files a finding can be placed on.
- `reviewFile`: the path to write the review to in step 5.
- `previousSummaries`: the summaries of earlier reviews that are still visible, each with the ids of its threads that are still open.

Stop if the pull request is not `OPEN`, and say so.

The review skills in step 3 read the code in the working tree, so it has to be the code of the pull request. Compare `git rev-parse HEAD` with `headSha`. If they differ and the working tree is clean, run `gh pr checkout <url>`. If they differ and there are uncommitted changes, stop and tell the user rather than moving their work aside. If HEAD is ahead of `headSha` because of unpushed commits, also stop: comments can only be placed on code GitHub has.

Then read the pull request itself: `gh pr view <url> --json title,body,files` and `gh pr diff <url>`. The description tells you what the author meant to do, which is what the change is judged against.

## 2. Follow up on the open threads

Skip this step when `openThreads` is empty.

Do this before the new review, while your view of the change is not yet shaped by it. For each open thread, read the first comment (the finding), the replies, and the current code at that place, then decide:

- **resolved**: the problem is gone, whether by the suggested fix or another one. Also resolved: the author explained why the code is right as it is and the explanation holds, or declined an optional (`nit`) suggestion. The thread exists to get a decision, and it has one.
- **open**: the problem is still there, the fix is partial or introduced a new problem at the same place, or the author's reply does not address the point.

Check the code, not the conversation. "Fixed" in a reply is a claim, and `isOutdated` only means the lines changed, not that they changed for the better. When the code moved, find where it went before concluding anything.

Write a short answer for each thread, saying what you checked and what you found: for a resolved thread, what fixed it (name the commit or the line); for an open one, what is still missing, concretely enough to act on. Do not add the "Resolved" or "Still open" label yourself, since the script prefixes it.

If a thread's `severity` is `null` (its comment was edited and no longer says) and it stays open, decide its severity from its content using the scale in step 4.

## 3. Review the change

Run both of these skills on the pull request with the Skill tool, one after the other, in this conversation rather than in a subagent, because they start their own subagents:

1. `code-review`, with the URL of the pull request as its target, for the same reason as in step 1: a number would be looked up in the repository of the current directory. Do not pass `--comment` or `--fix`: this skill posts the findings, and a review does not change the code.
2. `security-review`.

Both report their findings back to you. Nothing is posted yet. A skill may run in the background and report later, so wait until both have reported before going on to step 4: a review posted from one of them alone would approve whatever the other was about to find.

If one of the skills is not available in this session, do that part of the review yourself with the same aim (correctness bugs for the first, exploitable vulnerabilities for the second), and say in the summary that it was done without the skill.

## 4. Decide what to post

Gather the findings from both skills and go through them:

- **Drop duplicates.** The two skills can report the same problem. So can an open thread from step 2: a problem that already has an open thread is answered there, not posted again.
- **Drop what does not hold up.** Open the code a finding points to and confirm it. A wrong comment costs the author more time than a missed nit, and it teaches them to skim the next review.
- **Keep to the change.** A finding belongs in this review when the pull request introduced it or made it worse. Problems that were already there are out of scope, unless the change now depends on them.
- **Place it.** Give each finding the path and the line of the changed code it is about, on the new side of the diff. Use `startLine` when it covers a range. Use `"side": "LEFT"` only for a line the pull request removed.
- **When the code is outside the change, place it on the change.** GitHub only accepts a review comment on a file in `changedFiles`, and only a review comment becomes a thread that the author can reply to and the next review can resolve. So when the code a finding is about is not part of the change (a caller the change broke, a file that should have been updated along with it), place it on the changed line it follows from, such as the new signature that the untouched caller no longer matches. If no single line is the cause, pick the changed file most closely related to it. Either way, name the code the finding is really about in the body, with its path and line.

Give each finding a severity. The author reads this first, and it decides the verdict:

| Severity | Shown as | Meaning |
|----------|----------|---------|
| `must` | 🔴 Must fix | Merging this would cause harm: a bug in behaviour the change is meant to deliver, a security vulnerability, data loss or corruption, a breaking change nobody asked for. |
| `should` | 🟡 Should fix | Worth fixing, but merging without it is defensible: a bug in an unlikely path, a missing test for risky logic, a design that will cost the next person. |
| `nit` | 🔵 Optional | The author may ignore it: naming, style, a simpler way to write the same thing. |

When in doubt between two, pick the lower one. `must` blocks the merge, so it is kept for what you would stand behind blocking on, and a review where everything is 🔴 tells the author nothing about what matters.

Write each comment for someone who sees only that comment: what is wrong, why it matters (the input or situation that triggers it), and what to do instead. Use a GitHub suggestion block when the fix is a few lines. Do not write the severity in the body, since the script prefixes it.

## 5. Write the review file

Write the review to the path that step 1 printed as `reviewFile`. It is in a temporary directory, on purpose: an untracked file in the working tree would count as an uncommitted change if you have to return to step 1, and could be committed by accident if the run stops halfway.

```json
{
  "repository": "the repository from step 1, exactly as printed",
  "pullRequest": 123,
  "headSha": "the headSha from step 1",
  "summary": "Two or three sentences.",
  "findings": [
    {
      "path": "src/invoice.ts",
      "line": 42,
      "severity": "must",
      "body": "`total` is divided by `items.length` before the empty case is handled, so an invoice without items returns `NaN`.\n\n```suggestion\nif (items.length === 0) return 0;\n```"
    },
    {
      "path": "src/invoice.ts",
      "startLine": 60,
      "line": 68,
      "severity": "nit",
      "body": "This loop is `items.reduce(...)` in the helper two files over (`sum` in `src/math.ts`)."
    }
  ],
  "threads": [
    {
      "id": "PRRT_...",
      "status": "resolved",
      "body": "The empty case is now handled at line 40 (a1b2c3d)."
    },
    {
      "id": "PRRT_...",
      "status": "open",
      "body": "The check was added for `create`, but `update` at line 88 still accepts a negative amount."
    }
  ]
}
```

- `threads` must have one entry for every thread in `openThreads`, and only those. Add `"severity"` to an entry only when the thread's severity was `null` and it stays open.
- `findings` and `threads` may be empty arrays.
- There is no verdict in the file. The script requests changes when a new finding, or a thread that stays open, is `must`, and approves otherwise, so the verdict always follows from what was posted.

Keep the `summary` to two or three sentences: what the change does in your own words, and the one or two things the author should look at first, or that nothing needs to change. The script appends the counts of findings by severity, so do not repeat them, and do not list the findings, since each is already on its line.

## 6. Post the review

Check the file first. This reads from GitHub but posts nothing:

```sh
node "${CLAUDE_SKILL_DIR}/scripts/submit-review.ts" --dry-run <reviewFile>
```

Fix whatever it reports. If it says the pull request has new commits since `headSha`, go back to step 1: the review has to be about the code that is there now.

Then post it:

```sh
node "${CLAUDE_SKILL_DIR}/scripts/submit-review.ts" <reviewFile>
```

Being asked to run this skill is the request to post, so do not ask for confirmation again. The script posts everything as one review, so the author gets one notification: the replies to earlier threads, the new comments, and the verdict with the summary. It then resolves the threads marked `resolved`, and hides the summary of each earlier review as outdated once all of that review's threads are resolved. A summary with a thread that is still open stays visible, because GitHub hides a review's comments together with its summary.

Once the review is posted, the script deletes the review file, so the same comments cannot be posted twice by running it again. If it fails, it removes what it had started, so after fixing the cause it is safe to run again.

Finish by telling the user the URL of the review, the verdict, how many findings there were at each severity, and how many earlier threads were resolved and how many stay open. Pass on any `Warning:` lines from the script: a finding that could not be attached to its line was posted on the file instead, and a verdict GitHub did not accept (on your own pull request, or with a token that may not approve) was posted as a comment that states the verdict.
