import {
  canManageServerEntries,
  canViewServerEntries,
  hasRoleLevel,
  isSuperAdmin,
} from '../src/auth/permissions';
import { AuthenticatedUser } from '../src/auth/auth.types';

const user = (level: number, isSuper = false): AuthenticatedUser => ({
  id: 1,
  username: 'tester',
  email: 'tester@example.com',
  status: 'active',
  isSuperAdmin: isSuper,
  avatarUrl: null,
  profileBio: '我懒，我不写',
  createdAt: new Date('2026-07-14T00:00:00.000Z'),
  appearance: {
    themeId: 'sakura-mist',
    customAccent: '#db2777',
    customSurface: '#ffffff',
    customForeground: '#2b2530',
    customMuted: '#665867',
    cardAlpha: 52,
    glassBlur: 22,
    glassTint: '#fff3f6',
    glassTintAlpha: 72,
  },
  role: {
    code: isSuper ? 'administrator' : 'qi_refining',
    name: isSuper ? '管理员' : '练气',
    level,
  },
});

describe('permission helpers', () => {
  it('treats isSuperAdmin as super admin', () => {
    expect(isSuperAdmin(user(10, true))).toBe(true);
    expect(isSuperAdmin(user(90, false))).toBe(false);
  });

  it('allows super admin to bypass role level checks', () => {
    expect(hasRoleLevel(user(10, true), 90)).toBe(true);
  });

  it('checks regular users by role level', () => {
    expect(hasRoleLevel(user(30), 20)).toBe(true);
    expect(hasRoleLevel(user(10), 30)).toBe(false);
  });

  it('allows administrator level users to view server entries', () => {
    expect(canViewServerEntries(user(90))).toBe(true);
    expect(canViewServerEntries(user(80))).toBe(false);
  });

  it('allows only super admin to manage server entries', () => {
    expect(canManageServerEntries(user(90))).toBe(false);
    expect(canManageServerEntries(user(10, true))).toBe(true);
  });
});
