import winston from 'winston'
import { env } from './env'
import fs from 'fs'
import path from 'path'

const { combine, timestamp, printf, colorize, errors } = winston.format

// 로그 디렉토리 자동 생성
function ensureLogDirectory() {
  if (env.NODE_ENV === 'production') {
    const logDir = path.join(process.cwd(), 'logs')
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true })
      console.log(`📁 로그 디렉토리 생성: ${logDir}`)
    }
  }
}

ensureLogDirectory()

// 로그 포맷 정의
const logFormat = printf(({ level, message, timestamp, stack }) => {
  return `${timestamp} [${level}]: ${stack || message}`
})

// 개발 환경용 포맷 (컬러 + 간단)
const devFormat = combine(
  colorize(),
  timestamp({ format: 'HH:mm:ss' }),
  errors({ stack: true }),
  logFormat
)

// 프로덕션 환경용 포맷 (JSON)
const prodFormat = combine(
  timestamp(),
  errors({ stack: true }),
  winston.format.json()
)

// Logger 생성
const logger = winston.createLogger({
  level: env.NODE_ENV === 'production' ? 'info' : 'debug',
  format: env.NODE_ENV === 'production' ? prodFormat : devFormat,
  transports: [
    // 콘솔 출력
    new winston.transports.Console(),
    
    // 에러 로그 파일 (production only)
    ...(env.NODE_ENV === 'production' ? [
      new winston.transports.File({ 
        filename: 'logs/error.log', 
        level: 'error',
        maxsize: 5242880, // 5MB
        maxFiles: 5,
      }),
      new winston.transports.File({ 
        filename: 'logs/combined.log',
        maxsize: 5242880, // 5MB
        maxFiles: 5,
      })
    ] : [])
  ],
})

// HTTP 요청 로깅 미들웨어
export function requestLogger(req: any, res: any, next: any) {
  const start = Date.now()
  
  res.on('finish', () => {
    const duration = Date.now() - start
    const message = `${req.method} ${req.originalUrl} ${res.statusCode} - ${duration}ms`
    
    if (res.statusCode >= 500) {
      logger.error(message)
    } else if (res.statusCode >= 400) {
      logger.warn(message)
    } else {
      logger.info(message)
    }
  })
  
  next()
}

export default logger
