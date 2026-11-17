# UI Studio · Codex 可视化 UI 编辑插件

[![Build and test](https://github.com/fangyubao/codexPlugUIedit/actions/workflows/checks.yml/badge.svg)](https://github.com/fangyubao/codexPlugUIedit/actions/workflows/checks.yml)

在 Codex 右侧窗口用鼠标选择、拖动和调整 UI，让 Agent 接着修改**同一份设计**。适合用语言描述整体需求，再用鼠标精确调整位置和尺寸。

当前版本：**v0.2.1，早期开发版**。已实现独立 UI 设计、部分 Qt Designer 表单编辑、WatchX / LVGL 6.1.2 专用适配，以及实验性的 DWIN 串口屏工程只读解析。支持情况取决于具体工程格式和适配器，不能保证任意 C、C++、Python、Web 或串口屏工程导入后都能往返编辑。

## 支持什么

“工程识别”“预览”“编辑”“保存回原工程”是不同能力，下面分别说明。

| 工程或场景 | 导入与预览 | 鼠标 / Agent 编辑 | 保存结果 |
| --- | --- | --- | --- |
| 从零新建独立设计 | 设计画布；可另行生成 Qt 原生静态预览 | 新增、移动、缩放、删除控件；属性、层级、对齐 | 自动保存设计；导出 Qt、PySide6、Tkinter、LVGL 9 代码 |
| Qt Designer `.ui` 基础绝对定位表单 | 支持部分常见控件 | 修改已有控件；暂不支持增删和调整父子关系 | 导出保留未编辑 XML、连接和资源声明的副本；不直接写回原文件 |
| Qt 布局管理器 / 未适配自定义控件 | 检查并提示限制，可能只能显示部分内容 | 限制为查看 | 未实现完整往返 |
| **WatchX / LVGL 6.1.2** 的匹配工程 | 原 LVGL、字体、图片和七个页面的原生静态渲染 | 已有控件的位置、尺寸、标签文字、颜色、圆角、显隐 | **备份后修改原页面 `.cpp`，生成属性配置头文件** |
| **DWIN DGUS / T5L**，与已验证样本同类的工程格式 | 实验性独立检查脚本：背景、页面、控件、VP 和跳页关系 | **只读选择与属性查看** | JSON 报告和 HTML 检查视图；不写回、不生成下载文件 |
| 其他 MCU / 桌面 / Linux LVGL，Qt C++、PySide/PyQt 源码、QML、OSD、Tkinter、ImGui、直接 LCD 绘图 | 可检查已实现的框架、版本及目标平台证据 | 尚需具体适配器 | 未实现通用源码写回 |
| Web：HTML/CSS、React、Vue 等 | 尚未接入工程适配器 | 未实现 | 未实现 |
| 其他厂商串口屏 | 尚未接入对应格式解析器 | 未实现 | 未实现 |

控件库包含容器、文字、按钮、输入框、复选框、滑块和进度条。新建设计支持拖入控件、四角缩放、网格吸附、Shift 多选、框选、左 / 顶对齐、复制、删除、缩放、方向键微调，以及共享撤销 / 重做。

项目路径默认进入已有工程识别和支持情况检查；不支持的工程会显示报告。只有明确选择新建时才创建独立设计，不用空白画布代替导入结果。

## 运行条件

本项目目前主要在 **Windows** 验证，安装脚本使用 PowerShell。

| 功能 | 依赖 |
| --- | --- |
| 编辑器、MCP 服务 | Node.js 20+、npm；开发和测试建议 **Node.js 24.15+**，当前 jsdom 测试依赖要求 Node 22.22.2 / 24.15 或更新兼容版本 |
| 安装到 Codex | 提供 `codex plugin` 命令的 Codex CLI；可通过 `codex.cmd plugin --help` 检查 |
| Python 导出语法测试、Qt 原生预览 | PATH 中可用的 Python；本地验证使用 Python 3.13 |
| Qt 原生预览 | 首次自动创建工程独立 Python 环境并下载 PySide6，需要联网 |
| WatchX 原生宿主 | PATH 中的 **CMake、Ninja、MinGW GCC / G++**；原工程需自带匹配的 LVGL 6.1.2 和资源 |
| DWIN 实验性解析 | Node.js 和项目 npm 依赖；解析本身不需要安装原厂设计软件 |

编辑器无需单独配置云端 API Key。Agent 是当前 Codex 对话；Qt、LVGL、串口屏的厂商 SDK、固件及项目资源不包含在本仓库中。WatchX 构建目前复用已安装工具链，不会自动安装 GCC 或通用模拟器。

## 安装

在 PowerShell 中运行：

```powershell
git clone https://github.com/fangyubao/codexPlugUIedit.git
cd codexPlugUIedit
npm.cmd ci
npm.cmd run build
.\scripts\install.ps1
```

安装脚本构建编辑器，在仓库内生成 `.local-marketplace`，然后调用 Codex CLI 注册本地市场并安装 `ui-studio@ui-studio-local`。这个目录是安装所需的本地来源，请保留。

安装后新开 Codex 对话使用。如果客户端尚未刷新插件工具，可重新启动客户端。安装脚本不会自动重启 Codex，也不会重启已经运行的 UI Studio 后台服务。

可在 Codex 中说：

> 用 UI Studio 打开 E:\projects\my-app，在右侧显示已支持的界面，让我拖拽调整。

插件声明 MCP Apps HTML 资源和对话侧边面板入口；宿主需要支持对应能力。如果未自动显示面板，让 Codex 将返回的 `editorUrl` 打开到右侧浏览器，也可以在本机普通浏览器打开。

### 仅在本机浏览器使用

无需先安装 Codex 插件：

```powershell
npm.cmd ci
npm.cmd run build
node scripts/studio.mjs open "E:\projects\my-app"
```

输出中包含 `editorUrl`，打开即可查看。服务在后台监听 `127.0.0.1` 随机端口，链接包含本机连接凭据，请不要提交到 GitHub 或分享给其他人。

## 使用方法

### 从零设计

```powershell
# 创建或恢复独立设计
node scripts/studio.mjs open "E:\projects\my-app" --new

# 使用仓库内的设备面板示例
node scripts/studio.mjs open ".\examples\device-panel" --demo
```

从控件库拖入或点击添加控件。选中后拖动移动，用四角手柄调整大小，右侧属性面板可以输入精确数值。修改自动保存到目标工程的 `.ui-designer` 目录。

通过“导出 UI”选择目标：Qt Designer `.ui`、PySide6 / Python、Qt 6 / C++、Tkinter / Python、LVGL 9 / C。导出保存在新目录；事件和业务逻辑由应用工程连接。LVGL 9 输出还需要显示驱动、资源、字体与生命周期接入。

“原生预览”对新建设计准备 PySide6 环境，用真实 Qt 控件生成静态 PNG。它不是可操作的运行中应用，也不支持任意导入工程的原生执行。

### Qt Designer 表单

```powershell
node scripts/studio.mjs open ".\examples\qt-form" --source window.ui
```

如果路径下只有一个已支持且扫描完整的 Qt 表单候选，默认入口会自动尝试导入；多个候选需要指定 `--source`。导出保留未知 XML 属性、连接和资源声明，但不会复制外部资源文件；实际运行仍需原工程资源和插件。

### WatchX / LVGL 6.1.2

需要与当前适配器匹配的工程目录，例如存在 `WatchX/Libraries/lvgl`、`WatchX/WatchX/GUI/Page` 及原字体图片目录。**并非所有使用 LVGL 6 的工程都适用。**

```powershell
node scripts/studio.mjs open "E:\projects\WatchX"
node scripts/studio.mjs open "E:\projects\WatchX" --page MainMenu
```

已接入七页：

| 页面 ID | 界面 |
| --- | --- |
| `DialPlate` | 表盘 |
| `MainMenu` | 主菜单 |
| `TimeCfg` | 时间设置 |
| `Backlight` | 背光设置 |
| `StopWatch` | 秒表 |
| `Altitude` | 海拔 |
| `About` | 关于 |

在顶部页面下拉框切换，选择图层或画面对象后编辑。每次提交调用原 LVGL 6.1.2 重新渲染，沿用工程字体图片，不升级为 LVGL 9。

**自动保存与“保存回工程”不同：**

1. 自动保存只记录设计和撤销历史。
2. 点击“保存回工程”修改**当前页面**源码，并写入 `WatchX/WatchX/GUI/UIStudioGenerated/<页面>.h`。多个页面分别保存。
3. 写回前备份原文件，检查源码和生成配置是否被外部修改；有冲突时拒绝覆盖。
4. 保存不会自动编译固件、烧录或同步到屏幕，设备需要重新编译和下载。

写回保留 GBK 编码及原页面业务函数，通过捕获创建对象并在 `Setup` 末尾应用配置实现修改。**动态回调、动画和布局仍可能覆盖这些属性。** 宿主测试通过不代表 Keil 固件或实板运行无错误。

暂不支持新增 / 删除已有源码控件、改变父子关系、替换字体图片、Game 页面、整板仿真和硬件行为。时钟、电量、气压使用预览替身数据。

### DWIN 串口屏：实验性只读解析

这部分目前是**独立检查脚本**，没有接入通用编辑器的 MCP 导入或保存按钮。已验证一份 DWIN DGUS / T5L 工程，读取到 854×480、16 个页面图像、132 个控件；不代表所有 DWIN 版本都兼容。

先自行解压原始工程，提供包含以下结构的目录：

```text
my-dwin-project/
├── DWprj.hmi
├── TFT/
│   └── <页面图片名称>.tft
└── DWIN_SET/
    ├── <页面图片>.jpg
    ├── 13TouchFile.bin
    ├── 14ShowFile.bin
    └── <图片库、字库、配置等>
```

运行：

```powershell
npm.cmd run inspect:dwin -- "E:\projects\my-dwin-project" "test-results\dwin-inspection"

# 在当前终端启动只读视图服务，Ctrl+C 停止
npm.cmd run serve:dwin -- "test-results\dwin-inspection"
```

第二个命令运行期间，在另一个终端读取访问地址：

```powershell
Get-Content ".\test-results\dwin-inspection\runtime.json"
```

用其中的 `url` 在本机浏览器或 Codex 右侧打开。也可以直接打开输出的 `inspector.html`。视图支持切页、点选控件范围、查看坐标、VP、键码、跳页关系及原始属性；`report.json` 保存解析数据。

解析器将 .NET NRBF 作为数据读取，不实例化类型或执行其中的委托。一些样本在首个有效对象流后有尾部字节，目前记录警告并保持原文件不变。

**目前不支持拖拽、原工程写回、13/14 下载配置重生成、串口动态模拟或实屏验收。** 按钮文字、边框等可能直接画在 JPG 背景中，移动触摸区不会自动移动背景图形。私有工程、图像和字库未包含在本仓库。

## Agent 共同编辑

Agent 和鼠标通过同一个版本化事务接口修改设计，共享选择、历史、撤销和重做。Agent 编辑前先读最新 `revision`，旧版本写入会被拒绝。

| 工具 | 用途 |
| --- | --- |
| `inspect_ui_project` | 检查框架、版本、构建系统、平台证据和支持限制 |
| `open_ui_editor` | 打开支持的表单 / WatchX，恢复或明确新建设计；未支持时返回工程报告 |
| `get_ui_document` | 读取文档、当前选择和版本 |
| `apply_ui_operations` | 按版本原子提交编辑 |
| `select_ui_nodes` | 设置共享选择 |
| `ui_history` | 撤销或重做 |
| `export_ui_project` | 向新目录导出当前版本 |
| `render_ui_preview` | 启动新建设计的 Qt 原生静态预览 |
| `get_ui_preview` | 读取预览任务状态 |
| `save_ui_source` | 备份并写回已接入的 WatchX 当前页面 |

例如：

```json
{
  "sessionId": "open_ui_editor 返回的 ID",
  "revision": 3,
  "operations": [
    { "op": "update", "id": "connect", "changes": { "x": 520, "width": 160, "text": "开始连接" } }
  ]
}
```

MCP App 的“让 Codex 修改”按钮在支持的宿主中发送用户要求；本地网页回退会复制提示，让用户粘贴到当前对话。

## 数据保存位置

| 数据 | 位置 |
| --- | --- |
| 设计与最近 60 步历史 | `<工程>/.ui-designer/designs/<id>.uidesign` |
| 导出副本 | `<工程>/.ui-designer/exports/<id>/...` |
| WatchX 宿主及预览 | `<工程>/.ui-designer/watchx-host/`、`watchx-renders/` |
| WatchX 源码备份 | `<工程>/.ui-designer/source-backups/` |
| Qt 独立运行环境 | `<工程>/.ui-designer/runtime/pyside6/` |
| 本地服务记录 | `~/.codex/ui-studio/`，可用 `UI_STUDIO_DATA` 更改 |

这些运行数据、测试工程、凭据、依赖和生成文件由 `.gitignore` 排除，不随源码发布。

## 测试

```powershell
npm.cmd ci
npm.cmd run build
npm.cmd test
```

测试包括版本冲突、共享历史、原子编辑、Qt XML 保留、代码生成、Python 语法、路径越界、HTTP / MCP、生产 HTML 包初始化，以及 DWIN NRBF 读取。部分测试需要 PATH 中的 Python。

真实工程集成测试需自行提供工程；仓库未附带测试使用的 WatchX、DWIN 项目资源：

```powershell
$env:WATCHX_TEST_PROJECT = "E:\projects\WatchX"
$env:DWIN_TEST_PROJECT = "E:\projects\my-dwin-project"
npm.cmd test
```

WatchX 测试将必要文件复制到 `test-results` 后进行源码往返和宿主编译，不对输入工程页面进行测试写入。DWIN 实际工程测试当前以已验证的 854×480 / 132 控件样本为断言对象。未设置环境变量时，对应集成测试会跳过，不应将跳过计为已验证。

GitHub Actions 使用 Windows、Node.js 24 和 Python 3.13，运行通用构建及测试；不包含私有样本集成、Keil 固件或实板验证。详细本地验证记录见 [VALIDATION.md](VALIDATION.md)。

## 常见问题

**打开页面空白？** v0.2.1 修复了打包脚本的特殊字符替换问题。重新构建并安装，确认旧后台服务已经退出，再使用新返回的链接。升级插件后旧版本目录可能被移除，仍运行的旧服务需要重启。

**链接打不开或连接中断？** 链接只在本机对应服务存活时有效。重新运行 `open` 获取新链接。不要公开 `service.json`、`runtime.json` 或带令牌的地址。

**保存成功是否表示设备一定能运行？** 表示对应文件已写入。仍需原工具链编译、厂商软件下载与实板验证；动态业务逻辑也可能重新设置属性。

**是否支持任意语言编写的 UI？** 目前不支持通用往返转换。语言识别只是第一步，仍需处理框架、布局、资源、源码位置和生命周期。项目目标是逐类扩展适配器。

## 项目结构与扩展

```text
src/          文档事务、工程识别、HTTP / MCP、Qt / WatchX 适配、NRBF 读取
web/          共享可视化编辑器
native/       WatchX 原 LVGL 的宿主接口
scripts/      构建、安装、预览、命令行和 DWIN 检查脚本
skills/       插件对 Codex 的使用说明
examples/     独立设计入口与 Qt 表单样例
tests/        单元、DOM、协议及可选真实工程测试
```

后续方向包括：通用 LVGL 导入与资源编辑、WatchX 动态布局处理和增删控件、DWIN 安全写回与原厂验证、更多串口屏格式、Web 元素到组件源码的映射。适配器职责和验收标准见 [PRODUCT_REQUIREMENTS.md](PRODUCT_REQUIREMENTS.md)。

本仓库未指定开源许可证；代码公开不等于已授予通用开源许可。第三方依赖及用户工程资源各自遵循原许可证。

参考：[OpenAI 插件打包](https://developers.openai.com/plugins/build/plugins) · [MCP App UI](https://developers.openai.com/plugins/build/chatgpt-ui) · [侧边面板扩展](https://developers.openai.com/plugins/build/extensions)
