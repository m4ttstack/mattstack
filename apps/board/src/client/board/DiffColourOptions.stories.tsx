import type { ReactNode } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';

import { registerTheme, SoribashiProvider } from '@mattstack/tui-kit/provider';
import { tuiTheme } from '@mattstack/tui-kit/theme';

import '@mattstack/tui-kit/theme.css';
import '@mattstack/tui-kit/canvas.css';
import '../../style.css';

import DiffView, { type DiffColours } from './DiffView.tsx';

const stage = (
  Story: () => ReactNode,
  context: { globals: { scheme?: string } }
) => (
  <div
    className={context.globals.scheme === 'dark' ? 'dark' : undefined}
    style={{
      background: 'var(--page)',
      color: 'var(--text-1)',
      minHeight: '100vh',
      padding: 24,
    }}
  >
    <SoribashiProvider theme={tuiTheme}>
      <Story />
    </SoribashiProvider>
  </div>
);

const meta = {
  title: 'Gates/Board/DiffColourOptions',
  decorators: [stage],
  parameters: { layout: 'fullscreen' },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

registerTheme(tuiTheme);

const PATCH = `--- a/src/useRadarMap.ts
+++ b/src/useRadarMap.ts
@@ -98,11 +98,12 @@ export function useRadarMap(provider: RadarProvider) {
 export function useRadarMap(provider: RadarProvider) {
   const mapRef = useRef<RadarMap | null>(null);
   const layers = useLayers();
+  const isDetached = useRef(false);

   useEffect(() => {
-    if (!provider) return;
+    if (!provider || isDetached.current) return;
     mapRef.current = provider.attach();
     return () => {
       mapRef.current = null;
     };
   }, [provider]);
@@ -112,9 +113,16 @@ export function useRadarMap(provider: RadarProvider) {

   const onModel = (model: RadarModel) => {
     const ready = layers.ready();
     if (!ready) return;
+    if (mapRef.current === null) return;
+    // A late model can land after a step navigation
+    // tore this map down, so drop it here.
     layers.add(model);
   };
+  useProviderTeardown(provider, () => {
+    isDetached.current = true;
+    mapRef.current = null;
+  });

   return { onModel };
 }
`;

const OPTIONS: {
  key: string;
  size: number;
  colours: DiffColours;
  caption: string;
}[] = [
  {
    key: 'A',
    size: 12,
    colours: 'red-small',
    caption:
      'A: 12px, red keywords (bad), purple names, accent constants. Every hue at its small step, bar 7.0. Lowest hue pair 10.53 light, 8.95 dark.',
  },
  {
    key: 'B',
    size: 13,
    colours: 'red-body',
    caption:
      'B: 13px, red keywords (bad), purple names, accent constants. Body steps, bar 4.5; ok and warn take small steps (their body step fails a wash). Lowest hue pair 4.58 light, 5.69 dark.',
  },
  {
    key: 'C',
    size: 12,
    colours: 'purple-small',
    caption:
      'C: 12px, purple keywords, accent names, cyan constants, red only on removed signs. Every hue at its small step, bar 7.0. Lowest hue pair 10.52 light, 9.07 dark.',
  },
  {
    key: 'D',
    size: 13,
    colours: 'purple-body',
    caption:
      'D: 13px, purple keywords, accent names, cyan constants (small step: its body step fails a wash), red only on removed signs. Bar 4.5. Lowest hue pair 5.09 light, 5.70 dark.',
  },
];

export const Options: Story = {
  render: () => (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
        gap: 24,
      }}
    >
      {OPTIONS.map(o => (
        <section key={o.key} data-option={o.key}>
          <p
            style={{
              margin: '0 0 8px',
              font: '500 13px var(--font-sans)',
              color: 'var(--text-2)',
            }}
          >
            {o.caption}
          </p>
          <div
            style={{
              border: '1px solid var(--border)',
              borderRadius: 8,
              overflow: 'hidden',
            }}
          >
            <DiffView
              patch={PATCH}
              anchor={102}
              colours={o.colours}
              fontSize={o.size}
            />
          </div>
        </section>
      ))}
    </div>
  ),
};
