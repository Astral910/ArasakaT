# Use of Artificial Intelligence

**The idea is ours.** It came from our team member's proposal (milpa rotation planning over WhatsApp for the Dry Corridor) before any AI tool was used.

**AI coding assistants.** We used Claude Code (Anthropic) as a coding assistant to speed up writing and testing the Go backend, the Vue web app, tests, deployment files and the English drafts of these texts. The team defined the scope, the data choices, the scientific method (FAO-56, FAO-33, Monte Carlo, CMIP6 deltas) and reviewed the output. Generated code is declared here as the rules require.

**AI in the product.**
1. **"AI vs statistics" model**: a small, transparent machine-learning model trained on NASA features, compared with plain Monte Carlo frequencies, with cross-validated error shown to the user. This is the comparison the challenge asks for.
2. **Optional LLM** (off by default, behind a flag): only to understand free-text messages and to phrase replies **using the numbers computed by the deterministic engine**. No number, threshold or recommendation is produced by an LLM. The bot works end to end without it.

**Images, audio and video.** ⟦TBD: "No AI-generated images, audio or video were used." or list them; every AI-generated image or video carries a visible watermark⟧. No NASA logos appear in AI-generated content.
