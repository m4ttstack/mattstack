/** A file path that fits its bar: the folders give way first, losing
    their start to an ellipsis, while the file name and line stay whole.
    The full path is the hover title. */
export function CodePath({ path, line }: { path: string; line?: number }) {
  const cut = path.lastIndexOf('/') + 1;
  return (
    <span
      className="tui-review-code-path"
      title={line !== undefined ? `${path}:${line}` : path}
    >
      {cut > 0 && (
        <span className="tui-review-code-dir">
          <span dir="ltr">{path.slice(0, cut)}</span>
        </span>
      )}
      <span className="tui-review-code-name">
        {path.slice(cut)}
        {line !== undefined && (
          <span className="tui-review-code-line">:{line}</span>
        )}
      </span>
    </span>
  );
}
