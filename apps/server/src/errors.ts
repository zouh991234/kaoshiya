/** 统一错误模型：对外只返回稳定错误码与可读信息，绝不泄露堆栈或 SQL。 */
export class ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export const badRequest = (message: string, details?: unknown): ApiError =>
  new ApiError(400, 'BAD_REQUEST', message, details)

export const unauthorized = (message = '请先登录'): ApiError => new ApiError(401, 'UNAUTHORIZED', message)

export const forbidden = (message = '没有执行该操作的权限'): ApiError => new ApiError(403, 'FORBIDDEN', message)

export const notFound = (message = '资源不存在'): ApiError => new ApiError(404, 'NOT_FOUND', message)

export const conflict = (message: string, details?: unknown): ApiError =>
  new ApiError(409, 'CONFLICT', message, details)

export const tooManyRequests = (message: string): ApiError => new ApiError(429, 'TOO_MANY_REQUESTS', message)

export const payloadTooLarge = (message: string): ApiError => new ApiError(413, 'PAYLOAD_TOO_LARGE', message)
