export function normalizeLineEndings(content) {
  return content.replace(/\r\n?/g, "\n");
}
