import { describe, expect, it } from 'vitest'
import { renderMarkdown } from './markdown'
import {
  BUILTIN_TEMPLATES,
  compressSpace,
  detectQuestionType,
  judgeAnswer,
  parseAnswer,
  parseAnswerSection,
  splitAndParse,
} from '@kaoshiya/shared'

describe('受限 Markdown 渲染', () => {
  it('渲染段落、加粗与代码', () => {
    const html = renderMarkdown('普通**加粗**与 `code`')
    expect(html).toContain('<strong>加粗</strong>')
    expect(html).toContain('<code>code</code>')
  })

  it('过滤 script 与事件属性', () => {
    const html = renderMarkdown('<script>alert(1)</script><img src=x onerror="alert(1)">')
    // 标签被转义为文本，且不允许出现带事件属性的真实标签
    expect(html).not.toContain('<script')
    expect(html).not.toMatch(/<[^>]+\son[a-z]+=/i)
  })

  it('只允许 http(s)、/media 与 data:image 的图片地址', () => {
    expect(renderMarkdown('![a](https://example.com/a.png)')).toContain('src="https://example.com/a.png"')
    expect(renderMarkdown('![a](/media/abc.png)')).toContain('src="/media/abc.png"')
    expect(renderMarkdown('![a](javascript:alert(1))')).not.toContain('javascript:')
  })

  it('渲染表格与列表', () => {
    const table = renderMarkdown('| A | B |\n| --- | --- |\n| 1 | 2 |')
    expect(table).toContain('<table>')
    expect(table).toContain('<td>1</td>')
    expect(renderMarkdown('- 一\n- 二')).toContain('<ul>')
  })
})

describe('答案与题型归一化', () => {
  it('解析单字母与多字母答案', () => {
    expect(parseAnswer('A')).toEqual(['A'])
    expect(parseAnswer('A、B、D')).toEqual(['A', 'B', 'D'])
    expect(parseAnswer('ABCD')).toEqual(['A', 'B', 'C', 'D'])
  })

  it('判断题统一为 T / F', () => {
    expect(parseAnswer('√')).toEqual(['T'])
    expect(parseAnswer('错误')).toEqual(['F'])
    expect(parseAnswer('对')).toEqual(['T'])
  })

  it('卷末答案表支持区间式与逐题式', () => {
    const range = parseAnswerSection('1-5 ABCDA')
    expect(range.get(1)).toEqual(['A'])
    expect(range.get(5)).toEqual(['A'])
    const pairs = parseAnswerSection('1.B 2.√ 3.错')
    expect(pairs.get(1)).toEqual(['B'])
    expect(pairs.get(2)).toEqual(['T'])
    expect(pairs.get(3)).toEqual(['F'])
  })

  it('识别题型', () => {
    expect(
      detectQuestionType({
        stem: '问题',
        options: [
          { key: 'A', text: '1' },
          { key: 'B', text: '2' },
        ],
        answer: ['A'],
      }),
    ).toBe('single')
    expect(
      detectQuestionType({
        stem: '问题',
        options: [
          { key: 'A', text: '1' },
          { key: 'B', text: '2' },
        ],
        answer: ['A', 'B'],
      }),
    ).toBe('multiple')
    expect(detectQuestionType({ stem: '判断（ ）', options: [], answer: ['T'] })).toBe('judge')
    expect(detectQuestionType({ stem: '简答', options: [], answer: ['这是一段很长的参考答案文本，需要自评'] })).toBe('essay')
  })

  it('判分忽略大小写与多余空白', () => {
    expect(judgeAnswer('single', ['B'], ['b'])).toBe(true)
    expect(judgeAnswer('blank', ['TCP/IP'], ['tcp/ip'])).toBe(true)
    expect(judgeAnswer('multiple', ['A', 'C'], ['C', 'A'])).toBe(true)
    expect(judgeAnswer('multiple', ['A', 'C'], ['A'])).toBe(false)
  })

  it('空白压缩不改变语义', () => {
    expect(compressSpace('  甲   乙  ')).toBe('甲 乙')
  })
})

describe('切题模板', () => {
  it('编号式不把 1.1 这类小节号当成题号', () => {
    const template = BUILTIN_TEMPLATES.find((item) => item.id === 'numbered')
    expect(template).toBeTruthy()
    const blocks = splitAndParse('1.1 硬件组成\n1. 第一题\nA. 甲\nB. 乙\n答案：A', template!)
    expect(blocks.length).toBe(1)
    expect(blocks[0]?.stem).toContain('第一题')
    expect(blocks[0]?.answer).toEqual(['A'])
  })

  it('可以解析多行选项与解析', () => {
    const template = BUILTIN_TEMPLATES.find((item) => item.id === 'numbered')!
    const blocks = splitAndParse('2. 第二题？\nA. 甲\nB. 乙\n答案：B\n解析：因为乙正确。', template)
    expect(blocks.length).toBe(1)
    expect(blocks[0]?.options.length).toBe(2)
    expect(blocks[0]?.explanation).toContain('因为乙正确')
  })
})
