import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { inspectProject } from '../src/project.mjs';

async function fixture(files) {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'ui-studio-project-'));
  for(const[file,text]of Object.entries(files)){const dest=path.join(root,file);await fs.mkdir(path.dirname(dest),{recursive:true});await fs.writeFile(dest,text,'utf8');}
  return root;
}
test('MCU LVGL 8 preserves chip, Keil configuration and version in vendor folders',async()=>{
  const root=await fixture({
    'panel.ioc':'Mcu.Name=STM32H743ZITx\nMcu.Family=STM32H7',
    'MDK-ARM/panel.uvprojx':'<Project><Target><Device>STM32H743ZI</Device></Target></Project>',
    'Application/ui.c':'#include "lvgl.h"\nlv_obj_t *button = lv_btn_create(lv_scr_act());',
    'Middlewares/Third_Party/LVGL/lvgl.h':'#define LVGL_VERSION_MAJOR 8\n#define LVGL_VERSION_MINOR 3\n#define LVGL_VERSION_PATCH 11',
    'lv_conf.h':'#define LV_HOR_RES_MAX 800\n#define LV_VER_RES_MAX 480\n#define LV_COLOR_DEPTH 16',
    'Drivers/Board/display.c':'#include "stm32h7xx_hal.h"\nvoid display_init(void) {}',
  });
  const result=await inspectProject(root);
  assert.equal(result.environment.kind,'mcu');assert(result.buildSystems.some(b=>b.id==='keil-mdk'));
  assert(result.versions.some(v=>v.package==='LVGL'&&v.version==='8.3.11'));
  assert(result.environment.targets.some(t=>t.evidence.some(e=>e.description.includes('STM32H743ZITx'))));
  assert(result.displayFacts.some(f=>f.key==='LV_COLOR_DEPTH'&&f.value===16));
  const lvgl=result.frameworks.find(f=>f.framework==='lvgl');assert.equal(lvgl.importedProject.edit,'unsupported');assert.equal(lvgl.importedProject.writeBack,'unsupported');
  assert(lvgl.dependencies.some(d=>d.includes('8.3.11')));assert(lvgl.previewPlan.includes('硬件'));
  assert.equal(result.intake.status,'needs-adapter');assert.equal(result.scan.complete,true);
});
test('desktop and Linux LVGL targets are separate from MCU and mixed projects retain evidence',async()=>{
  const root=await fixture({'CMakeLists.txt':'find_package(SDL2 REQUIRED)\nadd_subdirectory(lvgl)',
    'main.c':'#include <SDL2/SDL.h>\n#include "lvgl.h"\nint main(void){ SDL_Init(0); }',
    'lvgl/src/lv_version.h':'#define LVGL_VERSION_MAJOR 9\n#define LVGL_VERSION_MINOR 2\n#define LVGL_VERSION_PATCH 0'});
  const desktop=await inspectProject(root);assert.equal(desktop.environment.kind,'host');assert(desktop.environment.targets.some(t=>t.id==='sdl'));
  await fs.writeFile(path.join(root,'platformio.ini'),'[env:esp32]\nplatform = espressif32\nlib_deps = lvgl/lvgl@8.3.11');
  const mixed=await inspectProject(root);assert.equal(mixed.environment.kind,'mixed');assert(mixed.conflicts.some(x=>x.includes('LVGL')));
  assert(mixed.versions.some(v=>v.version==='8.3.11'));assert(mixed.versions.some(v=>v.version==='9.2.0'));
  const linux=await inspectProject(await fixture({'main.c':'#include "lvgl.h"\nvoid init(void){lv_linux_fbdev_create();}'}));
  assert.equal(linux.environment.kind,'host');assert(linux.environment.targets.some(t=>t.id==='linux-display'));
});
test('PySide2 and PyQt6 remain distinct and docs do not invent installed framework evidence',async()=>{
  const root=await fixture({'app.py':'from PySide2.QtWidgets import QApplication, QPushButton\nraise RuntimeError("inspection must not execute")',
    'requirements.txt':'PySide2==5.15.2.1',
    'README.md':'Examples mention LVGL, PySide6, OSD and SDL_Init().'});
  const result=await inspectProject(root);assert(result.versions.some(v=>v.package==='PySide2'&&v.version==='5.15.2.1'));
  assert(result.versions.filter(v=>v.package==='PySide2').every(v=>v.major===5));
  assert(!result.versions.some(v=>v.package==='PySide6'));assert(!result.frameworks.some(f=>f.framework==='lvgl'));
  const pyside=result.frameworks.find(f=>f.framework==='qt-python');assert(pyside.dependencies.some(d=>d.includes('PySide2')));assert.equal(pyside.importedProject.import,'unsupported');
  await fs.writeFile(path.join(root,'other.py'),'from PyQt6.QtWidgets import QWidget');
  const mixed=await inspectProject(root);assert(mixed.conflicts.some(x=>x.includes('Python Qt')));
});
test('OSD, Qt 5, QML and unknown inputs have explicit unsupported or conditional capabilities',async()=>{
  const osd=await inspectProject(await fixture({'osd.c':'void draw(){ HI_MPI_RGN_Create(0, 0); }'}));
  assert(osd.frameworks.some(f=>f.framework==='osd'));assert.equal(osd.adapters[0].capabilities.writeBack,'unsupported');
  const qt=await inspectProject(await fixture({'CMakeLists.txt':'find_package(Qt5 REQUIRED COMPONENTS Widgets Quick)',
    'main.cpp':'#include <QApplication>\n#include <QPushButton>', 'Main.qml':'import QtQuick 2.15\nRectangle { width: 640; height: 480 }'}));
  assert(qt.versions.some(v=>v.package==='Qt'&&v.major===5));assert(qt.frameworks.some(f=>f.framework==='qt-quick'));
  const unknown=await inspectProject(await fixture({'custom.screen':'drawCircle(10,10,5)', 'form.ui':'<interface><object class="GtkWindow"/></interface>'}));
  assert.equal(unknown.qtUiFiles.length,0);assert.equal(unknown.adapters[0].id,'unknown-source');assert.equal(unknown.intake.status,'needs-adapter');
});
test('scan budgets and oversized files report incomplete results instead of definitive unknown',async()=>{
  const root=await fixture({'a.py':'print("hello")','z.py':'from PySide6.QtWidgets import QWidget','big.c':' '.repeat(200)});
  const limited=await inspectProject(root,{limits:{sourceFiles:1}});assert.equal(limited.truncated,true);assert(limited.scan.omittedReasons.includes('source-limit'));
  const size=await inspectProject(root,{limits:{fileBytes:100}});assert(size.scan.omittedReasons.includes('file-size-limit'));
  assert(size.frameworks.some(f=>f.framework==='qt-python'));
});
