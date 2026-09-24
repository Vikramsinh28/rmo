import { MetadataRoute } from 'next';
import { siteConfig } from './siteConfig';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: ['/login'],
      disallow: ['/api/', '/overview', '/divisions', '/lobbies', '/crew', '/monitoring'],
    },
    sitemap: `${siteConfig.url}/sitemap.xml`,
    host: siteConfig.url,
  };
}
