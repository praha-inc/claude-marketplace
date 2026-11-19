/**
 * Renders a diagram written as HTML into a PNG next to it, using a Chromium-based browser that
 * is already installed.
 *
 * The source may only describe the diagram: the shared stylesheet and layout script of the skill
 * are inlined here, and a source that brings styles, scripts or outside resources of its own is
 * refused. That is what keeps every diagram in the same design, and it also means that text
 * copied into a diagram from an issue cannot make the browser run or fetch anything.
 *
 * Usage: node render.ts <diagram.html> [<output.png>]
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { layout } from './layout.ts';

type Measurement = {
  width: number;
  height: number;
  errors: string[];
  warnings: string[];
};

const ASSETS = path.join(import.meta.dirname, '..', 'assets');

/** GitHub shows an image at most about this wide, so twice the pixels keeps the text sharp. */
const SCALE = 2;

const FORBIDDEN: { pattern: RegExp; reason: string }[] = [
  { pattern: /<\s*(style|script|link|iframe|frame|object|embed|img|picture|video|audio|source|svg|canvas|base|meta\s+http-equiv)\b/i, reason: 'the tag <$1>' },
  { pattern: /\sstyle\s*=/i, reason: 'a style attribute' },
  { pattern: /\son[a-z]+\s*=/i, reason: 'an event handler attribute' },
  { pattern: /\s(src|href|srcset|action|background|poster)\s*=/i, reason: 'the attribute $1' },
  { pattern: /\sclass\s*=\s*["'][^"']*\b(edges|edge-end|group-label|lane|lane-head|lifeline|legend|fragment-head|fragment-foot)\b/i, reason: 'the class "$1", which the layout script creates itself' },
];

const BROWSERS = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  'google-chrome',
  'google-chrome-stable',
  'chromium',
  'chromium-browser',
  'microsoft-edge',
  String.raw`C:\Program Files\Google\Chrome\Application\chrome.exe`,
  String.raw`C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`,
];

const findBrowser = (): string => {
  const candidates = [process.env['CHROME_PATH'] ?? '', ...BROWSERS].filter((candidate) => 0 < candidate.length);
  for (const candidate of candidates) {
    if (/[/\\]/.test(candidate)) {
      if (existsSync(candidate)) return candidate;
      continue;
    }
    const result = spawnSync(candidate, ['--version'], { encoding: 'utf8' });
    if (result.status === 0) return candidate;
  }
  throw new Error(
    'No Chromium-based browser was found. Install Google Chrome, Chromium or Microsoft Edge, or set CHROME_PATH to the path of its executable.',
  );
};

/**
 * Returns what the source contains that a diagram may not.
 */
const findForbidden = (source: string): string[] => {
  // Comments are dropped by the browser, so what they say is not part of the diagram.
  const markup = source.replaceAll(/<!--[\s\S]*?-->/g, '');
  return FORBIDDEN.flatMap(({ pattern, reason }) => {
    const match = pattern.exec(markup);
    return match ? [reason.replace('$1', (match[1] ?? '').toLowerCase())] : [];
  });
};

/**
 * Returns the page that is rendered: the source with the stylesheet and the layout script of the skill added.
 */
const buildPage = (source: string): string => {
  const style = `<style>\n${readFileSync(path.join(ASSETS, 'diagram.css'), 'utf8')}\n</style>`;
  // Node.js has already stripped the types from the function, so its text is plain JavaScript.
  const script = `<script>\n(${layout.toString()})();\n</script>`;
  if (!/<\/head>/i.test(source) || !/<\/body>/i.test(source)) {
    throw new Error('The source must be a whole HTML document with a <head> and a <body>. Start from one of the templates.');
  }
  // A function as the replacement keeps `$` in the assets from being read as a pattern.
  return source.replace(/<\/head>/i, () => `${style}\n</head>`).replace(/<\/body>/i, () => `${script}\n</body>`);
};

const runBrowser = (browser: string, profile: string, args: string[]): string => {
  const result = spawnSync(browser, [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-background-networking',
    // A diagram needs nothing from the network, so nothing is allowed to leave.
    '--host-resolver-rules=MAP * ~NOTFOUND',
    `--user-data-dir=${profile}`,
    '--virtual-time-budget=5000',
    ...args,
  ], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 60_000 });
  if (result.status !== 0) {
    throw new Error(`The browser failed:\n${`${result.stderr}${result.error?.message ?? ''}`.trim()}`);
  }
  return result.stdout;
};

/**
 * Reads what the layout script left on the <html> element once the page was laid out.
 */
const measure = (dom: string): Measurement => {
  const root = /<html\b[^>]*>/i.exec(dom)?.[0] ?? '';
  const read = (name: string): string | undefined => {
    const value = new RegExp(`\\sdata-${name}="([^"]*)"`).exec(root)?.[1];
    return value?.replaceAll('&quot;', '"').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&');
  };
  const list = (name: string): string[] => {
    const value: unknown = JSON.parse(read(name) ?? '[]');
    return Array.isArray(value) ? value.map(String) : [];
  };
  const errors = list('errors');
  const width = Number(read('width'));
  const height = Number(read('height'));
  if (errors.length <= 0 && !(0 < width && 0 < height)) {
    throw new Error('The page was not laid out. The layout script did not report the size of the diagram.');
  }
  return { width, height, errors, warnings: list('warnings') };
};

const main = (): number => {
  const [input, output] = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
  if (!input) {
    process.stderr.write('Usage: node render.ts <diagram.html> [<output.png>]\n');
    return 1;
  }

  const sourcePath = path.resolve(input);
  const outputPath = path.resolve(output ?? sourcePath.replace(/\.html?$/i, '') + '.png');
  const work = mkdtempSync(path.join(tmpdir(), 'diagram-writer-'));
  try {
    const source = readFileSync(sourcePath, 'utf8');
    const forbidden = findForbidden(source);
    if (0 < forbidden.length) {
      throw new Error(
        `The source contains ${forbidden.join(', ')}. A diagram is described only with the elements, classes and data attributes of the templates. Its design comes from the skill, so that every diagram looks the same.`,
      );
    }

    const page = path.join(work, 'page.html');
    writeFileSync(page, buildPage(source));
    const url = pathToFileURL(page).href;
    const browser = findBrowser();
    const profile = path.join(work, 'profile');

    const { width, height, errors, warnings } = measure(runBrowser(browser, profile, ['--dump-dom', url]));
    if (0 < errors.length) {
      throw new Error(`The diagram is not valid:\n${errors.map((error) => `- ${error}`).join('\n')}`);
    }

    runBrowser(browser, profile, [
      `--window-size=${width},${height}`,
      `--force-device-scale-factor=${SCALE}`,
      '--default-background-color=ffffffff',
      `--screenshot=${outputPath}`,
      url,
    ]);
    if (!existsSync(outputPath)) {
      throw new Error(`The browser did not write ${outputPath}. Check that ${path.dirname(outputPath)} exists and can be written to.`);
    }

    process.stdout.write(`Rendered ${outputPath} (${width}x${height}, at ${SCALE}x)\n`);
    if (0 < warnings.length) {
      process.stdout.write(`Problems to fix before using the image:\n${warnings.map((warning) => `- ${warning}`).join('\n')}\n`);
    } else {
      process.stdout.write('The layout check found no problems. Look at the image before using it.\n');
    }
    return 0;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
};

process.exitCode = main();
