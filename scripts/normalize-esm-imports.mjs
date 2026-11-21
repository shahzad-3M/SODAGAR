import fs from 'node:fs';
import path from 'node:path';

const projectRoot = path.resolve('.');
const ignoredDirectories = new Set(['node_modules', 'dist', '.git']);

function collectFiles(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (ignoredDirectories.has(entry.name)) continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...collectFiles(fullPath));
    else if (/\.(ts|tsx)$/.test(entry.name)) files.push(fullPath);
  }
  return files;
}

function normalizeSpecifier(filePath, specifier) {
  if (!specifier.startsWith('.')) return specifier;
  if (/\.(?:js|jsx|ts|tsx|mjs|cjs|json)$/.test(specifier)) return specifier;

  const absolute = path.resolve(path.dirname(filePath), specifier);
  if (fs.existsSync(absolute) && fs.statSync(absolute).isDirectory()) {
    for (const extension of ['.ts', '.tsx', '.js']) {
      const indexFile = path.join(absolute, `index${extension}`);
      if (fs.existsSync(indexFile)) return `${specifier}/index${extension}`;
    }
  }

  for (const extension of ['.ts', '.tsx', '.js']) {
    if (fs.existsSync(`${absolute}${extension}`)) return `${specifier}${extension}`;
  }

  return specifier;
}

for (const filePath of collectFiles(projectRoot)) {
  const original = fs.readFileSync(filePath, 'utf8');
  const updated = original.replace(/((?:from|import)\s*[(]?[\s]*['"])(\.[^'"]+)(['"])/g, (match, prefix, specifier, suffix) => {
    return `${prefix}${normalizeSpecifier(filePath, specifier)}${suffix}`;
  });
  if (updated !== original) fs.writeFileSync(filePath, updated);
}
