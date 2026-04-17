import rss from '@astrojs/rss';
import { getCollection } from 'astro:content';

export async function GET(context) {
  const posts = (await getCollection('blog', ({ data }) => !data.draft)).sort(
    (a, b) => b.data.pubDate.getTime() - a.data.pubDate.getTime()
  );

  return rss({
    title: 'OraDiscuss — Oracle Mastery, Distilled',
    description:
      'Production-grade Oracle DBA insights from a practising ACE Apprentice. Exadata, RAC, AWR, GoldenGate, OCI — the hard problems, solved in writing.',
    site: context.site,
    items: posts.map((post) => ({
      title: post.data.title,
      pubDate: post.data.pubDate,
      description: post.data.description,
      link: `/${post.data.category}/${post.id}/`,
      categories: [post.data.category, ...post.data.tags],
      author: 'Mahmoud Darwish',
    })),
    customData: '<language>en-us</language>',
  });
}
