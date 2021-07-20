module.exports = (api) => ({
  presets: [
    [
      '@4c',
      {
        target: 'web',
        modules: api.env() === 'test' ? 'commonjs' : false,
      },
    ],
    '@babel/preset-typescript',
  ],
});
