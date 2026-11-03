/**
 * 演示数据初始化命令（显式执行才会生成，正式部署默认不产生任何演示账号或固定密码）。
 *
 *   node dist/seed-demo.js           生成演示账号与 3 套演示题库
 *   node dist/seed-demo.js --clean   清除演示账号与演示题库
 *
 * 演示账号初始密码随机生成并打印一次，首次登录需改密。
 */
import path from 'node:path'
import process from 'node:process'
import { openDatabase } from './db/index.js'
import type { Db } from './db/index.js'
import { ensureBaseline, migrate } from './db/migrate.js'
import { hashPassword } from './auth/password.js'
import { generateInitialPassword, newId, nowIso } from './util.js'
import { ROLE_ADMIN, ROLE_MEMBER } from '@kaoshiya/shared'

const DEMO_PREFIX = '【演示】'

interface SeedQuestion {
  type: 'single' | 'multiple' | 'judge' | 'blank' | 'essay'
  no: number | null
  stem: string
  options?: { key: string; text: string }[]
  answer: string[]
  explanation?: string
  chapter?: string
  difficulty?: number
  tags?: string[]
}

interface SeedBank {
  name: string
  subject: string
  description: string
  chapters: string[]
  questions: SeedQuestion[]
}

const BANKS: SeedBank[] = [
  {
    name: `${DEMO_PREFIX}计算机基础`,
    subject: '计算机基础',
    description: '来源：模拟 Word 编号式文档（含少量脏数据，用于演示校对与质量报告）',
    chapters: ['计算机组成', '编程语言'],
    questions: [
      {
        type: 'single',
        no: 1,
        chapter: '计算机组成',
        stem: 'CPU 中负责算术运算和逻辑运算的部件是？',
        options: [
          { key: 'A', text: '控制器' },
          { key: 'B', text: '运算器' },
          { key: 'C', text: '寄存器' },
          { key: 'D', text: '总线' },
        ],
        answer: ['B'],
        explanation: '运算器（ALU）负责算术与逻辑运算，控制器负责指令译码与调度。',
        difficulty: 1,
        tags: ['硬件'],
      },
      {
        type: 'single',
        no: 2,
        chapter: '计算机组成',
        stem: '下列存储器中，断电后数据会丢失的是？',
        options: [
          { key: 'A', text: 'ROM' },
          { key: 'B', text: '硬盘' },
          { key: 'C', text: 'RAM' },
          { key: 'D', text: 'U 盘' },
        ],
        answer: ['C'],
        explanation: 'RAM 是易失性存储器，断电后内容丢失。',
        difficulty: 1,
        tags: ['硬件'],
      },
      {
        type: 'multiple',
        no: 3,
        chapter: '计算机组成',
        stem: '下列属于输入设备的有？',
        options: [
          { key: 'A', text: '键盘' },
          { key: 'B', text: '鼠标' },
          { key: 'C', text: '显示器' },
          { key: 'D', text: '扫描仪' },
        ],
        answer: ['A', 'B', 'D'],
        explanation: '显示器是输出设备。',
        difficulty: 1,
        tags: ['硬件'],
      },
      {
        type: 'single',
        no: 4,
        chapter: '编程语言',
        stem: '下列哪个是编译型语言？',
        options: [
          { key: 'A', text: 'Python' },
          { key: 'B', text: 'C' },
          { key: 'C', text: 'JavaScript' },
          { key: 'D', text: 'Ruby' },
        ],
        answer: ['B'],
        explanation: 'C 语言需要先编译为机器码再执行。',
        difficulty: 2,
        tags: ['语言'],
      },
      {
        type: 'single',
        no: 5,
        chapter: '编程语言',
        stem: 'HTTP 状态码 404 表示？',
        options: [
          { key: 'A', text: '请求成功' },
          { key: 'B', text: '重定向' },
          { key: 'C', text: '资源不存在' },
          { key: 'D', text: '服务器错误' },
        ],
        answer: ['C'],
        explanation: '',
        difficulty: 1,
        tags: ['网络'],
      },
      {
        // 脏数据：重复题号
        type: 'single',
        no: 5,
        chapter: '编程语言',
        stem: '二进制 1010 对应的十进制值是？',
        options: [
          { key: 'A', text: '8' },
          { key: 'B', text: '10' },
          { key: 'C', text: '12' },
          { key: 'D', text: '16' },
        ],
        answer: ['B'],
        explanation: '1×8 + 0×4 + 1×2 + 0×1 = 10。',
        difficulty: 2,
        tags: ['进制'],
      },
      {
        // 脏数据：答案越界（E 不存在）
        type: 'single',
        no: 6,
        chapter: '编程语言',
        stem: '下列哪种排序算法的平均时间复杂度是 O(n log n)？',
        options: [
          { key: 'A', text: '冒泡排序' },
          { key: 'B', text: '插入排序' },
          { key: 'C', text: '快速排序' },
          { key: 'D', text: '选择排序' },
        ],
        answer: ['E'],
        explanation: '快速排序平均 O(n log n)，最坏 O(n²)。',
        difficulty: 3,
        tags: ['算法'],
      },
      {
        // 脏数据：重复题干
        type: 'single',
        no: 7,
        chapter: '编程语言',
        stem: 'HTTP 状态码 404 表示？',
        options: [
          { key: 'A', text: '请求成功' },
          { key: 'B', text: '重定向' },
          { key: 'C', text: '资源不存在' },
          { key: 'D', text: '服务器错误' },
        ],
        answer: ['C'],
        explanation: '客户端请求的资源在服务器上不存在。',
        difficulty: 1,
        tags: ['网络'],
      },
    ],
  },
  {
    name: `${DEMO_PREFIX}低压电工`,
    subject: '低压电工作业',
    description: '来源：模拟 PDF（答案集中在卷末，用于演示答案分离式切题）',
    chapters: ['安全用电', '电工基础'],
    questions: [
      {
        type: 'judge',
        no: 1,
        chapter: '安全用电',
        stem: '发现有人触电，应立即用手将其拉开。',
        answer: ['F'],
        explanation: '应先切断电源或用绝缘物挑开电线，直接用手会导致救护者触电。',
        difficulty: 1,
        tags: ['急救'],
      },
      {
        type: 'judge',
        no: 2,
        chapter: '安全用电',
        stem: '低压是指对地电压在 250V 及以下的电压。',
        answer: ['T'],
        explanation: '按我国标准，工频低压为 250V 及以下。',
        difficulty: 2,
        tags: ['概念'],
      },
      {
        type: 'single',
        no: 3,
        chapter: '电工基础',
        stem: '三相异步电动机的转向由什么决定？',
        options: [
          { key: 'A', text: '电源频率' },
          { key: 'B', text: '相序' },
          { key: 'C', text: '负载大小' },
          { key: 'D', text: '绕组匝数' },
        ],
        answer: ['B'],
        explanation: '调换任意两相即可改变相序，从而改变转向。',
        difficulty: 2,
        tags: ['电机'],
      },
      {
        type: 'single',
        no: 4,
        chapter: '电工基础',
        stem: '万用表测量电阻前，必须？',
        options: [
          { key: 'A', text: '通电测量' },
          { key: 'B', text: '断电并断开被测元件' },
          { key: 'C', text: '短路表笔' },
          { key: 'D', text: '调到电压档' },
        ],
        answer: ['B'],
        explanation: '',
        difficulty: 2,
        tags: ['仪表'],
      },
      {
        type: 'judge',
        no: 5,
        chapter: '安全用电',
        stem: '漏电保护器可以代替接地保护。',
        answer: ['F'],
        explanation: '漏电保护器不能代替保护接地或保护接零。',
        difficulty: 3,
        tags: ['保护'],
      },
      {
        // 脏数据：缺答案
        type: 'single',
        no: 6,
        chapter: '电工基础',
        stem: '欧姆定律的表达式是？',
        options: [
          { key: 'A', text: 'U = I / R' },
          { key: 'B', text: 'I = U / R' },
          { key: 'C', text: 'R = U × I' },
          { key: 'D', text: 'P = U × I' },
        ],
        answer: [],
        explanation: '',
        difficulty: 1,
        tags: ['基础'],
      },
    ],
  },
  {
    name: `${DEMO_PREFIX}安全生产法规`,
    subject: '安全生产',
    description: '来源：模拟 Excel 表格（演示列映射导入）',
    chapters: ['法律法规', '事故处理'],
    questions: [
      {
        type: 'single',
        no: 1,
        chapter: '法律法规',
        stem: '《安全生产法》规定，生产经营单位的主要负责人对本单位的安全生产工作？',
        options: [
          { key: 'A', text: '负全面责任' },
          { key: 'B', text: '负部分责任' },
          { key: 'C', text: '不负责任' },
          { key: 'D', text: '仅负监督责任' },
        ],
        answer: ['A'],
        explanation: '主要负责人是本单位安全生产第一责任人。',
        difficulty: 2,
        tags: ['法律'],
      },
      {
        type: 'multiple',
        no: 2,
        chapter: '法律法规',
        stem: '生产经营单位应当对从业人员进行哪些培训？',
        options: [
          { key: 'A', text: '安全生产教育和培训' },
          { key: 'B', text: '岗位安全操作技能' },
          { key: 'C', text: '应急处理能力' },
          { key: 'D', text: '个人理财' },
        ],
        answer: ['A', 'B', 'C'],
        explanation: '培训内容与安全生产直接相关。',
        difficulty: 2,
        tags: ['培训'],
      },
      {
        type: 'single',
        no: 3,
        chapter: '事故处理',
        stem: '生产安全事故报告应当遵循的原则是？',
        options: [
          { key: 'A', text: '及时、准确、完整' },
          { key: 'B', text: '先处理后报告' },
          { key: 'C', text: '只报重大事故' },
          { key: 'D', text: '内部消化' },
        ],
        answer: ['A'],
        explanation: '《生产安全事故报告和调查处理条例》明确要求及时、准确、完整。',
        difficulty: 2,
        tags: ['事故'],
      },
      {
        type: 'essay',
        no: 4,
        chapter: '事故处理',
        stem: '简述发生生产安全事故后，现场人员应采取的处置步骤。',
        answer: [
          '立即报告现场负责人并启动应急预案；在保证自身安全前提下组织救援与人员疏散；保护事故现场；配合事故调查并如实提供情况。',
        ],
        explanation: '主观题，交卷后按参考答案自评。',
        difficulty: 4,
        tags: ['主观题'],
      },
      {
        // 脏数据：缺解析
        type: 'judge',
        no: 5,
        chapter: '法律法规',
        stem: '安全生产责任制只需要主要负责人签字确认即可。',
        answer: ['F'],
        explanation: '',
        difficulty: 3,
        tags: ['责任'],
      },
    ],
  },
]

function insertBank(db: Db, ownerId: string, bank: SeedBank): void {
  const bankId = newId('bank')
  const now = nowIso()
  db.prepare(
    `INSERT INTO banks (id, name, subject, description, visibility, owner_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'public', ?, ?, ?)`,
  ).run(bankId, bank.name, bank.subject, bank.description, ownerId, now, now)

  const chapterIds = new Map<string, string>()
  bank.chapters.forEach((name, index) => {
    const id = newId('ch')
    db.prepare('INSERT INTO chapters (id, bank_id, name, sort_order) VALUES (?, ?, ?, ?)').run(
      id,
      bankId,
      name,
      (index + 1) * 10,
    )
    chapterIds.set(name, id)
  })

  const insertQuestion = db.prepare(
    `INSERT INTO questions (id, bank_id, chapter_id, type, no, stem, options, answer, explanation, difficulty, tags, media, src_ref, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, ?)`,
  )
  for (const question of bank.questions) {
    insertQuestion.run(
      newId('q'),
      bankId,
      question.chapter ? chapterIds.get(question.chapter) ?? null : null,
      question.type,
      question.no,
      question.stem,
      JSON.stringify(question.options ?? []),
      JSON.stringify(question.answer),
      question.explanation ?? '',
      question.difficulty ?? 3,
      JSON.stringify(question.tags ?? []),
      JSON.stringify({ file: bank.description.slice(0, 40) }),
      now,
    )
  }
}

async function ensureDemoUser(db: Db, username: string, displayName: string, roleName: string): Promise<string> {
  const role = db.prepare('SELECT id FROM roles WHERE name = ?').get(roleName) as { id: string } | undefined
  if (!role) throw new Error(`缺少内置角色：${roleName}`)
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username) as { id: string } | undefined
  if (existing) {
    console.log(`  · 已存在用户 ${username}，跳过`)
    return existing.id
  }
  const password = generateInitialPassword()
  const hash = await hashPassword(password)
  const id = newId('u')
  db.prepare(
    `INSERT INTO users (id, username, display_name, status, pwd_hash, created_at, last_login_at, must_change_pwd)
     VALUES (?, ?, ?, 'active', ?, ?, NULL, 1)`,
  ).run(id, username, displayName, hash, nowIso())
  db.prepare('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)').run(id, role.id)
  console.log(`  · 新建演示账号 ${username} / 初始密码：${password}`)
  return id
}

async function seed(): Promise<void> {
  const dbPath = process.env.DATABASE_PATH ?? path.resolve('./data/kaoshiya.db')
  const db = openDatabase(dbPath)
  migrate(db)
  ensureBaseline(db)

  const owner = db.prepare(
    `SELECT u.id FROM users u JOIN user_roles ur ON ur.user_id = u.id JOIN roles r ON r.id = ur.role_id WHERE r.name = 'owner' LIMIT 1`,
  ).get() as { id: string } | undefined
  if (!owner) {
    console.error('还没有 owner 账号，请先在网页端完成 /setup 初始化，再执行演示数据初始化。')
    process.exit(1)
  }

  console.log('创建演示账号：')
  await ensureDemoUser(db, 'demo_admin', '演示管理员', ROLE_ADMIN)
  await ensureDemoUser(db, 'demo_member', '演示成员', ROLE_MEMBER)

  const existing = db.prepare('SELECT COUNT(*) AS c FROM banks WHERE name LIKE ?').get(`${DEMO_PREFIX}%`) as {
    c: number
  }
  if (existing.c > 0) {
    console.log(`已存在 ${existing.c} 套演示题库，跳过创建（如需重建请先执行 --clean）。`)
  } else {
    console.log('创建演示题库：')
    db.transaction(() => {
      for (const bank of BANKS) {
        insertBank(db, owner.id, bank)
        console.log(`  · ${bank.name}（${bank.questions.length} 题）`)
      }
    })()
  }
  console.log(`\n完成。数据库：${dbPath}`)
  db.close()
}

function clean(): void {
  const dbPath = process.env.DATABASE_PATH ?? path.resolve('./data/kaoshiya.db')
  const db = openDatabase(dbPath)
  const banks = db.prepare('SELECT id, name FROM banks WHERE name LIKE ?').all(`${DEMO_PREFIX}%`) as {
    id: string
    name: string
  }[]
  const users = db
    .prepare("SELECT id, username FROM users WHERE username IN ('demo_admin', 'demo_member')")
    .all() as { id: string; username: string }[]
  db.transaction(() => {
    for (const bank of banks) {
      db.prepare('DELETE FROM exam_records WHERE bank_id = ?').run(bank.id)
      db.prepare('DELETE FROM exam_configs WHERE bank_id = ?').run(bank.id)
      db.prepare('DELETE FROM questions WHERE bank_id = ?').run(bank.id)
      db.prepare('DELETE FROM chapters WHERE bank_id = ?').run(bank.id)
      db.prepare('DELETE FROM banks WHERE id = ?').run(bank.id)
    }
    for (const user of users) {
      db.prepare('DELETE FROM users WHERE id = ?').run(user.id)
    }
  })()
  console.log(`已清除 ${banks.length} 套演示题库与 ${users.length} 个演示账号。`)
  db.close()
}

const isClean = process.argv.includes('--clean')
if (isClean) clean()
else void seed()
