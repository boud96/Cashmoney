# -*- mode: python ; coding: utf-8 -*-

import os
import sys

from PyInstaller.utils.hooks import collect_data_files, collect_submodules

sys.path.insert(0, SPECPATH)
from check_bundle import is_database_name  # noqa: E402


datas = []
datas += collect_data_files("django.contrib.admin")
datas += collect_data_files("finance", includes=["templates/**", "static/**"])

hiddenimports = []
hiddenimports += collect_submodules("finance.migrations")
hiddenimports += collect_submodules("django.contrib.admin.migrations")
hiddenimports += collect_submodules("django.contrib.auth.migrations")
hiddenimports += collect_submodules("django.contrib.contenttypes.migrations")
hiddenimports += collect_submodules("django.contrib.sessions.migrations")
# Named only in settings (MIDDLEWARE) or imported late; make sure they are bundled.
hiddenimports += collect_submodules("whitenoise")
hiddenimports += collect_submodules("waitress")

a = Analysis(
    ["packaged_backend.py"],
    pathex=[],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)
# PyInstaller's Django hook adds every *.db / db.* file next to manage.py to the bundle
# root, such as the development database (CR-60). Leave those out; the build scripts
# then run check_bundle.py on the result.
a.datas = [
    entry
    for entry in a.datas
    if os.path.dirname(entry[0]) or not is_database_name(entry[0])
]
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="cashmoney-backend",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name="cashmoney-backend",
)
