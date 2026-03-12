import { customAlphabet } from 'nanoid';
import slugify = require('@sindresorhus/slugify');

const alphabet = '0123456789abcdefghijklmnopqrstuvwxyz';
export const nanoIdGen = customAlphabet(alphabet, 10);

const slugIdAlphabet =
  '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
export const generateSlugId = customAlphabet(slugIdAlphabet, 10);

/**
 * Generate a URL-friendly slug from a name.
 * If slugify produces a result shorter than 3 chars (e.g. CJK/mixed input),
 * append a nanoId to ensure uniqueness and readability.
 */
export function generateSlug(name: string): string {
  const slug = slugify(name);
  if (slug.length < 3) {
    const id = nanoIdGen();
    return slug ? `${slug}-${id}` : id;
  }
  return slug;
}