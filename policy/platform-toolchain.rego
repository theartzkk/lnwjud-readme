package main

deny contains msg if {
  input.authority != "AWH_PLATFORM_TOOLCHAIN"
  msg := "platform toolchain authority changed"
}

deny contains msg if {
  input.rules.singleAuthority != true
  msg := "single authority must remain enabled"
}

deny contains msg if {
  input.rules.noParallelDeployEngine != true
  msg := "parallel deploy engine is forbidden"
}

deny contains msg if {
  some name
  name in {"openobserve", "k3s", "restate", "backstage"}
  input.futureAdapters[name] != "contract-only"
  msg := sprintf("%s must remain contract-only", [name])
}

deny contains msg if {
  input.rules.ansibleInstallAuthority != "uv"
  msg := "Ansible must remain owned by uv"
}

deny contains msg if {
  input.rules.resticRole != "offsite-mirror-only"
  msg := "Restic must remain a mirror layer, not a backup authority"
}
