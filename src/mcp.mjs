import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import fs from 'node:fs/promises';
import path from 'node:path';
import { callService, pluginRoot } from './service.mjs';

const server=new McpServer({name:'ui-studio',version:'0.2.1'},{instructions:'Projects may use MCU LVGL, desktop/Linux LVGL, Qt, PySide/PyQt, OSD or unknown UI frameworks. open_ui_editor in auto mode inspects first. view=project means a report, NOT an imported UI. Do not substitute a blank/new design for an unsupported import. Preserve framework versions and hardware targets. Before edits read get_ui_document and pass its revision. Report import, preview, edit and source writeback capabilities separately.'});
const uri='ui://ui-studio/editor-v1.html';
server.registerResource('ui-studio-editor',uri,{mimeType:'text/html;profile=mcp-app'},async()=>({contents:[{uri,mimeType:'text/html;profile=mcp-app',text:await fs.readFile(path.join(pluginRoot,'dist/editor.html'),'utf8'),_meta:{ui:{prefersBorder:false,csp:{connectDomains:[],resourceDomains:[]}}}}]}));
const node=z.object({type:z.enum(['frame','label','button','input','checkbox','slider','progress']),id:z.string().optional(),name:z.string().optional(),text:z.string().optional(),x:z.number().optional(),y:z.number().optional(),width:z.number().optional(),height:z.number().optional(),parentId:z.string().nullable().optional()}).passthrough();
const operations=z.array(z.discriminatedUnion('op',[
  z.object({op:z.literal('add'),node}),z.object({op:z.literal('update'),id:z.string(),changes:z.record(z.unknown())}),
  z.object({op:z.literal('remove'),ids:z.array(z.string())}),z.object({op:z.literal('canvas'),changes:z.record(z.unknown())}),z.object({op:z.literal('reorder'),ids:z.array(z.string())}),
]));
const session={sessionId:z.string()}; const versioned={...session,revision:z.number().int().nonnegative()};
const definitions=[
  ['inspect_ui_project','识别 UI 工程','Inspect framework, version, MCU/host/mixed targets, build systems and source files for arbitrary UI project paths. Includes LVGL, Qt/PySide/PyQt, QML, OSD and unknown frameworks. Reports evidence, scan limits and actual import/preview/edit/writeback capabilities. Does not execute code or install dependencies.',{projectPath:z.string()},true],
  ['open_ui_editor','打开 UI 设计器','Open an existing UI project. WatchX LVGL 6.1.2 uses its native host adapter; page selects DialPlate, MainMenu, TimeCfg, Backlight, StopWatch, Altitude or About. Other projects use inspection and supported Qt .ui import. Unsupported projects return view=project, NOT an editable design. mode=new explicitly creates a separate design.',{projectPath:z.string().optional(),sourceFile:z.string().optional(),page:z.enum(['DialPlate','MainMenu','TimeCfg','Backlight','StopWatch','Altitude','About']).optional(),mode:z.enum(['auto','new']).optional(),demo:z.boolean().optional()},false],
  ['get_ui_document','读取当前界面','Read the authoritative document, revision and selection before edits, or the project inspection report when view=project. Reports contain no editable document.',session,true],
  ['apply_ui_operations','修改界面','Apply an atomic group of edits with the expected revision. All operations use the same history as mouse edits. Widget parent coordinates are relative to their frame.',{...versioned,operations},false],
  ['ui_history','撤销或重做','Undo or redo the latest shared design edit with optimistic concurrency.',{...versioned,action:z.enum(['undo','redo'])},false],
  ['select_ui_nodes','选择控件','Set the shared selection so the person and agent can refer to the same widgets.',{...session,ids:z.array(z.string())},false],
  ['export_ui_project','导出 UI 工程','Export a revision to a new directory inside .ui-designer/exports. Never overwrites the imported application. Qt and Tkinter outputs are runnable with required dependencies; LVGL 9 requires host integration.',{...versioned,target:z.enum(['qt-ui','pyside6','qt-cpp','tkinter','lvgl']).optional()},false],
  ['render_ui_preview','生成原生 Qt 预览','Start a background native Qt render for a new design. Automatically prepares a project-local Python virtual environment and installs PySide6 if needed. Returns a job ID; use get_ui_preview to check completion. Renders generated widgets only, not imported project code.',versioned,false],
  ['get_ui_preview','读取原生预览状态','Read the native Qt render status and local PNG path. includeImage=true returns the PNG data URL for the editor; normally use false for agent status checks.',{jobId:z.string(),includeImage:z.boolean().optional()},true],
  ['save_ui_source','保存回原工程','Save WatchX LVGL 6 edits into the original page using a backed-up source integration and generated property overrides. Preserves page functions and original encoding. Checks external source/header modifications. Does not build or flash MCU firmware.',versioned,false],
];
for(const [name,title,description,inputSchema,readOnlyHint] of definitions) {
  const meta=name==='open_ui_editor'?{ui:{resourceUri:uri},'openai/ui':{entrypoints:[{type:'thread'}]}}:undefined;
  server.registerTool(name,{title,description,inputSchema,annotations:{readOnlyHint,destructiveHint:false,openWorldHint:false},...(meta?{_meta:meta}:{})},async(args)=>{
    try {
      if(name==='open_ui_editor' && !args.projectPath) return {structuredContent:{welcome:true},content:[{type:'text',text:'UI Studio ready. Select a local project path or ask Codex to open your project.'}]};
      const result=await callService(name,args);
      return {structuredContent:result,content:[{type:'text',text:JSON.stringify(result)}]};
    } catch(e) { return {isError:true,content:[{type:'text',text:e.message}],structuredContent:{error:e.message,status:e.status || 500}}; }
  });
}
await server.connect(new StdioServerTransport());
