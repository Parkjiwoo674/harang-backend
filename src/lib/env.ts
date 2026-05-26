import dotenv from 'dotenv'  // ← 추가
dotenv.config()  

import { z } from 'zod'

// 환경 변수 스키마 정의
const envSchema = z.object({
  // 필수 환경 변수
  DATABASE_URL: z.string().min(1, 'DATABASE_URL은 필수입니다.'),
  JWT_SECRET: z.string().min(16, 'JWT_SECRET은 최소 16자 이상이어야 합니다.'),
  
  // 선택적 환경 변수 (기본값 있음)
  PORT: z.string().default('8000'),
  CLIENT_URL: z.string().url('CLIENT_URL은 유효한 URL이어야 합니다.').default('http://localhost:3000'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  JWT_EXPIRES_IN: z.string().default('7d'),
})

// 환경 변수 검증 및 타입 안전한 객체 반환
export function validateEnv() {
  try {
    const parsed = envSchema.parse(process.env)
    return parsed
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.error('❌ 환경 변수 검증 실패:')
      error.errors.forEach((err) => {
        console.error(`   - ${err.path.join('.')}: ${err.message}`)
      })
      console.error('\n💡 .env 파일을 확인하고 필수 환경 변수를 설정해주세요.')
      console.error('   참고: .env.example 파일을 복사하여 사용하세요.\n')
      process.exit(1)
    }
    throw error
  }
}

// 타입 안전한 환경 변수 객체
export const env = validateEnv()
