// Entry point for the helper bundle (`bun run build:bundle`). The dev
// forms stay `bin/gitq` and `bun run serve`; this wrapper exists because the
// bundle has no source tree, so the client bundle must be embedded at
// build time (the text import below -- scripts/build-client.ts writes it
// first) and handed to the server before `gitq board` boots it.
import appJs from '../dist/client/app.js.txt' with { type: 'text' };
import { injectClientAssets } from './server/client-assets.ts';
import { main } from './cli/main.ts';

injectClientAssets({ appJs });

process.exit(await main(Bun.argv.slice(2)));
