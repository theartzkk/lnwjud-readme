module.exports = {
  packagerConfig: {
    name: 'Art Agent',
    executableName: 'ArtAgent',
    asar: true,
    overwrite: true,
    ignore: [
      /^\/src($|\/)/,
      /^\/test($|\/)/,
      /^\/Screenshot($|\/)/,
      /^\/\.github($|\/)/,
    ],
  },
  makers: [],
};
