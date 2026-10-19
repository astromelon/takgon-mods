/**
 * `$.store` 키 네임스페이스.
 *
 * store는 플러그인 전용이지만 모든 프로젝트가 한 파일을 공유한다. Windows 경로(`C:\...`)의 콜론과
 * 섞이지 않도록 구분자는 `/`를 쓰고, 프로젝트는 루트 경로 해시로 식별한다.
 */

import { fnv1a } from './hash'

/** 루트 경로를 표기 차이(대소문자, 구분자, 끝 슬래시)와 무관하게 맞춘다. */
export const normalizeRoot = (root: string): string =>
  root.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()

/** 프로젝트 루트 경로 → 프로젝트 식별자. */
export const projectId = (root: string): string => fnv1a(normalizeRoot(root))

/** 프로젝트 범위 키: `p/{projectId}/{module}/{key}`. */
export const projectKey = (pid: string, module: string, key: string): string =>
  `p/${pid}/${module}/${key}`

/** 전역 키: `g/{module}/{key}`. */
export const globalKey = (module: string, key: string): string => `g/${module}/${key}`
