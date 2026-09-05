---
name: office-workflows
description: Process office materials and stage HTML, Word, Excel, or PowerPoint results through Whale's office artifact tool.
---

# Office workflows

When the user starts a Whale office task, use the supplied extracted material and attached files as sources.

1. Follow the requested task type and output format.
2. State material limitations instead of inventing missing facts.
3. For HTML and DOCX, put the complete human-readable draft in `content`.
4. For XLSX, provide `sheets`, an ordered list of every requested worksheet, each with non-empty stable `columns`, a concise unique `sheetName`, and non-empty `rows`. Do not also send top-level columns/rows. Never claim more worksheets than the actual sheets array contains. Rows may be objects whose keys exactly match `columns`, or arrays whose values exactly align with `columns`; do not omit or add cells. Also summarize the table in `content`.
5. For DOCX output, put the document body in `content` as clean Markdown or semantic HTML. Do not mix Markdown markers into HTML tags.
6. For HTML output, put a complete semantic HTML document or fragment in `content`; it will be rendered as a page preview.
7. For PPTX output, set `format` to `pptx` and provide `slides` in presentation order. Every slide needs `title`; add `body`, `bullets`, and optional speaker `notes`. Keep each slide concise enough to fit a 16:9 layout.
8. Finish by calling `whale_office_stage_artifact` exactly once. This call creates a preview only. Never claim that a file was saved until the user confirms generation in the result card.
