import { build } from 'esbuild';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const bundle=await build({entryPoints:[path.join(root,'web/editor.js')],bundle:true,format:'esm',platform:'browser',write:false,minify:true});
const html=await fs.readFile(path.join(root,'web/editor.html'),'utf8');
const css=await fs.readFile(path.join(root,'web/editor.css'),'utf8');
// Replacement callbacks preserve literal $&, $` and $' inside bundled code.
const output=html.replace('/* STUDIO_CSS */',()=>css).replace('/* STUDIO_JS */',()=>bundle.outputFiles[0].text.replace(/<\/script/gi,'<\\/script'));
await fs.mkdir(path.join(root,'dist'),{recursive:true});
await fs.writeFile(path.join(root,'dist/editor.html'),output);
console.log('Built dist/editor.html');
