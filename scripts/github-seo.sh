#!/usr/bin/env bash
# github-seo.sh
#
# Sets discoverability metadata (description + topics) on every public,
# non-fork, non-archived repo owned by github.com/fortun8te.
#
# Requires: `gh auth login` first (this environment's own `gh` token is
# read-only and will return HTTP 401 on writes).
#
# Safe to re-run: --add-topic is idempotent, and --description simply
# overwrites with the same text if already set.
#
# Skipped: F24display (fork of a Discord-RPC-for-Blender addon; not owned
# original work). No archived repos were found under fortun8te.

set -euo pipefail

# ad-decompiler-v2: Python pipeline that turns a flat image into a
# duplicate-free, editable Figma-native scene graph (OCR ensemble, SAM 3
# segmentation, vector/native/raster routing, recursive Figma compiler).
gh repo edit fortun8te/ad-decompiler-v2 \
  --description "Python pipeline that converts a flat image (ad, screenshot, poster) into a duplicate-free, editable Figma-native scene graph using OCR, SAM 3 segmentation, and a recursive Figma compiler." \
  --add-topic image-to-figma \
  --add-topic figma-api \
  --add-topic ocr \
  --add-topic segment-anything \
  --add-topic computer-vision \
  --add-topic python \
  --add-topic design-automation \
  --add-topic scene-graph

# blender-remote-gpu: Python/Blender addon that offloads rendering from a
# Mac to a remote Windows GPU over Tailscale via a WebSocket protocol.
gh repo edit fortun8te/blender-remote-gpu \
  --description "Blender addon and Python WebSocket server that renders Blender scenes on a remote Windows GPU over Tailscale while you work in Blender on a Mac." \
  --add-topic blender \
  --add-topic blender-addon \
  --add-topic gpu-rendering \
  --add-topic remote-rendering \
  --add-topic tailscale \
  --add-topic websocket \
  --add-topic python \
  --add-topic macos

# claude-creative-skills: 3-skill bundle for Claude Code covering research,
# brainstorming, and plan execution for creative-strategy work.
gh repo edit fortun8te/claude-creative-skills \
  --description "Three-skill bundle for Claude Code (deepresearch, brainstorming, executeplan) that takes creative-strategy work from research through a spec to a shipped, subagent-executed plan." \
  --add-topic claude-code \
  --add-topic claude-code-skill \
  --add-topic agent-skills \
  --add-topic anthropic \
  --add-topic ai-agents \
  --add-topic creative-strategy \
  --add-topic prompt-engineering

# codex-reset-tracker: GitHub Actions cron job that watches specific X/Twitter
# accounts via Nitter RSS and pings Telegram when OpenAI usage limits reset.
gh repo edit fortun8te/codex-reset-tracker \
  --description "GitHub Actions cron job that watches specific X/Twitter accounts via Nitter RSS for OpenAI Codex usage-limit reset announcements and alerts a Telegram chat, using a free OpenRouter model as a keyword-triggered judge." \
  --add-topic github-actions \
  --add-topic telegram-bot \
  --add-topic openai \
  --add-topic codex \
  --add-topic rss \
  --add-topic openrouter \
  --add-topic python \
  --add-topic automation

# island: Three.js browser simulation of a tropical island with autonomous
# AI survival agents and an ML-ready API for training RL models.
gh repo edit fortun8te/island \
  --description "Three.js browser simulation of a 3D tropical island with autonomous AI survival agents, resource management, and an ML-ready API intended for training reinforcement-learning models." \
  --add-topic threejs \
  --add-topic javascript \
  --add-topic simulation \
  --add-topic reinforcement-learning \
  --add-topic ai-agents \
  --add-topic webgl \
  --add-topic game-simulation

# lean-sonnet: Claude Code skill that trims Claude Sonnet 5's token usage
# and tool-call overhead on everyday agentic tasks.
gh repo edit fortun8te/lean-sonnet \
  --description "Claude Code skill that reduces Claude Sonnet 5's token usage and tool-call overhead by steering it toward the cheapest correct path: less rereading, fewer unnecessary subagents, less unrequested scope." \
  --add-topic claude-code \
  --add-topic claude-code-skill \
  --add-topic agent-skills \
  --add-topic anthropic \
  --add-topic claude-sonnet \
  --add-topic llm-cost-optimization \
  --add-topic token-optimization

# neuro: TypeScript agentic framework for autonomous research, ad-creative
# generation, and multi-agent orchestration; requires remote Docker infra
# (SearXNG, Ollama, Wayfarer) rather than running fully locally.
gh repo edit fortun8te/neuro \
  --description "TypeScript agentic framework for autonomous multi-phase web research, AI ad-creative generation, and multi-agent orchestration, built on Claude's extended thinking and designed to run against remote SearXNG/Ollama/Wayfarer infrastructure." \
  --add-topic ai-agents \
  --add-topic multi-agent-systems \
  --add-topic typescript \
  --add-topic research-agent \
  --add-topic creative-automation \
  --add-topic ollama \
  --add-topic searxng \
  --add-topic orchestration

# nichemaxx: Claude Code skill encoding a dark-literary/"cleanboy" TikTok
# creative-direction sensibility as reference material for a running agent.
gh repo edit fortun8te/nichemaxx \
  --description "Claude Code skill that encodes a dark-literary, cleanboy TikTok/mashcut creative-direction sensibility as reference material, for finding visual and tonal references during content creation." \
  --add-topic claude-code \
  --add-topic claude-code-skill \
  --add-topic agent-skills \
  --add-topic anthropic \
  --add-topic tiktok \
  --add-topic creative-direction \
  --add-topic content-creation

# ocodex: Python launcher/CLI that runs cheap parallel Codex/Claude worker
# agents (Muse Spark / OpenRouter) supervised by one paid model that audits
# every claim, retries dead workers, and keeps a crash-checkpointed ledger.
gh repo edit fortun8te/ocodex \
  --description "Python CLI that fans out cheap, capacity-capped parallel coding-agent workers (Muse Spark, with OpenRouter as fallback) for decomposable tasks, with one paid supervisor model auditing every claim, retrying crashed workers from checkpoints, and a machine-readable run ledger." \
  --add-topic ai-agents \
  --add-topic multi-agent-systems \
  --add-topic python \
  --add-topic cli \
  --add-topic openrouter \
  --add-topic agent-orchestration \
  --add-topic llm-automation \
  --add-topic codex

# RACKS: TypeScript CLI multi-agent deep-research system that decomposes
# a question, runs parallel research agents across web/YouTube/docs, and
# synthesizes a markdown report.
gh repo edit fortun8te/RACKS \
  --description "TypeScript CLI multi-agent research system that decomposes a research question into sub-questions, runs parallel research agents across web pages, YouTube, and documentation, and synthesizes a markdown report with coverage and confidence-based termination." \
  --add-topic deep-research \
  --add-topic ai-agents \
  --add-topic multi-agent-systems \
  --add-topic typescript \
  --add-topic cli \
  --add-topic research-automation \
  --add-topic llm

# rick: Claude Code skill that acts as a reflective "mirror" prompt/persona
# rather than a critique tool.
gh repo edit fortun8te/rick \
  --description "Claude Code skill that acts as a reflective mirror rather than a critic, prompting the user with a single question or observation instead of feedback or a review." \
  --add-topic claude-code \
  --add-topic claude-code-skill \
  --add-topic agent-skills \
  --add-topic anthropic \
  --add-topic reflection \
  --add-topic prompt-engineering

# SCOUT: Python bot that aggregates AI/ML news (HackerNews, ArXiv, Reddit,
# Bluesky, NewsAPI) and sends filtered Telegram digests, running on Claude
# Code Routines with no dedicated server.
gh repo edit fortun8te/SCOUT \
  --description "Python bot that aggregates AI/ML news from HackerNews, ArXiv, Reddit, Bluesky, and NewsAPI, filters and deduplicates it, and sends formatted Telegram digests, running serverless on Claude Code Routines." \
  --add-topic telegram-bot \
  --add-topic news-aggregator \
  --add-topic python \
  --add-topic ai-news \
  --add-topic automation \
  --add-topic claude-code \
  --add-topic rss

# simpletics-imagegen: Chrome extension that batch-drives image generation
# in the user's own logged-in ChatGPT tab to produce named ad-static image
# assets under a normal ChatGPT subscription quota.
gh repo edit fortun8te/simpletics-imagegen \
  --description "Chrome extension side panel that batch-generates static ad-creative images by driving the user's own logged-in ChatGPT tab, so images render under the normal ChatGPT subscription quota and auto-download under their configured file names." \
  --add-topic chrome-extension \
  --add-topic javascript \
  --add-topic chatgpt \
  --add-topic ad-creative \
  --add-topic image-generation \
  --add-topic browser-automation \
  --add-topic marketing-automation

# sky-computer-use: TypeScript MCP server giving Codex local, Ollama-backed
# vision computer-use tools (screenshot, pixel clicks, clipboard, browser).
gh repo edit fortun8te/sky-computer-use \
  --description "TypeScript MCP server that gives Codex vision-powered local computer-use tools — screenshot capture, pixel-coordinate clicks, keyboard/clipboard control, and browser actions — backed entirely by a local Ollama vision model, as a drop-in alongside or replacement for open-computer-use." \
  --add-topic mcp-server \
  --add-topic codex \
  --add-topic computer-use \
  --add-topic ollama \
  --add-topic typescript \
  --add-topic vision-ai \
  --add-topic automation

# sticky: Swift/.NET native app pair implementing a local-first Mac<->Windows
# file/clipboard transfer gateway via the macOS notch, with no cloud relay.
gh repo edit fortun8te/sticky \
  --description "Local-first Mac to Windows file and clipboard transfer app with a native macOS notch drop target, a separate multi-clipboard history, and LAN-only discovery, pairing, and transfer with no cloud relay or telemetry." \
  --add-topic macos \
  --add-topic swift \
  --add-topic windows \
  --add-topic clipboard-manager \
  --add-topic file-transfer \
  --add-topic menu-bar-app \
  --add-topic notch \
  --add-topic dotnet

# voice: Swift macOS menu bar app for fully on-device dictation (Parakeet
# ASR + Qwen3 polish via MLX), positioned against cloud dictation tools.
gh repo edit fortun8te/voice \
  --description "macOS menu bar app for offline push-to-talk dictation, running on-device speech recognition (Parakeet) and on-device text polish (Qwen3 via MLX on Apple Silicon) with no cloud transcription and no telemetry." \
  --add-topic macos \
  --add-topic swift \
  --add-topic speech-to-text \
  --add-topic dictation \
  --add-topic on-device-ai \
  --add-topic mlx \
  --add-topic menu-bar-app \
  --add-topic privacy

# xdr: Swift macOS menu bar app for real-time brightness control on HDR
# displays (e.g. Pro Display XDR) via display gamma tables.
gh repo edit fortun8te/xdr \
  --description "macOS menu bar app that adjusts HDR display brightness in real time via display gamma tables, for displays like the Pro Display XDR where the system brightness controls are not fine-grained enough." \
  --add-topic macos \
  --add-topic swift \
  --add-topic menu-bar-app \
  --add-topic hdr \
  --add-topic pro-display-xdr \
  --add-topic display-calibration \
  --add-topic swiftui

# hydo: JavaScript/Electron open-source desktop app running a roster of
# named, persistent AI teammates (Hermes Agent) locally or against any
# OpenAI-compatible endpoint, as an alternative to Grok Bot's desktop client.
gh repo edit fortun8te/hydo \
  --description "Open-source Electron desktop app for running a roster of named, persistent AI teammates on your own machine via Hermes Agent, with per-teammate memory, workspaces, and model choice (Grok or any OpenAI-compatible endpoint) — an alternative to Grok Bot's desktop client." \
  --add-topic ai-agents \
  --add-topic desktop-app \
  --add-topic electron \
  --add-topic grok \
  --add-topic grok-bot \
  --add-topic local-llm \
  --add-topic multi-agent
