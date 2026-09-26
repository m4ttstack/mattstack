#!/usr/bin/env node
import { main } from '../dist/gitq.js';
process.exit(await main(process.argv.slice(2)));
