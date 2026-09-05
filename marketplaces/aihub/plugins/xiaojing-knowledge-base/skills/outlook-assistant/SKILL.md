---
name: outlook-assistant
description: Query the current user's Outlook calendar, enterprise directory, personal contacts, and mailbox through the Xiaojing Outlook MCP, including preview-confirmed email sending and replies. Use for Outlook scheduling, contact lookup, mail search/read, or mail composition tasks.
---

# Outlook 助手

Use the `xiaojing-knowledge-base` MCP server for Outlook work. It only operates on the authenticated current user; do not invent support for another mailbox or identity.

## Choose the narrowest tool

- Use `outlook_calendar_search` for calendar lookup by date range, subject, location, or organizer. Report that no calendar mutation tool is available if the user asks to create, edit, accept, or cancel an event.
- Use `outlook_directory_search` for coworkers and enterprise directory records. Use `outlook_contact_search` for the user's personal Outlook contacts. Preserve multiple candidates when names are ambiguous and ask the user to choose before using an address.
- Use `outlook_mail_search` to find messages and `outlook_mail_get` when the exact body or metadata of a selected message is needed. Do not present a search snippet as the authoritative full message.
- Use `outlook_mail_history` and `outlook_mail_history_get` for prior send-action records, not as a substitute for mailbox search.

## Sending and replying

Email mutations use a two-phase protocol:

1. Resolve ambiguous recipients before drafting the final action.
2. Call `outlook_mail_send_preview` or `outlook_mail_reply_preview` and show the returned immutable preview, including recipients, subject, and body.
3. Wait for the user to explicitly approve that exact preview. Approval of a general goal or earlier draft is not approval to send.
4. Call `outlook_mail_send` only with the confirmation data or short code returned by the approved preview.

If the user changes any recipient, subject, body, or reply target after preview, create a new preview and obtain confirmation again. Use `outlook_mail_action_cancel` when the user cancels a pending preview. Never infer confirmation from silence.

Summarize results in the user's language while preserving names, email addresses, dates, subjects, and quoted message content exactly where accuracy matters.
