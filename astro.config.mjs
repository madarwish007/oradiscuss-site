// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import mdx from '@astrojs/mdx';
import rehypeSlug from 'rehype-slug';
import rehypeAutolinkHeadings from 'rehype-autolink-headings';

import react from '@astrojs/react';

export default defineConfig({
  site: 'https://oradiscuss.com',
  integrations: [
    mdx(),
    /* /watch/brief/ is a SHELL, not a page. Every published brief is rendered
       into it from D1 at request time, so the built file has no content of its
       own and must never be offered to a crawler as one. It also ships noindex;
       the Worker strips that meta only when it injects a real brief. */
    sitemap({ filter: (page) => !page.endsWith('/watch/brief/') }),
    react(),
  ],
  /* The membership page was reviewed at /instrument/ before it became the home.
     Anyone holding that URL should land on the real page, not a 404. */
  redirects: {
    /* One key only. Declaring both "/instrument" and "/instrument/" makes Astro
       treat it as the same static route defined twice and it drops one. */
    '/instrument': '/',
  },
  markdown: {
    shikiConfig: {
      theme: 'github-dark',
      wrap: true,
    },
    rehypePlugins: [
      rehypeSlug,
      [
        rehypeAutolinkHeadings,
        {
          behavior: 'append',
          properties: { className: ['heading-anchor'], ariaHidden: true, tabIndex: -1 },
        },
      ],
    ],
  },
});