import { mountMattstackApp } from '@mattstack/app-kit/app';

import './app/chat.css';
import './app/icons';

import { App } from './app/App';
import { chatTheme } from './app/chat-theme';
import { hostTheme } from './app/host-theme';
import { installPreviewStates } from './app/preview-states';

if (import.meta.env.DEV) installPreviewStates();

mountMattstackApp(<App />, {
  theme: chatTheme,
  forceColorScheme: hostTheme(window.location.pathname, window.location.search),
});
