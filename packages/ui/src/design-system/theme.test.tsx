import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  ActionIcon,
  Button,
  Combobox,
  createTheme,
  Kbd,
  MantineProvider,
  MantineThemeProvider,
  Paper,
  Progress,
  Radio,
  SegmentedControl,
  Switch,
  Text,
  useCombobox,
} from '@mantine/core';
import { Spotlight } from '@mantine/spotlight';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Table } from '@mattstack/app-kit/core';
import { appTheme, baseTheme, theme } from '@mattstack/app-kit/design-system';
import classes from './component-styles.module.css';

describe('base/app theme split', () => {
  it('keeps the kit defaults reachable on baseTheme after branding', () => {
    // The whole point of the split: a brand edits `app-theme.ts`, and the
    // unbranded theme is still an importable object rather than something a
    // consumer has to transcribe back out of the kit repo.
    expect(baseTheme.primaryColor).toBe('indigo');
    expect(baseTheme.defaultRadius).toBe('md');
  });

  it('composes the app theme on top of the base theme', () => {
    // Empty by default in the kit itself, so `theme` is `baseTheme` plus
    // whatever the app added -- never less.
    expect(theme.primaryColor).toBe(appTheme.primaryColor ?? 'indigo');
    expect(theme.components).toBeDefined();
    expect(Object.keys(theme.components!)).toContain('Tooltip');
  });
});

describe('primaryShade shape', () => {
  it('is the object form, so nesting cannot collapse it to {}', () => {
    // Mantine's deepMerge recurses whenever the SOURCE value is an object,
    // without checking that the target is one too: deepMerge(7, {light,dark})
    // spreads `{...7}` to `{}`, finds isObject(7) false, and returns `{}`.
    // validateMantineTheme then reads `{}` as the object form and throws
    // "Cannot read properties of undefined (reading 'toString')".
    expect(typeof baseTheme.primaryShade).toBe('object');
  });

  it('survives an app theme nesting either primaryShade form under it', () => {
    const shapes = [
      createTheme({ primaryShade: { light: 7, dark: 4 } }),
      createTheme({ primaryShade: 5 }),
    ];

    shapes.forEach(nested => {
      expect(() =>
        render(
          <MantineProvider theme={theme}>
            <MantineThemeProvider theme={nested}>
              <Text>nested</Text>
            </MantineThemeProvider>
          </MantineProvider>
        )
      ).not.toThrow();
    });

    expect(screen.getAllByText('nested')).toHaveLength(shapes.length);
  });
});

describe('disabled default-variant controls', () => {
  it('carry the kit class that keeps the default surface, dimmed', () => {
    render(
      <MantineProvider theme={theme}>
        <ActionIcon variant="default" aria-label="Step" disabled />
        <Button variant="default" disabled>
          Go
        </Button>
      </MantineProvider>
    );
    const icon = screen.getByRole('button', { name: 'Step' });
    const button = screen.getByRole('button', { name: 'Go' });
    expect(icon).toHaveClass(classes.actionIconRoot!);
    expect(icon).toHaveAttribute('data-variant', 'default');
    expect(button).toHaveClass(classes.buttonRoot!);
    expect(button).toHaveAttribute('data-variant', 'default');
  });
});

describe('contrast switch', () => {
  it('carries the kit classes the contrast off-track rule keys on', () => {
    const { container } = render(
      <MantineProvider theme={theme}>
        <Switch variant="contrast" label="Needs attention" />
      </MantineProvider>
    );
    const root = container.querySelector(`.${classes.switchRoot}`);
    expect(root).toHaveAttribute('data-variant', 'contrast');
    expect(root!.querySelector(`.${classes.switchTrack}`)).not.toBeNull();
  });
});

describe('ground paper', () => {
  it('carries the kit class the ground border rule keys on', () => {
    const { container } = render(
      <MantineProvider theme={theme}>
        <Paper withBorder variant="ground">
          card
        </Paper>
      </MantineProvider>
    );
    const root = container.querySelector(`.${classes.paperRoot}`);
    expect(root).toHaveAttribute('data-variant', 'ground');
    expect(root).toHaveAttribute('data-with-border', 'true');
  });

  it('leaves a Paper with no variant unmarked', () => {
    const { container } = render(
      <MantineProvider theme={theme}>
        <Paper withBorder>card</Paper>
      </MantineProvider>
    );
    expect(
      container.querySelector(`.${classes.paperRoot}`)
    ).not.toHaveAttribute('data-variant');
  });
});

describe('ground paper rule', () => {
  const css = readFileSync(
    path.resolve(import.meta.dirname, 'component-styles.module.css'),
    'utf-8'
  );
  const rule = (selector: string) =>
    css.match(new RegExp(`${selector}\\s*\\{([^}]*)\\}`))?.[1] ?? '';

  it('rules a bordered ground card with an outline over its contents', () => {
    const bordered = rule(
      "\\.paperRoot\\[data-variant='ground'\\]\\[data-with-border\\]"
    );
    expect(bordered).toContain('border-width: 0');
    expect(bordered).toContain('outline: 1px solid var(--tk-border)');
  });

  it('rings a selected ground card in the accent', () => {
    expect(
      rule("\\.paperRoot\\[data-variant='ground'\\]\\[data-selected\\]")
    ).toContain('outline: 1.5px solid var(--tk-fill-accent)');
  });

  it('rings a ground card that needs attention in the warn fill, under a selection ring', () => {
    const attention =
      "\\.paperRoot\\[data-variant='ground'\\]\\[data-attention\\]";
    expect(rule(attention)).toContain('outline: 1px solid var(--tk-fill-warn)');
    expect(css.indexOf('[data-attention]')).toBeLessThan(
      css.indexOf("[data-variant='ground'][data-selected]")
    );
  });

  it('rings a ground card whose attention is bad in the bad fill, still under a selection ring', () => {
    const bad =
      "\\.paperRoot\\[data-variant='ground'\\]\\[data-attention='bad'\\]";
    expect(rule(bad)).toContain('outline-color: var(--tk-fill-bad)');
    expect(css.indexOf("[data-attention='bad']")).toBeLessThan(
      css.indexOf("[data-variant='ground'][data-selected]")
    );
  });
});

describe('segmented progress', () => {
  it('carries the kit class the segmented rules key on, and marks the active part', () => {
    const { container } = render(
      <MantineProvider theme={theme}>
        <Progress.Root variant="segmented">
          <Progress.Section value={40} color="gray" />
          <Progress.Section value={60} color="gray" data-active />
        </Progress.Root>
      </MantineProvider>
    );
    const root = container.querySelector(`.${classes.progressRoot}`);
    expect(root).toHaveAttribute('data-variant', 'segmented');
    expect(
      [...root!.children].map(section => section.hasAttribute('data-active'))
    ).toEqual([false, true]);
  });
});

describe('segmented progress tones', () => {
  // jsdom applies no CSS module, so the tone contract is read off the sheet.
  const css = readFileSync(
    path.resolve(import.meta.dirname, 'component-styles.module.css'),
    'utf-8'
  );
  const rule = (selector: string) =>
    css.match(new RegExp(`${selector}\\s*\\{([^}]*)\\}`))?.[1] ?? '';

  it('gives gray parts the soft line and an active part the strong one', () => {
    expect(rule("\\.progressRoot\\[data-variant='segmented'\\]")).toContain(
      '--mantine-color-gray-filled: var(--tk-line-2)'
    );
    expect(
      rule("\\.progressRoot\\[data-variant='segmented'\\] > \\[data-active\\]")
    ).toContain('background-color: var(--tk-line-1)');
  });
});

describe('quiet segmented control', () => {
  it('carries the kit classes the quiet rules key on', () => {
    const { container } = render(
      <MantineProvider theme={theme}>
        <SegmentedControl variant="quiet" data={['Template', 'Rendered']} />
      </MantineProvider>
    );
    const root = container.querySelector(`.${classes.segmentedRoot}`);
    expect(root).toHaveAttribute('data-variant', 'quiet');
    expect(root?.querySelectorAll(`.${classes.segmentedLabel}`)).toHaveLength(
      2
    );
  });

  it('draws a raised track, a ruled card indicator and muted labels', () => {
    const css = readFileSync(
      path.resolve(import.meta.dirname, 'component-styles.module.css'),
      'utf-8'
    );
    const rule = (selector: string) =>
      css.match(new RegExp(`${selector}\\s*\\{([^}]*)\\}`))?.[1] ?? '';
    const root = "\\.segmentedRoot\\[data-variant='quiet'\\]";

    expect(rule(root)).toContain('background-color: var(--tk-raised)');
    expect(rule(root)).toContain('--sc-color: var(--tk-card)');
    expect(rule(`${root} \\.segmentedIndicator`)).toContain(
      'outline: 1px solid var(--tk-line-3)'
    );
    expect(rule(`${root} \\.segmentedLabel`)).toContain(
      'color: var(--tk-text-3)'
    );
    expect(rule(`${root} \\.segmentedLabel\\[data-active\\]`)).toContain(
      'color: var(--tk-text-1)'
    );
  });
});

describe('outline papers', () => {
  const css = readFileSync(
    path.resolve(import.meta.dirname, 'component-styles.module.css'),
    'utf-8'
  );
  const rule = (selector: string) =>
    css.match(new RegExp(`${selector}\\s*\\{([^}]*)\\}`))?.[1] ?? '';

  it('carry the kit class the outline rules key on', () => {
    const { container } = render(
      <MantineProvider theme={theme}>
        <Paper variant="soft-outline">soft</Paper>
        <Paper variant="panel-outline">panel</Paper>
      </MantineProvider>
    );
    expect(
      [...container.querySelectorAll(`.${classes.paperRoot}`)].map(root =>
        root.getAttribute('data-variant')
      )
    ).toEqual(['soft-outline', 'panel-outline']);
  });

  it('rule both in the soft line step inside the edge', () => {
    for (const variant of ['soft-outline', 'panel-outline']) {
      const block = rule(`\\.paperRoot\\[data-variant='${variant}'\\]`);
      expect(block).toContain('outline: 1px solid var(--tk-line-3)');
      expect(block).toContain('outline-offset: -1px');
    }
  });

  it('ring in the accent when selected, as a ground card does', () => {
    for (const variant of ['soft-outline', 'panel-outline']) {
      const block = rule(
        `\\.paperRoot\\[data-variant='${variant}'\\]\\[data-selected\\]`
      );
      expect(block).toContain('outline: 1.5px solid var(--tk-fill-accent)');
      expect(block).toContain('outline-offset: -0.75px');
    }
  });

  it('leave a soft-outline card on the surface it sits on, and fill a panel-outline one with the panel', () => {
    expect(rule("\\.paperRoot\\[data-variant='soft-outline'\\]")).toContain(
      'background-color: transparent'
    );
    expect(rule("\\.paperRoot\\[data-variant='panel-outline'\\]")).toContain(
      'background-color: var(--tk-panel)'
    );
  });
});

describe('soft table', () => {
  const css = readFileSync(
    path.resolve(import.meta.dirname, 'component-styles.module.css'),
    'utf-8'
  );
  const rule = (selector: string) =>
    css.match(new RegExp(`${selector}\\s*\\{([^}]*)\\}`))?.[1] ?? '';
  const root = "\\.tableRoot\\[data-variant='soft'\\]";

  it('carries the kit class the soft rules key on', () => {
    const { container } = render(
      <MantineProvider theme={theme}>
        <Table variant="soft" noPaper>
          <Table.Tbody>
            <Table.Tr>
              <Table.Td>cell</Table.Td>
            </Table.Tr>
          </Table.Tbody>
        </Table>
      </MantineProvider>
    );
    expect(container.querySelector(`.${classes.tableRoot}`)).toHaveAttribute(
      'data-variant',
      'soft'
    );
  });

  it('rules in the soft line step, the header on the panel, each body row ruled above', () => {
    expect(rule(root)).toContain('--table-border-color: var(--tk-line-3)');
    expect(rule(`${root} > thead`)).toContain(
      'background-color: var(--tk-panel)'
    );
    expect(rule(`${root} > tbody > tr`)).toContain(
      'border-top: 1px solid var(--table-border-color)'
    );
  });
});

describe('wash combobox options', () => {
  const css = readFileSync(
    path.resolve(import.meta.dirname, 'component-styles.module.css'),
    'utf-8'
  );
  // Whitespace-free, so a selector prettier wraps still reads as one.
  const flat = css.replace(/\s+/g, '');
  const rule = (selector: string) =>
    flat.match(new RegExp(`${selector}\\{([^}]*)\\}`))?.[1] ?? '';
  const wash =
    "\\.comboboxOption\\[data-variant='wash'\\]:not\\(\\[data-combobox-selected\\]\\)";

  function Options() {
    const store = useCombobox();
    return (
      <Combobox store={store}>
        <Combobox.Options>
          <Combobox.Option value="a" variant="wash" active>
            a
          </Combobox.Option>
          <Combobox.Option value="b">b</Combobox.Option>
        </Combobox.Options>
      </Combobox>
    );
  }

  it('carry the kit class the wash rules key on, and only a wash option its variant', () => {
    render(
      <MantineProvider theme={theme}>
        <Options />
      </MantineProvider>
    );
    const [a, b] = screen.getAllByRole('option');
    expect(a).toHaveClass(classes.comboboxOption!);
    expect(a).toHaveAttribute('data-variant', 'wash');
    expect(a).toHaveAttribute('data-combobox-active');
    expect(b).toHaveClass(classes.comboboxOption!);
    expect(b).not.toHaveAttribute('data-variant');
  });

  it('set a wash option in body text and wash the active one in the accent, leaving the keyboard cursor to Mantine', () => {
    expect(rule(wash)).toContain('color:var(--tk-text-1)');
    const active = rule(`${wash}\\[data-combobox-active\\]`);
    expect(active).toContain(
      'background-color:color-mix(insrgb,var(--tk-fill-accent)var(--ui-wash),transparent)'
    );
    expect(active).toContain('color:var(--tk-text-accent)');
  });
});

describe('wash spotlight actions', () => {
  const css = readFileSync(
    path.resolve(import.meta.dirname, 'component-styles.module.css'),
    'utf-8'
  );
  const flat = css.replace(/\s+/g, '');
  const rule = (selector: string) =>
    flat.match(new RegExp(`${selector}\\{([^}]*)\\}`))?.[1] ?? '';
  const wash = "\\.spotlightAction\\[data-variant='wash'\\]";

  it('carry the kit class the wash rules key on, and only a wash action its variant', () => {
    render(
      <MantineProvider theme={theme}>
        <Spotlight.Root forceOpened transitionProps={{ duration: 0 }}>
          <Spotlight.ActionsList>
            <Spotlight.Action variant="wash" label="a" />
            <Spotlight.Action label="b" />
          </Spotlight.ActionsList>
        </Spotlight.Root>
      </MantineProvider>
    );
    const a = screen.getByText('a').closest('[data-action]');
    const b = screen.getByText('b').closest('[data-action]');
    expect(a).toHaveClass(classes.spotlightAction!);
    expect(a).toHaveAttribute('data-variant', 'wash');
    expect(b).toHaveClass(classes.spotlightAction!);
    expect(b).not.toHaveAttribute('data-variant');
  });

  it('wash the selected action in the accent under body text, its key shown only there', () => {
    const selected = rule(`${wash}\\[data-selected\\]`);
    expect(selected).toContain(
      'background-color:color-mix(insrgb,var(--tk-fill-accent)var(--ui-wash),transparent)'
    );
    expect(selected).toContain('color:var(--tk-text-1)');
    expect(rule(`${wash}:not\\(\\[data-selected\\]\\)\\.kbdRoot`)).toContain(
      'visibility:hidden'
    );
    expect(rule(`${wash}\\[data-selected\\]\\.kbdRoot`)).toContain(
      'color:var(--tk-text-accent)'
    );
  });
});

describe('wash choice card', () => {
  const css = readFileSync(
    path.resolve(import.meta.dirname, 'component-styles.module.css'),
    'utf-8'
  );
  const rule = (selector: string) =>
    css.match(new RegExp(`${selector}\\s*\\{([^}]*)\\}`))?.[1] ?? '';
  const card = "\\.choiceCard\\[data-variant='wash'\\]";

  it('carries the kit class and the checked state the wash rules key on', () => {
    const { container } = render(
      <MantineProvider theme={theme}>
        <Radio.Group value="a">
          <Radio.Card value="a" variant="wash">
            a
          </Radio.Card>
          <Radio.Card value="b">b</Radio.Card>
        </Radio.Group>
      </MantineProvider>
    );
    const [wash, plain] = container.querySelectorAll(`.${classes.choiceCard}`);
    expect(wash).toHaveAttribute('data-variant', 'wash');
    expect(wash).toHaveAttribute('data-checked');
    expect(plain).not.toHaveAttribute('data-variant');
  });

  it('rules a wash card in the soft line step on the card surface', () => {
    const block = rule(card);
    expect(block).toContain('outline: 1px solid var(--tk-line-3)');
    expect(block).toContain('background-color: var(--tk-card)');
  });

  it('rings a checked wash card in the accent over its wash', () => {
    const block = rule(`${card}\\[data-checked\\]`);
    expect(block).toContain('outline: 1.5px solid var(--tk-fill-accent)');
    expect(block).toContain('var(--tk-wash)');
  });

  it('keeps a focus ring on a wash card', () => {
    expect(rule(`${card}:focus-visible`)).toContain('outline: 2px solid');
  });

  it('gives the Kbd inside a checked wash card the accent', () => {
    const block = rule(`${card}\\[data-checked\\] \\.kbdRoot`);
    expect(block).toContain('color: var(--tk-text-accent)');
    expect(block).toContain('var(--tk-fill-accent)');
  });
});

describe('on-fill kbd', () => {
  const css = readFileSync(
    path.resolve(import.meta.dirname, 'component-styles.module.css'),
    'utf-8'
  );
  const rule = (selector: string) =>
    css.match(new RegExp(`${selector}\\s*\\{([^}]*)\\}`))?.[1] ?? '';

  it('carries the kit class the on-fill rules key on, and leaves a plain Kbd unmarked', () => {
    const { container } = render(
      <MantineProvider theme={theme}>
        <Kbd variant="on-fill">⌘↵</Kbd>
        <Kbd>K</Kbd>
      </MantineProvider>
    );
    const [onFill, plain] = container.querySelectorAll(`.${classes.kbdRoot}`);
    expect(onFill).toHaveAttribute('data-variant', 'on-fill');
    expect(plain).not.toHaveAttribute('data-variant');
  });

  it('draws the on-fill label colour over a wash of it, with no rule', () => {
    const block = rule("\\.kbdRoot\\[data-variant='on-fill'\\]");
    expect(block).toContain('border: 0');
    expect(block).toContain(
      'color: color-mix(in srgb, var(--tk-on-fill-accent) 85%, transparent)'
    );
    expect(block.replace(/\s+/g, ' ')).toContain(
      'background-color: color-mix( in srgb, var(--tk-on-fill-accent) 18%, transparent )'
    );
  });
});
