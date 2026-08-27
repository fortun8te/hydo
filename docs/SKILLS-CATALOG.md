# Skills / MCP catalog (this machine)

Module: `electron/skills-catalog.cjs`. Read-only discovery of Claude Code, Codex, and Hermes skills and MCP servers. Not wired into `main.cjs` / `preload.cjs` / `hermes-plugins.cjs` (those files are owned by another agent).

Ran: `node -e "console.log(JSON.stringify(require('./electron/skills-catalog.cjs').catalog(), null, 1))"` — no throw.

## Counts (2026-08-26, this host)

| Source | Skills | MCP servers in config |
|--------|--------|------------------------|
| claude | 86 (42 under `~/.claude/skills`, 44 plugin `SKILL.md`) | 5 rows (3 in `~/.claude.json`, 2 in `~/.claude/mcp.json`; `pencil` appears in both) |
| codex | 23 (22 `SKILL.md` + 1 prompt) | 13 in `~/.codex/config.toml` |
| hermes | 250 (51 user + 82 bundled + 117 optional) | 1 configured (`chrome-devtools`). 65 optional-mcp *manifests* are not live servers |
| **total catalog()** | **359 skills** | **19 server rows** |

`optional-mcps` count is a `sources` entry only; those names are not appended to `servers`.

## Paths probed

| Path | Existed |
|------|---------|
| `/Users/michael/.claude/skills` | yes (42 `SKILL.md`, including nested + symlink targets) |
| `/Users/michael/.claude/plugins` | yes |
| `/Users/michael/.claude/plugins/installed_plugins.json` | yes |
| `/Users/michael/.claude.json` | yes — **MCP live map** (`mcpServers`: pencil, open-computer, cua) |
| `/Users/michael/.claude/mcp.json` | yes — `mcpServers`: pencil, chatgpt-unlimited |
| `/Users/michael/.claude/settings.json` | yes — **no `mcpServers` key** (permissions/hooks/plugins only) |
| `/Users/michael/.claude/settings.local.json` | yes — not parsed (permissions allow-list only) |
| `/Users/michael/.codex/config.toml` | yes |
| `/Users/michael/.codex/skills` | yes |
| `/Users/michael/.codex/prompts` | yes (`loop.md`) |
| `/Users/michael/.hermes/skills` | yes |
| `/Users/michael/.hermes/hermes-agent/skills` | yes |
| `/Users/michael/.hermes/hermes-agent/optional-skills` | yes |
| `/Users/michael/.hermes/hermes-agent/optional-mcps` | yes |
| `/Users/michael/.hermes/config.yaml` | yes |
| `/Users/michael/Projects/hydo/optional-skills` | **no** |
| `/Users/michael/Projects/hydo/optional-mcps` | **no** |

Not scanned as skill roots: `~/.claude/skills-archive`, `~/.claude/skills-backup`, Codex plugin cache (`~/.codex/plugins/cache/...` has extra template `SKILL.md`; those plugins are not enumerated as Hydo skills).

Plugin install paths that live under `/Users/mk/...` (figma, superpowers, double-shot-latte, claude-session-driver) were still readable on this machine; shopify + warp use `/Users/michael/.claude/plugins/cache/...`.

## Frontmatter / config shapes actually seen

**Claude / Codex / many Hermes `SKILL.md`:**

```
---
name: caveman
description: Activates direct, no-ceremony ...
---
```

Single-line `key: value`. Descriptions are often long unquoted strings on one line. Quoted descriptions also occur (`description: "Manage Apple Notes..."`).

**Hermes bundled extras** (e.g. `~/.hermes/hermes-agent/skills/apple/apple-notes/SKILL.md`): `version`, `author`, `license`, `platforms: [macos]`, nested `metadata:` / `prerequisites:` maps. The hand-rolled reader keeps only unindented `key: value` (`name`, `description`, `version`, `author`, `license`). Nested YAML is ignored.

**Claude MCP (`~/.claude.json`):**

```json
"mcpServers": {
  "pencil": { "command": "...", "args": ["--app", "desktop"], "env": {}, "type": "stdio" }
}
```

**Claude `~/.claude/mcp.json`:** same shape with `"transport": "stdio"`.

**Codex `config.toml`:**

```
[mcp_servers.pencil]
command = "..."
args = ["--app", "desktop"]

[mcp_servers.parallel-search]
url = "https://search.parallel.ai/mcp"

[mcp_servers.searxng.env]
...
```

`url` ⇒ `transport: "http"`, `command` set to the URL string. `[mcp_servers.*.env]` tables are skipped (no env values in output).

**Hermes `config.yaml`:**

```yaml
mcp_servers:
  chrome-devtools:
    command: npx
    args:
      - -y
      - chrome-devtools-mcp@latest
      ...
    enabled: true
```

**Hermes optional MCP manifest** (`optional-mcps/linear/manifest.yaml`): `name`, `description`, `transport.type` / `url`, `auth.type` — catalogued as a source *count of directories*, not as configured servers.

**Plugin skills:** `installed_plugins.json` key `superpowers@superpowers-marketplace` → namespace `superpowers:using-superpowers`.

## Redaction

Dropped from catalog output: any config key matching `env`, `headers`, `api_key` / `api-key`, `token`, `secret`, `password`, `authorization`, `bearer`, `credentials`. MCP `env` maps are never copied. Server records expose `id`, `name`, `transport`, `command` (command + args, or URL), `source`, `configPath` only.

`~/.hermes/.env` and `~/.codex/auth.json` are not read.

## Can a Hermes session use a Claude Code skill?

**Not automatically. Skills are per-tool runtime, not a shared Hydo capability bus. This catalog is informational unless something extra is configured.**

Evidence from Hermes source on this machine:

- Hermes loads skills from `~/.hermes/skills/` plus `skills.external_dirs` in `config.yaml` (`agent/skill_utils.py` `get_all_skills_dirs`, `agent/prompt_builder.py` ~1754–1757). On this host `skills.external_dirs: []`.
- Session access is the `skills` toolset: `skills_list` / `skill_view` / `skill_manage` (`model_tools.py` `skills_tools`). Claude Code uses its own `Skill` tool and `~/.claude/skills` + plugins.
- Same on-disk shape (`SKILL.md` + YAML `name`/`description`) is necessary but not sufficient. Hermes authoring rules require tools named in prose to be **native Hermes tools or declared MCP servers** (`AGENTS.md` skill standards item 2). Claude skills that say `Skill` / `Read` / `Bash` will not bind to Hermes tools.
- Hermes *can* see extra trees if you add e.g. `~/.claude/skills` to `skills.external_dirs`, or symlink into `~/.hermes/skills` (several Hermes entries here already symlink to `~/.agents/skills/...`, which Claude also uses). That is an explicit config/fs choice, not what Hydo does today.
- Optional bundled skills are inactive until `hermes skills install official/...`. Listing them in this catalog does not enable them.

MCP servers are likewise per-config: Claude `mcpServers`, Codex `[mcp_servers.*]`, Hermes `mcp_servers` in `config.yaml`. Same binary (pencil, cua, open-computer) may be listed in more than one tool; Hydo bots only get what Hermes has configured (`chrome-devtools` here) unless another agent copies entries into Hermes.

## API

```
listSkills()  → { skills: [{ id, name, description, source, path, namespace }] }
listServers() → { servers: [{ id, name, transport, command, source, configPath }] }
catalog()     → { skills, servers, sources: [{ source, path, found, count }] }
refresh()     → rebuild in-memory cache, return catalog()
```

`source` is `"claude" | "codex" | "hermes"`. Missing dirs / unreadable files / bad JSON/TOML/YAML → `found: false` or empty list, never throw.
