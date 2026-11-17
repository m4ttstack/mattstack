/** One error message from several, as a toast or banner shows it. */
export function joinErrors(errors: readonly string[]): string {
  return errors.join('; ');
}
