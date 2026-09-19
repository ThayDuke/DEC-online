# DEC-online Apps Script bridge

Deploy this directory as a separate Google Apps Script Web App and keep the
Google Spreadsheet private. Do not reuse the BBSO-BOT project.

Required Script Properties:

- `SPREADSHEET_ID`: DEC spreadsheet ID.
- `DEC_BACKEND_SECRET`: long random secret shared only with Pages Functions.

Required header rows:

- `Students`: `student_id`, `display_name`, `class_name`, `active`
- `Accounts`: `google_email`, `student_id`, `active`
- `Permissions`: `student_id`, `tag`, `active`
- `Results`: `student_id`, `google_email`, `quiz_id`, `display_title`, `score`, `max_score`, `percent`, `class_snapshot`, `school_year`, `best_at`, `completed`

The production Worker must call this endpoint server-to-server. Never expose
`DEC_BACKEND_SECRET` or this bridge's write payload in browser JavaScript.
