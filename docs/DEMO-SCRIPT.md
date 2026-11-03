# Demo script (90 seconds)

The video is **not recorded**. This is the script, written so that each step can be shown with the offline model
and no keys. Record at 1080p, no music, captions on, and put it at the top of the README.

| Time | Show                                                                                  | Say                                                                                     |
| ---- | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| 0:00 | The landing page, then "Continue as guest"                                            | "Ask your documents, and check the answer. No sign-up."                                 |
| 0:08 | Upload the PDF, a note and an image. Status moves queued, parsing, embedding, indexed | "A worker reads each file page by page and indexes it. The status is live."             |
| 0:22 | Ask "how did revenue grow in Asia?" Words stream in, the first-word time appears      | "Time to the first word is measured on every answer."                                   |
| 0:35 | Click the citation chip. The exact page opens with the passage marked                 | "Citations come from the server. The model only ever sees a number."                    |
| 0:45 | Ask a follow-up ("and costs?"), then press Stop mid-answer                            | "A follow-up is rewritten before it is searched. Stop keeps what had arrived."          |
| 0:55 | Ask "save this answer as Q3 notes". The approval card appears. Approve it             | "The assistant can only ask. A person approves, and every request is audited."          |
| 1:08 | The Evaluation page: recall, citation consistency, cross-workspace retrievals         | "276 labelled questions, scored on every change. Zero cross-workspace hits."            |
| 1:20 | The recall@10 row, "Not met"                                                          | "89%, against a target of 90. I show the miss."                                         |
| 1:25 | The architecture diagram from the README                                              | "Search filters by workspace inside the query, and the filter is tested at each layer." |

Lead with the hard part: the failure-first beat is Stop, the approval card and the miss against the target.
