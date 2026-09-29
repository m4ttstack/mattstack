import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));

function ruleBody(css: string, selector: string): string {
  const start = css.indexOf(`${selector} {`);
  if (start === -1) return '';
  return css.slice(start, css.indexOf('}', start));
}

describe('@mattstack/app-kit/charts', () => {
  it('exports BarChart and the Tokyo defaults', async () => {
    const mod = await import('./index');
    expect(mod.BarChart).toBeDefined();
    expect(mod.ChartTooltip).toBeDefined();
    expect(mod.chartDefaults.tooltipProps.wrapperStyle).toBeDefined();
    expect(JSON.stringify(mod.chartDefaults)).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });

  it('keeps the entry side-effectful so bundlers retain its stylesheet', async () => {
    const pkg = await import('../../package.json');
    expect(pkg.sideEffects).toContain('./src/charts/index.ts');
  });

  it('loads the Tokyo tooltip override after the Mantine charts stylesheet', () => {
    const entry = readFileSync(path.join(here, 'index.ts'), 'utf8');
    const mantine = entry.indexOf("'@mantine/charts/styles.css'");
    const kit = entry.indexOf("'./charts.css'");
    expect(mantine).toBeGreaterThanOrEqual(0);
    expect(kit).toBeGreaterThan(mantine);
  });

  it('paints the tooltip with Tokyo surface and text tokens', () => {
    const css = readFileSync(path.join(here, 'charts.css'), 'utf8');
    const tooltip = ruleBody(css, '.mantine-ChartTooltip-tooltip');
    expect(tooltip).toMatch(/background-color:\s*var\(--tk-raised\)/);
    expect(tooltip).toMatch(/border:\s*1px solid var\(--tk-border\)/);
    expect(tooltip).toMatch(/color:\s*var\(--tk-text-1\)/);
    expect(ruleBody(css, '.mantine-ChartTooltip-tooltipLabel')).toMatch(
      /color:\s*var\(--tk-text-1\)/
    );
    expect(ruleBody(css, '.mantine-ChartTooltip-tooltipItemName')).toMatch(
      /color:\s*var\(--tk-text-2\)/
    );
    expect(ruleBody(css, '.mantine-ChartTooltip-tooltipItemData')).toMatch(
      /color:\s*var\(--tk-text-1\)/
    );
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });
});
