import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  ActionIcon,
  Button,
  createTheme,
  MantineProvider,
  MantineThemeProvider,
  Paper,
  Progress,
  SegmentedControl,
  Switch,
  Text,
} from '@mantine/core';
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
