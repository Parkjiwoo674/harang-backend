import { Request, Response, NextFunction } from 'express'
import { AppError } from '../lib/errors'
import logger from '../lib/logger'
import { Prisma } from '@prisma/client'
import { ZodError } from 'zod'
import { env } from '../lib/env'

export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  next: NextFunction
) {
  // 1. AppError (우리가 직접 던진 에러)
  if (err instanceof AppError) {
    logger.warn(`${err.statusCode} - ${err.message} - ${req.method} ${req.originalUrl}`)
    return res.status(err.statusCode).json({
      error: err.message,
      statusCode: err.statusCode
    })
  }

  // 2. Zod Validation Error
  if (err instanceof ZodError) {
    logger.warn(`Validation Error - ${req.method} ${req.originalUrl}`, { errors: err.errors })
    return res.status(400).json({
      error: '입력 데이터가 올바르지 않습니다.',
      details: err.errors.map(e => ({
        field: e.path.join('.'),
        message: e.message
      }))
    })
  }

  // 3. Prisma Errors
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    // P2002: Unique constraint violation
    if (err.code === 'P2002') {
      const field = (err.meta?.target as string[])?.join(', ') || '필드'
      logger.warn(`Duplicate entry - ${field} - ${req.method} ${req.originalUrl}`)
      return res.status(409).json({
        error: `이미 존재하는 ${field}입니다.`
      })
    }

    // P2025: Record not found
    if (err.code === 'P2025') {
      logger.warn(`Record not found - ${req.method} ${req.originalUrl}`)
      return res.status(404).json({
        error: '요청한 데이터를 찾을 수 없습니다.'
      })
    }

    // 기타 Prisma 에러
    logger.error(`Prisma Error [${err.code}]: ${err.message}`, { meta: err.meta })
    return res.status(400).json({
      error: '데이터베이스 작업 중 오류가 발생했습니다.'
    })
  }

  // 4. JWT Errors
  if (err.name === 'JsonWebTokenError') {
    logger.warn(`Invalid JWT - ${req.method} ${req.originalUrl}`)
    return res.status(401).json({
      error: '유효하지 않은 토큰입니다.'
    })
  }

  if (err.name === 'TokenExpiredError') {
    logger.warn(`Expired JWT - ${req.method} ${req.originalUrl}`)
    return res.status(401).json({
      error: '토큰이 만료되었습니다. 다시 로그인해주세요.'
    })
  }

  // 5. 기타 모든 에러 (500 Internal Server Error)
  logger.error(`Unhandled Error: ${err.message}`, {
    stack: err.stack,
    method: req.method,
    url: req.originalUrl,
    body: req.body
  })

  return res.status(500).json({
    error: env.NODE_ENV === 'production'
      ? '서버 오류가 발생했습니다. 잠시 후 다시 시도해주세요.'
      : err.message
  })
}
