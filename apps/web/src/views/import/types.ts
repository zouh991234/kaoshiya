import type { QuestionMedia, QuestionOption, QuestionType, QualityIssue, SrcRef } from '@kaoshiya/shared'

/** 校对工作台里的可编辑题目。uid 仅用于列表 key，不提交给服务端。 */
export interface EditableQuestion {
  uid: string
  no: number | null
  type: QuestionType
  stem: string
  options: QuestionOption[]
  answer: string[]
  explanation: string
  difficulty: number
  tags: string[]
  chapterName: string
  media: QuestionMedia[]
  srcRef: SrcRef | null
  issues: QualityIssue[]
}

export interface ImportDraft {
  bankId: string
  fileName: string
  text: string
  pageTexts: string[]
  questions: EditableQuestion[]
  templateId: string
  updatedAt: string
}
