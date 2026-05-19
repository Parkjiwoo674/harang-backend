import { Request, Response, NextFunction } from 'express'
import { ZodSchema } from 'zod'

// Zod 스키마를 사용한 요청 검증 미들웨어
export function validate(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      schema.parse(req.body)
      next()
    } catch (error) {
      next(error) // ZodError를 errorHandler로 전달
    }
  }
}

// Query 파라미터 검증
export function validateQuery(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      schema.parse(req.query)
      next()
    } catch (error) {
      next(error)
    }
  }
}

// Params 검증
export function validateParams(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      schema.parse(req.params)
      next()
    } catch (error) {
      next(error)
    }
  }
}
