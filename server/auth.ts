import { randomUUID } from 'crypto'
import { mkdir, readFile, rename, writeFile } from 'fs/promises'
import path from 'path'

const OURA_AUTHORIZE_URL = 'https://cloud.ouraring.com/oauth/authorize'
const OURA_TOKEN_URL = 'https://api.ouraring.com/oauth/token'
const DEFAULT_SCOPES = ['email', 'personal', 'daily', 'heartrate', 'workout', 'tag', 'session', 'spo2']

interface StoredOAuthToken {
  accessToken: string
  refreshToken?: string
  tokenType: string
  expiresAt?: string
  scope?: string
  connectedAt: string
  lastRefreshAt?: string
}

interface PendingOAuthState {
  state: string
  createdAt: string
}

interface TokenResponse {
  token_type: string
  access_token: string
  expires_in?: number
  refresh_token?: string
  scope?: string
}

export type OuraAuthResponseType = 'code' | 'token'

const authDir = path.resolve(process.cwd(), 'server/data')
const tokenPath = path.resolve(authDir, 'oura-oauth-token.json')
const statePath = path.resolve(authDir, 'oura-oauth-state.json')

async function ensureAuthDir() {
  await mkdir(authDir, { recursive: true })
}

async function writeJsonAtomically(filePath: string, value: unknown) {
  await ensureAuthDir()
  const tempPath = `${filePath}.tmp`
  await writeFile(tempPath, JSON.stringify(value, null, 2), 'utf8')
  await rename(tempPath, filePath)
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    const text = await readFile(filePath, 'utf8')
    return JSON.parse(text) as T
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null
    }
    throw error
  }
}

function requireOauthCredentials() {
  const clientId = process.env.OURA_CLIENT_ID
  const clientSecret = process.env.OURA_CLIENT_SECRET

  if (!clientId || !clientSecret) {
    throw new Error('OURA_CLIENT_ID and OURA_CLIENT_SECRET are not configured')
  }

  return { clientId, clientSecret }
}

function redirectUri() {
  return process.env.OURA_REDIRECT_URI ?? 'http://localhost:8787/api/auth/oura/callback'
}

function frontendUrl() {
  return process.env.FRONTEND_URL ?? 'http://localhost:5173'
}

function authScopes() {
  return process.env.OURA_OAUTH_SCOPES?.trim() || DEFAULT_SCOPES.join(' ')
}

function authResponseType(): OuraAuthResponseType {
  return process.env.OURA_AUTH_RESPONSE_TYPE === 'token' ? 'token' : 'code'
}

function expiresAtFromNow(expiresInSeconds?: number) {
  if (!expiresInSeconds || !Number.isFinite(expiresInSeconds)) {
    return undefined
  }

  return new Date(Date.now() + expiresInSeconds * 1000).toISOString()
}

function tokenFromResponse(response: TokenResponse, prior?: StoredOAuthToken): StoredOAuthToken {
  return {
    accessToken: response.access_token,
    refreshToken: response.refresh_token ?? prior?.refreshToken,
    tokenType: response.token_type,
    expiresAt: expiresAtFromNow(response.expires_in),
    scope: response.scope ?? prior?.scope,
    connectedAt: prior?.connectedAt ?? new Date().toISOString(),
    lastRefreshAt: prior ? new Date().toISOString() : undefined,
  }
}

function isExpired(token: StoredOAuthToken) {
  if (!token.expiresAt) {
    return false
  }

  return Date.now() >= new Date(token.expiresAt).getTime() - 60_000
}

async function exchangeToken(params: URLSearchParams): Promise<TokenResponse> {
  const { clientId, clientSecret } = requireOauthCredentials()
  params.set('client_id', clientId)
  params.set('client_secret', clientSecret)

  const response = await fetch(OURA_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: params.toString(),
  })

  const payload = (await response.json().catch(() => null)) as TokenResponse | { error_description?: string } | null
  if (!response.ok || !payload || !('access_token' in payload)) {
    const message =
      payload && 'error_description' in payload && typeof payload.error_description === 'string'
        ? payload.error_description
        : response.statusText
    throw new Error(`Failed to exchange Oura OAuth token: ${message}`)
  }

  return payload
}

export async function buildAuthorizationUrl() {
  const { clientId } = requireOauthCredentials()
  const state = randomUUID()
  const createdAt = new Date().toISOString()
  await writeJsonAtomically(statePath, { state, createdAt } satisfies PendingOAuthState)

  const url = new URL(OURA_AUTHORIZE_URL)
  url.searchParams.set('response_type', authResponseType())
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('redirect_uri', redirectUri())
  url.searchParams.set('scope', authScopes())
  url.searchParams.set('state', state)
  return url.toString()
}

export async function completeOauthCallback(code: string, returnedState?: string) {
  const pending = await readJsonFile<PendingOAuthState>(statePath)
  if (!pending || !returnedState || pending.state !== returnedState) {
    throw new Error('Invalid Oura OAuth state')
  }

  const token = await exchangeToken(
    new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri(),
    }),
  )

  await writeJsonAtomically(tokenPath, tokenFromResponse(token))
  return token
}

async function readStoredToken() {
  return readJsonFile<StoredOAuthToken>(tokenPath)
}

async function writeStoredToken(token: StoredOAuthToken) {
  await writeJsonAtomically(tokenPath, token)
}

export async function getOauthStatus() {
  const hasClientCredentials = Boolean(process.env.OURA_CLIENT_ID && process.env.OURA_CLIENT_SECRET)
  const token = await readStoredToken()
  const hasPersonalAccessToken = Boolean(process.env.OURA_PERSONAL_ACCESS_TOKEN)
  const authMode = token?.accessToken ? ('oauth' as const) : hasPersonalAccessToken ? ('pat' as const) : ('none' as const)

  return {
    hasClientCredentials,
    hasPersonalAccessToken,
    connected: authMode !== 'none',
    authMode,
    expiresAt: token?.expiresAt,
    scope: token?.scope,
    responseType: authResponseType(),
    redirectUri: redirectUri(),
  }
}

export async function storeDirectAccessToken(input: {
  accessToken: string
  tokenType?: string
  expiresIn?: number
  scope?: string
}) {
  const token: StoredOAuthToken = {
    accessToken: input.accessToken,
    tokenType: input.tokenType ?? 'bearer',
    expiresAt: expiresAtFromNow(input.expiresIn),
    scope: input.scope,
    connectedAt: new Date().toISOString(),
  }

  await writeStoredToken(token)
  return token
}

export async function resolveOuraAccessToken() {
  const token = await readStoredToken()
  if (token?.accessToken && !isExpired(token)) {
    return {
      accessToken: token.accessToken,
      authMode: 'oauth' as const,
    }
  }

  if (token?.accessToken && token.refreshToken) {
    const refreshed = await exchangeToken(
      new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: token.refreshToken,
      }),
    )
    const nextToken = tokenFromResponse(refreshed, token)
    await writeStoredToken(nextToken)

    return {
      accessToken: nextToken.accessToken,
      authMode: 'oauth' as const,
    }
  }

  if (process.env.OURA_PERSONAL_ACCESS_TOKEN) {
    return {
      accessToken: process.env.OURA_PERSONAL_ACCESS_TOKEN,
      authMode: 'pat' as const,
    }
  }

  if (token?.accessToken) {
    throw new Error('Stored Oura OAuth token has expired and no refresh token is available.')
  }

  throw new Error('No Oura access token is configured. Connect Oura or set OURA_PERSONAL_ACCESS_TOKEN.')
}

export function callbackRedirect(success: boolean, error?: string) {
  const url = new URL(frontendUrl())
  url.searchParams.set('oura', success ? 'connected' : 'error')
  if (error) {
    url.searchParams.set('reason', error)
  }
  return url.toString()
}
