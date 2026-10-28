import PostalMime, { type Attachment } from 'postal-mime';

export const MIME_LIMITS = { raw: 5 * 1024 * 1024, body: 512 * 1024, attachment: 2 * 1024 * 1024, attachmentsTotal: 3 * 1024 * 1024, attachmentCount: 10 } as const;
export type ParsedAttachment = { filename: string; contentType: string; bytes: Uint8Array; skippedReason: null } | { filename: string; contentType: string; size: number; skippedReason: string };
export type ParsedMail = { from: string; to: string[]; subject: string; messageId: string; receivedAt: number; text: string; html: string; snippet: string; otpCandidates: string[]; bodyTruncated: boolean; attachments: ParsedAttachment[] };

function bytesOf(value: ArrayBuffer | Uint8Array | string): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return new TextEncoder().encode(value);
}
function address(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(item => {
    if (!item || typeof item !== 'object') return [];
    const entry = item as { address?: unknown; group?: Array<{ address?: unknown }> };
    if (typeof entry.address === 'string') return [entry.address];
    return (entry.group ?? []).flatMap(member => typeof member.address === 'string' ? [member.address] : []);
  });
}
function truncate(value: string, maxBytes: number): { value: string; truncated: boolean } {
  const bytes = new TextEncoder().encode(value);
  if (bytes.byteLength <= maxBytes) return { value, truncated: false };
  let end = maxBytes;
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) end--;
  return { value: new TextDecoder().decode(bytes.slice(0, end)), truncated: true };
}
function attachmentResult(attachments: Attachment[]): ParsedAttachment[] {
  let total = 0;
  return attachments.map((attachment, index) => {
    const bytes = bytesOf(attachment.content);
    const filename = (attachment.filename || `attachment-${index+1}`).replace(/[\r\n\\/]/g, '_').slice(0,180) || `attachment-${index+1}`;
    const contentType = /^[\w!#$&^_.+-]+\/[\w!#$&^_.+-]+$/.test(attachment.mimeType) ? attachment.mimeType : 'application/octet-stream';
    let skippedReason = '';
    if (index >= MIME_LIMITS.attachmentCount) skippedReason = 'attachment_count_limit';
    else if (bytes.byteLength > MIME_LIMITS.attachment) skippedReason = 'attachment_size_limit';
    else if (total + bytes.byteLength > MIME_LIMITS.attachmentsTotal) skippedReason = 'attachment_total_limit';
    if (skippedReason) return { filename, contentType, size: bytes.byteLength, skippedReason };
    total += bytes.byteLength;
    return { filename, contentType, bytes, skippedReason: null };
  });
}
export async function parseMime(raw: Uint8Array, envelopeTo: string): Promise<ParsedMail> {
  if (raw.byteLength > MIME_LIMITS.raw) throw new Error('RAW_MESSAGE_TOO_LARGE');
  const parsed = await PostalMime.parse(raw, { attachmentEncoding: 'arraybuffer', maxNestingDepth: 20, maxPartCount: 100, maxHeadersSize: 256 * 1024 });
  const text = truncate(parsed.text ?? '', MIME_LIMITS.body);
  const html = truncate(parsed.html ?? '', Math.max(0, MIME_LIMITS.body - new TextEncoder().encode(text.value).byteLength));
  const bodyTruncated = text.truncated || html.truncated;
  const snippet = (text.value || (parsed.html ?? '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim().slice(0, 240);
  const otpCandidates = [...new Set((text.value.match(/(?<!\d)\d{4,8}(?!\d)/g) ?? []))].slice(0, 5);
  return {
    from: address(parsed.from ? [parsed.from] : [])[0] ?? '', to: address(parsed.to).length ? address(parsed.to) : [envelopeTo],
    subject: (parsed.subject ?? '').slice(0, 998), messageId: (parsed.messageId ?? '').slice(0, 998),
    receivedAt: parsed.date && Number.isFinite(Date.parse(parsed.date)) ? Date.parse(parsed.date) : Date.now(),
    text: text.value, html: html.value, snippet, otpCandidates, bodyTruncated, attachments: attachmentResult(parsed.attachments ?? []),
  };
}
