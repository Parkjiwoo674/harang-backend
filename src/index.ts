import dotenv from 'dotenv'
dotenv.config()

import { env } from './lib/env'

import express, { Request, Response, NextFunction } from 'express'
import path from 'path'
import cors from 'cors'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import { createServer } from 'http'
import { initSocket } from './socket'
import prisma from './lib/prisma'
import bcrypt from 'bcryptjs'
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
import adminRouter from './routes/admin'
import mealRouter from './routes/meal'
import passwordResetRouter from './routes/password-reset'

const app = express()
const PORT = Number(env.PORT)
const CLIENT_URL = env.CLIENT_URL

app.set('trust proxy', 1)
app.use(helmet())
app.use(cors({ origin: CLIENT_URL, credentials: true }))
app.use(express.json({ limit: '10mb' }))
app.use(requestLogger)

const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  message: { error: '너무 많은 요청을 보냈습니다. 잠시 후 다시 시도해주세요.' },
  standardHeaders: true,
  legacyHeaders: false,
})

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: '로그인 시도 횟수를 초과했습니다. 15분 후 다시 시도해주세요.' },
  standardHeaders: true,
  legacyHeaders: false,
})

app.use('/api/', globalLimiter)

app.get('/health', async (_req: Request, res: Response) => {
  try {
    await prisma.$queryRaw`SELECT 1`
    res.json({ status: 'ok', timestamp: new Date().toISOString(), uptime: process.uptime(), database: 'connected' })
  } catch (error) {
    res.status(503).json({ status: 'error', message: 'Database unavailable', timestamp: new Date().toISOString() })
  }
})

app.use('/uploads', (req: any, res: any, next: any) => {
  res.header('Access-Control-Allow-Origin', CLIENT_URL)
  res.header('Cross-Origin-Resource-Policy', 'cross-origin')
  next()
}, express.static(path.join(process.cwd(), 'uploads')))

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
app.use('/api/admin', adminRouter)
app.use('/api/meal', mealRouter)
app.use('/api/auth', passwordResetRouter)

app.get('/', (_req: Request, res: Response) => {
  res.json({ message: 'Harang API v1.0.0' })
})

app.use(errorHandler)

async function ensureAdminAccount() {
  const adminUsername = process.env.ADMIN_USERNAME
  const adminPassword = process.env.ADMIN_PASSWORD
  const adminName = process.env.ADMIN_NAME || 'Admin'

  if (!adminUsername || !adminPassword) {
    logger.warn('⚠️  ADMIN_USERNAME / ADMIN_PASSWORD 환경변수가 없습니다.')
    return
  }

  const existing = await prisma.user.findUnique({ where: { username: adminUsername } })
  if (existing) {
    if (existing.role !== 'admin') {
      await prisma.user.update({ where: { id: existing.id }, data: { role: 'admin' } })
      logger.info(`✅ 기존 계정 "${adminUsername}"을 admin으로 업데이트했습니다.`)
    }
    return
  }

  await prisma.user.create({
    data: {
      username: adminUsername,
      hashedPassword: await bcrypt.hash(adminPassword, 10),
      name: adminName,
      role: 'admin',
      email: process.env.ADMIN_EMAIL || `${adminUsername}@admin.local`,
      avatarText: adminName[0],
      avatarColor: '#6366f1',
    },
  })
  logger.info(`✅ 관리자 계정 "${adminUsername}" 생성 완료`)
}

const httpServer = createServer(app)
initSocket(httpServer)

httpServer.listen(PORT, async () => {
  logger.info(`🚀 Harang API + Socket.io running on http://localhost:${PORT}`)
  logger.info(`   CLIENT_URL: ${CLIENT_URL}`)
  logger.info(`   Environment: ${env.NODE_ENV}`)
  await ensureAdminAccount()
})