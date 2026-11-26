# Installing schem

schem is one command, `schem`, with two jobs:

- `schem draw`, `schem edit`, `schem check`, `schem render` and the other CLI commands work with `.schem` text DSL and `.schem.json` circuit files in a terminal (the CLI, command line interface).
- `schem mcp` starts an MCP server: a program an AI agent (Claude Code, Claude Desktop, Cursor, VS Code, Codex CLI) talks to over stdin and stdout to get the schem tools. MCP is the Model Context Protocol, the common way these agents load tools.

You need [Node.js](https://nodejs.org/) 22 or newer on Windows, macOS or Linux.

> **schem is not on npm yet.** Until it is published, install it from a clone of this repo
> (next section). It will be published as **`schem-cli`**, and the command it installs is
> `schem`. Do not type `npx schem`: the name `schem` on npm belongs to an unrelated, empty
> package. The npm commands further down are for after the package is published.

## Install from a clone (works today)

```sh
git clone https://github.com/2Ntlaks/schem.git
cd schem
npm ci
npm run build
npm install -g .
```

`npm run build` writes the command to `dist/schem.js`. `npm install -g .` puts a `schem` command on your PATH that points at this folder (`npm link` does the same). Check it:

```sh
schem --version
schem draw examples/led.schem.json
```

After a `git pull`, run `npm ci` and `npm run build` again; the linked command picks up the new build. To remove the command: `npm uninstall -g schem-cli`.

### MCP setup from a clone

For agents, point the client at Node and the built file directly. This works the same on every system, with no PATH or `.cmd` shims involved. Use the absolute path of your clone:

- command: `node`
- arguments: `/path/to/schem/dist/schem.js mcp --root /path/to/your/circuits`

On Windows write the path with forward slashes, for example `C:/Users/you/schem/dist/schem.js`. The client snippets below use the npx form; to use your clone instead, replace `"command": "npx"` and `"-y", "schem-cli"` with `"command": "node"` and `"/path/to/schem/dist/schem.js"`. For Claude Code:

```sh
claude mcp add schem -- node /path/to/schem/dist/schem.js mcp --root /path/to/your/circuits
```

## Use from npm (after it is published)

Draw a circuit without installing anything:

```sh
npx schem-cli draw circuit.json
```

npx runs the package's one command, `schem`. This writes `out/circuit.svg` and `out/circuit.png`. Or install the command once:

```sh
npm install -g schem-cli
schem draw circuit.json -o drawings
```

`schem --help` lists the commands and options. The `.schem` text DSL (domain-specific language) is in [dsl.md](dsl.md), the JSON netlist format in [netlist-format.md](netlist-format.md), the part types in [parts.md](parts.md), edit operations in [editing.md](editing.md) and recognised circuit templates in [templates.md](templates.md). These docs, the agent skill and the examples also ship inside the package, in `node_modules/schem-cli/docs/`, `node_modules/schem-cli/skills/schem/SKILL.md` and `node_modules/schem-cli/examples/`.

## The MCP server's options

```
schem mcp [--root <folder>]...
```

| Option | Meaning |
| --- | --- |
| `--root <folder>` | A folder the server may read and write. Repeat it to allow several folders. Without it the root is the folder the server was started in. |
| `--help`, `-h` | Print the server's help and exit. |

There are no other options. The server reads and writes only inside its roots. Which folder a client starts the server in differs between clients, so give `--root` explicitly. Agents should pass absolute file paths in tool calls: a relative path is resolved against the folder the server was started in, not against the root.

The 11 MCP tools are `schem_create`, `schem_edit`, `schem_check`, `schem_preview`, `schem_query`, `schem_render`, `schem_undo`, `schem_describe`, `schem_fmt`, `schem_components` and `schem_component`. `schem_create` accepts `.schem` text DSL (preferred for brevity), JSON text or a JSON object.

In the snippets below, replace `/path/to/your/circuits` with your folder. `npx -y` lets npx download the package without asking.

### Claude Code

```sh
claude mcp add schem -- npx -y schem-cli mcp --root /path/to/your/circuits
```

Add `--scope user` to make it available in every project, or `--scope project` to write it to `.mcp.json` for your team. On native Windows (not WSL), wrap npx in `cmd /c`:

```sh
claude mcp add schem -- cmd /c npx -y schem-cli mcp --root C:/Users/you/circuits
```

Check it with `claude mcp list`.

### Claude Desktop

Edit `claude_desktop_config.json` (Settings, Developer, Edit Config). It is in `~/Library/Application Support/Claude/` on macOS and `%APPDATA%\Claude\` on Windows. Restart Claude Desktop afterwards.

```json
{
  "mcpServers": {
    "schem": {
      "command": "npx",
      "args": ["-y", "schem-cli", "mcp", "--root", "/path/to/your/circuits"]
    }
  }
}
```

If the server does not start on Windows, use `"command": "cmd"` and put `"/c", "npx"` in front of the arguments.

### Cursor

Add to `.cursor/mcp.json` in your project, or to `~/.cursor/mcp.json` for every project:

```json
{
  "mcpServers": {
    "schem": {
      "command": "npx",
      "args": ["-y", "schem-cli", "mcp", "--root", "/path/to/your/circuits"]
    }
  }
}
```

### VS Code

Add to `.vscode/mcp.json` in your workspace (note the key is `servers`, not `mcpServers`):

```json
{
  "servers": {
    "schem": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "schem-cli", "mcp", "--root", "${workspaceFolder}"]
    }
  }
}
```

`${workspaceFolder}` is the open folder; use an absolute path to point somewhere else.

### Codex CLI

Add to `~/.codex/config.toml`:

```toml
[mcp_servers.schem]
command = "npx"
args = ["-y", "schem-cli", "mcp", "--root", "/path/to/your/circuits"]
```

Or run `codex mcp add schem -- npx -y schem-cli mcp --root /path/to/your/circuits`.

## Agent skill

schem ships a short instruction file for AI coding agents in [`skills/schem/SKILL.md`](../skills/schem/SKILL.md) (inside the npm package at `node_modules/schem-cli/skills/schem/SKILL.md`). It covers the 11 MCP tools, the CLI workflow, the `.schem` text DSL syntax and the check-edit-preview-render stopping rules.

Copy or link that folder into your agent's skills directory:

- **Claude Code:** copy `skills/schem/SKILL.md` to `.claude/skills/schem/SKILL.md` (for one project) or `~/.claude/skills/schem/SKILL.md` (for every project).
- **Cursor:** copy `skills/schem/SKILL.md` to `.cursor/skills/schem/SKILL.md` (or `~/.cursor/skills/schem/SKILL.md`).
- **Codex CLI:** copy `skills/schem/SKILL.md` to `.agents/skills/schem/SKILL.md` (for one project) or `~/.codex/skills/schem/SKILL.md` (for every project).

## What the package contains

The bundle `dist/schem.js`, the DejaVu Sans font it measures and outlines text with (with its licence), the docs (`dsl.md`, `netlist-format.md`, `parts.md`, `editing.md`, `templates.md` and `install.md`), the agent skill (`skills/schem/SKILL.md`) and the examples. Two dependencies are installed with it: `@resvg/resvg-js`, which turns the SVG into a PNG and comes with a prebuilt binary for your system, and `opentype.js`, which reads the font. `npm run pack:smoke` in the repo checks that a clean install draws exactly what the repo draws.
