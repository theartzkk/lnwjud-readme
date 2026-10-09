# AWH/BAY Platform Reset — Baseline 2026-10-05

## Authority
- Reset goal: ae2c4101-ec7e-4648-89b1-1f3be125229d
- Workspace: 01bc49e7-2670-463d-9ba9-128405021684
- Baseline source HEAD: 3e8b72b5bc6d7a9e97cb4fa9427b76cf51b4c3db
- Isolated worktree: .worktrees/platform-reset-20261005
- Reset branch: fix/platform-reset-reliability-experience-20261005
- Production/data mutation: NONE in this baseline phase.

## Root workspace state
- Clean: undefined
- Changed files: undefined
- Staged files: undefined
- Important rule: do not normalize, reset, clean, or delete the dirty root workspace during reset discovery.

## Durable goal inventory
- Active goals: 15
- Expired/stale leases excluding reset goal: 12

- awh-agent-intel-release-closure | phase=created | revision=0 | lease=2026-10-05T14:46:49.795Z | tracked=0 | blockers=0
- awh-bay-platform-reset-reliability-experience-20261005 | phase=created | revision=0 | lease=2026-10-05T14:45:53.934Z | tracked=0 | blockers=0
- vps-delivery-speed-quality-wave | phase=mobile-experience-convergence-final-candidate-awaiting-source-activation | revision=22 | lease=2026-10-05T14:43:50.290Z | tracked=1 | blockers=1
- bay-computer-lab-management-resume | phase=ux-2-shadow-candidate-ready | revision=12 | lease=2026-10-05T14:29:54.599Z | tracked=1 | blockers=4
- update-center-release-execution-standard | phase=created | revision=1 | lease=2026-10-05T14:27:32.486Z | tracked=0 | blockers=0
- awh-visual-qa-worldclass-audit-20261005 | phase=worldclass-visual-gate-design-proven | revision=2 | lease=2026-10-05T14:00:01.684Z | tracked=0 | blockers=1
- awh-capability-expansion-visual-qa-20261005 | phase=created | revision=0 | lease=2026-10-05T13:48:14.943Z | tracked=0 | blockers=0
- bay-card-rc6652-release-cc5a6ac2 | phase=created | revision=0 | lease=2026-10-05T10:46:35.794Z | tracked=0 | blockers=0
- bay-assessment-answer-key-rescore-hotfix | phase=created | revision=0 | lease=2026-10-05T08:05:00.728Z | tracked=0 | blockers=0
- bay-assessment-teacher-mobile-ux-cleanup | phase=created | revision=0 | lease=2026-10-05T08:00:33.856Z | tracked=0 | blockers=0
- bay-product-consolidation-20261004 | phase=created | revision=0 | lease=2026-10-04T17:53:46.710Z | tracked=0 | blockers=0
- awh.chat.background-send-unblock.20261004 | phase=created | revision=0 | lease=2026-10-04T17:44:30.360Z | tracked=0 | blockers=0
- awh-chatgpt-tool-branding | phase=owner-registration-not-exposed | revision=4 | lease=2026-10-04T16:49:31.780Z | tracked=0 | blockers=1
- bay-assessment-print-center-reserve-answer-sheets | phase=created | revision=0 | lease=2026-10-04T16:00:43.403Z | tracked=0 | blockers=0
- bay-assessment-rc52.18-release | phase=owner-release-boundary | revision=3 | lease=2026-10-04T10:09:04.082Z | tracked=0 | blockers=1

## Managed task inventory
- Total: 1190
- completed: 962
- failed: 191
- timed_out: 27
- running: 1
- cancelled: 9
- Active at capture: 1

- ce43031f-6984-4c24-95be-c8fe124a059f | state=running | started=2026-10-05T14:08:17.390Z | deadline=2026-10-05T15:08:20.645Z

## Initial cleanup classification
### Preserve / inspect before any reconciliation
- awh-agent-intel-release-closure
- awh-bay-platform-reset-reliability-experience-20261005
- vps-delivery-speed-quality-wave

### Stale candidates (preview only; not yet reconciled)
- bay-computer-lab-management-resume | 2aa3fc41-32a5-4038-bf2d-eff8847f0e18
- update-center-release-execution-standard | c8363409-601a-49fc-9a49-80284b6674c4
- awh-visual-qa-worldclass-audit-20261005 | 9b3dd3f3-5303-4bec-9fa6-6d8e8bcbb421
- awh-capability-expansion-visual-qa-20261005 | ed7c2501-1a30-4f13-b028-d366bcf9ba43
- bay-card-rc6652-release-cc5a6ac2 | 34471b71-25ee-47ed-b521-f204c111754c
- bay-assessment-answer-key-rescore-hotfix | f5b58c13-dabd-49b0-92ae-0aa17eaaaaa3
- bay-assessment-teacher-mobile-ux-cleanup | 8ae3e96a-034d-401e-a686-d8b39082c8ab
- bay-product-consolidation-20261004 | bee3f408-eef1-40ac-9d64-ce9d132c48a5
- awh.chat.background-send-unblock.20261004 | fc2118e8-7aea-467c-bfc4-e6fa7f4f6186
- awh-chatgpt-tool-branding | f4679745-8ed9-4210-ba93-c7a7b5a817fb
- bay-assessment-print-center-reserve-answer-sheets | 93bcda8b-bb41-43e7-a238-f6c695b2a830
- bay-assessment-rc52.18-release | f524f77b-4f25-4f45-9035-3e6a98ca6a81

## Protected data boundary
Never delete or rewrite as part of cleanup:
- student and enrollment data
- scores / assessments / answer keys / scan evidence
- attendance
- cooperative transactions
- LINE bindings
- Smart Card registry/history
- accounts/auth bindings
- secrets/Vault material
- audit/release evidence
- verified canonical source and Production history

## Reset rule
Preserve first. Replace execution/control-plane debt only after evidence, rollback identity, and conflict ownership are proven.
