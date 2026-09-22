// Ships deliberately, to overwrite any stale config left in the repo.
//
// A leftover postcss.config.js from an earlier scaffold referenced tailwindcss,
// which this app does not use and does not install: the Vercel build then died
// with "Cannot find module 'tailwindcss'" while compiling app/globals.css.
// The stylesheet here is plain CSS and needs no PostCSS plugins.
module.exports = {
  plugins: {}
};
