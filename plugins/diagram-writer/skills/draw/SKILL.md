---
name: draw
description: Draw a diagram for a GitHub issue or pull request as a PNG, from the templates of this skill, so that every diagram has the same design. Covers architecture, sequence, flow, state, data model and tree diagrams, and a before-and-after comparison of any of them. Use this whenever an issue or a pull request is being written and its structure, flow, states, data or hierarchy would be clearer as a picture, when another skill asks for a diagram, or when the user asks to draw, illustrate or visualize how something works or what a change does, even if they do not name this skill.
argument-hint: "[what the diagram should show]"
---

# Draw a diagram

Draw one diagram for an issue or a pull request: write it as HTML from a template, render it to a PNG, look at the result, and hand the image back.

What to draw, if it was given with the command: $ARGUMENTS

The design of a diagram is not yours to decide. The templates, one stylesheet and one layout script fix the colours, the type, the spacing and how lines are routed, so that a reader who has seen one diagram can read the next. You decide what the diagram says: which parts are in it, how they are arranged, and what they are called.

**Handing back the image is not the end of the task you were called from.** When another skill asked for the diagram, such as one that is writing an issue or a pull request, go straight back to that skill's next step after step 6, in the same turn. Nothing has been created on GitHub at that point.

## 1. Decide whether a diagram helps

A diagram earns its place when the reader would otherwise have to assemble a picture in their head from prose: three or more parts and how they connect, an order of events between three or more participants, a path that branches and ends in different places, the states something moves through, or how a structure differs before and after the work.

Do not draw one when:

- The change stays inside one function, file or component. There is nothing to connect.
- It is the same edit in many places, such as a rename or a dependency update. Many files change and no connection between them does.
- What there is to show is a set of separate things, with no order and no connection between them. A list or a table says that better.
- You would be drawing it because an issue "should have a diagram". A diagram that carries nothing makes the reader look for a point that is not there.

That the text already says it is not one of these reasons. The text of an issue or a pull request has to say everything with or without a diagram, so a diagram never adds a fact: it saves the reader from holding the parts and their connections in their head while they read. When another skill asked for the diagram, it has already found a shape in the work. Hand back "no diagram" only when you read the code and the shape is not there.

One diagram is the norm, two when they answer different questions, such as the structure and the order of calls. When no diagram helps, say so to whoever asked and stop here.

## 2. Choose the template

Pick by the question the reader has. The templates are in `${CLAUDE_SKILL_DIR}/templates/`.

| The reader asks | Template |
|-----------------|----------|
| What are the parts, and which depends on which? | `architecture.html` |
| Who calls whom, and in what order? | `sequence.html` |
| What are the steps, and where does it branch? | `flow.html` |
| Which states exist, and what moves between them? | `state.html` |
| Which tables or types are there, and how do they relate? | `data-model.html` |
| What contains what? (components, modules, files) | `tree.html` |
| What is different afterwards? | `comparison.html`, around one of the above |

A change can be shown in two ways. Mark it inside a single diagram, with what is added, removed and changed in colour, when most of the picture stays the same. Use the comparison when the shape itself changes, so that one picture cannot hold both.

If none of them fits, do not bend one into something else. Draw the closest kind honestly, or draw nothing.

## 3. Write the source

Read `${CLAUDE_SKILL_DIR}/references/design-rules.md` once, then the template you chose. The comment at the top of each template lists every element, class and attribute that kind of diagram has.

Write the source to the path you were given. Otherwise put it next to the draft of the issue or pull request it belongs to, and outside the files the repository tracks, so that it is not committed by accident. Name it for what it shows, such as `coupon-flow.html`: the PNG takes the same name.

Start from a copy of the template and replace its content. The rules that the render enforces:

- Use only what the template's comment lists. A `style` attribute, a `<style>`, a `<script>`, an image or a link is refused, because the design comes from the skill and nothing in a diagram is fetched or run.
- Set `lang` on `<html>` to the language of the diagram. The legend is written in Japanese for `ja` and in English otherwise.

And the ones only you can keep:

- **Draw what you have read.** Every part and every line must be something you saw in the code, the diff or the issue. A reviewer trusts a diagram more than a paragraph, so a line that is not in the code does more harm than no diagram.
- **Write it in the language of the issue or pull request**, and call each part what the code calls it.
- **The title states the point**, not the kind of diagram: "Coupons are checked by a new service", not "Architecture". The caption under it is one sentence, or left out.
- **Leave out what has nothing to do with the work**, and say in the caption that it was left out. The parts a change sits between stay in, unmarked: they are what lets the reader place the change. Aim for at most about twelve boxes, five layers, six actors or twelve messages. Past that, the reader stops reading, so split the diagram or raise its level.
- **Mark only what the work changes.** `data-change` on everything marks nothing. In an issue where nothing has changed yet, `data-emphasis` marks what the issue is about.
- **Keep labels to a few words.** A box is a name, and a line's label is a verb, a protocol or an event.

## 4. Render

```sh
node "${CLAUDE_SKILL_DIR}/scripts/render.ts" <diagram.html>
```

It writes `<diagram>.png` next to the source, at twice the size so the text stays sharp, and prints the problems its layout check found.

- **It refuses the source**: the message names what the source may not contain, or which `data-id`, attribute or value is wrong. Fix the source.
- **It reports problems**: a line running through a box, a label covering a box or another label, text that does not fit, or content wider than the diagram. Each message says what to change. Fix them all before going on.
- **No browser was found**: the script needs Google Chrome, Chromium or Microsoft Edge, or `CHROME_PATH` set to one. Do not install one. Tell whoever asked that the diagram could not be rendered, and go on without it.

## 5. Look at the image

Open the PNG with the Read tool. The layout check cannot see everything, and you are the only one who looks at the image before it is published.

- Does the picture make the point in the title within a few seconds?
- Is anything cut off, squeezed, overlapping, or wrapped in the middle of a word?
- Do lines cross where reordering the layers, or the boxes within a layer, would untangle them?
- Is the part that matters easy to find, or is it lost among parts that could be left out?
- Does every line end at the box it is meant for, and point the right way?

Fix what you find in the source and render again. The usual fixes are fewer parts, shorter labels, a different order within a layer, and `data-direction="down"` for a graph that is too wide. Use `data-width="wide"` last: GitHub shows a wide diagram scaled down, so its text gets smaller.

Stop after looking at three images. A render that only reports problems is not one of them: fix what it reports and render again. If the diagram still does not read well after the third look, it is trying to show too much: cut it down to the point of the title, and if that cannot be done, hand back no diagram and say why.

## 6. Hand back

Give whoever asked:

- The path of the PNG.
- An alternative text: one sentence that says what the diagram shows, for a reader who cannot see it.
- Anything the diagram leaves out on purpose.

The image is attached with the GitHub CLI, which uploads it and rewrites the reference in the body to the uploaded URL. Write the reference where the image should appear, with a path relative to the body file:

```markdown
![The order API asks a new coupon service before it prices an order](./coupon-architecture.png)
```

```sh
gh issue create --title "<title>" --body-file <body.md> --attach <diagram.png>
gh pr create --draft --title "<title>" --body-file <body.md> --attach <diagram.png>
```

`gh issue edit`, `gh pr edit` and the `comment` commands take `--attach` in the same way. Attaching needs push access to the repository and a GitHub CLI recent enough to have the flag: if `gh issue create --help` does not list `--attach`, tell the user and create the issue or pull request without the image.

Two things follow from how the image is published:

- **The text must stand without the image.** An agent that picks up the issue reads its text and not its pictures, and the image is not shown in every notification. The diagram illustrates what the body says. It does not replace a sentence of it.
- **The source is not kept.** Delete the HTML and the PNG once the issue or pull request exists. When the content changes later, draw the diagram again from how things are then and replace the image, or remove it. A diagram that no longer matches the text is worse than none.
