/**
 * Lays out the parts of a diagram that CSS cannot: the lines between the nodes of a graph, the
 * rows of a sequence, the swimlanes and the legend.
 *
 * A diagram's source only says what is connected to what. Where a line runs is decided here, so
 * every diagram routes its lines the same way. When the page has been laid out, the size of the
 * diagram and the problems found in it are left on the <html> element for render.ts to read.
 *
 * This function runs in the browser, not in Node.js: render.ts puts its source text into the
 * page. Everything it uses therefore has to be declared inside it. Nothing outside the function
 * exists where it runs.
 */
export const layout = (): void => {
  type Side = 'top' | 'right' | 'bottom' | 'left';
  type Point = { x: number; y: number };
  type Area = { left: number; top: number; right: number; bottom: number };
  type Box = Area & { width: number; height: number };
  type LegendKey = 'added' | 'removed' | 'changed' | 'emphasis' | 'external';
  type Edge = {
    /** The element that describes the edge in the source. It becomes the label of the line. */
    element: HTMLElement;
    fromElement: HTMLElement;
    toElement: HTMLElement;
    arrow: string;
    direction: 'right' | 'down';
    /** How far the middle run of the line is moved to keep it off other lines in the same gap. */
    stagger: number;
    from: Box;
    to: Box;
    fromSide: Side;
    toSide: Side;
    start: Point;
    end: Point;
    points: Point[];
  };
  type AnchorEnd = { edge: Edge; end: 'start' | 'end'; position: number };

  const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
  const CHANGES = ['added', 'removed', 'changed'] as const;
  const SIDES: readonly Side[] = ['top', 'right', 'bottom', 'left'];
  const ARROWS = ['end', 'both', 'none'];
  const CORNER_RADIUS = 6;
  const ANCHOR_STEP = 16;
  const DETOUR = 24;
  const LOOP = 20;
  const CORNER_CLEARANCE = 8;
  const ORIGIN: Point = { x: 0, y: 0 };
  const EMPTY: Box = { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
  const PADDING = { top: 'paddingTop', right: 'paddingRight', bottom: 'paddingBottom', left: 'paddingLeft' } as const;
  const LEGEND_TEXT: Record<'en' | 'ja', Record<LegendKey, string>> = {
    en: { added: 'Added', removed: 'Removed', changed: 'Changed', emphasis: 'In focus', external: 'External' },
    ja: { added: '追加', removed: '削除', changed: '変更', emphasis: '注目', external: '外部' },
  };
  const LEGEND_ATTRIBUTE: Record<LegendKey, string> = {
    added: 'legendAdded',
    removed: 'legendRemoved',
    changed: 'legendChanged',
    emphasis: 'legendEmphasis',
    external: 'legendExternal',
  };
  const SWATCH: Record<Exclude<LegendKey, 'external'>, [line: string, fill: string]> = {
    added: ['added', 'added-pale'],
    removed: ['removed', 'removed-pale'],
    changed: ['changed-line', 'changed-pale'],
    emphasis: ['focus', 'focus-pale'],
  };

  /** Problems that make the diagram wrong. render.ts refuses to produce an image while there are any. */
  const errors: string[] = [];
  /** Problems that make the diagram hard to read. The image is produced, and they are reported with it. */
  const warnings: string[] = [];

  const data = (element: HTMLElement | SVGElement, name: string): string | undefined => element.dataset[name];

  const isSide = (value: string | undefined): value is Side => SIDES.some((side) => side === value);

  const childrenOf = (element: Element): HTMLElement[] => {
    return [...element.children].filter((child): child is HTMLElement => child instanceof HTMLElement);
  };

  const textOf = (element: Element): string => (element.textContent ?? '').trim();

  const describe = (element: HTMLElement): string => {
    const id = data(element, 'id') ?? data(element, 'label');
    return id ? `"${id}"` : `"${textOf(element).replaceAll(/\s+/g, ' ').slice(0, 24)}"`;
  };

  /**
   * Returns the box of an element in the coordinates of a container.
   */
  const boxIn = (element: Element, container: Element): Box => {
    const inner = element.getBoundingClientRect();
    const outer = container.getBoundingClientRect();
    return {
      left: inner.left - outer.left,
      top: inner.top - outer.top,
      right: inner.right - outer.left,
      bottom: inner.bottom - outer.top,
      width: inner.width,
      height: inner.height,
    };
  };

  const overlaps = (a: Area, b: Area, margin = 0): boolean => {
    return a.left < b.right - margin && b.left < a.right - margin && a.top < b.bottom - margin && b.top < a.bottom - margin;
  };

  /**
   * Returns the area a straight run of a line covers, a little wider than the line itself.
   */
  const around = (a: Point, b: Point, margin: number): Area => {
    return {
      left: Math.min(a.x, b.x) - margin,
      right: Math.max(a.x, b.x) + margin,
      top: Math.min(a.y, b.y) - margin,
      bottom: Math.max(a.y, b.y) + margin,
    };
  };

  const isHorizontal = (side: Side): boolean => side === 'left' || side === 'right';

  /**
   * Picks the sides a line leaves and enters by, from where the two boxes are: along the
   * direction the graph runs in when one box is past the other, and across it otherwise.
   */
  const chooseSides = (from: Box, to: Box, direction: 'right' | 'down'): [Side, Side] => {
    const horizontal = (): [Side, Side] | undefined => {
      if (from.right <= to.left) return ['right', 'left'];
      if (to.right <= from.left) return ['left', 'right'];
      return undefined;
    };
    const vertical = (): [Side, Side] | undefined => {
      if (from.bottom <= to.top) return ['bottom', 'top'];
      if (to.bottom <= from.top) return ['top', 'bottom'];
      return undefined;
    };
    const sides = direction === 'down' ? (vertical() ?? horizontal()) : (horizontal() ?? vertical());
    return sides ?? ['right', 'left'];
  };

  /**
   * Returns the point on a side of a box, the given distance from the middle of that side.
   */
  const anchor = (box: Box, side: Side, offset: number): Point => {
    const centerX = (box.left + box.right) / 2 + offset;
    const centerY = (box.top + box.bottom) / 2 + offset;
    if (side === 'top') return { x: centerX, y: box.top };
    if (side === 'bottom') return { x: centerX, y: box.bottom };
    if (side === 'left') return { x: box.left, y: centerY };
    return { x: box.right, y: centerY };
  };

  const outward = (side: Side): Point => {
    if (side === 'top') return { x: 0, y: -1 };
    if (side === 'bottom') return { x: 0, y: 1 };
    if (side === 'left') return { x: -1, y: 0 };
    return { x: 1, y: 0 };
  };

  /**
   * Returns the corners of a line made of horizontal and vertical runs, from a point on one
   * box to a point on another.
   */
  const route = (edge: Edge): Point[] => {
    const { start, end, fromSide, toSide, from, to, stagger } = edge;
    if (edge.fromElement === edge.toElement) {
      // A line from a box to itself loops over its top.
      return [start, { x: start.x, y: start.y - LOOP }, { x: end.x, y: end.y - LOOP }, end];
    }
    if (fromSide === toSide) {
      // Both ends are on the same side, so the line goes around: out past both boxes and back.
      const direction = outward(fromSide);
      if (isHorizontal(fromSide)) {
        const x = (direction.x < 0 ? Math.min(from.left, to.left) : Math.max(from.right, to.right)) + direction.x * (DETOUR + stagger);
        return [start, { x, y: start.y }, { x, y: end.y }, end];
      }
      const y = (direction.y < 0 ? Math.min(from.top, to.top) : Math.max(from.bottom, to.bottom)) + direction.y * (DETOUR + stagger);
      return [start, { x: start.x, y }, { x: end.x, y }, end];
    }
    if (isHorizontal(fromSide) && isHorizontal(toSide)) {
      if (Math.abs(start.y - end.y) < 1) return [start, { x: end.x, y: start.y }];
      const middle = (start.x + end.x) / 2 + stagger;
      return [start, { x: middle, y: start.y }, { x: middle, y: end.y }, end];
    }
    if (!isHorizontal(fromSide) && !isHorizontal(toSide)) {
      if (Math.abs(start.x - end.x) < 1) return [start, { x: start.x, y: end.y }];
      const middle = (start.y + end.y) / 2 + stagger;
      return [start, { x: start.x, y: middle }, { x: end.x, y: middle }, end];
    }
    return isHorizontal(fromSide) ? [start, { x: end.x, y: start.y }, end] : [start, { x: start.x, y: end.y }, end];
  };

  /**
   * Turns the corners of a line into an SVG path with rounded bends.
   */
  const toPath = (points: Point[]): string => {
    const commands: string[] = [];
    for (const [index, corner] of points.entries()) {
      const previous = points[index - 1];
      const next = points[index + 1];
      if (!previous) {
        commands.push(`M ${corner.x} ${corner.y}`);
        continue;
      }
      if (!next) {
        commands.push(`L ${corner.x} ${corner.y}`);
        continue;
      }
      const before = Math.hypot(corner.x - previous.x, corner.y - previous.y);
      const after = Math.hypot(next.x - corner.x, next.y - corner.y);
      const radius = Math.min(CORNER_RADIUS, before / 2, after / 2);
      if (radius < 1) {
        commands.push(`L ${corner.x} ${corner.y}`);
        continue;
      }
      const entry = { x: corner.x - ((corner.x - previous.x) / before) * radius, y: corner.y - ((corner.y - previous.y) / before) * radius };
      const exit = { x: corner.x + ((next.x - corner.x) / after) * radius, y: corner.y + ((next.y - corner.y) / after) * radius };
      commands.push(`L ${entry.x} ${entry.y}`, `Q ${corner.x} ${corner.y} ${exit.x} ${exit.y}`);
    }
    return commands.join(' ');
  };

  /**
   * Shapes that only touch their box at the middle of each side. A line that met them
   * anywhere else would end in the air.
   */
  const meetsOnlyAtMiddle = (element: HTMLElement): boolean => {
    return ['decision', 'start', 'end'].includes(data(element, 'shape') ?? '');
  };

  /**
   * Spreads the lines that meet one side of one box, in the order of where they come from, so
   * that they do not lie on top of each other and do not cross on the way in.
   */
  const spreadAnchors = (edges: Edge[]): void => {
    const groups = new Map<HTMLElement, Map<Side, AnchorEnd[]>>();
    const add = (element: HTMLElement, side: Side, edge: Edge, end: 'start' | 'end', other: Box): void => {
      const sides = groups.get(element) ?? new Map<Side, AnchorEnd[]>();
      groups.set(element, sides);
      const ends = sides.get(side) ?? [];
      sides.set(side, ends);
      const position = isHorizontal(side) ? (other.top + other.bottom) / 2 : (other.left + other.right) / 2;
      ends.push({ edge, end, position });
    };
    for (const edge of edges) {
      if (edge.fromElement === edge.toElement) continue;
      add(edge.fromElement, edge.fromSide, edge, 'start', edge.to);
      add(edge.toElement, edge.toSide, edge, 'end', edge.from);
    }
    for (const [element, sides] of groups) {
      for (const [side, ends] of sides) {
        ends.sort((a, b) => a.position - b.position);
        for (const [index, entry] of ends.entries()) {
          const box = entry.end === 'start' ? entry.edge.from : entry.edge.to;
          const length = isHorizontal(side) ? box.height : box.width;
          const step = meetsOnlyAtMiddle(element) ? 0 : Math.min(ANCHOR_STEP, length / (ends.length + 1));
          entry.edge[entry.end] = anchor(box, side, (index - (ends.length - 1) / 2) * step);
        }
      }
    }

    // Two boxes that face each other are rarely level to the pixel, which would put a small
    // step in the line between them. Where one end has its side to itself, slide it level
    // with the other end, as long as it stays clear of the corners of its box.
    const alone = (element: HTMLElement, side: Side): boolean => groups.get(element)?.get(side)?.length === 1;
    const reaches = (element: HTMLElement, box: Box, side: Side, value: number): boolean => {
      if (meetsOnlyAtMiddle(element)) return false;
      const [low, high] = isHorizontal(side) ? [box.top, box.bottom] : [box.left, box.right];
      // A rounded end curves away from its box, so a line has to stay nearer the middle of it.
      const rounded = data(element, 'kind') === 'actor' || data(element, 'shape') === 'terminal';
      let clearance = CORNER_CLEARANCE;
      if (rounded && isHorizontal(side)) clearance = box.height / 2 - 6;
      if (data(element, 'kind') === 'store' && !isHorizontal(side)) clearance = box.width / 4;
      return low + clearance <= value && value <= high - clearance;
    };
    for (const edge of edges) {
      if (edge.fromElement === edge.toElement || edge.fromSide === edge.toSide) continue;
      if (isHorizontal(edge.fromSide) !== isHorizontal(edge.toSide)) continue;
      const axis = isHorizontal(edge.fromSide) ? 'y' : 'x';
      if (Math.abs(edge.start[axis] - edge.end[axis]) < 1) continue;
      if (alone(edge.fromElement, edge.fromSide) && reaches(edge.fromElement, edge.from, edge.fromSide, edge.end[axis])) {
        edge.start = { ...edge.start, [axis]: edge.end[axis] };
      } else if (alone(edge.toElement, edge.toSide) && reaches(edge.toElement, edge.to, edge.toSide, edge.start[axis])) {
        edge.end = { ...edge.end, [axis]: edge.start[axis] };
      }
    }
  };

  /**
   * Moves apart the lines whose middle runs would lie on top of each other, which happens when
   * several lines cross the same gap between two layers.
   */
  const staggerMiddles = (edges: Edge[]): void => {
    const gaps = new Map<string, Edge[]>();
    for (const edge of edges) {
      if (edge.fromElement === edge.toElement) continue;
      const along = isHorizontal(edge.fromSide);
      const sameSide = edge.fromSide === edge.toSide;
      if (!sameSide && along !== isHorizontal(edge.toSide)) continue;
      const straight = along ? Math.abs(edge.start.y - edge.end.y) < 1 : Math.abs(edge.start.x - edge.end.x) < 1;
      if (!sameSide && straight) continue;
      const middle = along ? (edge.start.x + edge.end.x) / 2 : (edge.start.y + edge.end.y) / 2;
      const key = sameSide ? `around:${edge.fromSide}` : `${along ? 'x' : 'y'}:${Math.round(middle / ANCHOR_STEP)}`;
      const crossing = gaps.get(key) ?? [];
      gaps.set(key, crossing);
      crossing.push(edge);
    }
    for (const [key, crossing] of gaps) {
      const goesAround = key.startsWith('around:');
      // Ordering by where each line ends keeps two lines in one gap from crossing each other.
      crossing.sort((a, b) => (isHorizontal(a.fromSide) ? a.end.y - b.end.y : a.end.x - b.end.x));
      for (const [index, edge] of crossing.entries()) {
        edge.stagger = goesAround ? index * ANCHOR_STEP : (index - (crossing.length - 1) / 2) * (ANCHOR_STEP / 2);
      }
    }
  };

  const nameOf = (edge: HTMLElement): string => `The edge from "${data(edge, 'from')}" to "${data(edge, 'to')}"`;

  const readEdges = (graph: HTMLElement): Edge[] => {
    const direction = data(graph, 'direction') === 'down' ? 'down' : 'right';
    const defaultArrow = data(graph, 'arrow') ?? 'end';
    const named = [...graph.querySelectorAll<HTMLElement>('[data-id]')];
    const find = (id: string | undefined): HTMLElement | undefined => named.find((candidate) => data(candidate, 'id') === id);
    const edges: Edge[] = [];
    for (const element of graph.querySelectorAll<HTMLElement>('.edge')) {
      const fromElement = find(data(element, 'from'));
      const toElement = find(data(element, 'to'));
      if (!fromElement || !toElement) {
        errors.push(`An edge goes from "${data(element, 'from')}" to "${data(element, 'to')}", but no element in its graph has that data-id.`);
        continue;
      }
      for (const name of ['fromSide', 'toSide']) {
        if (data(element, name) && !isSide(data(element, name))) {
          errors.push(`${nameOf(element)} has a side that is not one of ${SIDES.join(', ')}.`);
        }
      }
      const arrow = data(element, 'arrow') ?? defaultArrow;
      if (!ARROWS.includes(arrow)) {
        errors.push(`${nameOf(element)} has a data-arrow that is not one of ${ARROWS.join(', ')}.`);
      }
      edges.push({
        element,
        fromElement,
        toElement,
        arrow,
        direction,
        stagger: 0,
        from: EMPTY,
        to: EMPTY,
        fromSide: 'right',
        toSide: 'left',
        start: ORIGIN,
        end: ORIGIN,
        points: [],
      });
    }
    return edges;
  };

  /**
   * Draws the lines of a graph and returns how far they reach outside it on each side.
   */
  const drawEdges = (graph: HTMLElement, edges: Edge[], layer: SVGSVGElement, marker: string): Record<Side, number> => {
    for (const edge of edges) {
      edge.from = boxIn(edge.fromElement, graph);
      edge.to = boxIn(edge.toElement, graph);
      if (edge.fromElement === edge.toElement) {
        edge.fromSide = 'top';
        edge.toSide = 'top';
        edge.start = anchor(edge.from, 'top', -Math.min(20, edge.from.width / 4));
        edge.end = anchor(edge.from, 'top', Math.min(20, edge.from.width / 4));
        continue;
      }
      const [fromSide, toSide] = chooseSides(edge.from, edge.to, edge.direction);
      const givenFrom = data(edge.element, 'fromSide');
      const givenTo = data(edge.element, 'toSide');
      edge.fromSide = isSide(givenFrom) ? givenFrom : fromSide;
      edge.toSide = isSide(givenTo) ? givenTo : toSide;
    }
    spreadAnchors(edges);
    staggerMiddles(edges);

    for (const stale of layer.querySelectorAll(':scope > path')) stale.remove();
    for (const stale of graph.querySelectorAll('.edge-end')) stale.remove();
    const size = boxIn(graph, graph);
    const reach: Record<Side, number> = { top: 0, right: 0, bottom: 0, left: 0 };
    const extend = (area: Area): void => {
      reach.top = Math.max(reach.top, -area.top);
      reach.left = Math.max(reach.left, -area.left);
      reach.bottom = Math.max(reach.bottom, area.bottom - size.height);
      reach.right = Math.max(reach.right, area.right - size.width);
    };

    for (const edge of edges) {
      edge.points = route(edge);
      const path = document.createElementNS(SVG_NAMESPACE, 'path');
      path.setAttribute('d', toPath(edge.points));
      for (const name of ['change', 'line']) {
        const value = data(edge.element, name);
        if (value) path.dataset[name] = value;
      }
      if (data(edge.element, 'emphasis') !== undefined) path.dataset['emphasis'] = '';
      if (edge.arrow !== 'none') path.setAttribute('marker-end', `url(#${marker})`);
      if (edge.arrow === 'both') path.setAttribute('marker-start', `url(#${marker})`);
      layer.append(path);
      for (const point of edge.points) extend(around(point, point, 0));

      // The label sits on the middle of the line, on a background that interrupts the line.
      // On a loop it sits above, because it is wider than the loop.
      const middle = path.getPointAtLength(path.getTotalLength() / 2);
      const lift = edge.fromElement === edge.toElement ? edge.element.getBoundingClientRect().height / 2 + 2 : 0;
      edge.element.style.left = `${middle.x}px`;
      edge.element.style.top = `${middle.y - lift}px`;
      if (0 < textOf(edge.element).length) extend(boxIn(edge.element, graph));

      // A label at an end, such as the cardinality of a relation, sits beside the line where it meets the box.
      const ends: [name: string, point: Point, side: Side][] = [['fromLabel', edge.start, edge.fromSide], ['toLabel', edge.end, edge.toSide]];
      for (const [name, point, side] of ends) {
        const text = data(edge.element, name);
        if (!text) continue;
        const label = document.createElement('span');
        label.className = 'edge-end';
        label.textContent = text;
        const direction = outward(side);
        label.style.left = `${point.x + direction.x * 12 + (isHorizontal(side) ? 0 : 10)}px`;
        label.style.top = `${point.y + direction.y * 12 - (isHorizontal(side) ? 10 : 0)}px`;
        graph.append(label);
        extend(boxIn(label, graph));
      }
    }
    return reach;
  };

  /**
   * Returns whether an area lies on a node. A decision is a diamond, which fills only the
   * middle of its box, so an area in a corner of that box does not touch it.
   */
  const covers = (area: Area, element: HTMLElement, box: Box, inset: number): boolean => {
    if (!overlaps(area, box, inset)) return false;
    if (data(element, 'shape') !== 'decision') return true;
    const centerX = (box.left + box.right) / 2;
    const centerY = (box.top + box.bottom) / 2;
    // The point of the area that is nearest to the middle of the diamond decides.
    const nearestX = Math.min(Math.max(centerX, area.left), area.right);
    const nearestY = Math.min(Math.max(centerY, area.top), area.bottom);
    const reach = Math.abs(nearestX - centerX) / (box.width / 2 - inset) + Math.abs(nearestY - centerY) / (box.height / 2 - inset);
    return reach < 1;
  };

  /**
   * Returns whether any run of a line passes through something, as the given test decides for
   * the area each run covers.
   */
  const crossedBy = (edge: Edge, margin: number, test: (area: Area) => boolean): boolean => {
    return edge.points.some((point, index) => {
      const previous = edge.points[index - 1];
      return previous !== undefined && test(around(previous, point, margin));
    });
  };

  /**
   * Reports the lines that run through a box they do not belong to, and the labels that cover
   * a box or each other. These are the mistakes a reader of the image would trip over.
   */
  const checkEdges = (graph: HTMLElement, edges: Edge[]): void => {
    const boxes = [...graph.querySelectorAll<HTMLElement>('.node, .entity')].map((element) => ({ element, box: boxIn(element, graph) }));
    const labels: { box: Box; text: string }[] = [];
    for (const edge of edges) {
      const own = (element: HTMLElement): boolean => {
        return [edge.fromElement, edge.toElement].some((end) => end === element || end.contains(element) || element.contains(end));
      };
      for (const { element, box } of boxes) {
        if (!own(element) && crossedBy(edge, 1, (area) => covers(area, element, box, 2))) {
          warnings.push(`${nameOf(edge.element)} runs through ${describe(element)}. Reorder the layers, or set data-from-side and data-to-side to send it around.`);
        }
      }
      const text = textOf(edge.element);
      if (text.length <= 0) continue;
      const label = boxIn(edge.element, graph);
      for (const { element, box } of boxes) {
        if (covers(label, element, box, 1)) {
          warnings.push(`The label "${text}" covers ${describe(element)}. Shorten the label, or move the boxes apart by putting them in different layers.`);
        }
      }
      for (const other of labels) {
        if (overlaps(label, other.box, 1)) {
          warnings.push(`The labels "${text}" and "${other.text}" overlap. Shorten them, or give the edges different sides.`);
        }
      }
      labels.push({ box: label, text });
    }
  };

  const layoutLanes = (graph: HTMLElement): void => {
    const names = (data(graph, 'lanes') ?? '').split(',').map((name) => name.trim()).filter((name) => 0 < name.length);
    if (data(graph, 'direction') !== 'down') {
      errors.push('A graph with data-lanes must have data-direction="down".');
    }
    const head = document.createElement('div');
    head.className = 'layer';
    for (const name of names) {
      const cell = document.createElement('div');
      cell.className = 'lane-head';
      cell.textContent = name;
      head.append(cell);
    }
    graph.prepend(head);
    for (const layer of graph.querySelectorAll<HTMLElement>(':scope > .layer')) {
      layer.style.gridTemplateColumns = `repeat(${names.length}, minmax(0, 1fr))`;
      if (layer === head) continue;
      for (const node of childrenOf(layer)) {
        const lane = Number(data(node, 'lane'));
        if (!Number.isInteger(lane) || lane < 1 || names.length < lane) {
          errors.push(`${describe(node)} needs a data-lane from 1 to ${names.length}, the position of its lane in data-lanes.`);
          continue;
        }
        node.style.gridColumn = String(lane);
        node.style.gridRow = '1';
      }
    }
    // The lanes go in first so that everything else is drawn on top of them.
    graph.prepend(...names.map((_, index) => {
      const lane = document.createElement('div');
      lane.className = 'lane';
      if (index === 0) lane.dataset['first'] = '';
      lane.style.left = `${(index / names.length) * 100}%`;
      lane.style.width = `${100 / names.length}%`;
      return lane;
    }));
  };

  const layoutGraph = (graph: HTMLElement, index: number): void => {
    const direction = data(graph, 'direction');
    if (direction && !['right', 'down'].includes(direction)) {
      errors.push('The data-direction of a graph must be right or down.');
    }
    if (data(graph, 'lanes')) layoutLanes(graph);
    const groupLabels = [...graph.querySelectorAll<HTMLElement>('.group')].flatMap((group) => {
      const text = data(group, 'label');
      if (!text) return [];
      const label = document.createElement('span');
      label.className = 'group-label';
      label.textContent = text;
      group.prepend(label);
      group.style.minWidth = `${Math.ceil(label.getBoundingClientRect().width) + 24}px`;
      return [label];
    });

    const edges = readEdges(graph);
    const marker = `arrow-${index}`;
    const layer = document.createElementNS(SVG_NAMESPACE, 'svg');
    layer.classList.add('edges');
    layer.innerHTML = `<defs><marker id="${marker}" viewBox="0 0 8 8" refX="7.5" refY="4" markerWidth="8" markerHeight="8" markerUnits="userSpaceOnUse" orient="auto-start-reverse"><path d="M 0 0.5 L 8 4 L 0 7.5 z" fill="context-stroke" stroke="none"/></marker></defs>`;
    graph.append(layer);

    // In a graph that runs to the right, a label lies along the gap between two layers, so the
    // gap has to be at least as wide as the longest label.
    if (direction !== 'down') {
      const widest = Math.max(0, ...edges.map((edge) => edge.element.getBoundingClientRect().width));
      const gap = Math.max(graph.closest('.pane') ? 40 : 64, Math.ceil((widest + 24) / 8) * 8);
      graph.style.columnGap = `${gap}px`;
      for (const group of graph.querySelectorAll<HTMLElement>('.group')) {
        if (group.querySelector(':scope > .layer')) group.style.columnGap = `${gap}px`;
      }
    }

    // Lines that go around a box reach outside the graph. Make room for them and draw again.
    const reach = drawEdges(graph, edges, layer, marker);
    if (!data(graph, 'lanes') && SIDES.some((side) => 0 < reach[side])) {
      for (const side of SIDES) {
        if (0 < reach[side]) graph.style[PADDING[side]] = `${Math.ceil(reach[side]) + 8}px`;
      }
      drawEdges(graph, edges, layer, marker);
    }
    checkEdges(graph, edges);

    // A line that enters a group from above can run through its label. Move the label to the
    // other corner then, and if a line runs there too, let the label interrupt the line.
    const crossed = (label: HTMLElement): boolean => {
      const box = boxIn(label, graph);
      return edges.some((edge) => crossedBy(edge, 2, (area) => overlaps(area, box)));
    };
    for (const label of groupLabels) {
      if (!crossed(label)) continue;
      label.dataset['side'] = 'right';
      if (!crossed(label)) continue;
      delete label.dataset['side'];
      label.dataset['covering'] = '';
    }
  };

  const layoutSequence = (sequence: HTMLElement): void => {
    const actors = [...sequence.querySelectorAll<HTMLElement>(':scope > .actor')];
    const column = (id: string | undefined): number => actors.findIndex((actor) => data(actor, 'id') === id);
    // Two columns for each actor, so that a line can start and end at the middle of an actor.
    sequence.style.gridTemplateColumns = `repeat(${actors.length * 2}, minmax(0, 1fr))`;
    for (const [index, actor] of actors.entries()) {
      actor.style.gridColumn = `${index * 2 + 1} / span 2`;
      actor.style.gridRow = '1';
    }

    let row = 1;
    const contents = new Map<HTMLElement, HTMLElement[]>();
    const spacer = (className: string): void => {
      row += 1;
      const element = document.createElement('div');
      element.className = className;
      element.style.gridColumn = '1 / -1';
      element.style.gridRow = String(row);
      sequence.append(element);
    };

    /**
     * Places an element on the next row and returns the columns of the actors it involves.
     */
    const place = (element: HTMLElement, depth: number): number[] => {
      if (element.classList.contains('message')) {
        const from = column(data(element, 'from'));
        const to = column(data(element, 'to'));
        if (from < 0 || to < 0) {
          errors.push(`A message goes from "${data(element, 'from')}" to "${data(element, 'to')}", but no actor in its sequence has that data-id.`);
          return [];
        }
        row += 1;
        const label = document.createElement('span');
        label.append(...element.childNodes);
        element.append(label);
        element.style.gridRow = String(row);
        if (from === to) {
          element.dataset['direction'] = 'self';
          element.style.gridColumn = `${from * 2 + 2} / span ${from < actors.length - 1 ? 2 : 1}`;
        } else {
          element.dataset['direction'] = from < to ? 'right' : 'left';
          element.style.gridColumn = `${Math.min(from, to) * 2 + 2} / ${Math.max(from, to) * 2 + 2}`;
        }
        sequence.append(element);
        return [from, to];
      }
      if (element.classList.contains('note')) {
        const over = (data(element, 'over') ?? '').split(',').map((id) => column(id.trim()));
        if (over.some((index) => index < 0)) {
          errors.push(`The note ${describe(element)} needs a data-over that names one or more actors of its sequence.`);
          return [];
        }
        row += 1;
        element.style.gridRow = String(row);
        element.style.gridColumn = `${Math.min(...over) * 2 + 1} / ${Math.max(...over) * 2 + 3}`;
        sequence.append(element);
        return over;
      }
      if (element.classList.contains('fragment')) {
        const first = row + 1;
        spacer('fragment-head');
        const involved = (contents.get(element) ?? []).flatMap((child) => place(child, depth + 1));
        spacer('fragment-foot');
        if (involved.length <= 0) {
          errors.push(`The fragment ${describe(element)} has no message in it.`);
          return [];
        }
        element.style.gridRow = `${first} / ${row + 1}`;
        element.style.gridColumn = `${Math.min(...involved) * 2 + 1} / ${Math.max(...involved) * 2 + 3}`;
        // A fragment inside another is drawn narrower, so that both frames can be seen.
        element.style.marginInline = `${4 + depth * 8}px`;
        return involved;
      }
      errors.push(`A sequence can only contain actor, message, note and fragment elements, but found ${describe(element)}.`);
      return [];
    };

    const steps = childrenOf(sequence).filter((element) => !element.classList.contains('actor'));
    // What each fragment contains is noted before the fragments are moved out of each other below.
    for (const fragment of sequence.querySelectorAll<HTMLElement>('.fragment')) contents.set(fragment, childrenOf(fragment));
    // The lifelines and the frames go in first so that everything placed after them is drawn on top.
    const lifelines = actors.map((_, index) => {
      const lifeline = document.createElement('div');
      lifeline.className = 'lifeline';
      lifeline.style.gridColumn = `${index * 2 + 1} / span 2`;
      sequence.append(lifeline);
      return lifeline;
    });
    for (const fragment of contents.keys()) sequence.append(fragment);
    for (const step of steps) place(step, 0);
    spacer('fragment-head');
    for (const lifeline of lifelines) lifeline.style.gridRow = `1 / ${row + 1}`;
  };

  const buildLegend = (diagram: HTMLElement): void => {
    const language = document.documentElement.lang.toLowerCase().startsWith('ja') ? 'ja' : 'en';
    const text = (key: LegendKey): string => data(diagram, LEGEND_ATTRIBUTE[key]) ?? LEGEND_TEXT[language][key];
    const entries: { key: LegendKey | 'dashed'; text: string }[] = [];
    for (const change of CHANGES) {
      if (diagram.querySelector(`[data-change="${change}"]`)) entries.push({ key: change, text: text(change) });
    }
    if (diagram.querySelector('[data-emphasis]')) entries.push({ key: 'emphasis', text: text('emphasis') });
    if (diagram.querySelector('[data-kind="external"]')) entries.push({ key: 'external', text: text('external') });
    if (diagram.querySelector('[data-line="dashed"]')) {
      const dashed = data(diagram, 'legendDashed');
      if (dashed) {
        entries.push({ key: 'dashed', text: dashed });
      } else {
        errors.push('The diagram has dashed lines. Say what a dashed line means in data-legend-dashed on the .diagram element, such as "Asynchronous".');
      }
    }
    for (const element of diagram.querySelectorAll<HTMLElement>('[data-change]')) {
      if (!CHANGES.some((change) => change === data(element, 'change'))) {
        errors.push(`${describe(element)} has a data-change that is not one of ${CHANGES.join(', ')}.`);
      }
    }
    if (entries.length <= 0) return;

    const legend = document.createElement('ul');
    legend.className = 'legend';
    for (const entry of entries) {
      const item = document.createElement('li');
      const mark = document.createElement('i');
      if (entry.key === 'dashed') {
        mark.dataset['swatch'] = 'line';
        mark.style.setProperty('--swatch-line', 'var(--color-line)');
      } else if (entry.key === 'external') {
        mark.style.borderStyle = 'dashed';
        mark.style.setProperty('--swatch-fill', 'var(--color-surface-gray)');
      } else {
        const [line, fill] = SWATCH[entry.key];
        if (entry.key === 'removed') mark.style.borderStyle = 'dotted';
        mark.style.setProperty('--swatch-line', `var(--color-${line})`);
        mark.style.setProperty('--swatch-fill', `var(--color-${fill})`);
      }
      item.append(mark, entry.text);
      legend.append(item);
    }
    diagram.append(legend);
  };

  /**
   * Reports text that does not fit its box and content that does not fit the diagram.
   */
  const checkFit = (diagram: HTMLElement): void => {
    for (const element of diagram.querySelectorAll<HTMLElement>('.node, .actor, .note, .entity th, .entity td')) {
      if (textOf(element).length <= 0) continue;
      const range = document.createRange();
      range.selectNodeContents(element);
      const text = range.getBoundingClientRect();
      const box = element.getBoundingClientRect();
      if (text.left < box.left - 1 || box.right + 1 < text.right || text.top < box.top - 1 || box.bottom + 1 < text.bottom) {
        warnings.push(`The text of ${describe(element)} does not fit its box. Shorten it.`);
      }
    }
    const frame = diagram.getBoundingClientRect();
    const inner = { left: frame.left + 23, right: frame.right - 23 };
    for (const element of diagram.querySelectorAll('.graph, .sequence, .tree, .compare, .pane, .node, .entity, .group, .edge, .edge-end')) {
      const box = element.getBoundingClientRect();
      if (box.width <= 0) continue;
      const limit = element.closest('.pane')?.getBoundingClientRect() ?? inner;
      if (box.left < limit.left - 1 || limit.right + 1 < box.right) {
        warnings.push('The content is wider than the diagram. Use fewer layers, shorter labels, a graph that runs down, or data-width="wide".');
        break;
      }
    }
  };

  const main = (): void => {
    const diagrams = [...document.querySelectorAll<HTMLElement>('.diagram')];
    if (diagrams.length !== 1) {
      errors.push('The page must contain exactly one element with the class "diagram".');
    }
    for (const diagram of diagrams) {
      buildLegend(diagram);
      for (const sequence of diagram.querySelectorAll<HTMLElement>('.sequence')) layoutSequence(sequence);
      for (const [index, graph] of [...diagram.querySelectorAll<HTMLElement>('.graph')].entries()) layoutGraph(graph, index);
      checkFit(diagram);
      const box = diagram.getBoundingClientRect();
      document.documentElement.dataset['width'] = String(Math.ceil(box.width));
      document.documentElement.dataset['height'] = String(Math.ceil(box.height));
    }
    document.documentElement.dataset['errors'] = JSON.stringify([...new Set(errors)]);
    document.documentElement.dataset['warnings'] = JSON.stringify([...new Set(warnings)]);
  };

  const run = (): void => {
    try {
      main();
    } catch (error) {
      document.documentElement.dataset['errors'] = JSON.stringify([`The layout script failed: ${error instanceof Error ? error.message : String(error)}`]);
    }
  };

  // The lines are measured from where the text puts the boxes, so wait for the fonts.
  void document.fonts.ready.then(run, run);
};
