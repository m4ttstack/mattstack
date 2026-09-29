// The app's one sanctioned lucide import site (apps/AGENTS.md section 8).
// eslint-disable-next-line no-restricted-imports
import {
  ArrowUpRight,
  ChartNoAxesColumn,
  CircleCheck,
  GitBranch,
  Hourglass,
  LayoutGrid,
  LoaderCircle,
  Table2,
  Trophy,
  Undo2,
} from 'lucide-react';

import { lucideWrapperFn, registerIcons } from '@mattstack/app-kit/icons';

registerIcons({
  arrowUpRight: lucideWrapperFn(ArrowUpRight),
  chartNoAxesColumn: lucideWrapperFn(ChartNoAxesColumn),
  circleCheck: lucideWrapperFn(CircleCheck),
  gitBranch: lucideWrapperFn(GitBranch),
  hourglass: lucideWrapperFn(Hourglass),
  layoutGrid: lucideWrapperFn(LayoutGrid),
  loaderCircle: lucideWrapperFn(LoaderCircle),
  table2: lucideWrapperFn(Table2),
  trophy: lucideWrapperFn(Trophy),
  undo2: lucideWrapperFn(Undo2),
});
