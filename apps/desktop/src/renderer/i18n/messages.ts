export type MessageKey =
  | 'brand'
  | 'nav.home'
  | 'nav.projects'
  | 'nav.git'
  | 'nav.workLog'
  | 'nav.live'
  | 'nav.settings'
  | 'nav.doctor'
  | 'footer.connected'
  | 'footer.disconnected'
  | 'home.title'
  | 'home.subtitle'
  | 'agent.ready'
  | 'agent.busy'
  | 'agent.stopped'
  | 'agent.mode'
  | 'action.refresh'
  | 'action.stop'
  | 'action.restart'
  | 'action.retry'
  | 'mcp.localUrl'
  | 'mcp.stdioCommand'
  | 'mcp.copy'
  | 'mcp.copied'
  | 'tunnel.title'
  | 'tunnel.start'
  | 'tunnel.stop'
  | 'tunnel.needKey'
  | 'tunnel.needProfile'
  | 'tunnel.running'
  | 'tunnel.runningExternal'
  | 'tunnel.stopped'
  | 'tunnel.starting'
  | 'tunnel.error'
  | 'project.active'
  | 'project.setMain'
  | 'project.add'
  | 'project.addHint'
  | 'project.activeList'
  | 'project.archivedList'
  | 'project.systemList'
  | 'project.archive'
  | 'project.restore'
  | 'project.delete'
  | 'project.confirmDelete'
  | 'project.cancel'
  | 'project.archivedBadge'
  | 'project.systemBadge'
  | 'project.systemHint'
  | 'project.emptyActive'
  | 'project.emptyArchived'
  | 'project.deleteHint'
  | 'info.workspace'
  | 'info.activeProject'
  | 'info.mode'
  | 'workLog.title'
  | 'workLog.filterAll'
  | 'workLog.filterError'
  | 'workLog.clear'
  | 'workLog.empty'
  | 'scope.all'
  | 'scope.workspace'
  | 'scope.session'
  | 'scope.clearSession'
  | 'scope.clearWorkspace'
  | 'scope.clearAll'
  | 'settings.title'
  | 'settings.subtitle'
  | 'settings.generalTitle'
  | 'settings.securityTitle'
  | 'settings.tunnelTitle'
  | 'settings.locale'
  | 'settings.tunnelKey'
  | 'settings.saveKey'
  | 'settings.clientPath'
  | 'settings.savePath'
  | 'settings.permissions'
  | 'settings.unrestricted'
  | 'settings.unrestrictedHint'
  | 'settings.restartRequired'
  | 'settings.saved'
  | 'badge.unrestricted'
  | 'security.title'
  | 'security.summaryBroad'
  | 'security.summaryRestricted'
  | 'security.desktopProfile'
  | 'security.stdioProfile'
  | 'security.strictRoots'
  | 'security.aiDelete'
  | 'security.unrestricted'
  | 'security.workspaceScope'
  | 'security.tunnelAccess'
  | 'security.enabled'
  | 'security.disabled'
  | 'security.registeredWorkspaces'
  | 'security.allowedRoots'
  | 'security.machineRoots'
  | 'security.warningBroad'
  | 'security.strictHint'
  | 'live.title'
  | 'live.subtitle'
  | 'live.tabTunnel'
  | 'live.tabMcp'
  | 'live.tabProcess'
  | 'live.pause'
  | 'live.follow'
  | 'live.filter'
  | 'live.export'
  | 'live.clearTab'
  | 'live.captureIncident'
  | 'live.incident.localToolFailed'
  | 'live.incident.tunnelDisconnected'
  | 'live.incident.remoteTurnStopped'
  | 'live.incident.healthyOrInconclusive'
  | 'live.incident.cancelled'
  | 'live.incident.capturing'
  | 'live.waiting'
  | 'live.waitingTunnel'
  | 'live.popOut'
  | 'git.title'
  | 'git.changed'
  | 'git.staged'
  | 'doctor.title'
  | 'doctor.run'
  | 'doctor.noReport'
  | 'capabilities.title'
  | 'permission.safe'
  | 'permission.balanced'
  | 'permission.full'
  | 'permission.custom'
  | 'app.loading'
  | 'error.logBufferClear'
  | 'error.logExport'
  | 'error.logViewerOpen'
  | 'error.desktopService'
  | 'error.workspaceAdd'
  | 'error.workspaceSelect'
  | 'error.workspaceArchive'
  | 'error.workspaceDelete'
  | 'error.permissionProfileChange'
  | 'error.unrestrictedModeChange'
  | 'error.mcpStop'
  | 'error.mcpRestart'
  | 'error.workLogClear'
  | 'error.tunnelStart'
  | 'error.tunnelStop'
  | 'error.doctorRun'
  | 'language.th'
  | 'language.en';

export type Messages = Record<MessageKey, string>;

export const th: Messages = {
  brand: 'Art’s Workspace Hub',
  'nav.home': 'หน้าหลัก',
  'nav.projects': 'โปรเจกต์',
  'nav.git': 'Git',
  'nav.workLog': 'บันทึกการทำงาน',
  'nav.live': 'Live Logs',
  'nav.settings': 'ตั้งค่า',
  'nav.doctor': 'Doctor',
  'footer.connected': 'เชื่อมต่อแล้ว',
  'footer.disconnected': 'ยังไม่เชื่อมต่อ',
  'home.title': 'ศูนย์ควบคุม Agent',
  'home.subtitle': 'ควบคุม MCP gateway และติดตามงานแบบ realtime',
  'agent.ready': 'Agent พร้อมทำงาน',
  'agent.busy': 'Agent กำลังทำงาน',
  'agent.stopped': 'Agent หยุดทำงาน',
  'agent.mode': 'Windows Desktop Agent • WORK mode',
  'action.refresh': 'รีเฟรช',
  'action.stop': 'หยุด',
  'action.restart': 'รีสตาร์ท',
  'action.retry': 'ลองใหม่',
  'mcp.localUrl': 'MCP URL (local)',
  'mcp.stdioCommand': 'คำสั่ง Secure Tunnel (stdio)',
  'mcp.copy': 'คัดลอก',
  'mcp.copied': 'คัดลอกแล้ว',
  'tunnel.title': 'Secure MCP Tunnel สำหรับ ChatGPT',
  'tunnel.start': 'เริ่ม Tunnel',
  'tunnel.stop': 'หยุด Tunnel',
  'tunnel.needKey': 'บันทึก Runtime API key ครั้งแรกในการตั้งค่า',
  'tunnel.needProfile': 'AWH Runtime ยังไม่ได้ตั้งค่า Secure Tunnel',
  'tunnel.running': 'Tunnel เชื่อมต่อแล้ว (จากแอพนี้)',
  'tunnel.runningExternal': 'Tunnel เชื่อมต่อแล้ว (จากสคริปต์) — ปุ่ม Start ถูกปิดไว้แล้ว',
  'tunnel.stopped': 'Tunnel หยุดอยู่',
  'tunnel.starting': 'กำลังเริ่ม Tunnel',
  'tunnel.error': 'Tunnel มีข้อผิดพลาด',
  'project.active': 'โปรเจกต์ที่ใช้งาน',
  'project.setMain': 'ตั้งเป็นโปรเจกต์หลัก',
  'project.add': 'เพิ่มโปรเจกต์',
  'project.addHint': 'ใส่ path ของโฟลเดอร์โปรเจกต์บนเครื่องนี้',
  'project.activeList': 'โปรเจกต์ที่ใช้งานอยู่',
  'project.archivedList': 'โปรเจกต์ที่เก็บถาวร',
  'project.systemList': 'System Workspaces',
  'project.archive': 'เก็บถาวร',
  'project.restore': 'นำกลับมาใช้งาน',
  'project.delete': 'ลบรายการ',
  'project.confirmDelete': 'ยืนยันลบรายการ',
  'project.cancel': 'ยกเลิก',
  'project.archivedBadge': 'เก็บถาวร',
  'project.systemBadge': 'ระบบ',
  'project.systemHint': 'Workspace นี้ AWH จัดการอัตโนมัติ จึงไม่สามารถเก็บถาวรหรือลบได้',
  'project.emptyActive': 'ยังไม่มีโปรเจกต์ที่ใช้งานอยู่',
  'project.emptyArchived': 'ยังไม่มีโปรเจกต์ที่เก็บถาวร',
  'project.deleteHint': 'ลบเฉพาะรายการออกจาก AWH เท่านั้น — โฟลเดอร์ ไฟล์ และ Git ของโปรเจกต์จะไม่ถูกลบ',
  'info.workspace': 'Workspace',
  'info.activeProject': 'Active Project',
  'info.mode': 'Mode',
  'workLog.title': 'บันทึกการทำงาน',
  'workLog.filterAll': 'ทั้งหมด',
  'workLog.filterError': 'เฉพาะ error',
  'workLog.clear': 'ล้างประวัติ',
  'workLog.empty': 'ยังไม่มีกิจกรรม',
  'scope.all': 'ทั้งหมด',
  'scope.workspace': 'Workspace',
  'scope.session': 'Session',
  'scope.clearSession': 'ล้าง Session นี้',
  'scope.clearWorkspace': 'ล้าง Workspace นี้',
  'scope.clearAll': 'ล้างทั้งหมด',
  'settings.title': 'ตั้งค่า',
  'settings.subtitle': 'ปรับแต่งภาษา สิทธิ์ความปลอดภัย และการเชื่อมต่อ Remote Tunnel สำหรับ AI Agent',
  'settings.generalTitle': 'ภาษาและการตั้งค่าทั่วไป',
  'settings.securityTitle': 'โปรไฟล์สิทธิ์ความปลอดภัย',
  'settings.tunnelTitle': 'OpenAI Secure MCP Tunnel สำหรับ ChatGPT',
  'settings.locale': 'ภาษา',
  'settings.tunnelKey': 'Runtime API key (บันทึกครั้งเดียว)',
  'settings.saveKey': 'บันทึกคีย์',
  'settings.clientPath': 'path ของ tunnel-client.exe',
  'settings.savePath': 'บันทึก path',
  'settings.permissions': 'โปรไฟล์สิทธิ์',
  'settings.unrestricted': 'โหมดเต็มสิทธิ์ (Unrestricted)',
  'settings.unrestrictedHint': 'ค่าเริ่มต้นเปิด: ลงทะเบียนทุกไดร์ฟ (C:, D:, E:), รัน cmd/powershell ได้, อ่านทุกไฟล์, รัน git ได้ทุกคำสั่ง — คำสั่งลบไฟล์ทั่วไปต้องถามก่อน',
  'settings.restartRequired': 'ต้องรีสตาร์ทแอพเพื่อให้มีผล',
  'settings.saved': 'บันทึกเรียบร้อย',
  'badge.unrestricted': 'Unrestricted',
  'security.title': 'ภาพรวมความปลอดภัย',
  'security.summaryBroad': 'การเข้าถึงกว้าง',
  'security.summaryRestricted': 'จำกัดขอบเขตแล้ว',
  'security.desktopProfile': 'Desktop Profile',
  'security.stdioProfile': 'Secure Tunnel / STDIO Profile',
  'security.strictRoots': 'Strict Roots',
  'security.aiDelete': 'AI File Delete',
  'security.unrestricted': 'Unrestricted',
  'security.workspaceScope': 'ขอบเขต Workspace',
  'security.tunnelAccess': 'Tunnel',
  'security.enabled': 'เปิด',
  'security.disabled': 'ปิด',
  'security.registeredWorkspaces': 'workspace ที่ลงทะเบียน',
  'security.allowedRoots': 'Allowed Roots',
  'security.machineRoots': 'Machine roots / workspace ที่ลงทะเบียน',
  'security.warningBroad': 'Secure Tunnel / STDIO ใช้ Full โดยปิด Strict Roots อยู่ จึงอาจมองเห็น machine roots ที่ระบบลงทะเบียนไว้ ควรเปิด Strict Roots เมื่อต้องการจำกัดเฉพาะโฟลเดอร์ที่เลือก',
  'security.strictHint': 'Strict Roots จำกัดเฉพาะ Secure Tunnel / STDIO และไม่ใช่ OS sandbox',
  'live.title': 'Live Logs',
  'live.subtitle': 'ดู log ของ tunnel, กิจกรรม MCP และ process แบบ realtime',
  'live.tabTunnel': 'Tunnel',
  'live.tabMcp': 'MCP activity',
  'live.tabProcess': 'Processes',
  'live.pause': 'หยุดชั่วคราว',
  'live.follow': 'ตามต่อ (follow)',
  'live.filter': 'กรองข้อความ...',
  'live.export': 'ส่งออกไฟล์',
  'live.clearTab': 'ล้าง Tab นี้',
  'live.captureIncident': 'บันทึกหลักฐานปัญหา',
  'live.incident.localToolFailed': 'เครื่องมือในเครื่องล้มเหลว',
  'live.incident.tunnelDisconnected': 'Tunnel หลุดการเชื่อมต่อ',
  'live.incident.remoteTurnStopped': 'Remote turn หยุดทำงาน',
  'live.incident.healthyOrInconclusive': 'ปกติหรือหลักฐานยังไม่ชัดเจน',
  'live.incident.cancelled': 'ยกเลิกการบันทึกหลักฐานแล้ว',
  'live.incident.capturing': 'กำลังบันทึกหลักฐานปัญหา…',
  'live.waiting': 'ยังไม่มีข้อมูล',
  'live.waitingTunnel': 'ยังไม่มี Tunnel log — กด Start Tunnel เพื่อเริ่มการเชื่อมต่อ',
  'live.popOut': 'เปิดหน้าต่างแยก',
  'git.title': 'สถานะ Git',
  'git.changed': 'ไฟล์ที่แก้ไข',
  'git.staged': 'ไฟล์ที่ stage แล้ว',
  'doctor.title': 'Doctor',
  'doctor.run': 'รัน Doctor',
  'doctor.noReport': 'ยังไม่มีผลการตรวจสอบ',
  'capabilities.title': 'Capabilities',
  'permission.safe': 'Safe (ปลอดภัย)',
  'permission.balanced': 'Balanced (สมดุล)',
  'permission.full': 'Full (เต็มสิทธิ์)',
  'permission.custom': 'Custom (กำหนดเอง)',
  'app.loading': 'กำลังโหลด…',
  'error.logBufferClear': 'ไม่สามารถล้าง log buffer ได้',
  'error.logExport': 'การส่งออก log ล้มเหลว',
  'error.logViewerOpen': 'ไม่สามารถเปิดหน้าต่างดู log ได้',
  'error.desktopService': 'การเชื่อมต่อเซอร์วิส Desktop ล้มเหลว',
  'error.workspaceAdd': 'ไม่สามารถเพิ่ม workspace ได้',
  'error.workspaceSelect': 'ไม่สามารถเลือก workspace ได้',
  'error.workspaceArchive': 'ไม่สามารถเปลี่ยนสถานะเก็บถาวรของ workspace ได้',
  'error.workspaceDelete': 'ไม่สามารถลบรายการ workspace ได้',
  'error.permissionProfileChange': 'ไม่สามารถเปลี่ยนโปรไฟล์สิทธิ์ได้',
  'error.unrestrictedModeChange': 'ไม่สามารถเปลี่ยนโหมดเต็มสิทธิ์ได้',
  'error.mcpStop': 'ไม่สามารถหยุด MCP ได้',
  'error.mcpRestart': 'ไม่สามารถรีสตาร์ท MCP ได้',
  'error.workLogClear': 'ไม่สามารถล้างประวัติการทำงานได้',
  'error.tunnelStart': 'ไม่สามารถเริ่ม Tunnel ได้',
  'error.tunnelStop': 'ไม่สามารถหยุด Tunnel ได้',
  'error.doctorRun': 'ไม่สามารถรัน Doctor ได้',
  'language.th': 'ไทย',
  'language.en': 'English',
};

export const en: Messages = {
  brand: 'Art’s Workspace Hub',
  'nav.home': 'Home',
  'nav.projects': 'Projects',
  'nav.git': 'Git',
  'nav.workLog': 'Work Log',
  'nav.live': 'Live Logs',
  'nav.settings': 'Settings',
  'nav.doctor': 'Doctor',
  'footer.connected': 'Connected',
  'footer.disconnected': 'Disconnected',
  'home.title': 'Agent Control Center',
  'home.subtitle': 'Control the MCP gateway and monitor work in realtime',
  'agent.ready': 'Agent ready',
  'agent.busy': 'Agent busy',
  'agent.stopped': 'Agent stopped',
  'agent.mode': 'Windows Desktop Agent • WORK mode',
  'action.refresh': 'Refresh',
  'action.stop': 'Stop',
  'action.restart': 'Restart',
  'action.retry': 'Retry',
  'mcp.localUrl': 'MCP URL (local)',
  'mcp.stdioCommand': 'Secure Tunnel command (stdio)',
  'mcp.copy': 'Copy',
  'mcp.copied': 'Copied',
  'tunnel.title': 'Secure MCP Tunnel for ChatGPT',
  'tunnel.start': 'Start Tunnel',
  'tunnel.stop': 'Stop Tunnel',
  'tunnel.needKey': 'Save a Runtime API key once in Settings',
  'tunnel.needProfile': 'AWH Runtime Secure Tunnel is not configured',
  'tunnel.running': 'Tunnel connected (from this app)',
  'tunnel.runningExternal': 'Tunnel connected (from script) — Start is disabled',
  'tunnel.stopped': 'Tunnel stopped',
  'tunnel.starting': 'Starting tunnel',
  'tunnel.error': 'Tunnel error',
  'project.active': 'Active project',
  'project.setMain': 'Set as main project',
  'project.add': 'Add project',
  'project.addHint': 'Enter a local project folder path',
  'project.activeList': 'Active projects',
  'project.archivedList': 'Archived projects',
  'project.systemList': 'System workspaces',
  'project.archive': 'Archive',
  'project.restore': 'Restore',
  'project.delete': 'Remove',
  'project.confirmDelete': 'Confirm remove',
  'project.cancel': 'Cancel',
  'project.archivedBadge': 'Archived',
  'project.systemBadge': 'System',
  'project.systemHint': 'This workspace is managed automatically by AWH and cannot be archived or removed.',
  'project.emptyActive': 'No active projects yet.',
  'project.emptyArchived': 'No archived projects.',
  'project.deleteHint': 'Removes only the AWH registration — the project folder, files, and Git repository are not deleted.',
  'info.workspace': 'Workspace',
  'info.activeProject': 'Active Project',
  'info.mode': 'Mode',
  'workLog.title': 'Work Log',
  'workLog.filterAll': 'All',
  'workLog.filterError': 'Errors only',
  'workLog.clear': 'Clear history',
  'workLog.empty': 'No activity yet',
  'scope.all': 'All',
  'scope.workspace': 'Workspace',
  'scope.session': 'Session',
  'scope.clearSession': 'Clear this session',
  'scope.clearWorkspace': 'Clear this workspace',
  'scope.clearAll': 'Clear all',
  'settings.title': 'Settings',
  'settings.subtitle': 'Configure system preferences, security profiles, and remote tunnel connections',
  'settings.generalTitle': 'Language & General Preferences',
  'settings.securityTitle': 'Security & Permission Profiles',
  'settings.tunnelTitle': 'OpenAI Secure MCP Tunnel for ChatGPT',
  'settings.locale': 'Language',
  'settings.tunnelKey': 'Runtime API key (save once)',
  'settings.saveKey': 'Save key',
  'settings.clientPath': 'tunnel-client.exe path',
  'settings.savePath': 'Save path',
  'settings.permissions': 'Permission profile',
  'settings.unrestricted': 'Unrestricted mode',
  'settings.unrestrictedHint': 'Default on: registers every drive (C:, D:, E:), allows cmd/powershell, reads any file, and runs every git command — filesystem deletes must be confirmed',
  'settings.restartRequired': 'Restart the app to apply',
  'settings.saved': 'Saved successfully',
  'badge.unrestricted': 'Unrestricted',
  'security.title': 'Security Overview',
  'security.summaryBroad': 'Broad access',
  'security.summaryRestricted': 'Restricted scope',
  'security.desktopProfile': 'Desktop Profile',
  'security.stdioProfile': 'Secure Tunnel / STDIO Profile',
  'security.strictRoots': 'Strict Roots',
  'security.aiDelete': 'AI File Delete',
  'security.unrestricted': 'Unrestricted',
  'security.workspaceScope': 'Workspace Scope',
  'security.tunnelAccess': 'Tunnel',
  'security.enabled': 'On',
  'security.disabled': 'Off',
  'security.registeredWorkspaces': 'registered workspaces',
  'security.allowedRoots': 'Allowed Roots',
  'security.machineRoots': 'Machine roots / registered workspaces',
  'security.warningBroad': 'Secure Tunnel / STDIO is using Full with Strict Roots off, so registered machine roots may be visible. Enable Strict Roots to limit access to selected folders.',
  'security.strictHint': 'Strict Roots scopes Secure Tunnel / STDIO only and is not an OS sandbox.',
  'live.title': 'Live Logs',
  'live.subtitle': 'Real-time tunnel, MCP activity, and process logs',
  'live.tabTunnel': 'Tunnel',
  'live.tabMcp': 'MCP activity',
  'live.tabProcess': 'Processes',
  'live.pause': 'Pause',
  'live.follow': 'Follow',
  'live.filter': 'Filter text...',
  'live.export': 'Export file',
  'live.clearTab': 'Clear tab',
  'live.captureIncident': 'Capture incident evidence',
  'live.incident.localToolFailed': 'Local tool failed',
  'live.incident.tunnelDisconnected': 'Tunnel disconnected',
  'live.incident.remoteTurnStopped': 'Remote turn stopped',
  'live.incident.healthyOrInconclusive': 'Healthy or inconclusive',
  'live.incident.cancelled': 'Incident capture cancelled',
  'live.incident.capturing': 'Capturing incident evidence…',
  'live.waiting': 'No data yet',
  'live.waitingTunnel': 'No Tunnel log yet — press Start Tunnel to start the connection.',
  'live.popOut': 'Pop out viewer',
  'git.title': 'Git status',
  'git.changed': 'changed',
  'git.staged': 'staged',
  'doctor.title': 'Doctor',
  'doctor.run': 'Run doctor',
  'doctor.noReport': 'No report yet.',
  'capabilities.title': 'Capabilities',
  'permission.safe': 'Safe',
  'permission.balanced': 'Balanced',
  'permission.full': 'Full',
  'permission.custom': 'Custom',
  'app.loading': 'Loading…',
  'error.logBufferClear': 'Log buffer could not be cleared',
  'error.logExport': 'Log export failed',
  'error.logViewerOpen': 'Log viewer could not be opened',
  'error.desktopService': 'Desktop service request failed',
  'error.workspaceAdd': 'Workspace could not be added',
  'error.workspaceSelect': 'Workspace could not be selected',
  'error.workspaceArchive': 'Workspace archive state could not be changed',
  'error.workspaceDelete': 'Workspace registration could not be removed',
  'error.permissionProfileChange': 'Permission profile could not be changed',
  'error.unrestrictedModeChange': 'Unrestricted mode could not be changed',
  'error.mcpStop': 'MCP could not be stopped',
  'error.mcpRestart': 'MCP could not be restarted',
  'error.workLogClear': 'Work log could not be cleared',
  'error.tunnelStart': 'Tunnel could not be started',
  'error.tunnelStop': 'Tunnel could not be stopped',
  'error.doctorRun': 'Doctor could not run',
  'language.th': 'ไทย',
  'language.en': 'English',
};
