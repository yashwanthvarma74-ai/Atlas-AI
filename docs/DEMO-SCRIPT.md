# Demo script (90 seconds)

The video is **not recorded**. This is the script. Use the two PDFs in `docs/samples`. Record at 1080p, no music,
captions on, and put it at the top of the README.

| Time | Show                                                                                  | Say                                                                                     |
| ---- | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| 0:00 | The landing page, then "Continue as guest"                                            | "Ask your documents, and check the answer. No sign-up."                                 |
| 0:08 | Upload the PDF, a note and an image. Status moves queued, parsing, embedding, indexed | "A worker reads each file page by page and indexes it. The status is live."             |
| 0:22 | Ask "why did support tickets rise in Q3?" The answer streams in with its sources      | "Time to the first word is measured on every answer."                                   |
| 0:35 | Click the citation chip. The exact page opens with the passage marked                 | "Citations come from the server. The model only ever sees a number."                    |
| 0:45 | Ask a follow-up ("and costs?"), then press Stop mid-answer                            | "A follow-up is rewritten before it is searched. Stop keeps what had arrived."          |
| 0:55 | Ask it to save the answer as a note. The approval card appears. Approve it            | "The assistant can only ask. A person approves, and every request is audited."          |
| 1:08 | The Evaluation page: recall, citation consistency, cross-workspace retrievals         | "240 labelled questions, scored on every change. Zero cross-workspace hits."            |
| 1:20 | The history: 89% with word matching, 96.7% with a real embedder                       | "The first embedder missed the target. Changing it, measured, is what met it."          |
| 1:25 | The architecture diagram from the README                                              | "Search filters by workspace inside the query, and the filter is tested at each layer." |

Lead with the hard part: the failure-first beat is Stop, the approval card and the measured fix for the missed target.

The approval step was checked with the offline answerer, which proposes a note when a question starts with "save".
Whether Gemini proposes one depends on the model following the tool instructions; try it before recording.
