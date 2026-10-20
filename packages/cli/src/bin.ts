#!/usr/bin/env node
import { main } from "./main";

const code = await main(process.argv.slice(2));
process.exitCode = code;
if (code === 130 || code === 143) process.exit(code);
