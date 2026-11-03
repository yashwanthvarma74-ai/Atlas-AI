import type { DocumentKind } from '@atlas/shared';

export interface SniffedFile {
  kind: DocumentKind;
  // the type we store and serve it as, chosen by us rather than sent by the client
  mimeType: string;
}

const startsWith = (bytes: Uint8Array, signature: number[], offset = 0) =>
  signature.every((byte, i) => bytes[offset + i] === byte);

// Decides what a file is from its first bytes. The Content-Type header and the file extension come from
// the client and say nothing about what is inside, so they are not consulted. Anything that is not
// recognised is refused, which is the default for a parser that must never see a surprise.
export function sniffFile(bytes: Uint8Array): SniffedFile | null {
  if (bytes.length === 0) return null;

  // %PDF- may follow up to 1024 bytes of junk, which the PDF spec allows and some producers emit
  const head = Buffer.from(bytes.subarray(0, 1024)).toString('latin1');
  if (head.includes('%PDF-')) return { kind: 'pdf', mimeType: 'application/pdf' };

  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { kind: 'image', mimeType: 'image/png' };
  }
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return { kind: 'image', mimeType: 'image/jpeg' };

  return isPlainText(bytes) ? { kind: 'text', mimeType: 'text/plain; charset=utf-8' } : null;
}

// Text means valid UTF-8 with no NUL bytes and almost no other control characters. Binary formats fail
// one of these within the first few kilobytes.
function isPlainText(bytes: Uint8Array): boolean {
  const sample = bytes.subarray(0, 8192);
  let text: string;
  try {
    // streaming mode tolerates a multi-byte character cut in half by the end of the sample
    text = new TextDecoder('utf-8', { fatal: true }).decode(sample, {
      stream: sample.length < bytes.length,
    });
  } catch {
    return false;
  }
  for (const char of text) {
    const code = char.codePointAt(0)!;
    if (code === 0) return false;
    if (code < 32 && code !== 9 && code !== 10 && code !== 13 && code !== 12) return false;
  }
  return true;
}
