import { describe, expect, it } from 'vitest';

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
});
