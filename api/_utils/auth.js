const { safeFetch } = require("./http");
const { hasSupabaseAuthConfig, supabaseHeaders, supabasePublicKey, supabaseUrl } = require("./supabase");

function bearerToken(request) {
  const value = String(request.headers?.authorization || request.headers?.Authorization || "").trim();
  if (!value) return { status: "missing", token: "" };

  const match = value.match(/^Bearer\s+([A-Za-z0-9._~+/=-]+)$/i);
  if (!match || match[1].length > 4096) return { status: "invalid", token: "" };

  return { status: "ok", token: match[1] };
}

function normalizeUser(user) {
  return {
    id: user.id,
    email: user.email || null,
    emailConfirmedAt: user.email_confirmed_at || null,
    createdAt: user.created_at || null,
    updatedAt: user.updated_at || null
  };
}

async function fetchSupabaseUser(token) {
  try {
    const response = await safeFetch(
      `${supabaseUrl()}/auth/v1/user`,
      {
        headers: {
          apikey: supabasePublicKey(),
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        }
      },
      5_000
    );

    if (response.status === 401 || response.status === 403) {
      return { ok: false, status: 401, code: "INVALID_AUTH_TOKEN" };
    }

    if (!response.ok) {
      return { ok: false, status: 503, code: "AUTH_PROVIDER_UNAVAILABLE" };
    }

    const user = await response.json();
    if (!user?.id) return { ok: false, status: 401, code: "INVALID_AUTH_TOKEN" };

    return { ok: true, user: normalizeUser(user) };
  } catch (error) {
    return { ok: false, status: 503, code: "AUTH_PROVIDER_UNAVAILABLE" };
  }
}

async function fetchRestRows(pathname, params) {
  const url = new URL(`${supabaseUrl()}/rest/v1/${pathname}`);
  Object.entries(params).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });

  const response = await safeFetch(
    url,
    {
      headers: {
        ...supabaseHeaders(),
        Accept: "application/json"
      }
    },
    5_000
  );

  if (!response.ok) {
    const error = new Error(`${pathname}_lookup_failed`);
    error.status = response.status;
    throw error;
  }

  return await response.json();
}

function normalizeProfile(row) {
  if (!row) return null;
  return {
    id: row.id,
    displayName: row.display_name || null,
    preferredLanguage: row.preferred_language || "en",
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null
  };
}

function normalizeMembership(row) {
  return {
    organizationId: row.organization_id,
    role: row.role,
    status: row.status
  };
}

function derivePermissions({ adminRoles, memberships }) {
  const permissions = new Set(["profile:read", "profile:update:self"]);

  if (adminRoles.some((role) => ["reviewer", "admin", "super_admin"].includes(role))) {
    permissions.add("admin:intake:read");
    permissions.add("admin:review:read");
  }

  if (adminRoles.some((role) => ["admin", "super_admin"].includes(role))) {
    permissions.add("admin:content:write");
    permissions.add("admin:audit:read");
  }

  if (adminRoles.includes("super_admin")) {
    permissions.add("admin:roles:write");
    permissions.add("admin:platform:write");
  }

  if (memberships.length > 0) {
    permissions.add("organization:read");
    permissions.add("maker_profile:read");
  }

  if (memberships.some((membership) => ["owner", "admin", "editor"].includes(membership.role))) {
    permissions.add("maker_profile:write");
  }

  if (memberships.some((membership) => ["owner", "admin"].includes(membership.role))) {
    permissions.add("organization:write");
  }

  return Array.from(permissions).sort();
}

async function loadAccountContext(userId) {
  try {
    const [profileRows, adminRoleRows, membershipRows] = await Promise.all([
      fetchRestRows("profiles", {
        id: `eq.${userId}`,
        select: "id,display_name,preferred_language,created_at,updated_at",
        limit: "1"
      }),
      fetchRestRows("admin_roles", {
        profile_id: `eq.${userId}`,
        select: "role,granted_at",
        limit: "1"
      }),
      fetchRestRows("organization_memberships", {
        profile_id: `eq.${userId}`,
        status: "eq.active",
        select: "organization_id,role,status"
      })
    ]);

    const adminRoles = adminRoleRows.map((row) => row.role).filter(Boolean);
    const memberships = membershipRows.map(normalizeMembership);
    const profile = normalizeProfile(profileRows[0]);
    if (!profile) {
      return { ok: false, status: 503, code: "PROFILE_NOT_FOUND" };
    }

    return {
      ok: true,
      profile,
      roles: adminRoles,
      memberships,
      permissions: derivePermissions({ adminRoles, memberships })
    };
  } catch (error) {
    return { ok: false, status: 503, code: "PROFILE_LOOKUP_FAILED" };
  }
}

async function authenticateAccount(request) {
  if (!hasSupabaseAuthConfig()) {
    return { ok: false, status: 501, code: "AUTH_NOT_CONFIGURED" };
  }

  const token = bearerToken(request);
  if (token.status === "missing") {
    return { ok: false, status: 401, code: "NOT_AUTHENTICATED", bearerChallenge: true };
  }

  if (token.status === "invalid") {
    return { ok: false, status: 401, code: "INVALID_AUTH_TOKEN", bearerChallenge: true };
  }

  const authResult = await fetchSupabaseUser(token.token);
  if (!authResult.ok) {
    return {
      ok: false,
      status: authResult.status || 503,
      code: authResult.code,
      bearerChallenge: authResult.code === "INVALID_AUTH_TOKEN"
    };
  }

  const account = await loadAccountContext(authResult.user.id);
  if (!account.ok) {
    return {
      ok: false,
      status: account.status || 503,
      code: account.code,
      user: authResult.user
    };
  }

  return {
    ok: true,
    user: authResult.user,
    account
  };
}

function hasAnyAdminRole(account, allowedRoles = ["reviewer", "admin", "super_admin"]) {
  const allowed = new Set(allowedRoles);
  return account.roles.some((role) => allowed.has(role));
}

module.exports = {
  authenticateAccount,
  bearerToken,
  fetchSupabaseUser,
  hasAnyAdminRole,
  loadAccountContext
};
