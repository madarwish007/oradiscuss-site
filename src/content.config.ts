import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

export const CATEGORIES = ['dba', 'oci', 'goldengate', 'scripts', 'community'] as const;
export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_LABEL: Record<Category, string> = {
  dba: 'Advanced DBA',
  oci: 'OCI / Cloud',
  goldengate: 'GoldenGate',
  scripts: 'Scripts',
  community: 'Community',
};

// ASM-tagged posts live under /dba/ (legacy URL structure) but get a tag-landing
// page at /asm/. Keep this list in sync with any tag-based pages under src/pages.
export const TAG_PAGES = ['asm'] as const;
export const TAG_LABEL: Record<(typeof TAG_PAGES)[number], string> = {
  asm: 'ASM',
};

// Sveltia CMS serialises un-filled optional fields as empty strings instead of
// omitting them, which breaks z.coerce.date() (coerces '' to Invalid Date).
// blankToUndef normalises them back to undefined before Zod sees them.
const blankToUndef = (v: unknown) => (v === '' || v == null ? undefined : v);

const blog = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/blog' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    pubDate: z.coerce.date(),
    updatedDate: z.preprocess(blankToUndef, z.coerce.date().optional()),
    category: z.enum(CATEGORIES),
    tags: z.array(z.string()).default([]),
    // cover is a public URL path (e.g. "/images/blog/foo.png") or an external
    // URL. Sveltia CMS writes this shape automatically; if you ever need Astro
    // image-optimisation, swap back to image() + relative paths and update
    // the CMS media_folder accordingly.
    cover: z.preprocess(blankToUndef, z.string().optional()),
    coverAlt: z.preprocess(blankToUndef, z.string().optional()),
    draft: z.boolean().default(false),
    featured: z.boolean().default(false),
  }),
});

export const collections = { blog };
