# PrAha Claude Marketplace

A [Claude Code](https://code.claude.com/docs) plugin marketplace maintained by [PrAha, Inc.](https://praha-inc.com)

## Installation

Add this marketplace to Claude Code:

```
/plugin marketplace add praha-inc/claude-marketplace
```

Then install the plugins you need:

```
/plugin install <plugin-name>@praha-claude-marketplace
```

You can also use the CLI instead of slash commands:

```sh
claude plugin marketplace add praha-inc/claude-marketplace
claude plugin install <plugin-name>@praha-claude-marketplace
```

## Plugins

| Plugin                                 | Description                                                                                                                                                                             |
|----------------------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| [commit-hook](plugins/commit-hook)     | Runs the commands configured in `COMMIT_HOOK_COMMANDS` before Claude commits, and blocks the commit if any of them fail.                                                                |
| [issue-planner](plugins/issue-planner) | Interviews you about what you want to achieve, investigates the codebase and related repositories, and creates a GitHub issue with sub-issues that each map to one pull request.        |
| [pr-creator](plugins/pr-creator)       | Implements an issue or a described change, reviews it with `/code-review` and `/security-review` until nothing is left to fix, and opens a draft pull request linked to the issue.       |
| [pr-reviewer](plugins/pr-reviewer)     | Reviews a pull request with `/code-review` and `/security-review`, comments on the affected lines with a severity prefix, follows up on earlier threads, and approves or requests changes. |

## 🤝 Contributing

Contributions, issues and feature requests are welcome.

Feel free to check [issues page](https://github.com/praha-inc/claude-marketplace/issues) if you want to contribute.

## 📝 License

Copyright © [PrAha, Inc.](https://www.praha-inc.com/)

This project is [```MIT```](https://github.com/praha-inc/claude-marketplace/blob/main/LICENSE) licensed.
