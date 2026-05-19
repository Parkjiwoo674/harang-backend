# Harang Backend 사용 가이드

## 목차
1. [에러 핸들링](#에러-핸들링)
2. [입력 검증](#입력-검증)
3. [비동기 라우터 작성](#비동기-라우터-작성)
4. [로깅](#로깅)
5. [보안 설정](#보안-설정)

---

## 에러 핸들링

### 커스텀 에러 사용하기

```typescript
import { BadRequestError, UnauthorizedError, NotFoundError } from '../lib/errors'

// 400 Bad Request
throw new BadRequestError('잘못된 요청입니다.')

// 401 Unauthorized
throw new UnauthorizedError('로그인이 필요합니다.')

// 404 Not Found
throw new NotFoundError('사용자를 찾을 수 없습니다.')
```

### 사용 가능한 에러 클래스

| 클래스 | 상태 코드 | 용도 |
|--------|-----------|------|
| `BadRequestError` | 400 | 잘못된 요청 |
| `UnauthorizedError` | 401 | 인증 필요 |
| `ForbiddenError` | 403 | 권한 없음 |
| `NotFoundError` | 404 | 리소스 없음 |
| `ConflictError` | 409 | 중복 데이터 |
| `ValidationError` | 422 | 검증 실패 |

### 자동 처리되는 에러

- **Prisma 에러** — 자동으로 적절한 메시지로 변환
- **JWT 에러** — 토큰 만료/유효하지 않음 자동 처리
- **Zod 검증 에러** — 필드별 에러 메시지 자동 생성

---

## 입력 검증

### 1. 스키마 정의 (이미 정의됨)

`src/lib/validation.ts`에 Zod 스키마가 정의되어 있습니다.

### 2. 라우터에서 사용

```typescript
import { Router } from 'express'
import { validate } from '../middleware/validate'
import { createAnnouncementSchema } from '../lib/validation'
import { asyncHandler } from '../lib/asyncHandler'

const router = Router()

router.post(
  '/',
  validate(createAnnouncementSchema), // 검증 미들웨어
  asyncHandler(async (req, res) => {
    // req.body는 이미 검증됨
    const { title, content } = req.body
    // ... 로직
    res.json({ success: true })
  })
)
```

### 3. Query/Params 검증

```typescript
import { validateQuery, validateParams } from '../middleware/validate'
import { z } from 'zod'

// Query 검증
const querySchema = z.object({
  page: z.string().regex(/^\d+$/).transform(Number),
  limit: z.string().regex(/^\d+$/).transform(Number)
})

router.get('/', validateQuery(querySchema), asyncHandler(async (req, res) => {
  const { page, limit } = req.query // 타입 안전
  // ...
}))

// Params 검증
const paramsSchema = z.object({
  id: z.string().uuid()
})

router.get('/:id', validateParams(paramsSchema), asyncHandler(async (req, res) => {
  const { id } = req.params
  // ...
}))
```

---

## 비동기 라우터 작성

### asyncHandler 사용

```typescript
import { asyncHandler } from '../lib/asyncHandler'

// ❌ 나쁜 예 - try-catch 반복
router.get('/users', async (req, res) => {
  try {
    const users = await prisma.user.findMany()
    res.json(users)
  } catch (error) {
    res.status(500).json({ error: '서버 오류' })
  }
})

// ✅ 좋은 예 - asyncHandler 사용
router.get('/users', asyncHandler(async (req, res) => {
  const users = await prisma.user.findMany()
  res.json(users)
}))
// 에러는 자동으로 errorHandler로 전달됨
```

### 커스텀 에러와 함께 사용

```typescript
router.get('/users/:id', asyncHandler(async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.params.id }
  })
  
  if (!user) {
    throw new NotFoundError('사용자를 찾을 수 없습니다.')
  }
  
  res.json(user)
}))
```

---

## 로깅

### 기본 사용법

```typescript
import logger from '../lib/logger'

// 정보 로그
logger.info('사용자 로그인 성공', { userId: user.id })

// 경고 로그
logger.warn('비정상적인 접근 시도', { ip: req.ip })

// 에러 로그
logger.error('데이터베이스 연결 실패', { error: err.message })

// 디버그 로그 (개발 환경에서만)
logger.debug('요청 데이터', { body: req.body })
```

### HTTP 요청 자동 로깅

모든 HTTP 요청은 자동으로 로깅됩니다:

```
15:30:45 [info]: GET /api/users 200 - 45ms
15:30:50 [warn]: POST /api/auth/login 401 - 120ms
15:31:00 [error]: GET /api/grades 500 - 230ms
```

### 로그 파일 (프로덕션)

프로덕션 환경에서는 자동으로 파일에 저장됩니다:

- `logs/error.log` — 에러 로그만
- `logs/combined.log` — 모든 로그

---

## 보안 설정

### Rate Limiting

#### 전역 제한 (이미 설정됨)

```typescript
// 모든 /api/* 엔드포인트
// 15분당 IP별 100 요청
```

#### 인증 엔드포인트 제한 (이미 설정됨)

```typescript
// /api/auth/login, /api/auth/signup
// 15분당 IP별 5 요청
```

#### 커스텀 Rate Limiter 추가

```typescript
import rateLimit from 'express-rate-limit'

const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1시간
  max: 10, // 10회
  message: { error: '파일 업로드 횟수를 초과했습니다.' }
})

router.post('/upload', uploadLimiter, asyncHandler(async (req, res) => {
  // 파일 업로드 로직
}))
```

### Helmet (이미 설정됨)

자동으로 다음 보안 헤더가 설정됩니다:

- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `X-XSS-Protection: 1; mode=block`
- `Strict-Transport-Security` (HTTPS 사용 시)

### CORS (이미 설정됨)

```typescript
// CLIENT_URL 환경 변수에 설정된 도메인만 허용
// credentials: true (쿠키 전송 허용)
```

---

## 전체 예시: 새 라우터 작성

```typescript
import { Router } from 'express'
import { asyncHandler } from '../lib/asyncHandler'
import { validate } from '../middleware/validate'
import { authenticate } from '../middleware/auth'
import { NotFoundError, ForbiddenError } from '../lib/errors'
import { createPostSchema } from '../lib/validation'
import prisma from '../lib/prisma'
import logger from '../lib/logger'

const router = Router()

// 게시글 목록 조회 (인증 필요)
router.get('/', authenticate, asyncHandler(async (req, res) => {
  const posts = await prisma.post.findMany({
    orderBy: { createdAt: 'desc' },
    take: 20
  })
  
  logger.info('게시글 목록 조회', { count: posts.length })
  res.json(posts)
}))

// 게시글 생성 (인증 + 검증)
router.post(
  '/',
  authenticate,
  validate(createPostSchema),
  asyncHandler(async (req, res) => {
    const { title, content } = req.body
    const userId = req.user!.id
    
    const post = await prisma.post.create({
      data: { title, content, authorId: userId }
    })
    
    logger.info('게시글 생성', { postId: post.id, userId })
    res.status(201).json(post)
  })
)

// 게시글 삭제 (권한 확인)
router.delete('/:id', authenticate, asyncHandler(async (req, res) => {
  const post = await prisma.post.findUnique({
    where: { id: req.params.id }
  })
  
  if (!post) {
    throw new NotFoundError('게시글을 찾을 수 없습니다.')
  }
  
  if (post.authorId !== req.user!.id && req.user!.role !== 'TEACHER') {
    throw new ForbiddenError('삭제 권한이 없습니다.')
  }
  
  await prisma.post.delete({ where: { id: post.id } })
  
  logger.info('게시글 삭제', { postId: post.id })
  res.json({ message: '삭제되었습니다.' })
}))

export default router
```

---

## Health Check

서버 상태 확인:

```bash
curl http://localhost:8000/health
```

응답:
```json
{
  "status": "ok",
  "timestamp": "2024-05-18T12:00:00.000Z",
  "uptime": 3600.5,
  "database": "connected"
}
```

---

## 환경 변수

`.env` 파일에 다음 변수를 설정하세요:

```bash
# 필수
DATABASE_URL="mysql://user:password@localhost:3306/harang"
JWT_SECRET="your-secret-key-here"

# 선택 (기본값 있음)
PORT=8000
CLIENT_URL="http://localhost:3000"
NODE_ENV="development"
JWT_EXPIRES_IN="7d"
```

---

## 패키지 설치

새로 추가된 패키지를 설치하세요:

```bash
cd backend
npm install
```

추가된 패키지:
- `helmet` — 보안 헤더
- `express-rate-limit` — Rate Limiting
- `winston` — 로깅

---

## 다음 단계

1. **패키지 설치**: `npm install`
2. **서버 실행**: `npm run dev`
3. **Health Check 확인**: `curl http://localhost:8000/health`
4. **로그 확인**: 콘솔에서 컬러 로그 확인
5. **Rate Limit 테스트**: 같은 엔드포인트에 연속 요청

---

## 문제 해결

### 로그 파일이 생성되지 않음
- 프로덕션 환경에서만 파일 로그가 생성됩니다
- `NODE_ENV=production`으로 설정하세요

### Rate Limit이 작동하지 않음
- 프록시 뒤에 있다면 `app.set('trust proxy', 1)` 추가
- IP가 제대로 감지되는지 확인

### 에러가 제대로 처리되지 않음
- `asyncHandler`를 사용했는지 확인
- `errorHandler`가 마지막 미들웨어인지 확인

---

**Happy Coding! 🚀**
