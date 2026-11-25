/** Only an explicit unauthorized response establishes that a refresh is invalid. */
export function isRejectedRefresh(error: unknown): boolean {
  return (error as { response?: { status?: number } } | null)?.response?.status === 401;
}
