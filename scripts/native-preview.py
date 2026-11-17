"""Render a generated .ui using real Qt widgets without opening a desktop window."""
import os
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
import sys
from pathlib import Path
from PySide6.QtCore import QFile, QIODevice
from PySide6.QtUiTools import QUiLoader
from PySide6.QtWidgets import QApplication
from PySide6.QtGui import QFont, QFontDatabase

source_path = Path(sys.argv[1]).resolve()
output_path = Path(sys.argv[2]).resolve()
app = QApplication([])
# Offscreen Qt does not always discover Windows font fallbacks. Register the
# installed CJK font explicitly so preview text matches the user's language.
if sys.platform == "win32":
    font_root = Path(os.environ.get("WINDIR", "C:/Windows")) / "Fonts"
    for font_file in ("msyh.ttc", "msyhbd.ttc", "simhei.ttf", "simsun.ttc"):
        candidate = font_root / font_file
        if candidate.exists():
            font_id = QFontDatabase.addApplicationFont(str(candidate))
            families = QFontDatabase.applicationFontFamilies(font_id)
            if families:
                app.setFont(QFont(families[0], 10))
                break
source = QFile(str(source_path))
if not source.open(QIODevice.OpenModeFlag.ReadOnly):
    raise RuntimeError(source.errorString())
loader = QUiLoader()
window = loader.load(source)
source.close()
if window is None:
    raise RuntimeError(loader.errorString())
window.show()
app.processEvents()
if not window.grab().save(str(output_path), "PNG"):
    raise RuntimeError("Failed to save native Qt preview")
print(f"Qt rendered {window.width()}x{window.height()} to {output_path}")
window.close()
