# Use of Artificial Intelligence

**The idea is ours.** It came from our team member's proposal (milpa rotation planning over WhatsApp for the Dry Corridor) before any AI tool was used.

**AI coding assistants.** We used Claude Code (Anthropic) as a coding assistant to speed up writing and testing the Go backend, the Vue web app, tests, deployment files and the English drafts of these texts. The team defined the scope, the data choices, the scientific method (FAO-56, FAO-33, Monte Carlo, CMIP6 deltas) and reviewed the output. Generated code is declared here as the rules require.

**AI in the product.**
1. **"AI vs statistics" model**: a small, transparent machine-learning model trained on NASA features, compared with plain Monte Carlo frequencies, with cross-validated error shown to the user. This is the comparison the challenge asks for.
2. **Optional LLM** (off by default, behind a flag): only to understand free-text messages and to phrase replies **using the numbers computed by the deterministic engine**. No number, threshold or recommendation is produced by an LLM. The bot works end to end without it.

3. **Farm assistant (round 5)**: a chat on the dashboard, inside the 3D simulator and on WhatsApp. It runs Claude Code in headless mode (`claude -p`, Anthropic) with a single MCP server of ours. Its only tools are the engine's (plan, simulate a date range, today's irrigation, record a farmer report, pests, open a simulation, change the sowing date, show a map layer, list the user's fields), plus web search to cite sources. File, shell and editing tools are disabled. **Every number in its answers comes from the deterministic engine**; it only chooses the tool and phrases the reply, citing sources. If it is unavailable, a rule-based fallback answers. For production we document the Anthropic API with a project key.

**Images, audio and video.** ⟦TBD: "No AI-generated images, audio or video were used." or list them; every AI-generated image or video carries a visible watermark⟧. No NASA logos appear in AI-generated content.
