import { writeFileSync } from 'fs';
import { join } from 'path';

// GitHub Pages: evita processamento Jekyll
writeFileSync(join('docs', '.nojekyll'), '');
console.log('GitHub Pages: docs/.nojekyll criado');
