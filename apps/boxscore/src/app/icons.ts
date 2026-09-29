// The app's one sanctioned lucide import site (apps/AGENTS.md section 8).
// eslint-disable-next-line no-restricted-imports
import {
  ArrowUpRight,
  ChartNoAxesColumn,
  GitBranch,
  LayoutGrid,
  Table2,
  Trophy,
} from 'lucide-react';

import { lucideWrapperFn, registerIcons } from '@mattstack/app-kit/icons';

registerIcons({
  arrowUpRight: lucideWrapperFn(ArrowUpRight),
  chartNoAxesColumn: lucideWrapperFn(ChartNoAxesColumn),
  gitBranch: lucideWrapperFn(GitBranch),
  layoutGrid: lucideWrapperFn(LayoutGrid),
  table2: lucideWrapperFn(Table2),
  trophy: lucideWrapperFn(Trophy),
});
