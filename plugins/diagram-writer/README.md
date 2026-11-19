# diagram-writer

A Claude Code plugin that draws diagrams for GitHub issues and pull requests. Claude writes a diagram as HTML from a template, renders it to a PNG with a browser that is already installed, looks at the result, and hands back an image that the GitHub CLI can attach.

Every diagram comes out in the same design, because the design is not Claude's to choose: the templates, one stylesheet and one layout script fix the colours, the type, the spacing and how lines are routed.

## Installation

```
/plugin marketplace add praha-inc/claude-marketplace
/plugin install diagram-writer@praha-claude-marketplace
```

## Usage

Run the skill with what the diagram should show:

```
/diagram-writer:draw How a coupon code is validated when an order is placed
/diagram-writer:draw What this branch changes in the checkout components
```

Claude also uses the skill on its own when an issue or a pull request it is writing would be clearer with a picture, and when you ask it to draw or visualize something. [issue-planner](../issue-planner) and [pr-creator](../pr-creator) call it for the issues and pull requests they write, when a diagram would help.

## Templates

| Template | Shows |
|----------|-------|
| Architecture | The parts of a system, the boundaries they sit in, and which depends on which |
| Sequence | Who sends what to whom, in order, with frames for steps that are conditional or repeated |
| Flow | The steps of a process and where it branches, with optional swimlanes |
| State | The states something can be in and what moves it between them |
| Data model | Tables or types, their fields, and how they relate |
| Tree | What contains what: components, modules, or files and directories |
| Comparison | Any of the above before and after the work, side by side |

Each of them can mark what the work adds, removes and changes. The marks use the same three colours in every diagram, and the legend is built from the ones a diagram uses.

## How it works

1. **Decide**: Claude draws a diagram only when it saves the reader from assembling a picture from prose. A change inside one function gets none.
2. **Choose**: Claude picks the template by the question the reader has, such as "who calls whom, in what order?".
3. **Write**: Claude copies the template and replaces its content. The source only says what the parts are and what connects to what.
4. **Render**: `render.ts` adds the stylesheet and the layout script, lays the page out in a headless browser, and takes a screenshot at twice the size.
5. **Look**: Claude opens the PNG, fixes what does not read well, and renders again, for at most three rounds.
6. **Hand back**: Claude returns the path of the PNG with an alternative text. The image is attached with `gh issue create --attach` or `gh pr create --attach`.

### What keeps the design the same

- **A source cannot style itself.** The render refuses a source that contains a `style` attribute, a `<style>`, a `<script>`, an image or a link. The only way to change how a diagram looks is to change the skill.
- **Lines are routed by the script.** The source names the two ends of a line. Which sides it leaves and enters by, where it bends, and where its label sits are computed the same way every time.
- **Colour has one meaning.** Diagrams are neutral, and colour marks only what the work changes. Kinds of things are told apart by shape.

The rules and their reasons are in [design-rules.md](skills/draw/references/design-rules.md).

### What the render checks

The layout script reports what it can measure, and Claude fixes it before looking at the image:

- A line that runs through a box it does not belong to.
- A label that covers a box or another label.
- Text that does not fit its box.
- Content that is wider than the diagram.
- A line whose end does not exist, a dashed line whose meaning is not given, and values that are not allowed. For these, no image is produced.

### Nothing is fetched or run

A diagram often contains text copied from an issue. The source may not contain scripts, event handlers or anything with a URL, and the browser is started with name resolution turned off, so rendering a diagram cannot load or send anything.

## Notes

- The plugin needs a Chromium-based browser: Google Chrome, Chromium, Microsoft Edge or Brave. Set `CHROME_PATH` to the executable if it is not in the usual place. GitHub's hosted runners have Chrome installed.
- It needs Node.js 22.18 or later available as `node`, because its script is a TypeScript file run with Node.js type stripping.
- Attaching the image needs a [GitHub CLI](https://cli.github.com/) (`gh`) that has the `--attach` flag, and push access to the repository.
- Diagrams are set in Noto Sans JP, falling back to Noto Sans CJK JP and Hiragino Kaku Gothic ProN. No web font is loaded, so on a machine with none of them the browser's default face is used.
- The HTML source is not kept after the issue or pull request is created. To change a diagram later, Claude draws it again from how things are then.
- The image is only an illustration. The issue or pull request has to say in its text everything the diagram shows, since agents that read it later do not see the picture.

## Disabling

```
/plugin disable diagram-writer@praha-claude-marketplace
```
