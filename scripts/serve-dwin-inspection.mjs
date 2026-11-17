import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
const directory=await fs.realpath(process.argv[2]),token=randomBytes(24).toString('hex');
const html=await fs.readFile(path.join(directory,'inspector.html'));
const server=http.createServer((req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Content-Type-Options','nosniff');
  const u=new URL(req.url,'http://127.0.0.1');
  if(req.method!=='GET'||u.pathname!=='/'||u.searchParams.get('token')!==token){res.writeHead(404);res.end('Not found');return;}
  res.setHeader('Content-Type','text/html; charset=utf-8');
  res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
  res.end(html);
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
await fs.writeFile(path.join(directory,'runtime.json'),JSON.stringify({url:`http://127.0.0.1:${server.address().port}/?token=${token}`,pid:process.pid}));
