import { Request, Response, NextFunction } from 'express'

// Express async 라우터에서 발생하는 에러를 자동으로 next()로 전달
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<any>
) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next)
  }
}
