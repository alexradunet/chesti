export interface AiState {
  open: boolean;
  draft: string;
  conversationId?: string;
  previousId?: string;
  contextTitle: string;
}

/** A submitted form owns even an empty draft; explicit entry owns its target. */
export function restoreAiState(request: AiState, stored: unknown, intent: 'browse' | 'explicit' | 'submitted'): AiState {
  if (intent === 'submitted' || request.draft !== '' || !stored || typeof stored !== 'object') return request;
  const saved = stored as Partial<AiState>;
  if (typeof saved.open !== 'boolean' || typeof saved.draft !== 'string' || typeof saved.contextTitle !== 'string'
    || (saved.conversationId !== undefined && typeof saved.conversationId !== 'string')
    || (saved.previousId !== undefined && typeof saved.previousId !== 'string')) return request;

  if (intent === 'browse') return { ...saved as AiState, open: request.open || saved.open };
  const sameTarget = request.conversationId
    ? request.conversationId === saved.conversationId
    : !saved.conversationId && request.previousId === saved.previousId;
  if (!sameTarget) return request;
  return { ...request, draft: saved.draft, open: request.open || saved.open };
}
