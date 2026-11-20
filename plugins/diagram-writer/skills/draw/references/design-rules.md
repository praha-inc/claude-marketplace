# Design rules

Every diagram is drawn with the same tokens and the same components, which live in `assets/diagram.css` and `scripts/layout.ts`. A diagram's source cannot change them. This document says what they are and why, so that you can use them as meant, and so that the stylesheet can be changed without losing the reasons behind it.

The tokens are those of PrAha's design system. Change a value here and in `diagram.css` together.

## Principles

1. **Colour means change, and nothing else.** A diagram is neutral by default: white boxes, grey lines, dark text. Colour appears only on what the work adds, removes or changes, or on what an issue is about. A reader can then find the change without reading a single label. Kinds of things are told apart by shape and border, never by hue.
2. **Flat.** No shadows and no gradients. The image is shown small, inside a page that has its own visual weight.
3. **One background.** The canvas is always white, because the image is also seen on GitHub's dark theme, where a transparent PNG would put dark text on a dark page.
4. **Text is sized to be read where it is shown.** A diagram is 880px wide, about the width of an issue or pull request body, and is rendered at twice that. Text is then shown at the size it was set in.
5. **The layout script decides where lines run.** The source says what connects to what. This keeps the routing the same from one diagram to the next, and lets the script report a line that runs through a box.

## Colour

| Role | Value | Used for |
|------|-------|----------|
| Text | `#16191F` | Names and titles |
| Secondary text | `#727272` | Captions, second lines, labels on lines, group names |
| Border | `#D3D3D3` | Boxes, frames, lifelines, tree branches |
| Line | `#727272` | Lines between boxes, arrows |
| Surface | `#FFFFFF` | The canvas and boxes |
| Grey surface | `#F1F1F1` | Groups, table headings, lane headings, external systems |
| Added | `#4F7F00` on `#EDF2E6` | `data-change="added"` |
| Removed | `#D10010` on `#FDE6E7` | `data-change="removed"`, with a dotted outline and a dotted line |
| Changed | `#DEB158` on `#FBF5EA`, text `#987021` | `data-change="changed"` |
| Focus | `#0076C0` on `#E6F1F9` | `data-emphasis`, and the label of the second pane of a comparison |

Each change has a line colour and a pale fill of the same hue. The line colour goes on borders, lines and their labels, the fill inside boxes. Removed parts are also marked without colour, so the difference survives for a reader who cannot tell red from green: their outline and their lines are dotted, and their text is grey. A name is never struck through, because a struck-through name is hard to read, most of all in a small box. In a data model, a field carries the sign a diff would give it: `+`, `−` or `~`.

The legend under the diagram is built by the layout script from the marks the diagram actually uses. Do not write one.

## Type

| Token | Size | Used for |
|-------|------|----------|
| 300, bold | 17.7px | The title |
| 75 | 12.4px | The caption, names in boxes (bold), table headings (bold) |
| 50 | 11.1px | Second lines in boxes, labels on lines, group names, fields, notes, the legend |

The face is Noto Sans JP, falling back to Noto Sans CJK JP and Hiragino Kaku Gothic ProN, so that a diagram looks the same on macOS and on a Linux runner. Identifiers in a data model and in a file tree are set in the system's monospaced face. The sizes are steps of a major second scale (1.125) on a 14px base, and the line height is 1.5.

No web font is loaded: rendering does not use the network. On a machine without any of these faces the browser's default sans-serif is used, and the widths of labels differ slightly.

Japanese text breaks between phrases, and the lines of a label are balanced in length. A label that still wraps badly is too long: shorten it.

## Space and shape

| Token | Value | Used for |
|-------|-------|----------|
| xxs, xs, sm | 4, 8, 12px | Inside boxes and between a box and its remark |
| md | 16px | Inside groups and panes, between panes |
| lg | 24px | Around the diagram, between boxes in a layer, wider when a line between two of them carries a label |
| xl | 40px | Between the layers of a graph that runs down |
| xxl | 64px | Between the layers of a graph that runs right, wider when a label needs it |

| Radius | Value | Used for |
|--------|-------|----------|
| sm | 2px | Labels, legend swatches |
| md | 4px | Boxes, notes |
| lg | 6px | Groups, tables, panes, frames |
| full | | People and clients, and the start and end of a flow |

Borders of boxes and lines between them are 1.5px. Frames that only contain things, such as groups and panes, are 1px.

## Shapes

| Shape | Meaning | Written as |
|-------|---------|------------|
| Rectangle | A part, a step, a state | `.node` |
| Pill | A person or a client; where a flow starts or ends | `data-kind="actor"`, `data-shape="terminal"` |
| Cylinder | Something that stores: a database, a queue, a bucket | `data-kind="store"` |
| Dashed grey rectangle | A system outside what the repository owns | `data-kind="external"` |
| Diamond | A decision | `data-shape="decision"` |
| Filled circle, ringed circle | Before the first state, after the last | `data-shape="start"`, `data-shape="end"` |
| Grey frame with a name | A boundary: a service, a package, a repository | `.group` |

## Lines

- A solid line with an arrowhead is the default: a dependency, a call, a transition, a step to the next.
- A dashed line is a second kind, and a diagram has at most one. Say what it means in `data-legend-dashed` on `.diagram`: "Asynchronous" in an architecture, "Reply" in a sequence. The render refuses a dashed line without it.
- A relation in a data model has no arrowhead. Its ends carry the cardinality.
- Lines run horizontally and vertically with rounded corners. They leave a box on the side that faces where they go, and several lines on one side are spread apart.
- A line that would run through another box is reported. Fix it by reordering first. Only when the order is right and the line has to go back, send it around with `data-from-side` and `data-to-side`.

## Arrangement

- Order the layers in the direction of reading: who starts things first, what they depend on after. In a graph that runs right, that is left to right, and in one that runs down, top to bottom.
- Within a layer, order the boxes so that lines do not cross: a box goes level with what it connects to.
- A graph that runs right fits about four layers in the standard width, and about three when lines carry labels. Past that, run it down, or leave parts out.
- In a comparison, draw both panes with the same parts in the same places. The eye finds a difference by position before it reads a label.

## Width

| `data-width` | Canvas | When |
|--------------|--------|------|
| (none) | 880px | Always, unless the content cannot be cut down to fit |
| `wide` | 1200px | A comparison whose panes each need more than three layers. GitHub scales it to about three quarters, so its smallest text is shown at about 8px |
