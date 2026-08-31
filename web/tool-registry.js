export const SCHOOL_TOOLS = Object.freeze([
  { id: 'documents', icon: '▤', title: 'สร้างเอกสาร', copy: 'บันทึกข้อความ รายงาน หนังสือ และงานโรงเรียน', badge: '', mode: 'ai-document' },
  { id: 'pdf', icon: 'PDF', title: 'จัดการ PDF', copy: 'รวม แยก/เลือกหน้า หมุน และรวมรูปเป็น PDF', badge: 'ฟรี', mode: 'local' },
  { id: 'qr', icon: 'QR', title: 'สร้าง QR', copy: 'สร้าง QR จากลิงก์หรือข้อความพร้อมดาวน์โหลด', badge: 'ฟรี', mode: 'local' },
  { id: 'image', icon: '▧', title: 'จัดการรูปภาพ', copy: 'ย่อขนาด บีบอัด และแปลงไฟล์รูป', badge: 'ฟรี', mode: 'local' },
  { id: 'ai', icon: '✦', title: 'แชทกับ AWH', copy: 'ถาม เขียน สรุป คิด และสั่งงานด้วยภาษาปกติ', badge: '', mode: 'ai' },
  { id: 'attach', icon: '＋', title: 'แนบไฟล์ให้ AWH', copy: 'ส่งไฟล์แล้วบอกว่าอยากให้ช่วยอะไร', badge: '', mode: 'ai-attach' },
  { id: 'project-factory', icon: '⌘', title: 'สร้างโปรเจกต์', copy: 'เริ่มงานโปรเจกต์ใหม่จากเป้าหมายที่บอก AWH', badge: '', mode: 'project-factory' },
]);

export const OWNER_TOOLS = Object.freeze([
  { id: 'projects', icon: '◫', title: 'Projects', copy: 'โปรเจกต์ทั้งหมดและบริบทงาน' },
  { id: 'multi-chat', icon: '☰', title: 'Multi Chat', copy: 'การสนทนาแยกตามโปรเจกต์' },
  { id: 'memory', icon: '◎', title: 'Memory', copy: 'ความจำและความต่อเนื่องของ AWH' },
  { id: 'tasks', icon: '↻', title: 'Tasks & Executions', copy: 'ติดตามงาน การทำงาน และผลลัพธ์' },
  { id: 'devices', icon: '◇', title: 'Devices', copy: 'Mac, Windows และอุปกรณ์ที่เชื่อมต่อ' },
  { id: 'system', icon: '⚙', title: 'System', copy: 'สุขภาพระบบและ Database Studio' },
]);
