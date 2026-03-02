import adapter from '@sveltejs/adapter-node';

/** @type {import('@sveltejs/kit').Config} */
export default {
  kit: {
    adapter: adapter({ out: 'build' }),
    csrf: { checkOrigin: false }, // local dashboard — no cross-site risk
  },
};
