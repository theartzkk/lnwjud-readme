const path = require('node:path');

const windowsIcon = path.join(__dirname, '.art-agent-build', 'art-agent.ico');

module.exports = {
  packagerConfig: {
    name: 'Art Agent',
    executableName: 'ArtAgent',
    icon: windowsIcon,
    asar: true,
    overwrite: true,
    ignore: [
      /^\/src($|\/)/,
      /^\/test($|\/)/,
      /^\/Screenshot($|\/)/,
      /^\/\.github($|\/)/,
      /^\/\.art-agent-build($|\/)/,
    ],
  },
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      config: {
        name: 'ArtAgent',
        title: 'Art Agent',
        authors: 'Art Agent',
        description: 'Safe-by-default local Windows MCP development agent for ChatGPT and Codex.',
        exe: 'ArtAgent.exe',
        setupExe: 'ArtAgentSetup.exe',
        setupIcon: windowsIcon,
        noMsi: true,
      },
    },
  ],
};
