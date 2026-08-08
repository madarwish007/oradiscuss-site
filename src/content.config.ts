import { defineCollection, reference, z } from 'astro:content';
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

/* ---------------------------------------------------------------------------
   THE ACADEMY CONTENT TREE

   Two collections, because a course and a lesson are different records and a
   course has metadata that belongs to the course. Folding them into one
   collection would mean repeating the course title, its summary and its module
   order inside every lesson file, which is a second source of truth that starts
   disagreeing with itself on the first rename.

     academyCourses  one file per course, id = the course slug
     academy         one file per lesson,  id = "<course-slug>/<lesson-slug>"

   Both are empty today and the routes render an honest empty state from that
   fact. NOTHING in either schema carries a price. Academy access is flat
   all-access on the membership (spec section 2.1: per-course pricing was
   proposed and rejected), so a per-course price field here would be a place
   for a rejected decision to grow back.
   --------------------------------------------------------------------------- */

/* The negated second half of each glob pattern below is load bearing, not
   tidiness. Astro 6's glob loader does NOT skip underscore prefixed files the
   way src/pages does: dropping an `_authoring-notes.md` into the folder without
   that exclusion failed the build with "academyCourses, _authoring-notes data
   does not match collection schema", which is how this was found. It also gives
   an author a way to park a half written lesson in the tree unpublished. */
const academyCourses = defineCollection({
  loader: glob({ pattern: ['**/*.{md,mdx}', '!**/_*'], base: './src/content/academy-courses' }),
  schema: z.object({
    title: z.string(),
    summary: z.string(),
    /* The modules of this course in teaching order. A lesson names its module
       with one of these strings, so the shape of the course is declared once,
       here, rather than inferred from whichever lessons happen to exist yet.
       A half written course therefore still renders in the right order. */
    modules: z.array(z.string()).min(1),
    /* Which Oracle releases the course as a whole was written against, for
       example ["19c", "23ai"]. Free text rather than an enum: real
       applicability is often "19c RU 19.20 and later", which no enum survives. */
    oracleVersions: z.array(z.string()).min(1),
    /* What a reader needs BEFORE lesson one. Plain sentences, not links. */
    prerequisites: z.array(z.string()).default([]),
    /* Required, not optional. A lab manual aimed at a moving product is only
       trustworthy if it says when it was last checked against a release, so
       the schema refuses a course that will not say. */
    lastReviewed: z.coerce.date(),
    draft: z.boolean().default(false),
  }),
});

const academy = defineCollection({
  loader: glob({ pattern: ['**/*.{md,mdx}', '!**/_*'], base: './src/content/academy' }),
  schema: z.object({
    /* A reference, so a lesson naming a course that does not exist fails the
       build instead of rendering a link to nowhere. */
    course: reference('academyCourses'),
    /* Must match one of the parent course's `modules` entries. */
    module: z.string(),
    /* Position within the module. Ordering is explicit because file names sort
       alphabetically and lesson 10 would otherwise land between 1 and 2. */
    order: z.number().int().positive(),
    title: z.string(),
    summary: z.string(),
    /* Working time at a terminal, not reading time. Reading time can be
       computed from the body; the time a lab actually takes cannot. */
    estimatedMinutes: z.number().int().positive(),
    prerequisites: z.array(z.string()).default([]),
    oracleVersions: z.array(z.string()).min(1),
    lastReviewed: z.coerce.date(),
    draft: z.boolean().default(false),
  }),
});

export const collections = { blog, academy, academyCourses };
