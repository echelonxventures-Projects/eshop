import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import {config} from './config.js';
import {repositories} from './db.js';
import {HttpError} from './http.js';

export function hashToken(value) { return crypto.createHash('sha256').update(value).digest('hex'); }

export function issueAccessToken(user, context) {
  return jwt.sign({sub:user.id, email:user.email, role:user.role, tenantId:context.tenantId, universeId:context.universeId}, config.jwtSecret, {expiresIn:config.jwtExpiresIn, issuer:'marketly-api'});
}

export async function issueRefreshToken(user, context) {
  const raw = crypto.randomBytes(48).toString('base64url');
  const expiresAt = new Date(Date.now() + config.refreshExpiresDays * 86400000);
  await repositories.identity.storeRefreshToken({userId:user.id,tenantId:context.tenantId,tokenHash:hashToken(raw),expiresAt});
  return {token:raw, expiresAt};
}

export function requireAuth(req, _res, next) {
  try {
    const value = req.header('authorization');
    if (!value?.startsWith('Bearer ')) throw new HttpError(401, 'Authentication required', 'unauthorized');
    const payload = jwt.verify(value.slice(7), config.jwtSecret, {issuer:'marketly-api'});
    if (payload.tenantId !== req.context.tenantId || payload.universeId !== req.context.universeId) throw new HttpError(403, 'Token context does not match this store', 'context_mismatch');
    req.user = payload;
    req.context.userId = payload.sub;
    next();
  } catch (error) { next(error instanceof HttpError ? error : new HttpError(401, 'Invalid or expired access token', 'unauthorized')); }
}

export async function authenticate(email, password, context) {
  const result = await repositories.identity.findUserByEmail(email, context.tenantId);
  const user = result.rows[0];
  if (!user || !(await bcrypt.compare(password, user.password_hash))) throw new HttpError(401, 'Email or password is incorrect', 'invalid_credentials');
  return {user, accessToken:issueAccessToken(user, context), refreshToken:await issueRefreshToken(user, context)};
}

export async function createUser({email, password, firstName, lastName}, context) {
  const passwordHash = await bcrypt.hash(password, 12);
  try {
    const result = await repositories.identity.createUser({email,passwordHash,firstName,lastName});
    const user = result.rows[0];
    await repositories.identity.addMembership({tenantId:context.tenantId,userId:user.id});
    return {user, accessToken:issueAccessToken(user, context), refreshToken:await issueRefreshToken(user, context)};
  } catch (error) {
    if (error.code === '23505') throw new HttpError(409, 'An account with this email already exists', 'email_exists');
    throw error;
  }
}

export async function rotateRefreshToken(rawToken, context) {
  const tokenHash = hashToken(rawToken);
  const result = await repositories.identity.findRefreshToken(tokenHash, context.tenantId);
  const stored = result.rows[0];
  if (!stored || stored.status !== 'active') throw new HttpError(401, 'Refresh token is invalid or expired', 'invalid_refresh_token');
  await repositories.identity.revokeRefreshToken(stored.id);
  const user = {id:stored.user_id, email:stored.email, role:stored.role};
  return {user, accessToken:issueAccessToken(user, context), refreshToken:await issueRefreshToken(user, context)};
}
