---
name: office-workflows
description: Process office materials and stage HTML, Word, or Excel results through Whale's office artifact tool.
---

# Office workflows

When the user starts a Whale office task, use the supplied extracted material and attached files as sources.

1. Follow the requested task type and output format.
2. State material limitations instead of inventing missing facts.
3. For HTML and DOCX, put the complete human-readable draft in `content`.
4. For XLSX, provide stable `columns` and object `rows`; also summarize the table in `content`.
5. Finish by calling `whale_office_stage_artifact` exactly once. This call creates a preview only. Never claim that a file was saved until the user confirms generation in the result card.
