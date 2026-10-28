# Baseline tool versions (pinned, installed outside the repo)

Installed 2026-10-25 under `%USERPROFILE%\schem-baselines`. Nothing is installed in the repo.

| Tool | Version | Where |
|---|---|---|
| Python | 3.12.10 | `%LOCALAPPDATA%\Programs\Python\Python312\python.exe` (venv base) |
| skidl | 3.0.0 | venv `%USERPROFILE%\schem-baselines\venv` |
| schematizer (SKiDL's placer/router/SVG writer, pulled in by skidl) | 0.2.0 | venv |
| hierplace (skidl dependency) | 1.1.0 | venv |
| schemdraw | 0.23 | venv |
| matplotlib | 3.11.2 | venv |
| KiCad symbol library | tag 10.0.7, commit e1bb0a65cb243525367c5dc7294665b9fd57fc4d | `%USERPROFILE%\schem-baselines\kicad-symbols` (SKiDL reads it through `KICAD10_SYMBOL_DIR`; SKiDL 3.0.0's default tool is kicad10) |
| netlistsvg (analog skin `lib/analog.svg`, unmodified) | 1.0.2 | `%USERPROFILE%\schem-baselines\netlistsvg` (own `package.json`, `--save-exact`) |
| Node.js / npm | 24.14.0 / 11.9.0 | system |
| @resvg/resvg-js (rasteriser, from the repo) | 2.6.2 | repo `node_modules` |
| DejaVu fonts (rasteriser fonts, from the repo) | dejavu-fonts-ttf 2.37.3 | repo `node_modules` |

KiCad itself is not installed and not needed: SKiDL 3.0.0's `generate_svg()` renders through schematizer.

## Install commands

```
%LOCALAPPDATA%\Programs\Python\Python312\python.exe -m venv %USERPROFILE%\schem-baselines\venv
%USERPROFILE%\schem-baselines\venv\Scripts\python.exe -m pip install --upgrade pip
%USERPROFILE%\schem-baselines\venv\Scripts\python.exe -m pip install skidl==3.0.0 schemdraw==0.23 matplotlib==3.11.2
git clone --depth 1 --branch 10.0.7 https://gitlab.com/kicad/libraries/kicad-symbols.git %USERPROFILE%\schem-baselines\kicad-symbols
cd %USERPROFILE%\schem-baselines\netlistsvg && npm init -y && npm install --save-exact netlistsvg@1.0.2
```

## Verify

```
%USERPROFILE%\schem-baselines\venv\Scripts\python.exe -m pip freeze | findstr /i "skidl schematizer hierplace schemdraw matplotlib"
cd %USERPROFILE%\schem-baselines\netlistsvg && npm ls --depth=0
git -C %USERPROFILE%\schem-baselines\kicad-symbols describe --tags
```

Checked 2026-10-25: pip freeze shows hierplace==1.1.0, matplotlib==3.11.2, schematizer==0.2.0, schemdraw==0.23,
skidl==3.0.0; `npm ls` shows netlistsvg@1.0.2; kicad-symbols describes as 10.0.7.
