import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'Soroban-Resurrect',
  description: 'Automated Cross-Contract State Restoration SDK & Wallet Middleware for Soroban',
  base: '/Automated-Cross-Contract-SDK-Frontend-/docs/',
  cleanUrls: true,

  themeConfig: {
    nav: [
      { text: 'Guide', link: '/guide/getting-started' },
      { text: 'API Reference', link: '/api/sdk' },
      { text: 'Examples', link: '/examples/' },
      { text: 'Integrations', link: '/integrations/react' },
    ],

    sidebar: {
      '/guide/': [
        {
          text: 'Guide',
          items: [
            { text: 'Getting Started', link: '/guide/getting-started' },
            { text: 'Tutorial: Common Use Cases', link: '/guide/tutorial' },
            { text: 'Testing', link: '/guide/testing' },
          ],
        },
      ],
      '/api/': [
        {
          text: 'API Reference',
          items: [
            { text: 'SDK (@soroban-resurrect/sdk)', link: '/api/sdk' },
            { text: 'React Hook (@soroban-resurrect/react-hook)', link: '/api/react-hook' },
            { text: 'Types', link: '/api/types' },
          ],
        },
      ],
      '/examples/': [
        {
          text: 'Examples',
          items: [{ text: 'Overview', link: '/examples/' }],
        },
      ],
      '/integrations/': [
        {
          text: 'Framework Integrations',
          items: [
            { text: 'React', link: '/integrations/react' },
            { text: 'Next.js', link: '/integrations/nextjs' },
            { text: 'Vite', link: '/integrations/vite' },
            { text: 'Astro', link: '/integrations/astro' },
          ],
        },
      ],
    },

    socialLinks: [
      {
        icon: 'github',
        link: 'https://github.com/Automated-Cross-Contract-SDK/Automated-Cross-Contract-SDK-Frontend-',
      },
    ],

    search: {
      provider: 'local',
    },
  },
})
