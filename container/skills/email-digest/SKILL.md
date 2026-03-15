---
name: email-digest
description: >
  Summarize recent emails and flag ones that need immediate attention. Use this
  skill whenever the user asks to check their inbox, summarize emails, get an
  email overview, or find out if there's anything urgent or important they need
  to respond to. Also trigger for phrases like "catch me up on my emails",
  "what emails do I have", "anything important in my inbox", "email summary",
  "what's in my inbox", or "do I have any urgent emails". Use this skill
  proactively any time the user wants a digest or overview of their email — even
  if they phrase it casually.
---

# Email Digest

Give the user a clear, useful summary of their recent emails — a general sense of what's going on in their inbox, followed by a focused list of emails that genuinely deserve their immediate attention.

## What to do

1. **Fetch recent emails** — Search Gmail for emails received in the last 24 hours. Use `after:` date filters in the search query. If fewer than 5 emails come back, extend the window to 48 hours and note that you did so.

2. **Read each email** — For each result, read enough to understand:
   - Who sent it and in what context (colleague, business contact, newsletter, automated system, etc.)
   - What it's about at a high level
   - Whether it requires action, a reply, or a decision from the user
   - Any urgency signals (see below)

3. **Write the summary** in two sections:

   **General Outlook** — Open with 1–2 sentences setting the overall tone (volume, general mix, anything notable or unusual). Then follow with a short bullet list (3–5 bullets) calling out the key highlights — the things that actually stand out in the inbox, whether that's an important cluster of emails, a financial alert, an upcoming event, or a notable absence of anything urgent. Think of the prose as the "vibe" and the bullets as the "headlines."

   **Needs Immediate Attention** — A focused list of emails that genuinely deserve the user's attention soon. For each item include: sender name, subject line, and 1–2 sentences explaining *why* it matters and what the user should do (if anything).

## Judging what needs immediate attention

Think of yourself as a thoughtful executive assistant who can tell the difference between noise and signal. An email belongs on this list if it meets one or more of these criteria — but use real judgment rather than keyword matching:

- **Explicit urgency**: Contains words like "urgent", "ASAP", "immediately", "time-sensitive" — but only when used meaningfully, not as filler in marketing copy
- **Action required**: The sender is asking the user to do something specific — reply, review, decide, approve, attend, or sign something
- **Deadline mentioned**: A specific date or time is called out by which something needs to happen
- **Important sender**: The email is from someone likely to matter to the user — a manager, close colleague, key client, or someone they communicate with frequently
- **General importance vibe**: Even without the above signals, some emails just *matter* — a genuine personal message, something affecting finances or plans, an important account or legal notice. Use context.

**The flip side — what NOT to include:** Be skeptical of emails that *look* urgent but probably aren't. Marketing emails using urgency language ("Last chance!", "Act now!"), routine automated notifications, newsletters, spam, and promotional content should not make the list — even if they contain trigger words. Ask yourself: would a reasonable, busy person actually need to act on this in the next few hours? If not, leave it off.

If nothing genuinely needs immediate attention, say so clearly — that's useful information and worth saying.

## Tone and format

Keep the summary concise and direct — this is a briefing, not a report. The General Outlook opens with a sentence or two of prose, then a short bullet list of key highlights. The Needs Immediate Attention section uses a simple list (sender and subject as a bolded header, then 1–2 sentences of explanation). No extra sections, no stats tables, no action checklists beyond those two parts. The user should be able to read the whole thing in under a minute.