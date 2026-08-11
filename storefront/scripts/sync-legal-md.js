'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const LEGAL = path.join(ROOT, 'legal');

function htmlToMd(htmlPath, title) {
  const html = fs.readFileSync(htmlPath, 'utf8');
  const mainMatch = html.match(/<main[\s\S]*?<\/main>/i);
  let t = mainMatch ? mainMatch[0] : html;
  t = t
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, '# $1\n\n')
    .replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, '## $1\n\n')
    .replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, '### $1\n\n')
    .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '- $1\n')
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return `# ${title}\n\n${t}\n`;
}

const jobs = [
  ['public/cgv.html', 'cgv.md', 'Conditions Générales de Vente — Boxing Center'],
  ['public/reglement-interieur.html', 'reglement.md', 'Règlement intérieur — Boxing Center'],
];

for (const [src, dest, title] of jobs) {
  const out = htmlToMd(path.join(ROOT, src), title);
  fs.writeFileSync(path.join(LEGAL, dest), out, 'utf8');
  console.log('wrote', dest, out.length, 'chars');
}
