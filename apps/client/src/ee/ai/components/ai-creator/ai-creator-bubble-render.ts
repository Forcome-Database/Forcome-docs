export const BUBBLE_ALLOWED_URI_REGEXP = /^(?:(?:https?|data):|\/api\/files\/)/i;

export function isBubbleAllowedUri(uri: string): boolean {
  return BUBBLE_ALLOWED_URI_REGEXP.test(uri);
}
