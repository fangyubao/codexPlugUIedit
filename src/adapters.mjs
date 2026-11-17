import fs from 'node:fs/promises';
import path from 'node:path';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { assert, contained, hash, newDocument, newNode, validateDocument } from './model.mjs';

const qtClasses = { frame:'QFrame', label:'QLabel', button:'QPushButton', input:'QLineEdit', checkbox:'QCheckBox', slider:'QSlider', progress:'QProgressBar' };
const xmlEscape = s => String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&apos;');
const r = n => Math.round(n);
const py = s => JSON.stringify(String(s));
const cString = s => JSON.stringify(String(s)).replaceAll('\u2028',' ').replaceAll('\u2029',' ');
export const variable = n => 'ui_' + n.id;
export { inspectProject } from './project.mjs';
function parseXml(text) {
  assert(!/<!DOCTYPE|<!ENTITY/i.test(text),'不支持带外部实体或 DTD 的 UI 文件');
  const errors = [];
  const doc = new DOMParser({ errorHandler: { warning: m=>errors.push(m), error:m=>errors.push(m), fatalError:m=>errors.push(m) } }).parseFromString(text,'text/xml');
  assert(errors.length === 0 && doc.documentElement?.tagName === 'ui','不是有效的 Qt .ui 文档'); return doc;
}
const children = (el, tag) => Array.from(el.childNodes || []).filter(n => n.nodeType === 1 && (!tag || n.tagName === tag));
const property = (el,name) => children(el,'property').find(p => p.getAttribute('name') === name);
function val(el,name,fallback='') { const p = property(el,name); return p ? p.textContent.trim() : fallback; }
function rect(el) {
  const p = property(el,'geometry'); const re = p?.getElementsByTagName('rect')[0];
  if (!re) return null;
  return Object.fromEntries(['x','y','width','height'].map(key => [key,Number(re.getElementsByTagName(key)[0]?.textContent || 0)]));
}
export async function importQt(root, sourceFile) {
  assert(sourceFile.endsWith('.ui'),'当前仅支持导入 .ui 文件');
  const file = await contained(root,sourceFile); assert((await fs.stat(file)).size <= 2_000_000,'UI 文件超过 2 MB');
  const raw = await fs.readFile(file,'utf8'), xml = parseXml(raw), top = children(xml.documentElement,'widget')[0];
  assert(top,'缺少根窗口');
  const doc = newDocument(); doc.title = val(top,'windowTitle',top.getAttribute('name') || 'Qt 表单'); doc.target = 'qt-ui';
  const rootRect = rect(top); if (rootRect) Object.assign(doc.canvas,{width:Math.max(64,rootRect.width),height:Math.max(64,rootRect.height)});
  doc.source = { kind:'qt-ui', file:sourceFile, hash:hash(raw), rawXml:raw, rootName:top.getAttribute('name') };
  const unsupported = new Set();
  function visit(widget,parentId) {
    for (const child of children(widget,'widget')) {
      const klass = child.getAttribute('class'), id = child.getAttribute('name');
      let type = Object.keys(qtClasses).find(k=>qtClasses[k]===klass);
      if (klass === 'QWidget' || klass === 'QGroupBox') type = 'frame';
      if (!type || !/^[A-Za-z_]\w{0,79}$/.test(id)) { unsupported.add(klass); continue; }
      const geometry = rect(child);
      if (!geometry) { unsupported.add(`${klass} 无绝对几何信息`); continue; }
      const node = newNode(type,{ id, name:id, parentId, ...geometry,
        text:val(child,type === 'input' ? 'placeholderText' : 'text',type === 'frame' ? '' : defaultsText(type)),
        visible:val(child,'visible','true') !== 'false', value:Number(val(child,'value','50')), checked:val(child,'checked') === 'true',
      });
      if (type === 'input' && val(child,'text')) node.text = val(child,'text');
      const font = property(child,'font')?.getElementsByTagName('pointsize')[0]; if (font) node.fontSize = Math.round(Number(font.textContent)*4/3);
      const style = val(child,'styleSheet');
      for (const [prop,field] of [['background-color','background'],['color','color'],['border-color','border']]) {
        const match = style.match(new RegExp(`(?:^|[;{]\\s*)${prop}\\s*:\\s*(#[0-9a-fA-F]{6})`)); if (match) node[field] = match[1];
      }
      const radius = style.match(/border-radius\s*:\s*(\d+)px/); if (radius) node.radius = Number(radius[1]);
      const size = style.match(/font-size\s*:\s*(\d+)px/); if (size) node.fontSize = Number(size[1]);
      doc.nodes.push(node); visit(child,id);
    }
  }
  visit(top,null);
  if (xml.getElementsByTagName('layout').length) { doc.readOnly = true; doc.warnings.push('此表单使用 Qt 布局管理器，v0.1 仅查看，未启用拖拽或源码改写。'); }
  if (unsupported.size) { doc.readOnly = true; doc.warnings.push(`未适配控件：${[...unsupported].join('、')}。为保留工程语义，此表单仅查看。`); }
  doc.warnings.push('设计画布为近似预览。导出副本保留未编辑的 XML、连接和资源；资源相对路径仍需与原工程配合使用。');
  doc.source.originalNodes = structuredClone(doc.nodes); doc.source.originalCanvas = structuredClone(doc.canvas);
  return validateDocument(doc);
}
const defaultsText = type => ({button:'按钮',label:'文本',checkbox:'选项',input:''}[type] || '');
function setProperty(xml,el,name,tag,value) {
  let p = property(el,name); if (!p) { p = xml.createElement('property'); p.setAttribute('name',name); el.appendChild(p); }
  while (p.firstChild) p.removeChild(p.firstChild);
  const child = xml.createElement(tag); child.appendChild(xml.createTextNode(String(value))); p.appendChild(child);
}
function setRect(xml,el,geometry) {
  let p = property(el,'geometry'); if (!p) { p = xml.createElement('property'); p.setAttribute('name','geometry'); el.appendChild(p); }
  while (p.firstChild) p.removeChild(p.firstChild);
  const re = xml.createElement('rect');
  for (const key of ['x','y','width','height']) { const c = xml.createElement(key); c.appendChild(xml.createTextNode(String(r(geometry[key])))); re.appendChild(c); }
  p.appendChild(re);
}
export function qtXml(doc) {
  if (doc.source) {
    const xml = parseXml(doc.source.rawXml), top = children(xml.documentElement,'widget')[0];
    const elements = Array.from(xml.getElementsByTagName('widget'));
    for (const node of doc.nodes) {
      const old = doc.source.originalNodes.find(n=>n.id===node.id), el = elements.find(e=>e.getAttribute('name')===node.id);
      if (!el || !old) continue;
      if (['x','y','width','height'].some(k=>node[k]!==old[k])) setRect(xml,el,node);
      if (node.text!==old.text) setProperty(xml,el,node.type==='input'?'text':'text','string',node.text);
      if (node.checked!==old.checked) setProperty(xml,el,'checked','bool',node.checked);
      if (node.value!==old.value) setProperty(xml,el,'value','number',r(node.value));
      if (node.visible!==old.visible) setProperty(xml,el,'visible','bool',node.visible);
      const styleChanges = { color:'color',background:'background-color',border:'border-color',radius:'border-radius',fontSize:'font-size' };
      const changed = Object.entries(styleChanges).filter(([key])=>node[key]!==old[key]);
      if (changed.length) {
        const extra = changed.map(([key,css])=>`${css}: ${node[key]}${['radius','fontSize'].includes(key)?'px':''};`).join(' ');
        setProperty(xml,el,'styleSheet','string',`${val(el,'styleSheet')}\n#${node.id} { ${extra} }`);
      }
    }
    if (doc.canvas.width!==doc.source.originalCanvas.width || doc.canvas.height!==doc.source.originalCanvas.height) setRect(xml,top,{x:0,y:0,...doc.canvas});
    setProperty(xml,top,'windowTitle','string',doc.title);
    if(doc.canvas.background!==doc.source.originalCanvas.background) setProperty(xml,top,'styleSheet','string',`${val(top,'styleSheet')}\n#${doc.source.rootName} { background-color: ${doc.canvas.background}; }`);
    return new XMLSerializer().serializeToString(xml);
  }
  const prop = (name,tag,value) => `<property name="${name}"><${tag}>${xmlEscape(value)}</${tag}></property>`;
  const geometry = n => `<property name="geometry"><rect><x>${r(n.x)}</x><y>${r(n.y)}</y><width>${r(n.width)}</width><height>${r(n.height)}</height></rect></property>`;
  function widget(node) {
    const style = `#${node.id} { background-color: ${node.background}; color: ${node.color}; border: ${['slider','checkbox','label'].includes(node.type)?0:1}px solid ${node.border}; border-radius: ${node.radius}px; font-size: ${node.fontSize}px; }`;
    let properties = geometry(node)+prop('styleSheet','string',style);
    if (['label','button','checkbox','input'].includes(node.type)) properties+=prop(node.type==='input'?'placeholderText':'text','string',node.text);
    if (node.type==='label') properties+=prop('textFormat','enum','Qt::PlainText');
    if (['slider','progress'].includes(node.type)) properties+=prop('value','number',r(node.value))+prop('maximum','number',100);
    if (node.type==='slider') properties+=prop('orientation','enum','Qt::Horizontal');
    if (node.type==='checkbox') properties+=prop('checked','bool',node.checked);
    if (!node.visible) properties+=prop('visible','bool',false);
    return `<widget class="${qtClasses[node.type]}" name="${node.id}">${properties}${doc.nodes.filter(n=>n.parentId===node.id).map(widget).join('\n')}</widget>`;
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<ui version="4.0"><class>StudioWindow</class><widget class="QWidget" name="StudioWindow">${geometry({x:0,y:0,...doc.canvas})}${prop('windowTitle','string',doc.title)}${prop('styleSheet','string',`#StudioWindow { background-color: ${doc.canvas.background}; }`)}${doc.nodes.filter(n=>!n.parentId).map(widget).join('\n')}</widget><resources/><connections/></ui>\n`;
}
function ordered(doc) {
  const result = []; function visit(parentId) { for (const n of doc.nodes.filter(n=>n.parentId===parentId)) { result.push(n); visit(n.id); } } visit(null); return result;
}
export function generateFiles(doc, target) {
  validateDocument(doc);
  assert(!doc.readOnly,'此导入表单仅查看，不能导出修改');
  if (doc.source) assert(['qt-ui','pyside6','qt-cpp'].includes(target),'导入的 Qt 表单仅支持 Qt 导出，以保留原始语义');
  const files = {}, warnings = [...doc.warnings];
  if (['qt-ui','pyside6','qt-cpp'].includes(target)) files['window.ui'] = qtXml(doc);
  if (target==='pyside6') {
    files['main.py'] = `"""Generated UI. Add application behavior in a separate module."""\nimport sys\nfrom pathlib import Path\nfrom PySide6.QtWidgets import QApplication\nfrom PySide6.QtCore import QFile, QIODevice\nfrom PySide6.QtUiTools import QUiLoader\n\napp = QApplication(sys.argv)\nsource = QFile(str(Path(__file__).with_name("window.ui")))\nif not source.open(QIODevice.OpenModeFlag.ReadOnly):\n    raise RuntimeError(source.errorString())\nloader = QUiLoader()\nwindow = loader.load(source)\nsource.close()\nif window is None:\n    raise RuntimeError(loader.errorString())\nwindow.show()\nsys.exit(app.exec())\n`;
    files['requirements.txt'] = 'PySide6>=6.8,<7\n';
  }
  if (target==='qt-cpp') {
    files['main.cpp'] = '#include <QApplication>\n#include <QFile>\n#include <QUiLoader>\n#include <QWidget>\n#include <QDebug>\n\nint main(int argc, char **argv) {\n    QApplication app(argc, argv);\n    QFile file(":/window.ui");\n    if (!file.open(QIODevice::ReadOnly)) return 1;\n    QUiLoader loader;\n    QWidget *window = loader.load(&file);\n    if (!window) { qCritical() << loader.errorString(); return 1; }\n    window->show();\n    int status = app.exec();\n    delete window;\n    return status;\n}\n';
    files['CMakeLists.txt'] = 'cmake_minimum_required(VERSION 3.21)\nproject(StudioUI LANGUAGES CXX)\nset(CMAKE_CXX_STANDARD 17)\nset(CMAKE_AUTORCC ON)\nfind_package(Qt6 REQUIRED COMPONENTS Widgets UiTools)\nadd_executable(studio_ui main.cpp resources.qrc)\ntarget_link_libraries(studio_ui PRIVATE Qt6::Widgets Qt6::UiTools)\n';
    files['resources.qrc'] = '<RCC><qresource prefix="/"><file>window.ui</file></qresource></RCC>\n';
  }
  if (target==='tkinter') {
    const lines = ['import tkinter as tk','from tkinter import ttk','', 'root = tk.Tk()',`root.title(${py(doc.title)})`,`root.geometry("${doc.canvas.width}x${doc.canvas.height}")`,`root.configure(bg=${py(doc.canvas.background)})`, '_ui_values = {}', ''];
    for (const n of ordered(doc)) {
      const v=variable(n), parent=n.parentId ? 'ui_'+n.parentId : 'root';
      const font=`font=("Arial", -${r(n.fontSize)})`, colors=`bg=${py(n.background)}, fg=${py(n.color)}`;
      if (n.type==='frame') lines.push(`${v} = tk.Frame(${parent}, bg=${py(n.background)}, highlightbackground=${py(n.border)}, highlightthickness=1)`);
      if (n.type==='label') lines.push(`${v} = tk.Label(${parent}, text=${py(n.text)}, ${colors}, ${font}, anchor="w")`);
      if (n.type==='button') lines.push(`${v} = tk.Button(${parent}, text=${py(n.text)}, ${colors}, ${font}, relief="flat")`);
      if (n.type==='input') lines.push(`${v} = tk.Entry(${parent}, ${colors}, ${font}, relief="solid", bd=1)`,`${v}.insert(0, ${py(n.text)})`);
      if (n.type==='checkbox') lines.push(`_ui_values[${py(n.id)}] = tk.BooleanVar(value=${n.checked?'True':'False'})`,`${v} = tk.Checkbutton(${parent}, text=${py(n.text)}, variable=_ui_values[${py(n.id)}], ${colors}, ${font}, anchor="w")`);
      if (n.type==='slider') lines.push(`${v} = tk.Scale(${parent}, from_=0, to=100, orient="horizontal", showvalue=False, ${colors}, highlightthickness=0)`,`${v}.set(${r(n.value)})`);
      if (n.type==='progress') lines.push(`${v} = ttk.Progressbar(${parent}, maximum=100, value=${r(n.value)})`);
      if (n.visible) lines.push(`${v}.place(x=${r(n.x)}, y=${r(n.y)}, width=${r(n.width)}, height=${r(n.height)})`);
      lines.push('');
    }
    lines.push('if __name__ == "__main__":','    root.mainloop()',''); files['main.py']=lines.join('\n');
    warnings.push('Tkinter 使用平台原生控件；圆角、主题和输入框占位提示不保证与设计画布一致。');
  }
  if (target==='lvgl') {
    const lines = ['#include "ui_generated.h"','','/* LVGL 9; call after display initialization. Parent is provided by the application. */','void ui_studio_create(lv_obj_t *parent) {',`    lv_obj_set_style_bg_color(parent, lv_color_hex(0x${doc.canvas.background.slice(1)}), 0);`];
    const classes={frame:'obj',label:'label',button:'button',input:'textarea',checkbox:'checkbox',slider:'slider',progress:'bar'};
    for (const n of ordered(doc)) {
      const v=variable(n),parent=n.parentId ? 'ui_'+n.parentId : 'parent';
      lines.push(`    lv_obj_t *${v} = lv_${classes[n.type]}_create(${parent});`,`    lv_obj_set_pos(${v}, ${r(n.x)}, ${r(n.y)});`,`    lv_obj_set_size(${v}, ${r(n.width)}, ${r(n.height)});`,
        `    lv_obj_set_style_bg_color(${v}, lv_color_hex(0x${n.background.slice(1)}), 0);`,`    lv_obj_set_style_bg_opa(${v}, LV_OPA_COVER, 0);`,
        `    lv_obj_set_style_text_color(${v}, lv_color_hex(0x${n.color.slice(1)}), 0);`,`    lv_obj_set_style_radius(${v}, ${r(n.radius)}, 0);`,
        `    lv_obj_set_style_border_color(${v}, lv_color_hex(0x${n.border.slice(1)}), 0);`,`    lv_obj_set_style_border_width(${v}, ${['frame','input','button'].includes(n.type)?1:0}, 0);`);
      if (n.type==='frame') lines.push(`    lv_obj_set_style_pad_all(${v}, 0, 0);`,`    lv_obj_remove_flag(${v}, LV_OBJ_FLAG_SCROLLABLE);`);
      if (n.type==='label') lines.push(`    lv_label_set_text(${v}, ${cString(n.text)});`);
      if (n.type==='button') lines.push(`    { lv_obj_t *button_label = lv_label_create(${v});`,`      lv_label_set_text(button_label, ${cString(n.text)});`,`      lv_obj_center(button_label); }`);
      if (n.type==='input') lines.push(`    lv_textarea_set_one_line(${v}, true);`,`    lv_textarea_set_placeholder_text(${v}, ${cString(n.text)});`);
      if (n.type==='checkbox') { lines.push(`    lv_checkbox_set_text(${v}, ${cString(n.text)});`); if (n.checked) lines.push(`    lv_obj_add_state(${v}, LV_STATE_CHECKED);`); }
      if (n.type==='slider' || n.type==='progress') { const kind=n.type==='slider'?'slider':'bar'; lines.push(`    lv_${kind}_set_range(${v}, 0, 100);`,`    lv_${kind}_set_value(${v}, ${r(n.value)}, LV_ANIM_OFF);`); }
      if (!n.visible) lines.push(`    lv_obj_add_flag(${v}, LV_OBJ_FLAG_HIDDEN);`);
      lines.push('');
    }
    lines.push('}',''); files['ui_generated.c']=lines.join('\n');
    files['ui_generated.h']='#pragma once\n#include "lvgl.h"\n#ifdef __cplusplus\nextern "C" {\n#endif\nvoid ui_studio_create(lv_obj_t *parent);\n#ifdef __cplusplus\n}\n#endif\n';
    warnings.push('目标 LVGL 9。需接入显示驱动及包含中文的字体；fontSize 尚未映射到 LVGL 字体资源。不是完整开发板固件。');
  }
  assert(Object.keys(files).length,'未知导出格式');
  if (doc.source) warnings.push('Qt 资源、自定义控件插件和业务代码仍取自原工程，导出副本并不自动携带这些依赖。');
  return { files, warnings };
}
