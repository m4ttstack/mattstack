import { lucideWrapperFn, registerIcons } from '@mattstack/app-kit/icons';
// The app's one sanctioned lucide import site, per app-kit's AGENTS.md §8
// registration contract.
// eslint-disable-next-line no-restricted-imports
import {
  ArrowUpRight,
  CircleDot,
  Cpu,
  FileCode,
  FileText,
  LayoutDashboard,
  Maximize,
  Minus,
  PanelRight,
  PanelRightOpen,
  Replace,
  SquareTerminal,
  Workflow,
} from 'lucide-react';

registerIcons({
  workflow: lucideWrapperFn(Workflow),
  layoutDashboard: lucideWrapperFn(LayoutDashboard),
  fileText: lucideWrapperFn(FileText),
  fileCode: lucideWrapperFn(FileCode),
  cpu: lucideWrapperFn(Cpu),
  circleDot: lucideWrapperFn(CircleDot),
  replace: lucideWrapperFn(Replace),
  arrowUpRight: lucideWrapperFn(ArrowUpRight),
  squareTerminal: lucideWrapperFn(SquareTerminal),
  minus: lucideWrapperFn(Minus),
  fitView: lucideWrapperFn(Maximize),
  panelRight: lucideWrapperFn(PanelRight),
  panelRightOpen: lucideWrapperFn(PanelRightOpen),
});
