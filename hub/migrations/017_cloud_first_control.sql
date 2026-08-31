-- M18 Cloud-first Control adds no new task, queue, project, memory or artifact authority.
-- It only extends the existing capability catalog so cloud execution can be
-- routed through control_task_executions and control_execution_envelopes.

INSERT OR IGNORE INTO control_capability_catalog(
    capability, source_id, category, display_name, description,
    mutation_kind, risk_class, maturity, user_visible, enabled,
    created_at, updated_at
) VALUES(
    'qa.cloud','awh-core','development','ตรวจระบบบน Cloud',
    'รันชุดตรวจสอบ AWH บน Cloud โดยใช้ task และ execution เดิม',
    'READ','LOW','AVAILABLE',1,1,
    '2026-08-31T00:00:00Z','2026-08-31T00:00:00Z'
);

INSERT OR IGNORE INTO control_capability_catalog(
    capability, source_id, category, display_name, description,
    mutation_kind, risk_class, maturity, user_visible, enabled,
    created_at, updated_at
) VALUES(
    'review.visual','awh-core','development','ตรวจประสบการณ์ใช้งาน',
    'สร้างภาพหน้าจอและ Review Pack บน Cloud จาก revision ที่ระบุ',
    'CREATE','LOW','AVAILABLE',1,1,
    '2026-08-31T00:00:00Z','2026-08-31T00:00:00Z'
);
