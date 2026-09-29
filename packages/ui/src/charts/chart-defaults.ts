export const chartDefaults = {
  tooltipProps: {
    wrapperStyle: { outline: 'none' },
    contentStyle: {
      background: 'var(--tk-raised)',
      border: '1px solid var(--tk-border)',
      borderRadius: 8,
      color: 'var(--tk-text-1)',
    },
  },
  gridProps: { stroke: 'var(--tk-line-3)' },
  textColor: 'var(--tk-text-3)',
} as const;
