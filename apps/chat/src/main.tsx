import { mountMattstackApp } from '@mattstack/app-kit/app';

import '@fontsource-variable/inter';
import './app/chat.css';
import './app/icons';

import { App } from './app/App';
import { chatTheme } from './app/chat-theme';
import { hostTheme } from './app/host-theme';

mountMattstackApp(<App />, {
  theme: chatTheme,
  forceColorScheme: hostTheme(window.location.pathname, window.location.search),
});
