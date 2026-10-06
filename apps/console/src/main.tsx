import './app/icons';

import { mountMattstackApp } from '@mattstack/app-kit/app';

import { App } from './app/App';

// A framed settings group takes its host's scheme, never console's own.
const scheme = window.location.pathname.startsWith('/embed/')
  ? new URLSearchParams(window.location.search).get('scheme')
  : null;

mountMattstackApp(<App />, {
  notificationMaxHeight: 400,
  forceColorScheme:
    scheme === 'light' || scheme === 'dark' ? scheme : undefined,
});
