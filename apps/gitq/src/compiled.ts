// Entry point for the helper bundle (`bun run build:bundle`), which
// Contents/Helpers/gitq runs. main.ts only exports main(); this runs it.
import { main } from './cli/main.ts';

process.exit(await main(Bun.argv.slice(2)));
