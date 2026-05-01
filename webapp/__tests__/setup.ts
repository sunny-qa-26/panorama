import { config } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

// Load webapp/.env.local explicitly so tests pick up DB credentials regardless of CWD.
config({ path: path.resolve(here, '..', '.env.local') });
