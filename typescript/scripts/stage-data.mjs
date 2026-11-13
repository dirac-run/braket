import { copyFileSync, mkdirSync } from 'node:fs';

// Tooling keeps the source tree layout, including its adjacent data directory.
const destination = new URL('../.build/data/', import.meta.url);
mkdirSync(destination, { recursive: true });
copyFileSync(new URL('../data/classifier.bin', import.meta.url), new URL('classifier.bin', destination));
