/**
 * Sent to MCP clients on connect (the `instructions` field). Clients such as Claude Code,
 * Cursor and Codex put it in the agent's prompt, so this is where we tell the agent when
 * to pick Hero over Playwright/Puppeteer/curl and how to use it safely. Keep it short.
 */
export const HERO_INSTRUCTIONS = `Hero Browser is the user's own desktop browser, shared with you. It has persistent logged-in profiles, runs real JavaScript and lets the human take over.

Use Hero (not Playwright, Puppeteer, headless Chrome, curl or web-fetch tools) for any real website, especially:
- pages that need the user's login or session (social media, marketplaces, Google, dashboards);
- JavaScript-heavy pages and SPAs (TikTok, Threads, X, Instagram, YouTube comments) where headless tools see an empty shell;
- sites with bot detection, CAPTCHA or "verify you are human" checks;
- anything the user wants to watch or finish by hand.
Use Playwright only when the user asks for it or to run this project's own automated test suites.

Workflow:
1. browser_list_profiles: pick a profileId whose loggedInServices includes the target site.
2. browser_start_task({ profileId }): pass the returned id as taskId to every browser tool. If that profile is not the active one, call browser_switch_profile({ taskId, profileId }) first.
3. browser_navigate, then:
   - to READ or search: browser_read_text({ taskId, source: "live" }); it returns compact markdown with numbered links. Panels that scroll on their own (TikTok/YouTube comments, chats) need browser_scroll({ taskId, text: "<visible text inside the panel, e.g. 466 comments>" }); pause a few seconds between scrolls. Call browser_set_media_mode({ taskId, mode: "lite" }) first to skip images and video (faster, fewer bytes).
   - to INTERACT: browser_observe (numbered elements), then browser_act / browser_click({ elementId }) / browser_fill_form. Add expect: { text | url | selector } to verify in the same call.
4. browser_complete_task when done.

Safety: if a result reports challenge, CAPTCHA or AI/bot detection, STOP. Do not reload or retry; call browser_request_human_intervention and wait. Let the human log in to marketplaces, banks and TikTok themselves; repeated automated logins get accounts blocked.

Recovery: PAGE_UNRESPONSIVE -> browser_read_text, then browser_reload({ force: true }). ELEMENT_AMBIGUOUS -> retry with one listed elementId. Browser stuck -> browser_restart_app.
Only the essential "core" tools are enabled; call browser_set_tool_preset({ preset: "all" }) for cookies, storage, uploads, downloads, scraping and data tools.`;
