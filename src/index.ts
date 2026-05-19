import dotenv from 'dotenv'
dotenv.config()

// 환경 변수 검증 (가장 먼저 실행)
import { env } from './lib/env'

import express, { Request, Response, NextFunction } from 'express'
import cors from 'cors'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import { createServer } from 'http'
import { initSocket } from './socket'
import prisma from './lib/prisma'
import logger, { requestLogger } from './lib/logger'
import { errorHandler } from './middleware/errorHandler'

import authRouter from './routes/auth'
import usersRouter from './routes/users'
import chatRouter from './routes/chat'
import announcementsRouter from './routes/announcements'
import assignmentsRouter from './routes/assignments'
import gradesRouter from './routes/grades'
import scheduleRouter from './routes/schedule'
import qnaRouter from './routes/qna'
import notificationsRouter from './routes/notifications'

const app = express()
const PORT = Number(env.PORT)
const CLIENT_URL = env.CLIENT_URL

// ── 보안 미들웨어 ──────────────────────────────────────────
app.use(helmet())
app.use(cors({ origin: CLIENT_URL, credentials: true }))
app.use(express.json({ limit: '10mb' }))
app.use(requestLogger) // HTTP 요청 로깅

// Rate Limiting - 전역
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15분
  max: 100, // IP당 최대 100 요청
  message: { error: '너무 많은 요청을 보냈습니다. 잠시 후 다시 시도해주세요.' },
  standardHeaders: true,
  legacyHeaders: false,
})

// Rate Limiting - 인증 엔드포인트 (더 엄격)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15분
  max: 5, // 로그인/회원가입 시도 5회 제한
  message: { error: '로그인 시도 횟수를 초과했습니다. 15분 후 다시 시도해주세요.' },
  standardHeaders: true,
  legacyHeaders: false,
})

app.use('/api/', globalLimiter)

// ── Health Check ───────────────────────────────────────────
app.get('/health', async (_req: Request, res: Response) => {
  try {
    await prisma.$queryRaw`SELECT 1`
    res.json({ 
      status: 'ok', 
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      database: 'connected'
    })
  } catch (error) {
    res.status(503).json({ 
      status: 'error', 
      message: 'Database unavailable',
      timestamp: new Date().toISOString()
    })
  }
})

// ── Routes ─────────────────────────────────────────────────
app.use('/api/auth/login', authLimiter)
app.use('/api/auth/signup', authLimiter)
app.use('/api/auth', authRouter)
app.use('/api/users', usersRouter)
app.use('/api/chat', chatRouter)
app.use('/api/announcements', announcementsRouter)
app.use('/api/assignments', assignmentsRouter)
app.use('/api/grades', gradesRouter)
app.use('/api/schedule', scheduleRouter)
app.use('/api/qna', qnaRouter)
app.use('/api/notifications', notificationsRouter)

app.get('/', (_req: Request, res: Response) => {
  res.json({ message: 'Harang API v1.0.0' })
})

// ── 글로벌 에러 핸들러 ─────────────────────────────────────
app.use(errorHandler)

// ── HTTP 서버 + Socket.io 초기화 ────────────────────────────
const httpServer = createServer(app)
initSocket(httpServer)

httpServer.listen(PORT, () => {
  logger.info(`🚀 Harang API + Socket.io running on http://localhost:${PORT}`)
  logger.info(`   CLIENT_URL: ${CLIENT_URL}`)
  logger.info(`   Environment: ${env.NODE_ENV}`)
  logger.info(`   Database: ${env.DATABASE_URL.replace(/:[^:@]+@/, ':****@')}`) // 비밀번호 숨김
})
