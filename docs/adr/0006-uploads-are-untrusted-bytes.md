# 0006. Uploads are untrusted bytes

Status: accepted

## Context

Anyone with the editor role can put a file on the server, and a parser then opens it. A crafted PDF, a script with a
friendly name, or a file that lies about its type is the realistic attack, and the threat model names it.

## Decision

- **The type comes from the bytes.** `sniffFile` reads the first bytes: `%PDF-` within the first kilobyte, the PNG
  and JPEG signatures, or valid UTF-8 with no NUL bytes and no stray control characters. Anything else is refused
  with 415. The browser's `Content-Type` and the file name are never consulted, and we store and serve our own
  `mimeType`, not the client's.
- **Limits at the door.** 20 MB, enforced by the body parser while the stream is read (413), and an empty file is 400.
  PDFs over 500 pages fail in the worker. The file name is length-limited and used only as a label and a download
  name.
- **The upload is the request body**, sent as `application/octet-stream` with the name in the query. No multipart
  parser, so no multipart parsing bugs. Anything else is 415.
- **Parsing happens in the worker**, a separate process from the API, so a parser that crashes or hangs takes down a
  job, not the server people are using. pdf.js 5 contains no code-evaluation path (the old `isEvalSupported`
  option no longer exists), and it is pinned to `^5` so a downgrade does not reintroduce one.
- **Nothing is ever executed.** Files are read as data, indexed as text, and kept as bytes.
- **Downloads are attachments.** The API sends `Content-Disposition: attachment`, `X-Content-Type-Options: nosniff`
  and `Content-Security-Policy: default-src 'none'; sandbox`, so an uploaded file is never rendered in the app's
  origin even if someone opens the link directly. With S3 the signed URL carries the same disposition and expires
  in five minutes.
- **Storage keys are made by the server** (`<workspaceId>/<documentId>`). The local driver also refuses any key
  that resolves outside its folder, as a second line.
- **Documents are fetched by id and workspace together.** A document id from another workspace is "not found" even
  if guessed ([0001](0001-workspace-access-is-proved-by-a-type.md)).

## Honest limits

- The worker is a separate process, not a sandbox. It holds the database credentials. If the parser were exploited
  it could read what the worker can read. Containment (a container with no network and a read-only filesystem,
  or a parser in a restricted child process) is a deployment task for week 6, and is listed as open in the threat
  model.
- A text file that contains a prompt-injection payload is accepted, because it is valid text. That risk is handled
  when the text reaches a model, not at upload ([threat model](../THREAT-MODEL.md)).
- Image OCR runs in-process in the worker, on Tesseract's WebAssembly build. It is not isolated either.

## Evidence

- `sniff.test.ts`: PDF with leading junk, PNG, JPEG, text with multi-byte characters cut by the sample boundary,
  empty files, an executable, an ELF binary, a zip, and a NUL byte hidden in text.
- `documents.test.ts` (API): a binary renamed `report.pdf` gets 415, an oversize body gets 413, a wrong
  `Content-Type` gets 415, a viewer gets 403, an outsider gets the same 404 as for a missing workspace, and a
  download carries the four headers above.
- `storage.test.ts`: keys that climb out of the folder are refused, against the local driver; the same suite runs
  against an S3-compatible server (s3mock) in CI.

## Alternatives

- **Trust the extension or `Content-Type`.** Trivially spoofed.
- **Multipart uploads.** Needed for forms with several fields; here there is one file and one name.
- **A virus scanner.** Reasonable for a product that serves files to other people's browsers. Downloads are
  sandboxed attachments, and the files are not shared outside their workspace.
