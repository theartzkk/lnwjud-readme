package platform

#Lock: {
  schemaVersion: 1
  authority: "AWH_PLATFORM_TOOLCHAIN"
  installRoot: string
  tools: [string]: string
  futureAdapters: {
    openobserve: "contract-only"
    k3s: "contract-only"
    restate: "contract-only"
    backstage: "contract-only"
  }
  rules: {
    singleAuthority: true
    noParallelDeployEngine: true
    noParallelScheduler: true
    noParallelAuth: true
    productionSigningRequiresExistingVaultCredential: true
    ansibleInstallAuthority: "uv"
    resticRole: "offsite-mirror-only"
  }
}
