import { callService } from '../src/service.mjs';
const [command,...args]=process.argv.slice(2);
const commands={open:'open_ui_editor',inspect:'inspect_ui_project',get:'get_ui_document',apply:'apply_ui_operations',export:'export_ui_project',history:'ui_history',select:'select_ui_nodes',preview:'render_ui_preview','preview-status':'get_ui_preview',save:'save_ui_source'};
try {
  if(!commands[command]) throw new Error('Usage: studio.mjs open <project> [--new | --demo | --source file.ui] | inspect <project> | get <session> | apply/export/history/select <JSON>');
  let input;
  if(command==='open') input={projectPath:args[0],mode:args.includes('--new')?'new':'auto',demo:args.includes('--demo'),sourceFile:args.includes('--source')?args[args.indexOf('--source')+1]:undefined,page:args.includes('--page')?args[args.indexOf('--page')+1]:undefined};
  else if(command==='inspect') input={projectPath:args[0]};
  else if(command==='get') input={sessionId:args[0]};
  else input=JSON.parse(args.join(' '));
  console.log(JSON.stringify(await callService(commands[command],input),null,2));
} catch(e) { console.error(e.message); process.exitCode=1; }
