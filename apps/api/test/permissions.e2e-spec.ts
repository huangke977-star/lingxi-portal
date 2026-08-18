import {
  canManageServerEntries,
  canViewServerEntries,
  isAdministrator,
  isSiteManager,
  isSuperAdmin,
} from '../src/auth/permissions';
import { AuthenticatedUser } from '../src/auth/auth.types';

const user = (level: number, isSuper = false, administrator = false): AuthenticatedUser => ({
  id: 1,
  username: 'tester',
  nickname: 'tester',
  email: 'tester@example.com',
  status: 'active',
  isSuperAdmin: isSuper,
  isAdministrator: administrator,
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
    code: level >= 80 ? 'mahayana' : 'qi_refining',
    name: level >= 80 ? '大乘' : '练气',
    level,
  },
});

describe('permission helpers', () => {
  it('treats isSuperAdmin as super admin', () => {
    expect(isSuperAdmin(user(10, true))).toBe(true);
    expect(isSuperAdmin(user(80, false))).toBe(false);
  });

  it('recognizes the independent administrator identity', () => {
    expect(isAdministrator(user(10, false, true))).toBe(true);
    expect(isAdministrator(user(80))).toBe(false);
  });

  it('does not derive management permission from growth level', () => {
    expect(isSiteManager(user(80))).toBe(false);
    expect(isSiteManager(user(10, false, true))).toBe(true);
    expect(isSiteManager(user(10, true))).toBe(true);
  });

  it('allows only the super admin to view server entries', () => {
    expect(canViewServerEntries(user(80, false, true))).toBe(false);
    expect(canViewServerEntries(user(10, true))).toBe(true);
  });

  it('allows only super admin to manage server entries', () => {
    expect(canManageServerEntries(user(80, false, true))).toBe(false);
    expect(canManageServerEntries(user(10, true))).toBe(true);
  });
});
