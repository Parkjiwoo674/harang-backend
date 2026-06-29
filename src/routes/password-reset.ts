import { Router, Request, Response, NextFunction } from 'express'
import { z } from 'zod'
import bcrypt from 'bcryptjs'
import crypto from 'crypto'
import prisma from '../lib/prisma'
import { sendPasswordResetEmail } from '../lib/mailer'

const router = Router()

// 6자리 숫자 인증코드 생성
function generateCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString()
}

// POST /api/auth/forgot-password — 인증코드 발송
router.post('/forgot-password', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const schema = z.object({
      username: z.string().min(1),
      email: z.string().email(),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: '아이디와 이메일을 입력해주세요' })

    const { username, email } = parsed.data

    const user = await prisma.user.findUnique({ where: { username } })

    // 보안상 유저가 없어도 같은 메시지 반환
    if (!user || user.email !== email) {
      return res.json({ message: '입력하신 이메일로 인증코드를 발송했습니다.' })
    }

    // 기존 미사용 토큰 만료 처리
    await prisma.passwordreset.updateMany({
      where: { userId: user.id, used: false },
      data: { used: true },
    })

    const code = generateCode()
    const token = crypto.randomBytes(32).toString('hex')
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000) // 10분

    await prisma.passwordreset.create({
      data: {
        userId: user.id,
        token: `${token}:${code}`, // token에 code 포함
        expiresAt,
      },
    })

    await sendPasswordResetEmail(user.email, code, user.name)

    return res.json({ message: '입력하신 이메일로 인증코드를 발송했습니다.', token })
  } catch (err) {
    next(err)
  }
})

// POST /api/auth/verify-reset-code — 인증코드 확인
router.post('/verify-reset-code', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const schema = z.object({
      token: z.string(),
      code: z.string().length(6),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: '올바른 형식이 아닙니다' })

    const { token, code } = parsed.data

    const reset = await prisma.passwordreset.findFirst({
      where: {
        token: `${token}:${code}`,
        used: false,
        expiresAt: { gt: new Date() },
      },
    })

    if (!reset) return res.status(400).json({ error: '인증코드가 올바르지 않거나 만료되었습니다' })

    return res.json({ ok: true, reset_id: reset.id })
  } catch (err) {
    next(err)
  }
})

// POST /api/auth/reset-password — 새 비밀번호 설정
router.post('/reset-password', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const schema = z.object({
      reset_id: z.number().int(),
      token: z.string(),
      code: z.string().length(6),
      new_password: z.string().min(4, '비밀번호는 4자 이상이어야 합니다'),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() })

    const { reset_id, token, code, new_password } = parsed.data

    const reset = await prisma.passwordreset.findFirst({
      where: {
        id: reset_id,
        token: `${token}:${code}`,
        used: false,
        expiresAt: { gt: new Date() },
      },
    })

    if (!reset) return res.status(400).json({ error: '인증이 만료되었습니다. 다시 시도해주세요' })

    // 비밀번호 변경 + 토큰 사용 처리
    await prisma.$transaction([
      prisma.user.update({
        where: { id: reset.userId ?? 0 },
        data: { hashedPassword: await bcrypt.hash(new_password, 10) },
      }),
      prisma.passwordreset.update({
        where: { id: reset.id },
        data: { used: true },
      }),
    ])

    return res.json({ message: '비밀번호가 변경되었습니다. 새 비밀번호로 로그인해주세요.' })
  } catch (err) {
    next(err)
  }
})

// POST /api/auth/send-verify-email — 회원가입 이메일 인증코드 발송
router.post('/send-verify-email', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const schema = z.object({ email: z.string().email() })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: '올바른 이메일을 입력해주세요' })

    const { email } = parsed.data

    const code = generateCode()
    const token = crypto.randomBytes(32).toString('hex')
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000)

    // 이메일 인증은 userId 없이 저장 (userId를 nullable로)
    await prisma.passwordreset.create({
      data: {
        userId: 0, // 임시값 (회원가입 전이라 userId 없음)
        token: `signup:${token}:${code}`,
        expiresAt,
      },
    })

    await sendPasswordResetEmail(email, code, '회원')

    return res.json({ token })
  } catch (err) {
    next(err)
  }
})

// POST /api/auth/verify-email — 회원가입 이메일 인증코드 확인
router.post('/verify-email', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const schema = z.object({ token: z.string(), code: z.string().length(6) })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: '올바른 형식이 아닙니다' })

    const { token, code } = parsed.data

    const reset = await prisma.passwordreset.findFirst({
      where: {
        token: `signup:${token}:${code}`,
        used: false,
        expiresAt: { gt: new Date() },
      },
    })

    if (!reset) return res.status(400).json({ error: '인증코드가 올바르지 않거나 만료되었습니다' })

    // 인증 완료 처리
    await prisma.passwordreset.update({
      where: { id: reset.id },
      data: { used: true },
    })

    return res.json({ ok: true })
  } catch (err) {
    next(err)
  }
})

export default router