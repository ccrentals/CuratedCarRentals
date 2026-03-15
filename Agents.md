# Project rules for Codex (read before editing)

## Project
Curated Car Rentals website (Next.js App Router + TypeScript + Tailwind).
Local dev: `npm run dev` → http://localhost:3000

## Goal (current phase)
Build the FRONTEND template first (no backend/DB integration yet).
We are creating a professional car rental site skeleton similar to curatedcarrentals.com, then enhancing it.

## Workflow rules (very important)
- Work in small, logical steps.
- Make changes in small batches, usually 2–4 files per batch unless a task clearly requires more to stay coherent.
- All deploys must go through GitHub: commit the changes, push to GitHub, and only then deploy. Do not deploy directly from an unpushed local workspace unless I explicitly request that.
- After each batch:
  1) Summarize what changed
  2) Tell me exactly how to verify in the browser
- Ensure all steps in the requested task are completed, then review the work once finished to confirm every task item is done.

## Default operating behavior
- Do not jump straight into implementation.
- Even if my prompt is casual, short, or unstructured, first convert it into a structured execution workflow.
- Choose the correct mode automatically:
  - **Standard execution mode** for normal coding tasks, bug fixes, UI work, refactors, tests, and file updates
  - **Guidance-first mode** for tasks about standards, workflows, governance, architecture rules, coding conventions, prompting rules, repository instructions, security rules, or agent behavior
- If the task is guidance-first:
  1) identify the governing source, rule set, or referenced guidance
  2) extract the actionable rules
  3) then proceed with the structured plan and implementation
- If uncertain between standard execution and guidance-first, prefer guidance-first for behavior/rules tasks and standard execution for implementation tasks.

## Required pre-execution output
Before making changes, always output these sections in this exact order:
1. Objective
2. Assumptions
3. Files likely to change
4. Step-by-step plan
5. Verification plan
6. Risks / notes

- Keep this concise but complete.
- After outputting the plan, proceed unless blocked by a real dependency, missing credential, missing file, unavailable environment requirement, or a truly unsafe ambiguity.

## Do
- Keep changes minimal and consistent with existing styling.
- Use Tailwind (already configured).
- Prefer Server Components unless interactivity is required (then use `"use client"`).
- Use clean, readable code and simple component structure.
- Keep routes/pages inside `src/app/*`.

## Don’t
- Don’t add new libraries/packages unless I explicitly ask.
- Don’t change build config (Next/Netlify) unless absolutely required.
- Don’t touch Prisma/DB/migrations in this phase.
- Don’t remove existing pages/sections unless requested.
- Don’t make unrelated edits outside the requested scope.
- Don’t claim success without verification evidence.
- Don’t invent new scripts or workflows unless I explicitly request them.

## File and change discipline
- Be explicit about which files are being created or modified.
- Make the smallest effective change set.
- Preserve the existing architecture and conventions unless I explicitly request a redesign or refactor.
- Prefer targeted updates over broad rewrites unless a broad rewrite is clearly required.
- Prefer full completion of the requested task over partial scaffolding.
- If code is changed, provide the exact files changed and what was done in each.
- Unrelated files must not be modified without a clear reason.

## Frontend scope for this phase
Create/maintain these files:
- `src/lib/utils.ts`
- `src/data/{vehicles.ts, services.ts, content.ts}`
- `src/components/ui/Button.tsx`
- `src/components/site/{Container.tsx, Header.tsx, Footer.tsx}`
- `src/components/sections/{SectionHeading.tsx, VehicleCard.tsx}`
- Pages:
  - `src/app/page.tsx` (Home)
  - `src/app/fleet/page.tsx`
  - `src/app/book/page.tsx` (template booking UI showing deposit + balance)
  - `src/app/services/page.tsx`
  - `src/app/tourist-destinations/page.tsx`
  - `src/app/about/page.tsx`
  - `src/app/contact/page.tsx`
- Update `src/app/layout.tsx` to include Header + Footer.

## Booking/payment note
- UI is template-only.
- Deposit is shown as “due now”, balance as “due on pickup”.
- Do not implement real payment yet.

## Definition of done (for each batch)
- No TypeScript errors.
- `npm run dev` runs successfully.
- You clearly state what pages to open to verify (e.g., `/fleet`, `/book`).

## Command, approval, and failure-handling rules
- Before running commands, choose the smallest reasonable command set needed to verify the task.
- Prefer project-standard commands only. In this repo, use available commands such as:
  - `npm run dev`
  - `npm run build`
  - `npm run lint`
  - project test commands if already configured
- Respect sandbox and approval boundaries:
  - proceed automatically for safe reads, targeted file edits, and routine local verification
  - ask only when a command requires elevated approval, external network access, secret input, destructive action, or writes outside the intended workspace
- If a command cannot be run because of environment, permissions, missing dependencies, or sandbox restrictions, explicitly state:
  1) what was attempted
  2) why it could not be completed
  3) the safest next best verification performed instead
- If implementation or verification fails:
  1) identify the failure clearly
  2) fix the issue if it is within the requested scope
  3) re-run the relevant verification
  4) repeat until the task passes or a real blocker remains
- Do not stop at the first failure without explaining the cause and next action.

## Verification rules
Before declaring completion:
- verify that the implementation matches the request
- run relevant checks/tests/lint/build where feasible
- confirm whether the task is fully complete or partially complete
- clearly state any risks, limitations, skipped items, or follow-up items
- if tests/checks cannot be run, explicitly state why

## Acceptance checklist
For each task, confirm all of the following before declaring completion:
- requested changes are implemented
- unrelated files were not modified without reason
- relevant pages/components still render
- TypeScript/build/lint/test checks were run where feasible
- manual browser verification steps are provided
- risks, limitations, or unverified areas are clearly stated

## PROCESS RULE (MANDATORY WORKFLOW)
- Implement tasks in order.
- After implementation, explicitly review against the Acceptance Checklist.
- If any task was skipped or incomplete:
   - complete skipped task(s)
   - run the checklist again
- Repeat until all checklist items pass.
- Provide final summary:
   - files changed
   - migrations added
   - how to test manually (step-by-step)

## Response format after execution
After each implementation batch, return:
1. What I changed
2. Why I changed it
3. Files changed
4. Verification performed
5. How to test manually
6. Remaining risks / follow-ups

## Communication style
- Be concise, practical, and action-oriented.
- Provide short progress updates during longer tasks.
- Avoid unnecessary verbosity.
- Do not ask unnecessary clarifying questions when a reasonable path exists.

## Skills
A skill is a set of local instructions to follow that is stored in a `SKILL.md` file. Below is the list of skills that can be used. Each entry includes a name, description, and file path so you can open the source for full instructions when using a specific skill.
### Available skills
- cloudflare-deploy: Deploy applications and infrastructure to Cloudflare using Workers, Pages, and related platform services. Use when the user asks to deploy, host, publish, or set up a project on Cloudflare. (file: /Users/damianthompson/.codex/skills/cloudflare-deploy/SKILL.md)
- figma: Use the Figma MCP server to fetch design context, screenshots, variables, and assets from Figma, and to translate Figma nodes into production code. Trigger when a task involves Figma URLs, node IDs, design-to-code implementation, or Figma MCP setup and troubleshooting. (file: /Users/damianthompson/.codex/skills/figma/SKILL.md)
- figma-implement-design: Translate Figma nodes into production-ready code with 1:1 visual fidelity using the Figma MCP workflow (design context, screenshots, assets, and project-convention translation). Trigger when the user provides Figma URLs or node IDs, or asks to implement designs or components that must match Figma specs. Requires a working Figma MCP server connection. (file: /Users/damianthompson/.codex/skills/figma-implement-design/SKILL.md)
- gh-fix-ci: Use when a user asks to debug or fix failing GitHub PR checks that run in GitHub Actions; use `gh` to inspect checks and logs, summarize failure context, draft a fix plan, and implement only after explicit approval. Treat external providers (for example Buildkite) as out of scope and report only the details URL. (file: /Users/damianthompson/.codex/skills/gh-fix-ci/SKILL.md)
- linear: Manage issues, projects & team workflows in Linear. Use when the user wants to read, create or updates tickets in Linear. (file: /Users/damianthompson/.codex/skills/linear/SKILL.md)
- netlify-deploy: Deploy web projects to Netlify using the Netlify CLI (`npx netlify`). Use when the user asks to deploy, host, publish, or link a site/repo on Netlify, including preview and production deploys. (file: /Users/damianthompson/.codex/skills/netlify-deploy/SKILL.md)
- openai-docs: Use when the user asks how to build with OpenAI products or APIs and needs up-to-date official documentation with citations (for example: Codex, Responses API, Chat Completions, Apps SDK, Agents SDK, Realtime, model capabilities or limits); prioritize OpenAI docs MCP tools and restrict any fallback browsing to official OpenAI domains. (file: /Users/damianthompson/.codex/skills/openai-docs/SKILL.md)
- pdf: Use when tasks involve reading, creating, or reviewing PDF files where rendering and layout matter; prefer visual checks by rendering pages (Poppler) and use Python tools such as `reportlab`, `pdfplumber`, and `pypdf` for generation and extraction. (file: /Users/damianthompson/.codex/skills/pdf/SKILL.md)
- playwright: Use when the task requires automating a real browser from the terminal (navigation, form filling, snapshots, screenshots, data extraction, UI-flow debugging) via `playwright-cli` or the bundled wrapper script. (file: /Users/damianthompson/.codex/skills/playwright/SKILL.md)
- safe-refactor-deadcode-ccr: Safe refactoring and dead-code cleanup for the Curated Car Rentals repo (Next.js App Router + TypeScript + Tailwind + Netlify + Postgres/pg + WiPay/Resend/PDFMonkey). Use when the user asks to refactor/rename/extract/cleanup without behavior, UI, route, API, auth, payment, or schema changes; or to remove unused code. Require proof (rg + build + tests) before deleting anything; quarantine anything uncertain. Follow the repo's Agents.md workflow rules (small batches, verify in browser, stop). (file: /Users/damianthompson/.codex/skills/safe-refactor-deadcode-ccr/SKILL.md)
- screenshot: Use when the user explicitly asks for a desktop or system screenshot (full screen, specific app or window, or a pixel region), or when tool-specific capture capabilities are unavailable and an OS-level capture is needed. (file: /Users/damianthompson/.codex/skills/screenshot/SKILL.md)
- security-best-practices: Perform language and framework specific security best-practice reviews and suggest improvements. Trigger only when the user explicitly requests security best practices guidance, a security review/report, or secure-by-default coding help. Trigger only for supported languages (python, javascript/typescript, go). Do not trigger for general code review, debugging, or non-security tasks. (file: /Users/damianthompson/.codex/skills/security-best-practices/SKILL.md)
- security-ownership-map: Analyze git repositories to build a security ownership topology (people-to-file), compute bus factor and sensitive-code ownership, and export CSV/JSON for graph databases and visualization. Trigger only when the user explicitly wants a security-oriented ownership or bus-factor analysis grounded in git history (for example: orphaned sensitive code, security maintainers, CODEOWNERS reality checks for risk, sensitive hotspots, or ownership clusters). Do not trigger for general maintainer lists or non-security ownership questions. (file: /Users/damianthompson/.codex/skills/security-ownership-map/SKILL.md)
- security-threat-model: Repository-grounded threat modeling that enumerates trust boundaries, assets, attacker capabilities, abuse paths, and mitigations, and writes a concise Markdown threat model. Trigger only when the user explicitly asks to threat model a codebase or path, enumerate threats/abuse paths, or perform AppSec threat modeling. Do not trigger for general architecture summaries, code review, or non-security design work. (file: /Users/damianthompson/.codex/skills/security-threat-model/SKILL.md)
- skill-creator: Guide for creating effective skills. This skill should be used when users want to create a new skill (or update an existing skill) that extends Codex's capabilities with specialized knowledge, workflows, or tool integrations. (file: /Users/damianthompson/.codex/skills/.system/skill-creator/SKILL.md)
- skill-installer: Install Codex skills into $CODEX_HOME/skills from a curated list or a GitHub repo path. Use when a user asks to list installable skills, install a curated skill, or install a skill from another repo (including private repos). (file: /Users/damianthompson/.codex/skills/.system/skill-installer/SKILL.md)
### How to use skills
- Discovery: The list above is the skills available in this session (name + description + file path). Skill bodies live on disk at the listed paths.
- Trigger rules: If the user names a skill (with `$SkillName` or plain text) OR the task clearly matches a skill's description shown above, you must use that skill for that turn. Multiple mentions mean use them all. Do not carry skills across turns unless re-mentioned.
- Missing/blocked: If a named skill isn't in the list or the path can't be read, say so briefly and continue with the best fallback.
- How to use a skill (progressive disclosure):
  1) After deciding to use a skill, open its `SKILL.md`. Read only enough to follow the workflow.
  2) When `SKILL.md` references relative paths (e.g., `scripts/foo.py`), resolve them relative to the skill directory listed above first, and only consider other paths if needed.
  3) If `SKILL.md` points to extra folders such as `references/`, load only the specific files needed for the request; don't bulk-load everything.
  4) If `scripts/` exist, prefer running or patching them instead of retyping large code blocks.
  5) If `assets/` or templates exist, reuse them instead of recreating from scratch.
- Coordination and sequencing:
  - If multiple skills apply, choose the minimal set that covers the request and state the order you'll use them.
  - Announce which skill(s) you're using and why (one short line). If you skip an obvious skill, say why.
- Context hygiene:
  - Keep context small: summarize long sections instead of pasting them; only load extra files when needed.
  - Avoid deep reference-chasing: prefer opening only files directly linked from `SKILL.md` unless you're blocked.
  - When variants exist (frameworks, providers, domains), pick only the relevant reference file(s) and note that choice.
- Safety and fallback: If a skill can't be applied cleanly (missing files, unclear instructions), state the issue, pick the next-best approach, and continue.
