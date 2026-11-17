import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import path from 'node:path';
const installed=process.argv[2];
if(!installed)throw new Error('Pass the installed plugin path');
const client=new Client({name:'ui-studio-install-check',version:'1.0.0'});
const transport=new StdioClientTransport({command:process.execPath,args:['./src/mcp.mjs'],cwd:installed,stderr:'pipe'});
try{
  await client.connect(transport);
  const {tools}=await client.listTools();
  const resource=await client.readResource({uri:'ui://ui-studio/editor-v1.html'});
  if(tools.length!==10||!resource.contents[0]?.text.includes('save-source'))throw new Error('Incomplete installed plugin');
  console.log(JSON.stringify({installedPath:path.resolve(installed),toolCount:tools.length,resource:'ok',threadEntrypoint:tools.find(t=>t.name==='open_ui_editor')._meta['openai/ui']},null,2));
}finally{await client.close();}
