import { describe, expect, it } from 'vitest';
import { sniffFile } from './sniff';

const bytes = (text: string) => new TextEncoder().encode(text);

describe('sniffFile', () => {
  it('recognises a PDF by its header', () => {
    expect(sniffFile(bytes('%PDF-1.7\n%...'))).toEqual({
      kind: 'pdf',
      mimeType: 'application/pdf',
    });
  });

  it('allows a PDF with junk before the header, as the format permits', () => {
    expect(sniffFile(bytes(`\r\n\r\n${'x'.repeat(200)}%PDF-1.4`))?.kind).toBe('pdf');
  });

  it('recognises PNG and JPEG by their signatures', () => {
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
    const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);
    expect(sniffFile(png)).toEqual({ kind: 'image', mimeType: 'image/png' });
    expect(sniffFile(jpeg)).toEqual({ kind: 'image', mimeType: 'image/jpeg' });
  });

  it('accepts plain text, including non-Latin text and Markdown', () => {
    expect(sniffFile(bytes('# Notes\n\n- café\n- 日本語\n'))?.kind).toBe('text');
  });

  it('is not fooled by a character split at the end of the sample', () => {
    const long = `${'a'.repeat(8191)}é and more text after the cut`;
    expect(sniffFile(bytes(long))?.kind).toBe('text');
  });

  it('refuses an empty file', () => {
    expect(sniffFile(new Uint8Array())).toBeNull();
  });

  it('refuses executables, archives and other binary data', () => {
    expect(sniffFile(Uint8Array.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00]))).toBeNull(); // Windows exe
    expect(sniffFile(Uint8Array.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01]))).toBeNull(); // ELF
    expect(sniffFile(Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]))).toBeNull(); // zip
  });

  it('refuses text that hides a NUL byte', () => {
    expect(sniffFile(bytes('looks fine\u0000but is not'))).toBeNull();
  });

  it('treats a script as plain text, whatever the client called it', () => {
    // text is only ever read and indexed, never executed, so a script is just words
    expect(sniffFile(bytes('<?php system($_GET["c"]); ?>'))?.kind).toBe('text');
  });
});
