import { mountMattstackApp } from '@mattstack/app-kit/app';

import '@fontsource-variable/inter';
import './app/icons';

import { App } from './app/App';
import { chatTheme } from './app/chat-theme';

mountMattstackApp(<App />, { theme: chatTheme });
