import { lucideWrapperFn, registerIcons } from '@mattstack/app-kit/icons';
// The app's one sanctioned lucide import site, per app-kit's AGENTS.md §8
// registration contract.
// eslint-disable-next-line no-restricted-imports
import { Hash, History, MessageSquare, Palette } from 'lucide-react';

registerIcons({
  hash: lucideWrapperFn(Hash),
  history: lucideWrapperFn(History),
  messageSquare: lucideWrapperFn(MessageSquare),
  palette: lucideWrapperFn(Palette),
});
