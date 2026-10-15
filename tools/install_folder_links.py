"""Зарегистрировать в Windows ссылки vhutemas-folder: (только для текущего
пользователя, HKCU). По ссылке со страницы /materials откроется папка
материалов в Проводнике через tools/open_folder.py.

    python tools/install_folder_links.py           # установить
    python tools/install_folder_links.py --remove  # убрать
"""
import sys
import winreg
from pathlib import Path

KEY = r"Software\Classes\vhutemas-folder"
script = Path(__file__).resolve().parent / "open_folder.py"
pythonw = Path(sys.executable).with_name("pythonw.exe")
if not pythonw.exists():
    pythonw = Path(sys.executable)

if "--remove" in sys.argv:
    for sub in (r"\shell\open\command", r"\shell\open", r"\shell", ""):
        try:
            winreg.DeleteKey(winreg.HKEY_CURRENT_USER, KEY + sub)
        except FileNotFoundError:
            pass
    print("Ссылки vhutemas-folder: убраны.")
    sys.exit()

with winreg.CreateKey(winreg.HKEY_CURRENT_USER, KEY) as k:
    winreg.SetValueEx(k, "", 0, winreg.REG_SZ, "URL:2VHUTEMAS папка материалов")
    winreg.SetValueEx(k, "URL Protocol", 0, winreg.REG_SZ, "")
with winreg.CreateKey(winreg.HKEY_CURRENT_USER, KEY + r"\shell\open\command") as k:
    winreg.SetValueEx(k, "", 0, winreg.REG_SZ, f'"{pythonw}" "{script}" "%1"')
print(f"Готово: ссылки vhutemas-folder: открывают папки через {script.name}.")
