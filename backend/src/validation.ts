import { z } from 'zod';

export const bookInput = z.object({
  title: z.string().trim().min(1).max(300),
  author: z.string().trim().min(1).max(300),
  description: z.string().trim().max(10000).nullable().optional(),
  coverImageUrl: z.url().refine(value => /^https?:\/\//.test(value), 'Use an HTTP or HTTPS image URL').nullable().optional(),
  pageCount: z.number().int().positive().nullable().optional(),
  status: z.enum(['WANT_TO_READ', 'CURRENTLY_READING', 'FINISHED', 'ABANDONED']).default('WANT_TO_READ'),
  progress: z.number().int().min(0).max(100).default(0),
  rating: z.number().int().min(1).max(5).nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(50)).max(20).default([]),
  startedAt: z.iso.date().nullable().optional(),
  finishedAt: z.iso.date().nullable().optional()
});

export const bookPatch = bookInput.partial().refine(value => Object.keys(value).length > 0);
export type BookInput = z.infer<typeof bookInput>;
