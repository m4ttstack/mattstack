/** Reads at most `maxBytes`, so an oversized body is never buffered. Null when it is larger. */
export async function readCappedText(
  req: Request,
  maxBytes: number
): Promise<string | null> {
  const declared = req.headers.get('content-length');
  if (declared !== null && Number(declared) > maxBytes) return null;
  if (!req.body) return '';
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = req.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}
