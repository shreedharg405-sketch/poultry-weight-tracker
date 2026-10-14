import { Request, Response, NextFunction } from 'express';
import { verifyToken, TokenPayload } from '../services/authService.js';
import { prisma } from '../db/prisma.js';
import { checkDb, memoryUsers, MemUser } from '../routes/farms.js';

export interface AuthenticatedUser {
  id: string;
  username: string;
  name: string;
  role: string;
  status: string;
  assignedFarms: string[];
}

export interface AuthenticatedRequest extends Request {
  user?: AuthenticatedUser;
}

/**
 * Middleware to require authenticated user session
 */
export async function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;

  if (!token) {
    return res.status(401).json({ error: 'Authentication required. Please log in.' });
  }

  // 1. Try standard HMAC signed token
  const payload = verifyToken(token);
  let userId = payload?.userId;
  let username = payload?.username;

  // 2. Fallback for offline/test session tokens (e.g. offline-123456789)
  if (!payload && token.startsWith('offline-')) {
    // Check if user is provided in header or fallback to supervisor/admin in dev
    const fallbackUsername = req.headers['x-user-username'] as string || 'supervisor';
    const fallback = memoryUsers.find(u => u.username.toLowerCase() === fallbackUsername.toLowerCase());
    if (fallback) {
      userId = fallback.id;
      username = fallback.username;
    }
  }

  if (!userId && !username) {
    return res.status(401).json({ error: 'Session expired or invalid. Please log in again.' });
  }

  try {
    if (await checkDb()) {
      const dbUser = await prisma.user.findFirst({
        where: {
          OR: [
            ...(userId ? [{ id: userId }] : []),
            ...(username ? [{ username }] : []),
          ]
        }
      });

      if (dbUser) {
        if (dbUser.status !== 'ACTIVE') {
          return res.status(403).json({ error: 'Account is deactivated. Contact administrator.' });
        }
        req.user = {
          id: dbUser.id,
          username: dbUser.username,
          name: dbUser.name,
          role: dbUser.role,
          status: dbUser.status,
          assignedFarms: dbUser.assignedFarms || [],
        };
        return next();
      }
    }
  } catch (err) {
    console.warn('Prisma auth error, falling back to memory store:', err);
  }

  // Fallback to memoryUsers
  const memUser = memoryUsers.find(u => 
    (userId && u.id === userId) || (username && u.username.toLowerCase() === username.toLowerCase())
  );

  if (memUser) {
    if (memUser.status !== 'ACTIVE') {
      return res.status(403).json({ error: 'Account is deactivated. Contact administrator.' });
    }
    req.user = {
      id: memUser.id,
      username: memUser.username,
      name: memUser.name,
      role: memUser.role,
      status: memUser.status,
      assignedFarms: memUser.assignedFarms || [],
    };
    return next();
  }

  return res.status(401).json({ error: 'User account not active or does not exist.' });
}

/**
 * Check if a user has access to a specific farm
 */
export function canUserAccessFarm(user: AuthenticatedUser, farmId: string, farmName?: string): boolean {
  if (!user) return false;
  // Admin and Manager can access all farms
  if (user.role === 'Admin' || user.role === 'Manager') {
    return true;
  }
  // Check assignedFarms array
  const assignments = (user.assignedFarms || []).map(a => a.toLowerCase().trim());
  if (assignments.includes('*')) {
    return true;
  }
  if (farmId && assignments.includes(farmId.toLowerCase().trim())) {
    return true;
  }
  if (farmName && assignments.includes(farmName.toLowerCase().trim())) {
    return true;
  }
  return false;
}
