import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'Soroban-Resurrect',
  description: 'Automated Cross-Contract State Restoration SDK & Wallet Middleware for Soroban',
  base: '/Automated-Cross-Contract-SDK-Frontend-/docs/',
  cleanUrls: true,

  // Several docs pages link to repository files that live outside this
  // VitePress source root (e.g. `../ARCHITECTURE.md`, `../packages/sdk/src`),
  // which the dead-link checker can't resolve. Site-internal links are always
  // root-absolute (`/guide/...`), so ignoring relative `../` links only
  // silences those out-of-root references.
  ignoreDeadLinks: [/\.\.\//],

  themeConfig: {
    nav: [
      { text: 'Guide', link: '/guide/getting-started' },
      { text: 'API Reference', link: '/api/sdk' },
      { text: 'Examples', link: '/examples/' },
      { text: 'Playground', link: '/examples/playground' },
      { text: 'Integrations', link: '/integrations/react' },
    ],

    sidebar: {
      '/guide/': [
        {
          text: 'Guide',
          items: [
            { text: 'Getting Started', link: '/guide/getting-started' },
            { text: 'Tutorial: Common Use Cases', link: '/guide/tutorial' },
            { text: 'Local Development', link: '/guide/local-development' },
            { text: 'Local Package Development', link: '/guide/local-package-development' },
          ],
        },
      ],
      '/api/': [
        {
          text: 'API Reference',
          items: [
            { text: 'SDK (@soroban-resurrect/sdk)', link: '/api/sdk' },
            { text: 'React Hook (@soroban-resurrect/react-hook)', link: '/api/react-hook' },
            { text: 'Vue Hook (@soroban-resurrect/vue-hook)', link: '/api/vue-hook' },
            { text: 'Svelte Hook (@soroban-resurrect/svelte-hook)', link: '/api/svelte-hook' },
            { text: 'Types', link: '/api/types' },
          ],
        },
      ],
      '/examples/': [
        {
          text: 'Examples',
          items: [
            { text: 'Overview', link: '/examples/' },
            { text: 'Interactive Playground', link: '/examples/playground' },
          ],
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
