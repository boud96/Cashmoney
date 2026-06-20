# -*- mode: python ; coding: utf-8 -*-

from PyInstaller.utils.hooks import collect_data_files, collect_submodules


datas = []
datas += collect_data_files("django.contrib.admin")
datas += collect_data_files("finance", includes=["templates/**", "static/**"])

hiddenimports = []
hiddenimports += collect_submodules("finance.migrations")
hiddenimports += collect_submodules("django.contrib.admin.migrations")
hiddenimports += collect_submodules("django.contrib.auth.migrations")
hiddenimports += collect_submodules("django.contrib.contenttypes.migrations")
hiddenimports += collect_submodules("django.contrib.sessions.migrations")

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
