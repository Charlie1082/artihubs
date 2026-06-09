import { Readable } from "node:stream";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { enforceRateLimit } = require("../api/_utils/rate-limit.js");
const { writeAuditEvent } = require("../api/_utils/audit.js");
const intake = require("../api/intake.js");
const search = require("../api/search.js");
const adminAuditEvents = require("../api/v1/admin/audit-events.js");
const adminIntakeSubmissions = require("../api/v1/admin/intake-submissions.js");
const adminMaintenance = require("../api/v1/admin/maintenance.js");
const adminPrivacyRedactions = require("../api/v1/admin/privacy-redactions.js");
const adminRoles = require("../api/v1/admin/roles.js");
const v1Health = require("../api/v1/health.js");
const authLogin = require("../api/v1/auth/login.js");
const authSignup = require("../api/v1/auth/signup.js");
const v1Intake = require("../api/v1/intake.js");
const v1Me = require("../api/v1/me.js");
const v1Search = require("../api/v1/search.js");

async function invokeRaw(handler, rawBody, headers = {}, method = "POST", url = "/api/test") {
  const request = Readable.from([Buffer.from(rawBody)]);
  request.method = method;
  request.url = url;
  request.headers = {
    "x-forwarded-for": "127.0.0.1",
    ...(["PATCH", "POST"].includes(method) ? { "content-type": "application/json" } : {}),
    ...headers
  };

  return await new Promise((resolve, reject) => {
    const response = {
      statusCode: 0,
      headers: {},
      setHeader(key, value) {
        this.headers[key] = value;
      },
      end(text) {
        try {
          resolve({ statusCode: this.statusCode, headers: this.headers, body: text ? JSON.parse(text) : null });
        } catch (error) {
          reject(error);
        }
      }
    };

    Promise.resolve(handler(request, response)).catch(reject);
  });
}

async function invoke(handler, body, headers = {}) {
  return await invokeRaw(handler, JSON.stringify(body), headers);
}

async function invokePatch(handler, body, headers = {}, url = "/api/test") {
  return await invokeRaw(handler, JSON.stringify(body), headers, "PATCH", url);
}

async function invokeGet(handler, headers = {}, url = "/api/test") {
  return await invokeRaw(handler, "", headers, "GET", url);
}

async function invokeOptions(handler, headers = {}, url = "/api/test") {
  return await invokeRaw(handler, "", headers, "OPTIONS", url);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const originalFetch = globalThis.fetch;

const intakeResult = await invoke(intake, {
  type: "maker",
  name: "Test Maker",
  email: "test@example.com",
  country: "Korea",
  region: "Seoul",
  field: "robotics",
  message: "test"
});

assert(intakeResult.statusCode === 503, "intake should return 503 when Supabase env is absent");
assert(intakeResult.body.ok === false, "intake should return ok=false when unavailable");
assert(intakeResult.body.error?.code === "INTAKE_NOT_CONFIGURED", "intake should use public error code");
assert(!Object.prototype.hasOwnProperty.call(intakeResult.body, "detail"), "intake must not expose raw detail");
assert(Boolean(intakeResult.body.requestId), "intake should include requestId");
assert(intakeResult.headers["Cache-Control"] === "no-store", "intake should disable response caching");
assert(intakeResult.headers["X-Request-Id"] === intakeResult.body.requestId, "intake should mirror requestId in a header");

const searchResult = await invoke(search, {
  query: "waterproof sensor housing in Korea"
});

assert(searchResult.statusCode === 200, "search should return 200 with fallback when Claude env is absent");
assert(searchResult.body.ok === true, "search fallback should return ok=true");
assert(searchResult.body.rankSource === "fallback", "search should mark fallback rankSource");
assert(searchResult.body.degraded === true, "search should mark degraded fallback");
assert(Array.isArray(searchResult.body.matches), "search should return matches array");
assert(Boolean(searchResult.body.requestId), "search should include requestId");
assert(Boolean(searchResult.body.data), "search should include data envelope");
assert(searchResult.headers["Cache-Control"] === "no-store", "search should disable response caching");
assert(searchResult.headers["X-Request-Id"] === searchResult.body.requestId, "search should mirror requestId in a header");

const v1IntakeResult = await invoke(v1Intake, {
  type: "maker",
  name: "V1 Test Maker",
  email: "v1-test@example.com",
  country: "Korea",
  region: "Seoul",
  field: "robotics",
  message: "test"
});

assert(v1IntakeResult.statusCode === 503, "v1 intake wrapper should call intake handler");
assert(v1IntakeResult.body.error?.code === "INTAKE_NOT_CONFIGURED", "v1 intake should preserve intake error code");

const v1SearchResult = await invoke(v1Search, {
  query: "controller boards and firmware help"
});

assert(v1SearchResult.statusCode === 200, "v1 search wrapper should call search handler");
assert(v1SearchResult.body.rankSource === "fallback", "v1 search should preserve fallback behavior");

const v1MeResult = await invokeGet(v1Me, { "x-forwarded-for": "127.0.0.6" });

assert(v1MeResult.statusCode === 501, "v1 me should report auth not configured");
assert(v1MeResult.body.error?.code === "AUTH_NOT_CONFIGURED", "v1 me should use public auth config error");
assert(v1MeResult.body.data?.authenticated === false, "v1 me should not fake an authenticated user");
assert(Boolean(v1MeResult.body.requestId), "v1 me should include requestId");

const authSignupUnconfiguredResult = await invoke(
  authSignup,
  {
    displayName: "Demo Maker",
    email: "demo@example.com",
    password: "password123"
  },
  { "x-forwarded-for": "127.0.0.60" }
);

assert(authSignupUnconfiguredResult.statusCode === 501, "signup should stay disabled when public auth is not configured");
assert(authSignupUnconfiguredResult.body.error?.code === "AUTH_NOT_CONFIGURED", "signup should use auth config guard");

const adminIntakeUnconfiguredResult = await invokeGet(adminIntakeSubmissions, { "x-forwarded-for": "127.0.0.31" });
const adminAuditUnconfiguredResult = await invokeGet(adminAuditEvents, { "x-forwarded-for": "127.0.0.36" });
const adminRolesUnconfiguredResult = await invokeGet(adminRoles, { "x-forwarded-for": "127.0.0.40" });
const adminMaintenanceUnconfiguredResult = await invoke(
  adminMaintenance,
  {
    action: "cleanup_expired_rate_limit_buckets",
    before: "2026-06-01T00:00:00.000Z"
  },
  { "x-forwarded-for": "127.0.0.53" }
);
const adminPrivacyUnconfiguredResult = await invoke(
  adminPrivacyRedactions,
  {
    action: "redact_search_query_logs",
    before: "2026-06-01T00:00:00.000Z"
  },
  { "x-forwarded-for": "127.0.0.46" }
);

assert(adminIntakeUnconfiguredResult.statusCode === 501, "admin intake route should report auth not configured");
assert(adminIntakeUnconfiguredResult.body.error?.code === "AUTH_NOT_CONFIGURED", "admin intake route should use public auth config error");
assert(adminAuditUnconfiguredResult.statusCode === 501, "admin audit route should report auth not configured");
assert(adminAuditUnconfiguredResult.body.error?.code === "AUTH_NOT_CONFIGURED", "admin audit route should use public auth config error");
assert(adminRolesUnconfiguredResult.statusCode === 501, "admin roles route should report auth not configured");
assert(adminRolesUnconfiguredResult.body.error?.code === "AUTH_NOT_CONFIGURED", "admin roles route should use public auth config error");
assert(adminMaintenanceUnconfiguredResult.statusCode === 501, "admin maintenance route should report auth not configured");
assert(adminMaintenanceUnconfiguredResult.body.error?.code === "AUTH_NOT_CONFIGURED", "admin maintenance route should use public auth config error");
assert(adminPrivacyUnconfiguredResult.statusCode === 501, "admin privacy route should report auth not configured");
assert(adminPrivacyUnconfiguredResult.body.error?.code === "AUTH_NOT_CONFIGURED", "admin privacy route should use public auth config error");

process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_ANON_KEY = "anon_test";
process.env.SUPABASE_SERVICE_ROLE_KEY = "";
process.env.SUPABASE_SECRET_KEY = "sb_secret_test";

const authLoginDisabledResult = await invoke(
  authLogin,
  {
    email: "demo@example.com",
    password: "password123"
  },
  { "x-forwarded-for": "127.0.0.61" }
);

assert(authLoginDisabledResult.statusCode === 501, "login should stay disabled until AUTH_PUBLIC_AUTH_ENABLED=true");
assert(authLoginDisabledResult.body.error?.code === "AUTH_NOT_CONFIGURED", "login should use auth config guard when disabled");

process.env.AUTH_PUBLIC_AUTH_ENABLED = "true";

let signupFetchCalled = false;
globalThis.fetch = async (url, options = {}) => {
  const target = String(url);
  if (target.endsWith("/auth/v1/signup")) {
    signupFetchCalled = true;
    const body = JSON.parse(options.body);
    assert(body.email === "demo@example.com", "signup should forward normalized email");
    assert(body.password === "password123", "signup should forward password only to Supabase Auth");
    assert(body.data.display_name === "Demo Maker", "signup should forward display name as auth metadata");
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          user: {
            id: "33333333-3333-4333-8333-333333333333",
            email: "demo@example.com",
            email_confirmed_at: null,
            created_at: "2026-06-09T00:00:00.000Z"
          },
          session: null
        };
      }
    };
  }

  throw new Error(`unexpected fetch target for auth signup: ${target}`);
};

const authSignupConfiguredResult = await invoke(
  authSignup,
  {
    displayName: "Demo Maker",
    email: "DEMO@example.com",
    password: "password123"
  },
  { "x-forwarded-for": "127.0.0.62" }
);

assert(authSignupConfiguredResult.statusCode === 201, "configured signup should proxy Supabase Auth signup");
assert(authSignupConfiguredResult.body.data?.emailVerificationRequired === true, "signup should expose email verification pending state");
assert(!authSignupConfiguredResult.body.data?.session, "signup should not fake a session when Supabase does not issue one");
assert(signupFetchCalled === true, "signup should call Supabase Auth");

let loginFetchCalled = false;
globalThis.fetch = async (url, options = {}) => {
  const target = String(url);
  if (target.endsWith("/auth/v1/token?grant_type=password")) {
    loginFetchCalled = true;
    const body = JSON.parse(options.body);
    assert(body.email === "demo@example.com", "login should forward normalized email");
    assert(body.password === "password123", "login should forward password only to Supabase Auth");
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          access_token: "server_access_token_for_test",
          expires_in: 3600,
          token_type: "bearer",
          user: {
            id: "33333333-3333-4333-8333-333333333333",
            email: "demo@example.com",
            email_confirmed_at: "2026-06-09T00:00:00.000Z",
            created_at: "2026-06-09T00:00:00.000Z"
          }
        };
      }
    };
  }

  throw new Error(`unexpected fetch target for auth login: ${target}`);
};

const authLoginConfiguredResult = await invoke(
  authLogin,
  {
    email: "DEMO@example.com",
    password: "password123"
  },
  { "x-forwarded-for": "127.0.0.63" }
);

assert(authLoginConfiguredResult.statusCode === 200, "configured login should proxy Supabase Auth password login");
assert(authLoginConfiguredResult.body.data?.session?.accessToken === "server_access_token_for_test", "login should return a usable access token");
assert(!Object.prototype.hasOwnProperty.call(authLoginConfiguredResult.body.data.session, "refreshToken"), "login should not return refresh token");
assert(loginFetchCalled === true, "login should call Supabase Auth");

const v1MeNoTokenResult = await invokeGet(v1Me, { "x-forwarded-for": "127.0.0.27" });

assert(v1MeNoTokenResult.statusCode === 401, "configured v1 me should require a bearer token");
assert(v1MeNoTokenResult.body.error?.code === "NOT_AUTHENTICATED", "configured v1 me should use auth required error");
assert(v1MeNoTokenResult.headers["WWW-Authenticate"] === "Bearer", "configured v1 me should send bearer challenge");

const v1MeInvalidHeaderResult = await invokeGet(v1Me, {
  "x-forwarded-for": "127.0.0.28",
  authorization: "Basic not-a-bearer-token"
});

assert(v1MeInvalidHeaderResult.statusCode === 401, "v1 me should reject non-bearer auth headers");
assert(v1MeInvalidHeaderResult.body.error?.code === "INVALID_AUTH_TOKEN", "invalid auth header should use token error");

let invalidTokenAuthCalled = false;
globalThis.fetch = async (url) => {
  if (String(url).endsWith("/auth/v1/user")) {
    invalidTokenAuthCalled = true;
    return {
      ok: false,
      status: 401,
      async json() {
        return {};
      }
    };
  }

  throw new Error(`unexpected fetch target for invalid token: ${url}`);
};

const v1MeInvalidTokenResult = await invokeGet(v1Me, {
  "x-forwarded-for": "127.0.0.29",
  authorization: "Bearer invalid.jwt.token"
});

assert(v1MeInvalidTokenResult.statusCode === 401, "v1 me should reject Supabase-invalid tokens");
assert(v1MeInvalidTokenResult.body.error?.code === "INVALID_AUTH_TOKEN", "invalid Supabase token should use token error");
assert(invalidTokenAuthCalled === true, "invalid token path should call Supabase Auth");

globalThis.fetch = async (url) => {
  const target = String(url);
  if (target.endsWith("/auth/v1/user")) {
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          id: "11111111-1111-4111-8111-111111111111",
          email: "missing-profile@example.com",
          email_confirmed_at: "2026-06-09T00:00:00.000Z",
          created_at: "2026-06-09T00:00:00.000Z",
          updated_at: "2026-06-09T00:00:00.000Z"
        };
      }
    };
  }

  if (target.includes("/rest/v1/profiles?")) {
    return {
      ok: true,
      status: 200,
      async json() {
        return [];
      }
    };
  }

  if (target.includes("/rest/v1/admin_roles?") || target.includes("/rest/v1/organization_memberships?")) {
    return {
      ok: true,
      status: 200,
      async json() {
        return [];
      }
    };
  }

  throw new Error(`unexpected fetch target for missing profile: ${target}`);
};

const v1MeMissingProfileResult = await invokeGet(v1Me, {
  "x-forwarded-for": "127.0.0.31",
  authorization: "Bearer missing-profile.jwt.token"
});

assert(v1MeMissingProfileResult.statusCode === 503, "v1 me should fail closed when the authenticated profile row is missing");
assert(v1MeMissingProfileResult.body.error?.code === "PROFILE_NOT_FOUND", "missing profile row should use a distinct profile bootstrap error");
assert(v1MeMissingProfileResult.body.data?.authenticated === true, "missing profile response should still indicate the user authenticated");

let capturedAuthHeaders = {};
let capturedMeProfileUrl = "";
let capturedMeProfileHeaders = {};
let capturedAdminRoleUrl = "";
let capturedMembershipUrl = "";
globalThis.fetch = async (url, options = {}) => {
  const target = String(url);
  if (target.endsWith("/auth/v1/user")) {
    capturedAuthHeaders = options.headers || {};
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          id: "11111111-1111-4111-8111-111111111111",
          email: "admin@example.com",
          email_confirmed_at: "2026-06-09T00:00:00.000Z",
          created_at: "2026-06-09T00:00:00.000Z",
          updated_at: "2026-06-09T00:00:00.000Z"
        };
      }
    };
  }

  if (target.includes("/rest/v1/profiles?")) {
    capturedMeProfileUrl = target;
    capturedMeProfileHeaders = options.headers || {};
    return {
      ok: true,
      status: 200,
      async json() {
        return [
          {
            id: "11111111-1111-4111-8111-111111111111",
            display_name: "Admin User",
            preferred_language: "ko",
            created_at: "2026-06-09T00:00:00.000Z",
            updated_at: "2026-06-09T00:00:00.000Z"
          }
        ];
      }
    };
  }

  if (target.includes("/rest/v1/admin_roles?")) {
    capturedAdminRoleUrl = target;
    return {
      ok: true,
      status: 200,
      async json() {
        return [{ role: "admin", granted_at: "2026-06-09T00:00:00.000Z" }];
      }
    };
  }

  if (target.includes("/rest/v1/organization_memberships?")) {
    capturedMembershipUrl = target;
    return {
      ok: true,
      status: 200,
      async json() {
        return [
          {
            organization_id: "22222222-2222-4222-8222-222222222222",
            role: "owner",
            status: "active"
          }
        ];
      }
    };
  }

  throw new Error(`unexpected fetch target for me success: ${target}`);
};

const v1MeSuccessResult = await invokeGet(v1Me, {
  "x-forwarded-for": "127.0.0.30",
  authorization: "Bearer valid.jwt.token"
});

assert(v1MeSuccessResult.statusCode === 200, "v1 me should return authenticated account context");
assert(v1MeSuccessResult.body.ok === true, "v1 me success should return ok=true");
assert(v1MeSuccessResult.body.data?.authenticated === true, "v1 me success should mark authenticated");
assert(v1MeSuccessResult.body.data?.user?.id === "11111111-1111-4111-8111-111111111111", "v1 me should return the Supabase user id");
assert(v1MeSuccessResult.body.data?.profile?.displayName === "Admin User", "v1 me should return normalized profile");
assert(v1MeSuccessResult.body.data?.roles?.includes("admin"), "v1 me should return admin role");
assert(v1MeSuccessResult.body.data?.permissions?.includes("admin:audit:read"), "v1 me should derive admin permissions");
assert(v1MeSuccessResult.body.data?.permissions?.includes("organization:write"), "v1 me should derive organization permissions");
assert(capturedAuthHeaders.apikey === "anon_test", "v1 me should validate bearer token with Supabase public key");
assert(capturedAuthHeaders.Authorization === "Bearer valid.jwt.token", "v1 me should forward the bearer token only to Supabase Auth");
assert(capturedMeProfileUrl.includes("/rest/v1/profiles?"), "v1 me should query profiles");
assert(capturedMeProfileUrl.includes("id=eq."), "v1 me profile lookup should filter by user id");
assert(capturedMeProfileHeaders.apikey === "sb_secret_test", "v1 me should query account context with server key");
assert(!capturedMeProfileHeaders.Authorization, "sb_secret account context lookup should not use bearer Authorization");
assert(capturedAdminRoleUrl.includes("/rest/v1/admin_roles?"), "v1 me should query admin_roles");
assert(capturedMembershipUrl.includes("/rest/v1/organization_memberships?"), "v1 me should query active organization memberships");

let adminForbiddenListCalled = false;
globalThis.fetch = async (url) => {
  const target = String(url);
  if (target.endsWith("/auth/v1/user")) {
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          id: "33333333-3333-4333-8333-333333333333",
          email: "member@example.com"
        };
      }
    };
  }

  if (target.includes("/rest/v1/profiles?")) {
    return {
      ok: true,
      status: 200,
      async json() {
        return [{ id: "33333333-3333-4333-8333-333333333333", display_name: "Member User", preferred_language: "en" }];
      }
    };
  }

  if (target.includes("/rest/v1/admin_roles?") || target.includes("/rest/v1/organization_memberships?")) {
    return {
      ok: true,
      status: 200,
      async json() {
        return [];
      }
    };
  }

  adminForbiddenListCalled = true;
  throw new Error(`non-admin should not query intake submissions: ${target}`);
};

const adminIntakeForbiddenResult = await invokeGet(adminIntakeSubmissions, {
  "x-forwarded-for": "127.0.0.32",
  authorization: "Bearer member.jwt.token"
});

assert(adminIntakeForbiddenResult.statusCode === 403, "admin intake route should reject non-admin users");
assert(adminIntakeForbiddenResult.body.error?.code === "ADMIN_ROLE_REQUIRED", "admin intake route should use admin role error");
assert(adminForbiddenListCalled === false, "admin intake route should not query submissions for non-admin users");

let capturedAdminIntakeUrl = "";
let capturedAdminIntakeHeaders = {};
process.env.INTAKE_TABLE = "intake_submissions";
globalThis.fetch = async (url, options = {}) => {
  const target = String(url);
  if (target.endsWith("/auth/v1/user")) {
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          id: "11111111-1111-4111-8111-111111111111",
          email: "admin@example.com"
        };
      }
    };
  }

  if (target.includes("/rest/v1/profiles?")) {
    return {
      ok: true,
      status: 200,
      async json() {
        return [{ id: "11111111-1111-4111-8111-111111111111", display_name: "Admin User", preferred_language: "ko" }];
      }
    };
  }

  if (target.includes("/rest/v1/admin_roles?")) {
    return {
      ok: true,
      status: 200,
      async json() {
        return [{ role: "reviewer", granted_at: "2026-06-09T00:00:00.000Z" }];
      }
    };
  }

  if (target.includes("/rest/v1/organization_memberships?")) {
    return {
      ok: true,
      status: 200,
      async json() {
        return [];
      }
    };
  }

  if (target.includes("/rest/v1/intake_submissions?")) {
    capturedAdminIntakeUrl = target;
    capturedAdminIntakeHeaders = options.headers || {};
    return {
      ok: true,
      status: 200,
      async json() {
        return [
          {
            id: "44444444-4444-4444-8444-444444444444",
            type: "maker",
            name: "Admin Intake Test",
            email: "admin-intake@example.com",
            country: "Korea",
            region: "Seoul",
            field: "robotics",
            message: "private admin intake message",
            source_path: "/for-makers/",
            status: "new",
            metadata: { private: true },
            created_at: "2026-06-09T00:00:00.000Z"
          }
        ];
      },
      async text() {
        return "";
      }
    };
  }

  throw new Error(`unexpected admin intake fetch target: ${target}`);
};

const adminIntakeSuccessResult = await invokeGet(
  adminIntakeSubmissions,
  {
    "x-forwarded-for": "127.0.0.33",
    authorization: "Bearer admin.jwt.token"
  },
  "/api/v1/admin/intake-submissions?status=new&type=maker&limit=5"
);

assert(adminIntakeSuccessResult.statusCode === 200, "admin intake route should list submissions for admin roles");
assert(adminIntakeSuccessResult.body.data?.table === "intake_submissions", "admin intake route should report intake table");
assert(adminIntakeSuccessResult.body.data?.count === 1, "admin intake route should return result count");
assert(adminIntakeSuccessResult.body.data?.submissions?.[0]?.email === "admin-intake@example.com", "admin intake route should return authorized private intake email");
assert(!Object.prototype.hasOwnProperty.call(adminIntakeSuccessResult.body.data.submissions[0], "metadata"), "admin intake route should not return raw metadata");
assert(capturedAdminIntakeUrl.includes("/rest/v1/intake_submissions?"), "admin intake route should query selected intake table");
assert(capturedAdminIntakeUrl.includes("status=eq.new"), "admin intake route should apply status filter");
assert(capturedAdminIntakeUrl.includes("type=eq.maker"), "admin intake route should apply type filter");
assert(capturedAdminIntakeUrl.includes("limit=5"), "admin intake route should apply capped limit");
assert(capturedAdminIntakeHeaders.apikey === "sb_secret_test", "admin intake route should query with server key");
assert(!capturedAdminIntakeHeaders.Authorization, "admin intake route should not send sb_secret as bearer token");

const adminAuditForbiddenResult = await invokeGet(
  adminAuditEvents,
  {
    "x-forwarded-for": "127.0.0.37",
    authorization: "Bearer reviewer.jwt.token"
  },
  "/api/v1/admin/audit-events?entityTable=intake_submissions&limit=5"
);

assert(adminAuditForbiddenResult.statusCode === 403, "admin audit route should reject reviewer role");
assert(adminAuditForbiddenResult.body.error?.code === "ADMIN_ROLE_REQUIRED", "admin audit route should require admin role");

const adminPrivacyForbiddenResult = await invoke(
  adminPrivacyRedactions,
  {
    action: "redact_search_query_logs",
    before: "2026-06-01T00:00:00.000Z"
  },
  {
    "x-forwarded-for": "127.0.0.47",
    authorization: "Bearer reviewer.jwt.token"
  }
);

assert(adminPrivacyForbiddenResult.statusCode === 403, "admin privacy route should reject reviewer role");
assert(adminPrivacyForbiddenResult.body.error?.code === "ADMIN_ROLE_REQUIRED", "admin privacy route should require admin role");

const adminMaintenanceForbiddenResult = await invoke(
  adminMaintenance,
  {
    action: "cleanup_expired_rate_limit_buckets",
    before: "2026-06-01T00:00:00.000Z"
  },
  {
    "x-forwarded-for": "127.0.0.54",
    authorization: "Bearer reviewer.jwt.token"
  }
);

assert(adminMaintenanceForbiddenResult.statusCode === 403, "admin maintenance route should reject reviewer role");
assert(adminMaintenanceForbiddenResult.body.error?.code === "ADMIN_ROLE_REQUIRED", "admin maintenance route should require admin role");

let capturedAdminPatchUrl = "";
let capturedAdminPatchHeaders = {};
let capturedAdminPatchBody = {};
let capturedAuditUrl = "";
let capturedAuditHeaders = {};
let capturedAuditBody = {};
let capturedWeakAuditBody = {};
let capturedAuditListUrl = "";
let capturedAuditListHeaders = {};
process.env.AUDIT_IP_HASH_SECRET = "audit_secret_test_0123456789abcdef";
globalThis.fetch = async (url, options = {}) => {
  const target = String(url);
  if (target.endsWith("/auth/v1/user")) {
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          id: "11111111-1111-4111-8111-111111111111",
          email: "admin@example.com"
        };
      }
    };
  }

  if (target.includes("/rest/v1/profiles?")) {
    return {
      ok: true,
      status: 200,
      async json() {
        return [{ id: "11111111-1111-4111-8111-111111111111", display_name: "Admin User", preferred_language: "ko" }];
      }
    };
  }

  if (target.includes("/rest/v1/admin_roles?")) {
    return {
      ok: true,
      status: 200,
      async json() {
        return [{ role: "admin", granted_at: "2026-06-09T00:00:00.000Z" }];
      }
    };
  }

  if (target.includes("/rest/v1/organization_memberships?")) {
    return {
      ok: true,
      status: 200,
      async json() {
        return [];
      }
    };
  }

  if (target.includes("/rest/v1/intake_submissions?") && options.method === "PATCH") {
    capturedAdminPatchUrl = target;
    capturedAdminPatchHeaders = options.headers || {};
    capturedAdminPatchBody = JSON.parse(options.body);
    return {
      ok: true,
      status: 200,
      async json() {
        return [
          {
            id: "44444444-4444-4444-8444-444444444444",
            type: "maker",
            name: "Admin Intake Test",
            email: "admin-intake@example.com",
            country: "Korea",
            region: "Seoul",
            field: "robotics",
            message: "private admin intake message",
            source_path: "/for-makers/",
            status: "reviewing",
            reviewed_by: "11111111-1111-4111-8111-111111111111",
            reviewed_at: "2026-06-09T00:01:00.000Z",
            created_at: "2026-06-09T00:00:00.000Z"
          }
        ];
      },
      async text() {
        return "";
      }
    };
  }

  if (target.endsWith("/rest/v1/audit_events")) {
    capturedAuditUrl = target;
    capturedAuditHeaders = options.headers || {};
    const auditBody = JSON.parse(options.body);
    if (auditBody.event_type === "audit.weak_secret_test") {
      capturedWeakAuditBody = auditBody;
    } else {
      capturedAuditBody = auditBody;
    }
    return {
      ok: true,
      status: 201,
      async json() {
        return [];
      },
      async text() {
        return "";
      }
    };
  }

  if (target.includes("/rest/v1/audit_events?")) {
    capturedAuditListUrl = target;
    capturedAuditListHeaders = options.headers || {};
    return {
      ok: true,
      status: 200,
      async json() {
        return [
          {
            id: "55555555-5555-4555-8555-555555555555",
            actor_profile_id: "11111111-1111-4111-8111-111111111111",
            actor_type: "admin",
            event_type: "admin.intake.status_update",
            entity_table: "intake_submissions",
            entity_id: "44444444-4444-4444-8444-444444444444",
            after_data: {
              status: "reviewing",
              reviewedBy: "11111111-1111-4111-8111-111111111111",
              unsafe: "must not be returned"
            },
            ip_hash: "f".repeat(64),
            user_agent: "private user agent",
            created_at: "2026-06-09T00:02:00.000Z"
          }
        ];
      },
      async text() {
        return "";
      }
    };
  }

  throw new Error(`unexpected admin intake patch fetch target: ${target}`);
};

const adminIntakePatchResult = await invokePatch(
  adminIntakeSubmissions,
  {
    id: "44444444-4444-4444-8444-444444444444",
    status: "reviewing"
  },
  {
    "x-forwarded-for": "127.0.0.35",
    authorization: "Bearer admin.jwt.token",
    "user-agent": "Artihubs Smoke Test"
  }
);

assert(adminIntakePatchResult.statusCode === 200, "admin intake route should update submission status for admin roles");
assert(adminIntakePatchResult.body.data?.submission?.status === "reviewing", "admin intake patch should return updated status");
assert(capturedAdminPatchUrl.includes("id=eq.44444444-4444-4444-8444-444444444444"), "admin intake patch should filter by submission id");
assert(capturedAdminPatchHeaders.Prefer === "return=representation", "admin intake patch should request updated representation");
assert(capturedAdminPatchBody.status === "reviewing", "admin intake patch should write allowed status");
assert(capturedAdminPatchBody.reviewed_by === "11111111-1111-4111-8111-111111111111", "admin intake patch should stamp reviewer id");
assert(Boolean(capturedAdminPatchBody.reviewed_at), "admin intake patch should stamp reviewed timestamp");
assert(capturedAuditUrl.endsWith("/rest/v1/audit_events"), "admin intake patch should write a best-effort audit event");
assert(capturedAuditHeaders.Prefer === "return=minimal", "audit event insert should request minimal return");
assert(capturedAuditBody.actor_profile_id === "11111111-1111-4111-8111-111111111111", "audit event should include actor profile id");
assert(capturedAuditBody.event_type === "admin.intake.status_update", "audit event should include status update event type");
assert(capturedAuditBody.entity_table === "intake_submissions", "audit event should include entity table");
assert(capturedAuditBody.entity_id === "44444444-4444-4444-8444-444444444444", "audit event should include entity id");
assert(capturedAuditBody.after_data?.status === "reviewing", "audit event should include normalized after data");
assert(/^[a-f0-9]{64}$/.test(capturedAuditBody.ip_hash), "audit event should hash IP when audit secret is configured");
assert(capturedAuditBody.user_agent === "Artihubs Smoke Test", "audit event should include capped user agent");

const adminAuditSuccessResult = await invokeGet(
  adminAuditEvents,
  {
    "x-forwarded-for": "127.0.0.38",
    authorization: "Bearer admin.jwt.token"
  },
  "/api/v1/admin/audit-events?entityTable=intake_submissions&eventType=admin.intake.status_update&limit=5"
);

assert(adminAuditSuccessResult.statusCode === 200, "admin audit route should list events for admin roles");
assert(adminAuditSuccessResult.body.data?.count === 1, "admin audit route should return event count");
assert(adminAuditSuccessResult.body.data?.events?.[0]?.eventType === "admin.intake.status_update", "admin audit route should return event type");
assert(adminAuditSuccessResult.body.data?.events?.[0]?.ipHashPresent === true, "admin audit route should report hash presence");
assert(!Object.prototype.hasOwnProperty.call(adminAuditSuccessResult.body.data.events[0], "ip_hash"), "admin audit route should not expose raw ip_hash");
assert(!Object.prototype.hasOwnProperty.call(adminAuditSuccessResult.body.data.events[0], "user_agent"), "admin audit route should not expose raw user agent");
assert(adminAuditSuccessResult.body.data.events[0].afterData.status === "reviewing", "admin audit route should return safe after data");
assert(!Object.prototype.hasOwnProperty.call(adminAuditSuccessResult.body.data.events[0].afterData, "unsafe"), "admin audit route should filter unsafe after data");
assert(capturedAuditListUrl.includes("/rest/v1/audit_events?"), "admin audit route should query audit_events");
assert(capturedAuditListUrl.includes("entity_table=eq.intake_submissions"), "admin audit route should apply entity table filter");
assert(capturedAuditListUrl.includes("event_type=eq.admin.intake.status_update"), "admin audit route should apply event type filter");
assert(capturedAuditListHeaders.apikey === "sb_secret_test", "admin audit route should query with server key");
assert(!capturedAuditListHeaders.Authorization, "admin audit route should not send sb_secret as bearer token");

process.env.AUDIT_IP_HASH_SECRET = "short";
await writeAuditEvent({
  actorType: "system",
  eventType: "audit.weak_secret_test",
  entityTable: "audit_events",
  request: {
    headers: {
      "x-forwarded-for": "203.0.113.10",
      "user-agent": "Weak Audit Secret Smoke Test"
    }
  }
});
assert(capturedWeakAuditBody.event_type === "audit.weak_secret_test", "weak audit secret smoke should write an audit event");
assert(capturedWeakAuditBody.ip_hash === null, "audit event should not hash IP metadata with a weak audit secret");
process.env.AUDIT_IP_HASH_SECRET = "audit_secret_test_0123456789abcdef";

const adminRolesForbiddenResult = await invokeGet(
  adminRoles,
  {
    "x-forwarded-for": "127.0.0.41",
    authorization: "Bearer admin.jwt.token"
  },
  "/api/v1/admin/roles?limit=5"
);

assert(adminRolesForbiddenResult.statusCode === 403, "admin roles route should reject non-super-admin roles");
assert(adminRolesForbiddenResult.body.error?.code === "ADMIN_ROLE_REQUIRED", "admin roles route should require super_admin role");

let capturedRolesListUrl = "";
let capturedRolesListHeaders = {};
let capturedRoleUpsertUrl = "";
let capturedRoleUpsertHeaders = {};
let capturedRoleUpsertBody = {};
let capturedRoleAuditBody = {};
globalThis.fetch = async (url, options = {}) => {
  const target = String(url);
  if (target.endsWith("/auth/v1/user")) {
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          email: "super-admin@example.com"
        };
      }
    };
  }

  if (target.includes("/rest/v1/profiles?")) {
    return {
      ok: true,
      status: 200,
      async json() {
        return [{ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", display_name: "Super Admin", preferred_language: "ko" }];
      }
    };
  }

  if (target.includes("/rest/v1/admin_roles?") && options.method !== "POST") {
    capturedRolesListUrl = target.includes("limit=5") ? target : capturedRolesListUrl;
    capturedRolesListHeaders = target.includes("limit=5") ? options.headers || {} : capturedRolesListHeaders;
    return {
      ok: true,
      status: 200,
      async json() {
        return [{ profile_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", role: "super_admin", granted_by: null, granted_at: "2026-06-09T00:00:00.000Z" }];
      }
    };
  }

  if (target.includes("/rest/v1/organization_memberships?")) {
    return {
      ok: true,
      status: 200,
      async json() {
        return [];
      }
    };
  }

  if (target.includes("/rest/v1/admin_roles?") && options.method === "POST") {
    capturedRoleUpsertUrl = target;
    capturedRoleUpsertHeaders = options.headers || {};
    capturedRoleUpsertBody = JSON.parse(options.body);
    return {
      ok: true,
      status: 201,
      async json() {
        return [
          {
            profile_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            role: "admin",
            granted_by: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            granted_at: "2026-06-09T00:03:00.000Z"
          }
        ];
      },
      async text() {
        return "";
      }
    };
  }

  if (target.endsWith("/rest/v1/audit_events")) {
    capturedRoleAuditBody = JSON.parse(options.body);
    return {
      ok: true,
      status: 201,
      async json() {
        return [];
      },
      async text() {
        return "";
      }
    };
  }

  throw new Error(`unexpected admin roles fetch target: ${target}`);
};

const adminRolesSuccessResult = await invokeGet(
  adminRoles,
  {
    "x-forwarded-for": "127.0.0.42",
    authorization: "Bearer super-admin.jwt.token"
  },
  "/api/v1/admin/roles?role=super_admin&limit=5"
);

assert(adminRolesSuccessResult.statusCode === 200, "admin roles route should list roles for super_admin");
assert(adminRolesSuccessResult.body.data?.count === 1, "admin roles route should return role count");
assert(adminRolesSuccessResult.body.data?.roles?.[0]?.role === "super_admin", "admin roles route should return role");
assert(capturedRolesListUrl.includes("/rest/v1/admin_roles?"), "admin roles route should query admin_roles");
assert(capturedRolesListUrl.includes("role=eq.super_admin"), "admin roles route should apply role filter");
assert(capturedRolesListHeaders.apikey === "sb_secret_test", "admin roles route should query with server key");

const adminRolesSelfChangeResult = await invokePatch(
  adminRoles,
  {
    profileId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    role: "admin"
  },
  {
    "x-forwarded-for": "127.0.0.43",
    authorization: "Bearer super-admin.jwt.token"
  }
);

assert(adminRolesSelfChangeResult.statusCode === 400, "admin roles route should reject self role changes");
assert(adminRolesSelfChangeResult.body.error?.code === "SELF_ROLE_CHANGE_NOT_ALLOWED", "self role change should use public error code");

const adminRolesPatchResult = await invokePatch(
  adminRoles,
  {
    profileId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    role: "admin"
  },
  {
    "x-forwarded-for": "127.0.0.44",
    authorization: "Bearer super-admin.jwt.token",
    "user-agent": "Artihubs Role Smoke Test"
  }
);

assert(adminRolesPatchResult.statusCode === 200, "admin roles route should upsert roles for super_admin");
assert(adminRolesPatchResult.body.data?.role?.profileId === "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "admin roles patch should return target profile id");
assert(adminRolesPatchResult.body.data?.role?.role === "admin", "admin roles patch should return updated role");
assert(capturedRoleUpsertUrl.includes("/rest/v1/admin_roles?"), "admin roles patch should write admin_roles");
assert(capturedRoleUpsertUrl.includes("on_conflict=profile_id"), "admin roles patch should upsert on profile_id");
assert(capturedRoleUpsertHeaders.Prefer === "resolution=merge-duplicates,return=representation", "admin roles patch should request upsert representation");
assert(capturedRoleUpsertBody.profile_id === "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "admin roles patch should write target profile id");
assert(capturedRoleUpsertBody.role === "admin", "admin roles patch should write allowed role");
assert(capturedRoleUpsertBody.granted_by === "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "admin roles patch should stamp granter");
assert(capturedRoleAuditBody.event_type === "admin.role.upsert", "admin roles patch should write audit event");
assert(capturedRoleAuditBody.entity_table === "admin_roles", "admin roles audit should target admin_roles");
assert(capturedRoleAuditBody.entity_id === "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "admin roles audit should include entity id");

let capturedPrivacyIntakeRpcUrl = "";
let capturedPrivacyIntakeRpcHeaders = {};
let capturedPrivacyIntakeRpcBody = {};
let capturedPrivacySearchRpcUrl = "";
let capturedPrivacySearchRpcBody = {};
let privacySearchRpcCalls = 0;
let capturedMaintenanceRpcUrl = "";
let capturedMaintenanceRpcHeaders = {};
let capturedMaintenanceRpcBody = {};
let maintenanceRpcCalls = 0;
globalThis.fetch = async (url, options = {}) => {
  const target = String(url);
  if (target.endsWith("/auth/v1/user")) {
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          email: "super-admin@example.com"
        };
      }
    };
  }

  if (target.includes("/rest/v1/profiles?")) {
    return {
      ok: true,
      status: 200,
      async json() {
        return [{ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", display_name: "Super Admin", preferred_language: "ko" }];
      }
    };
  }

  if (target.includes("/rest/v1/admin_roles?")) {
    return {
      ok: true,
      status: 200,
      async json() {
        return [{ profile_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", role: "super_admin", granted_by: null, granted_at: "2026-06-09T00:00:00.000Z" }];
      }
    };
  }

  if (target.includes("/rest/v1/organization_memberships?")) {
    return {
      ok: true,
      status: 200,
      async json() {
        return [];
      }
    };
  }

  if (target.endsWith("/rest/v1/rpc/redact_intake_submission")) {
    capturedPrivacyIntakeRpcUrl = target;
    capturedPrivacyIntakeRpcHeaders = options.headers || {};
    capturedPrivacyIntakeRpcBody = JSON.parse(options.body);
    return {
      ok: true,
      status: 200,
      async json() {
        return true;
      },
      async text() {
        return "";
      }
    };
  }

  if (target.endsWith("/rest/v1/rpc/redact_search_query_logs")) {
    privacySearchRpcCalls += 1;
    capturedPrivacySearchRpcUrl = target;
    capturedPrivacySearchRpcBody = JSON.parse(options.body);
    return {
      ok: true,
      status: 200,
      async json() {
        return 3;
      },
      async text() {
        return "";
      }
    };
  }

  if (target.endsWith("/rest/v1/rpc/cleanup_expired_rate_limit_buckets")) {
    maintenanceRpcCalls += 1;
    capturedMaintenanceRpcUrl = target;
    capturedMaintenanceRpcHeaders = options.headers || {};
    capturedMaintenanceRpcBody = JSON.parse(options.body);
    return {
      ok: true,
      status: 200,
      async json() {
        return 4;
      },
      async text() {
        return "";
      }
    };
  }

  throw new Error(`unexpected admin privacy/maintenance fetch target: ${target}`);
};

const adminPrivacyInvalidActionResult = await invoke(
  adminPrivacyRedactions,
  {
    action: "erase_everything"
  },
  {
    "x-forwarded-for": "127.0.0.48",
    authorization: "Bearer super-admin.jwt.token"
  }
);

assert(adminPrivacyInvalidActionResult.statusCode === 400, "admin privacy route should reject invalid redaction actions");
assert(adminPrivacyInvalidActionResult.body.error?.code === "INVALID_REDACTION_ACTION", "invalid redaction action should use public error code");

const adminPrivacyTextBodyResult = await invokeRaw(
  adminPrivacyRedactions,
  JSON.stringify({
    action: "redact_search_query_logs",
    before: "2026-06-01T00:00:00.000Z"
  }),
  {
    "x-forwarded-for": "127.0.0.59",
    authorization: "Bearer super-admin.jwt.token",
    "content-type": "text/plain"
  }
);

assert(adminPrivacyTextBodyResult.statusCode === 415, "admin privacy route should reject non-json requests");
assert(adminPrivacyTextBodyResult.body.error?.code === "UNSUPPORTED_MEDIA_TYPE", "admin privacy non-json request should use media type error");

const adminPrivacyIntakeResult = await invoke(
  adminPrivacyRedactions,
  {
    action: "redact_intake_submission",
    submissionId: "44444444-4444-4444-8444-444444444444"
  },
  {
    "x-forwarded-for": "127.0.0.49",
    authorization: "Bearer super-admin.jwt.token"
  }
);

assert(adminPrivacyIntakeResult.statusCode === 200, "admin privacy route should call intake redaction RPC");
assert(adminPrivacyIntakeResult.body.data?.action === "redact_intake_submission", "admin privacy intake response should report action");
assert(adminPrivacyIntakeResult.body.data?.changed === true, "admin privacy intake response should report changed true");
assert(capturedPrivacyIntakeRpcUrl.endsWith("/rest/v1/rpc/redact_intake_submission"), "admin privacy route should call intake redaction RPC path");
assert(capturedPrivacyIntakeRpcHeaders.apikey === "sb_secret_test", "admin privacy route should call RPC with server key");
assert(!capturedPrivacyIntakeRpcHeaders.Authorization, "admin privacy route should not send sb_secret as bearer token");
assert(capturedPrivacyIntakeRpcBody.p_submission_id === "44444444-4444-4444-8444-444444444444", "admin privacy route should pass submission id to RPC");
assert(capturedPrivacyIntakeRpcBody.p_actor_profile_id === "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "admin privacy route should pass actor profile id to RPC");

const adminPrivacySearchResult = await invoke(
  adminPrivacyRedactions,
  {
    action: "redact_search_query_logs",
    before: "2026-06-01T00:00:00.000Z"
  },
  {
    "x-forwarded-for": "127.0.0.50",
    authorization: "Bearer super-admin.jwt.token"
  }
);

assert(adminPrivacySearchResult.statusCode === 200, "admin privacy route should call search log redaction RPC");
assert(adminPrivacySearchResult.body.data?.action === "redact_search_query_logs", "admin privacy search response should report action");
assert(adminPrivacySearchResult.body.data?.redactedCount === 3, "admin privacy search response should report redacted count");
assert(capturedPrivacySearchRpcUrl.endsWith("/rest/v1/rpc/redact_search_query_logs"), "admin privacy route should call search redaction RPC path");
assert(capturedPrivacySearchRpcBody.p_before === "2026-06-01T00:00:00.000Z", "admin privacy route should pass cutoff to RPC");
assert(privacySearchRpcCalls === 1, "admin privacy search redaction should call RPC exactly once for valid cutoff");

const adminPrivacyFutureCutoffResult = await invoke(
  adminPrivacyRedactions,
  {
    action: "redact_search_query_logs",
    before: "2999-01-01T00:00:00.000Z"
  },
  {
    "x-forwarded-for": "127.0.0.52",
    authorization: "Bearer super-admin.jwt.token"
  }
);

assert(adminPrivacyFutureCutoffResult.statusCode === 400, "admin privacy route should reject future redaction cutoff");
assert(adminPrivacyFutureCutoffResult.body.error?.code === "INVALID_REDACTION_CUTOFF", "future cutoff should use public cutoff error code");
assert(privacySearchRpcCalls === 1, "future cutoff should be rejected before search redaction RPC");

const adminMaintenanceInvalidActionResult = await invoke(
  adminMaintenance,
  {
    action: "vacuum_everything"
  },
  {
    "x-forwarded-for": "127.0.0.55",
    authorization: "Bearer super-admin.jwt.token"
  }
);

assert(adminMaintenanceInvalidActionResult.statusCode === 400, "admin maintenance route should reject invalid actions");
assert(adminMaintenanceInvalidActionResult.body.error?.code === "INVALID_MAINTENANCE_ACTION", "invalid maintenance action should use public error code");
assert(maintenanceRpcCalls === 0, "invalid maintenance action should be rejected before RPC");

const adminMaintenanceTextBodyResult = await invokeRaw(
  adminMaintenance,
  JSON.stringify({
    action: "cleanup_expired_rate_limit_buckets",
    before: "2026-06-01T00:00:00.000Z"
  }),
  {
    "x-forwarded-for": "127.0.0.60",
    authorization: "Bearer super-admin.jwt.token",
    "content-type": "text/plain"
  }
);

assert(adminMaintenanceTextBodyResult.statusCode === 415, "admin maintenance route should reject non-json requests");
assert(adminMaintenanceTextBodyResult.body.error?.code === "UNSUPPORTED_MEDIA_TYPE", "admin maintenance non-json request should use media type error");
assert(maintenanceRpcCalls === 0, "admin maintenance non-json request should be rejected before RPC");

const adminMaintenanceFutureCutoffResult = await invoke(
  adminMaintenance,
  {
    action: "cleanup_expired_rate_limit_buckets",
    before: "2999-01-01T00:00:00.000Z"
  },
  {
    "x-forwarded-for": "127.0.0.56",
    authorization: "Bearer super-admin.jwt.token"
  }
);

assert(adminMaintenanceFutureCutoffResult.statusCode === 400, "admin maintenance route should reject future cleanup cutoff");
assert(adminMaintenanceFutureCutoffResult.body.error?.code === "INVALID_MAINTENANCE_CUTOFF", "future maintenance cutoff should use public cutoff error code");
assert(maintenanceRpcCalls === 0, "future maintenance cutoff should be rejected before RPC");

const adminMaintenanceCleanupResult = await invoke(
  adminMaintenance,
  {
    action: "cleanup_expired_rate_limit_buckets",
    before: "2026-06-01T00:00:00.000Z"
  },
  {
    "x-forwarded-for": "127.0.0.57",
    authorization: "Bearer super-admin.jwt.token"
  }
);

assert(adminMaintenanceCleanupResult.statusCode === 200, "admin maintenance route should call cleanup RPC");
assert(adminMaintenanceCleanupResult.body.data?.action === "cleanup_expired_rate_limit_buckets", "admin maintenance response should report action");
assert(adminMaintenanceCleanupResult.body.data?.deletedCount === 4, "admin maintenance response should report deleted count");
assert(capturedMaintenanceRpcUrl.endsWith("/rest/v1/rpc/cleanup_expired_rate_limit_buckets"), "admin maintenance route should call cleanup RPC path");
assert(capturedMaintenanceRpcHeaders.apikey === "sb_secret_test", "admin maintenance route should call RPC with server key");
assert(!capturedMaintenanceRpcHeaders.Authorization, "admin maintenance route should not send sb_secret as bearer token");
assert(capturedMaintenanceRpcBody.p_before === "2026-06-01T00:00:00.000Z", "admin maintenance route should pass cutoff to RPC");
assert(maintenanceRpcCalls === 1, "admin maintenance route should call cleanup RPC exactly once");

globalThis.fetch = originalFetch;
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_ANON_KEY;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
delete process.env.SUPABASE_SECRET_KEY;
delete process.env.AUTH_PUBLIC_AUTH_ENABLED;
delete process.env.INTAKE_TABLE;
delete process.env.AUDIT_IP_HASH_SECRET;

const v1HealthResult = await invokeGet(v1Health, { "x-forwarded-for": "127.0.0.7" });

assert(v1HealthResult.statusCode === 200, "v1 health should return 200");
assert(v1HealthResult.body.ok === true, "v1 health should return ok=true");
assert(v1HealthResult.body.data?.version === "v1", "v1 health should identify api version");
assert(Boolean(v1HealthResult.body.requestId), "v1 health should include requestId");

const intakeGetResult = await invokeGet(intake, { "x-forwarded-for": "127.0.0.12" });
const searchGetResult = await invokeGet(search, { "x-forwarded-for": "127.0.0.13" });
const authSignupGetResult = await invokeGet(authSignup, { "x-forwarded-for": "127.0.0.64" });
const authLoginGetResult = await invokeGet(authLogin, { "x-forwarded-for": "127.0.0.65" });
const v1MePostResult = await invoke(v1Me, {}, { "x-forwarded-for": "127.0.0.14" });
const v1HealthPostResult = await invoke(v1Health, {}, { "x-forwarded-for": "127.0.0.15" });
const adminIntakePostResult = await invoke(adminIntakeSubmissions, {}, { "x-forwarded-for": "127.0.0.34" });
const adminAuditPostResult = await invoke(adminAuditEvents, {}, { "x-forwarded-for": "127.0.0.39" });
const adminRolesPostResult = await invoke(adminRoles, {}, { "x-forwarded-for": "127.0.0.45" });
const adminMaintenanceGetResult = await invokeGet(adminMaintenance, { "x-forwarded-for": "127.0.0.58" });
const adminPrivacyGetResult = await invokeGet(adminPrivacyRedactions, { "x-forwarded-for": "127.0.0.51" });

assert(intakeGetResult.statusCode === 405, "intake should reject GET");
assert(intakeGetResult.body.error?.code === "METHOD_NOT_ALLOWED", "intake GET should use method error code");
assert(searchGetResult.statusCode === 405, "search should reject GET");
assert(searchGetResult.body.error?.code === "METHOD_NOT_ALLOWED", "search GET should use method error code");
assert(authSignupGetResult.statusCode === 405, "signup should reject GET");
assert(authSignupGetResult.body.error?.code === "METHOD_NOT_ALLOWED", "signup GET should use method error code");
assert(authLoginGetResult.statusCode === 405, "login should reject GET");
assert(authLoginGetResult.body.error?.code === "METHOD_NOT_ALLOWED", "login GET should use method error code");
assert(v1MePostResult.statusCode === 405, "v1 me should reject POST");
assert(v1MePostResult.body.error?.code === "METHOD_NOT_ALLOWED", "v1 me POST should use method error code");
assert(v1HealthPostResult.statusCode === 405, "v1 health should reject POST");
assert(v1HealthPostResult.body.error?.code === "METHOD_NOT_ALLOWED", "v1 health POST should use method error code");
assert(adminIntakePostResult.statusCode === 405, "admin intake route should reject POST");
assert(adminIntakePostResult.body.error?.code === "METHOD_NOT_ALLOWED", "admin intake POST should use method error code");
assert(adminAuditPostResult.statusCode === 405, "admin audit route should reject POST");
assert(adminAuditPostResult.body.error?.code === "METHOD_NOT_ALLOWED", "admin audit POST should use method error code");
assert(adminRolesPostResult.statusCode === 405, "admin roles route should reject POST");
assert(adminRolesPostResult.body.error?.code === "METHOD_NOT_ALLOWED", "admin roles POST should use method error code");
assert(adminMaintenanceGetResult.statusCode === 405, "admin maintenance route should reject GET");
assert(adminMaintenanceGetResult.body.error?.code === "METHOD_NOT_ALLOWED", "admin maintenance GET should use method error code");
assert(adminPrivacyGetResult.statusCode === 405, "admin privacy route should reject GET");
assert(adminPrivacyGetResult.body.error?.code === "METHOD_NOT_ALLOWED", "admin privacy GET should use method error code");

const hostileOriginIntakeResult = await invoke(
  intake,
  {
    type: "maker",
    name: "Hostile Origin Test",
    email: "hostile-origin@example.com",
    message: "test"
  },
  { "x-forwarded-for": "127.0.0.18", origin: "https://evil.example", host: "artihubs.com" }
);

assert(hostileOriginIntakeResult.statusCode === 403, "intake should reject hostile browser origins");
assert(hostileOriginIntakeResult.body.error?.code === "ORIGIN_NOT_ALLOWED", "hostile origin should use public origin error");

const malformedOriginIntakeResult = await invoke(
  intake,
  {
    type: "maker",
    name: "Malformed Origin Test",
    email: "malformed-origin@example.com",
    message: "test"
  },
  { "x-forwarded-for": "127.0.0.22", origin: "not a url", host: "artihubs.com" }
);

assert(malformedOriginIntakeResult.statusCode === 403, "intake should reject malformed browser origins");
assert(malformedOriginIntakeResult.body.error?.code === "ORIGIN_NOT_ALLOWED", "malformed origin should use public origin error");

const sameOriginSearchResult = await invoke(
  search,
  {
    query: "sensor housings"
  },
  { "x-forwarded-for": "127.0.0.19", origin: "https://artihubs.com", host: "artihubs.com" }
);

assert(sameOriginSearchResult.statusCode === 200, "search should allow same-host browser origins");

process.env.ALLOWED_ORIGINS = "https://partner.example";
const allowlistedPreflightResult = await invokeOptions(
  search,
  {
    "x-forwarded-for": "127.0.0.25",
    origin: "https://partner.example",
    host: "artihubs.com",
    "access-control-request-method": "POST",
    "access-control-request-headers": "content-type"
  }
);

assert(allowlistedPreflightResult.statusCode === 204, "allowlisted preflight should return 204");
assert(allowlistedPreflightResult.headers["Access-Control-Allow-Origin"] === "https://partner.example", "allowlisted preflight should echo allowed origin");
assert(allowlistedPreflightResult.headers["Access-Control-Allow-Methods"] === "POST, OPTIONS", "allowlisted preflight should expose allowed methods");
assert(allowlistedPreflightResult.headers["Access-Control-Allow-Headers"] === "Content-Type", "allowlisted preflight should expose allowed headers");

const allowlistedOriginSearchResult = await invoke(
  search,
  {
    query: "controller boards"
  },
  { "x-forwarded-for": "127.0.0.20", origin: "https://partner.example", host: "artihubs.com" }
);
delete process.env.ALLOWED_ORIGINS;

assert(allowlistedOriginSearchResult.statusCode === 200, "search should allow configured browser origins");
assert(allowlistedOriginSearchResult.headers["Access-Control-Allow-Origin"] === "https://partner.example", "allowlisted POST should include CORS origin header");

const hostilePreflightResult = await invokeOptions(
  intake,
  {
    "x-forwarded-for": "127.0.0.26",
    origin: "https://evil.example",
    host: "artihubs.com",
    "access-control-request-method": "POST",
    "access-control-request-headers": "content-type"
  }
);

assert(hostilePreflightResult.statusCode === 403, "hostile preflight should be rejected");
assert(hostilePreflightResult.body.error?.code === "ORIGIN_NOT_ALLOWED", "hostile preflight should use public origin error");
assert(!hostilePreflightResult.headers["Access-Control-Allow-Origin"], "hostile preflight must not include CORS allow origin header");

const hostileAdminIntakeGetResult = await invokeGet(
  adminIntakeSubmissions,
  {
    "x-forwarded-for": "127.0.0.58",
    origin: "https://evil.example",
    host: "artihubs.com",
    authorization: "Bearer admin.jwt.token"
  },
  "/api/v1/admin/intake-submissions"
);

const hostileAdminAuditGetResult = await invokeGet(
  adminAuditEvents,
  {
    "x-forwarded-for": "127.0.0.59",
    origin: "https://evil.example",
    host: "artihubs.com",
    authorization: "Bearer admin.jwt.token"
  },
  "/api/v1/admin/audit-events"
);

const hostileAdminRolesGetResult = await invokeGet(
  adminRoles,
  {
    "x-forwarded-for": "127.0.0.60",
    origin: "https://evil.example",
    host: "artihubs.com",
    authorization: "Bearer super-admin.jwt.token"
  },
  "/api/v1/admin/roles"
);

const hostileAdminIntakePatchResult = await invokePatch(
  adminIntakeSubmissions,
  {
    id: "44444444-4444-4444-8444-444444444444",
    status: "reviewing"
  },
  {
    "x-forwarded-for": "127.0.0.61",
    origin: "https://evil.example",
    host: "artihubs.com",
    authorization: "Bearer admin.jwt.token"
  }
);

const hostileAdminRolesPatchResult = await invokePatch(
  adminRoles,
  {
    profileId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    role: "admin"
  },
  {
    "x-forwarded-for": "127.0.0.62",
    origin: "https://evil.example",
    host: "artihubs.com",
    authorization: "Bearer super-admin.jwt.token"
  }
);

const hostileAdminMaintenanceResult = await invoke(
  adminMaintenance,
  {
    action: "cleanup_expired_rate_limit_buckets"
  },
  {
    "x-forwarded-for": "127.0.0.63",
    origin: "https://evil.example",
    host: "artihubs.com",
    authorization: "Bearer super-admin.jwt.token"
  }
);

const hostileAdminPrivacyResult = await invoke(
  adminPrivacyRedactions,
  {
    action: "redact_search_query_logs",
    before: "2026-06-01T00:00:00.000Z"
  },
  {
    "x-forwarded-for": "127.0.0.64",
    origin: "https://evil.example",
    host: "artihubs.com",
    authorization: "Bearer super-admin.jwt.token"
  }
);

assert(hostileAdminIntakeGetResult.statusCode === 403, "admin intake GET should reject hostile browser origins before auth");
assert(hostileAdminIntakeGetResult.body.error?.code === "ORIGIN_NOT_ALLOWED", "admin intake GET hostile origin should use public origin error");
assert(hostileAdminAuditGetResult.statusCode === 403, "admin audit GET should reject hostile browser origins before auth");
assert(hostileAdminAuditGetResult.body.error?.code === "ORIGIN_NOT_ALLOWED", "admin audit GET hostile origin should use public origin error");
assert(hostileAdminRolesGetResult.statusCode === 403, "admin roles GET should reject hostile browser origins before auth");
assert(hostileAdminRolesGetResult.body.error?.code === "ORIGIN_NOT_ALLOWED", "admin roles GET hostile origin should use public origin error");
assert(hostileAdminIntakePatchResult.statusCode === 403, "admin intake patch should reject hostile browser origins before auth");
assert(hostileAdminIntakePatchResult.body.error?.code === "ORIGIN_NOT_ALLOWED", "admin intake hostile origin should use public origin error");
assert(hostileAdminRolesPatchResult.statusCode === 403, "admin roles patch should reject hostile browser origins before auth");
assert(hostileAdminRolesPatchResult.body.error?.code === "ORIGIN_NOT_ALLOWED", "admin roles hostile origin should use public origin error");
assert(hostileAdminMaintenanceResult.statusCode === 403, "admin maintenance should reject hostile browser origins before auth");
assert(hostileAdminMaintenanceResult.body.error?.code === "ORIGIN_NOT_ALLOWED", "admin maintenance hostile origin should use public origin error");
assert(hostileAdminPrivacyResult.statusCode === 403, "admin privacy should reject hostile browser origins before auth");
assert(hostileAdminPrivacyResult.body.error?.code === "ORIGIN_NOT_ALLOWED", "admin privacy hostile origin should use public origin error");

process.env.ALLOWED_ORIGINS = "https://partner.example";
const publicAllowedAdminMaintenanceResult = await invoke(
  adminMaintenance,
  {
    action: "cleanup_expired_rate_limit_buckets"
  },
  {
    "x-forwarded-for": "127.0.0.65",
    origin: "https://partner.example",
    host: "artihubs.com",
    authorization: "Bearer super-admin.jwt.token"
  }
);
const publicAllowedAdminMaintenancePreflightResult = await invokeOptions(
  adminMaintenance,
  {
    origin: "https://partner.example",
    host: "artihubs.com",
    "access-control-request-method": "POST",
    "access-control-request-headers": "authorization, content-type"
  }
);
delete process.env.ALLOWED_ORIGINS;

assert(publicAllowedAdminMaintenanceResult.statusCode === 403, "admin mutation should not trust public ALLOWED_ORIGINS");
assert(publicAllowedAdminMaintenanceResult.body.error?.code === "ORIGIN_NOT_ALLOWED", "admin mutation rejected public allowed origin should use origin error");
assert(publicAllowedAdminMaintenancePreflightResult.statusCode === 403, "admin preflight should not trust public ALLOWED_ORIGINS");
assert(publicAllowedAdminMaintenancePreflightResult.body.error?.code === "ORIGIN_NOT_ALLOWED", "admin preflight rejected public allowed origin should use origin error");

process.env.ADMIN_ALLOWED_ORIGINS = "https://admin.partner.example";
const adminAllowedOriginMaintenanceResult = await invoke(
  adminMaintenance,
  {
    action: "cleanup_expired_rate_limit_buckets"
  },
  {
    "x-forwarded-for": "127.0.0.66",
    origin: "https://admin.partner.example",
    host: "artihubs.com",
    authorization: "Bearer super-admin.jwt.token"
  }
);
const adminAllowedOriginMaintenancePreflightResult = await invokeOptions(
  adminMaintenance,
  {
    origin: "https://admin.partner.example",
    host: "artihubs.com",
    "access-control-request-method": "POST",
    "access-control-request-headers": "authorization, content-type"
  }
);
delete process.env.ADMIN_ALLOWED_ORIGINS;

assert(adminAllowedOriginMaintenanceResult.statusCode === 501, "admin-specific allowed origin should pass origin guard and reach auth config check");
assert(adminAllowedOriginMaintenanceResult.body.error?.code === "AUTH_NOT_CONFIGURED", "admin-specific allowed origin should not bypass auth");
assert(adminAllowedOriginMaintenanceResult.headers["Access-Control-Allow-Origin"] === "https://admin.partner.example", "admin-specific allowed origin should set CORS origin on actual Admin response");
assert(adminAllowedOriginMaintenancePreflightResult.statusCode === 204, "admin-specific allowed origin should pass Admin CORS preflight");
assert(adminAllowedOriginMaintenancePreflightResult.headers["Access-Control-Allow-Origin"] === "https://admin.partner.example", "admin preflight should echo the allowed Admin origin");
assert(adminAllowedOriginMaintenancePreflightResult.headers["Access-Control-Allow-Headers"].includes("Authorization"), "admin preflight should allow bearer Authorization headers");
assert(adminAllowedOriginMaintenancePreflightResult.headers["Access-Control-Allow-Methods"].includes("POST"), "admin preflight should allow the Admin maintenance method");

const invalidJsonSearchResult = await invokeRaw(
  search,
  "{",
  { "x-forwarded-for": "127.0.0.16" }
);

assert(invalidJsonSearchResult.statusCode === 400, "invalid search JSON should be rejected");
assert(invalidJsonSearchResult.body.error?.code === "INVALID_JSON", "invalid search JSON should use public error code");

const invalidContentTypeSearchResult = await invokeRaw(
  search,
  JSON.stringify({ query: "sensor housings" }),
  { "x-forwarded-for": "127.0.0.21", "content-type": "text/plain" }
);

assert(invalidContentTypeSearchResult.statusCode === 415, "non-json search requests should be rejected");
assert(invalidContentTypeSearchResult.body.error?.code === "UNSUPPORTED_MEDIA_TYPE", "non-json search requests should use public media type error");

const invalidEmailResult = await invoke(
  intake,
  {
    type: "maker",
    name: "Invalid Email Test",
    email: "not-an-email",
    message: "test"
  },
  { "x-forwarded-for": "127.0.0.17" }
);

assert(invalidEmailResult.statusCode === 400, "invalid intake email should be rejected");
assert(invalidEmailResult.body.error?.code === "INVALID_EMAIL", "invalid intake email should use public error code");

const largeSearchResult = await invokeRaw(
  search,
  JSON.stringify({ query: "x".repeat(8_000) }),
  { "x-forwarded-for": "127.0.0.2" }
);

assert(largeSearchResult.statusCode === 400, "large search payload should be rejected");
assert(largeSearchResult.body.error?.code === "PAYLOAD_TOO_LARGE", "large search payload should use public error code");

let limitedResult;
for (let index = 0; index < 9; index += 1) {
  limitedResult = await invoke(
    intake,
    {
      type: "maker",
      name: "Limit Test",
      email: "limit@example.com",
      country: "Korea",
      region: "Seoul",
      field: "robotics",
      message: "test"
    },
    { "x-forwarded-for": "127.0.0.3" }
  );
}

assert(limitedResult.statusCode === 429, "intake should apply best-effort rate limit");
assert(limitedResult.body.error?.code === "RATE_LIMITED", "rate limit should use public error code");

process.env.TURNSTILE_REQUIRED = "true";
process.env.TURNSTILE_SECRET_KEY = "turnstile_secret_test";
let turnstileMissingFetchCalled = false;
globalThis.fetch = async () => {
  turnstileMissingFetchCalled = true;
  throw new Error("fetch should not be called when required Turnstile token is missing");
};

const missingTurnstileResult = await invoke(
  intake,
  {
    type: "maker",
    name: "Missing Turnstile Test",
    email: "missing-turnstile@example.com",
    message: "test"
  },
  { "x-forwarded-for": "127.0.0.23" }
);

assert(missingTurnstileResult.statusCode === 403, "required Turnstile without token should be rejected");
assert(missingTurnstileResult.body.error?.code === "BOT_CHECK_FAILED", "missing Turnstile should use bot check error");
assert(turnstileMissingFetchCalled === false, "missing Turnstile token should be rejected before network calls");

let turnstileVerifyCalled = false;
let turnstileInsertCalled = false;
process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "";
process.env.SUPABASE_SECRET_KEY = "sb_secret_test";
process.env.INTAKE_TABLE = "intake_submissions";
globalThis.fetch = async (url) => {
  const target = String(url);
  if (target.startsWith("https://challenges.cloudflare.com/turnstile/v0/siteverify")) {
    turnstileVerifyCalled = true;
    return {
      ok: true,
      async json() {
        return { success: true };
      }
    };
  }

  if (target.endsWith("/rest/v1/intake_submissions")) {
    turnstileInsertCalled = true;
    return {
      ok: true,
      async json() {
        return [{ id: "00000000-0000-0000-0000-000000000002", status: "new" }];
      },
      async text() {
        return "";
      }
    };
  }

  throw new Error(`unexpected fetch target: ${target}`);
};

const successfulTurnstileResult = await invoke(
  intake,
  {
    type: "maker",
    name: "Successful Turnstile Test",
    email: "successful-turnstile@example.com",
    message: "test",
    turnstileToken: "token_test"
  },
  { "x-forwarded-for": "127.0.0.24" }
);

assert(successfulTurnstileResult.statusCode === 201, "valid Turnstile token should allow configured intake");
assert(turnstileVerifyCalled === true, "valid Turnstile token should call siteverify");
assert(turnstileInsertCalled === true, "valid Turnstile token should continue to Supabase insert");

delete process.env.TURNSTILE_REQUIRED;
delete process.env.TURNSTILE_SECRET_KEY;
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
delete process.env.SUPABASE_SECRET_KEY;
delete process.env.INTAKE_TABLE;

let capturedIntakeUrl = "";
let capturedIntakeHeaders = {};
process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "";
process.env.SUPABASE_SECRET_KEY = "sb_secret_test";
process.env.INTAKE_TABLE = "intake_submissions";

globalThis.fetch = async (url, options = {}) => {
  capturedIntakeUrl = String(url);
  capturedIntakeHeaders = options.headers || {};
  return {
    ok: true,
    async json() {
      return [{
        id: "00000000-0000-0000-0000-000000000001",
        status: "new",
        email: "configured@example.com",
        message: "private test message"
      }];
    },
    async text() {
      return "";
    }
  };
};

const configuredIntakeResult = await invoke(
  intake,
  {
    type: "maker",
    name: "Configured Table Test",
    email: "configured@example.com",
    country: "Korea",
    region: "Seoul",
    field: "robotics",
    message: "test"
  },
  { "x-forwarded-for": "127.0.0.4" }
);

assert(configuredIntakeResult.statusCode === 201, "configured intake should insert successfully with mocked Supabase");
assert(capturedIntakeUrl.endsWith("/rest/v1/intake_submissions"), "intake should honor the approved INTAKE_TABLE");
assert(capturedIntakeHeaders.apikey === "sb_secret_test", "intake should pass Supabase server key as apikey");
assert(!capturedIntakeHeaders.Authorization, "sb_secret keys should not be sent as bearer tokens");
assert(configuredIntakeResult.body.data?.status === "new", "configured intake should return inserted status");
assert(!Object.prototype.hasOwnProperty.call(configuredIntakeResult.body, "intake"), "intake should not echo the inserted row");
assert(!Object.prototype.hasOwnProperty.call(configuredIntakeResult.body, "email"), "intake should not echo private email");

process.env.INTAKE_TABLE = "unsafe_table";
let invalidTableFetchCalled = false;
globalThis.fetch = async () => {
  invalidTableFetchCalled = true;
  throw new Error("fetch should not be called for invalid intake table");
};

const invalidTableResult = await invoke(
  intake,
  {
    type: "maker",
    name: "Invalid Table Test",
    email: "invalid-table@example.com",
    country: "Korea",
    region: "Seoul",
    field: "robotics",
    message: "test"
  },
  { "x-forwarded-for": "127.0.0.5" }
);

assert(invalidTableResult.statusCode === 503, "invalid intake table config should return a public config error");
assert(invalidTableResult.body.error?.code === "INTAKE_NOT_CONFIGURED", "invalid intake table should not expose internals");
assert(invalidTableFetchCalled === false, "invalid intake table should be rejected before network calls");

let capturedRateLimitUrl = "";
process.env.RATE_LIMIT_MODE = "supabase";
process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "";
process.env.SUPABASE_SECRET_KEY = "sb_secret_test";
globalThis.fetch = async (url) => {
  capturedRateLimitUrl = String(url);
  return {
    ok: true,
    async json() {
      return [{ allowed: false, remaining: 0, reset_at: "2026-06-09T00:00:00.000Z" }];
    }
  };
};

const durableRateLimitResult = await enforceRateLimit({
  key: "search:127.0.0.8",
  limit: 1,
  windowMs: 60_000
});

assert(durableRateLimitResult.allowed === false, "durable rate limit should use mocked Supabase decision");
assert(durableRateLimitResult.source === "supabase", "durable rate limit should report supabase source");
assert(capturedRateLimitUrl.endsWith("/rest/v1/rpc/consume_rate_limit"), "durable rate limit should call consume_rate_limit RPC");

let capturedProfileUrl = "";
let capturedProfileHeaders = {};
delete process.env.RATE_LIMIT_MODE;
process.env.SEARCH_PROFILE_SOURCE = "database";
process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "";
process.env.SUPABASE_SECRET_KEY = "sb_secret_test";
globalThis.fetch = async (url, options = {}) => {
  capturedProfileUrl = String(url);
  capturedProfileHeaders = options.headers || {};
  return {
    ok: true,
    async json() {
      return [
        {
          id: "30000000-0000-4000-8000-000000000091",
          name: "Ceramic Line Lab",
          country: "Korea",
          region: "Seoul",
          field: "sensor housings",
          capability: "precision ceramic sensor housings",
          tags: ["ceramic", "sensors", "sealed housings"],
          summary: "Builds sealed ceramic housings for compact sensing modules."
        }
      ];
    }
  };
};

const databaseSearchResult = await invoke(
  search,
  {
    query: "precision ceramic sensor housings in Korea"
  },
  { "x-forwarded-for": "127.0.0.9" }
);

assert(databaseSearchResult.statusCode === 200, "database search should return 200 with mocked profiles");
assert(databaseSearchResult.body.profileSource === "public_maker_profiles", "database search should report public profile source");
assert(databaseSearchResult.body.data?.profileSource === "public_maker_profiles", "database search data envelope should include profile source");
assert(databaseSearchResult.body.matches[0]?.publicProfileId === "30000000-0000-4000-8000-000000000091", "database search should return public profile id");
assert(capturedProfileUrl.includes("/rest/v1/public_maker_profiles?"), "database search should call public_maker_profiles");
assert(capturedProfileUrl.includes("is_active=eq.true"), "database search should only request active public profiles");
assert(!capturedProfileUrl.includes("contact_email"), "database search must not request private contact email");
assert(!capturedProfileUrl.includes("internal_notes"), "database search must not request private internal notes");
assert(!capturedProfileUrl.includes("owner_profile_id"), "database search must not request private owner profile id");
assert(!capturedProfileUrl.includes("source_intake_id"), "database search must not request private source intake id");
assert(capturedProfileHeaders.apikey === "sb_secret_test", "database search should pass Supabase server key as apikey");
assert(!capturedProfileHeaders.Authorization, "database search should not send sb_secret as bearer token");

let capturedSearchLogUrl = "";
let capturedSearchLogHeaders = {};
let capturedSearchLogBody = {};
process.env.SEARCH_QUERY_LOGGING_ENABLED = "true";
process.env.SEARCH_QUERY_HASH_SECRET = "0123456789abcdef0123456789abcdef";
globalThis.fetch = async (url, options = {}) => {
  const target = String(url);
  if (target.includes("/rest/v1/public_maker_profiles?")) {
    return {
      ok: true,
      async json() {
        return [
          {
            id: "30000000-0000-4000-8000-000000000091",
            name: "Ceramic Line Lab",
            country: "Korea",
            region: "Seoul",
            field: "sensor housings",
            capability: "precision ceramic sensor housings",
            tags: ["ceramic", "sensors", "sealed housings"],
            summary: "Builds sealed ceramic housings for compact sensing modules."
          }
        ];
      }
    };
  }

  if (target.endsWith("/rest/v1/search_query_logs")) {
    capturedSearchLogUrl = target;
    capturedSearchLogHeaders = options.headers || {};
    capturedSearchLogBody = JSON.parse(options.body);
    return {
      ok: true,
      async json() {
        return [];
      }
    };
  }

  throw new Error(`unexpected search logging fetch target: ${target}`);
};

const loggedSearchResult = await invoke(
  search,
  {
    query: "precision ceramic sensor housings in Korea for buyer@example.com"
  },
  { "x-forwarded-for": "127.0.0.10" }
);

assert(loggedSearchResult.statusCode === 200, "logged database search should still return a normal search response");
assert(capturedSearchLogUrl.endsWith("/rest/v1/search_query_logs"), "search logging should insert into search_query_logs");
assert(capturedSearchLogHeaders.apikey === "sb_secret_test", "search logging should use Supabase server key as apikey");
assert(!capturedSearchLogHeaders.Authorization, "search logging should not send sb_secret as bearer token");
assert(capturedSearchLogBody.query_preview.includes("[email]"), "search logging should redact emails from query preview");
assert(!capturedSearchLogBody.query_preview.includes("buyer@example.com"), "search logging must not store raw email addresses in query preview");
assert(/^[a-f0-9]{64}$/i.test(capturedSearchLogBody.query_hash), "search logging should store a hex HMAC query hash");
assert(capturedSearchLogBody.rank_source === "fallback", "search logging should record the rank source");
assert(capturedSearchLogBody.status === "degraded", "search logging should mark fallback search as degraded");
assert(capturedSearchLogBody.result_profile_ids.includes("30000000-0000-4000-8000-000000000091"), "search logging should store matched public profile ids");

globalThis.fetch = originalFetch;
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
delete process.env.SUPABASE_SECRET_KEY;
delete process.env.SEARCH_QUERY_LOGGING_ENABLED;
delete process.env.SEARCH_QUERY_HASH_SECRET;
delete process.env.INTAKE_TABLE;
delete process.env.RATE_LIMIT_MODE;
delete process.env.SEARCH_PROFILE_SOURCE;

console.log(
  JSON.stringify(
    {
      ok: true,
      intake: {
        statusCode: intakeResult.statusCode,
        errorCode: intakeResult.body.error.code,
        requestId: Boolean(intakeResult.body.requestId)
      },
      search: {
        statusCode: searchResult.statusCode,
        rankSource: searchResult.body.rankSource,
        degraded: searchResult.body.degraded,
        matches: searchResult.body.matches.length
      },
      v1: {
        intakeStatusCode: v1IntakeResult.statusCode,
        searchStatusCode: v1SearchResult.statusCode,
        searchRankSource: v1SearchResult.body.rankSource,
        healthStatusCode: v1HealthResult.statusCode,
        meStatusCode: v1MeResult.statusCode,
        meErrorCode: v1MeResult.body.error.code
      },
      methodGuards: {
        intakeGetStatusCode: intakeGetResult.statusCode,
        searchGetStatusCode: searchGetResult.statusCode,
        authSignupGetStatusCode: authSignupGetResult.statusCode,
        authLoginGetStatusCode: authLoginGetResult.statusCode,
        mePostStatusCode: v1MePostResult.statusCode,
        healthPostStatusCode: v1HealthPostResult.statusCode,
        adminIntakePostStatusCode: adminIntakePostResult.statusCode,
        adminAuditPostStatusCode: adminAuditPostResult.statusCode,
        adminRolesPostStatusCode: adminRolesPostResult.statusCode,
        adminMaintenanceGetStatusCode: adminMaintenanceGetResult.statusCode,
        adminPrivacyGetStatusCode: adminPrivacyGetResult.statusCode
      },
      authMe: {
        unconfiguredStatusCode: v1MeResult.statusCode,
        missingTokenStatusCode: v1MeNoTokenResult.statusCode,
        invalidHeaderStatusCode: v1MeInvalidHeaderResult.statusCode,
        invalidTokenStatusCode: v1MeInvalidTokenResult.statusCode,
        missingProfileStatusCode: v1MeMissingProfileResult.statusCode,
        successStatusCode: v1MeSuccessResult.statusCode,
        roles: v1MeSuccessResult.body.data.roles,
        permissions: v1MeSuccessResult.body.data.permissions.length
      },
      publicAuth: {
        signupUnconfiguredStatusCode: authSignupUnconfiguredResult.statusCode,
        loginDisabledStatusCode: authLoginDisabledResult.statusCode,
        signupConfiguredStatusCode: authSignupConfiguredResult.statusCode,
        signupEmailVerificationRequired: authSignupConfiguredResult.body.data.emailVerificationRequired,
        loginConfiguredStatusCode: authLoginConfiguredResult.statusCode,
        loginAccessToken: Boolean(authLoginConfiguredResult.body.data.session.accessToken)
      },
      adminIntake: {
        unconfiguredStatusCode: adminIntakeUnconfiguredResult.statusCode,
        forbiddenStatusCode: adminIntakeForbiddenResult.statusCode,
        successStatusCode: adminIntakeSuccessResult.statusCode,
        patchStatusCode: adminIntakePatchResult.statusCode,
        auditEvent: Boolean(capturedAuditBody.event_type),
        table: adminIntakeSuccessResult.body.data.table,
        count: adminIntakeSuccessResult.body.data.count
      },
      adminAudit: {
        unconfiguredStatusCode: adminAuditUnconfiguredResult.statusCode,
        forbiddenStatusCode: adminAuditForbiddenResult.statusCode,
        successStatusCode: adminAuditSuccessResult.statusCode,
        count: adminAuditSuccessResult.body.data.count,
        ipHashExposed: Object.prototype.hasOwnProperty.call(adminAuditSuccessResult.body.data.events[0], "ip_hash"),
        weakSecretIpHashPresent: Boolean(capturedWeakAuditBody.ip_hash)
      },
      adminRoles: {
        unconfiguredStatusCode: adminRolesUnconfiguredResult.statusCode,
        forbiddenStatusCode: adminRolesForbiddenResult.statusCode,
        successStatusCode: adminRolesSuccessResult.statusCode,
        selfChangeStatusCode: adminRolesSelfChangeResult.statusCode,
        patchStatusCode: adminRolesPatchResult.statusCode,
        role: adminRolesPatchResult.body.data.role.role
      },
      adminMaintenance: {
        unconfiguredStatusCode: adminMaintenanceUnconfiguredResult.statusCode,
        forbiddenStatusCode: adminMaintenanceForbiddenResult.statusCode,
        invalidActionStatusCode: adminMaintenanceInvalidActionResult.statusCode,
        textBodyStatusCode: adminMaintenanceTextBodyResult.statusCode,
        futureCutoffStatusCode: adminMaintenanceFutureCutoffResult.statusCode,
        cleanupStatusCode: adminMaintenanceCleanupResult.statusCode,
        deletedCount: adminMaintenanceCleanupResult.body.data.deletedCount
      },
      adminPrivacy: {
        unconfiguredStatusCode: adminPrivacyUnconfiguredResult.statusCode,
        forbiddenStatusCode: adminPrivacyForbiddenResult.statusCode,
        invalidActionStatusCode: adminPrivacyInvalidActionResult.statusCode,
        textBodyStatusCode: adminPrivacyTextBodyResult.statusCode,
        futureCutoffStatusCode: adminPrivacyFutureCutoffResult.statusCode,
        intakeStatusCode: adminPrivacyIntakeResult.statusCode,
        searchStatusCode: adminPrivacySearchResult.statusCode,
        redactedCount: adminPrivacySearchResult.body.data.redactedCount
      },
      originGuards: {
        hostileIntakeStatusCode: hostileOriginIntakeResult.statusCode,
        malformedIntakeStatusCode: malformedOriginIntakeResult.statusCode,
        sameOriginSearchStatusCode: sameOriginSearchResult.statusCode,
        allowlistedSearchStatusCode: allowlistedOriginSearchResult.statusCode,
        allowlistedPreflightStatusCode: allowlistedPreflightResult.statusCode,
        hostilePreflightStatusCode: hostilePreflightResult.statusCode,
        hostileAdminIntakeGetStatusCode: hostileAdminIntakeGetResult.statusCode,
        hostileAdminAuditGetStatusCode: hostileAdminAuditGetResult.statusCode,
        hostileAdminRolesGetStatusCode: hostileAdminRolesGetResult.statusCode,
        hostileAdminIntakePatchStatusCode: hostileAdminIntakePatchResult.statusCode,
        hostileAdminRolesPatchStatusCode: hostileAdminRolesPatchResult.statusCode,
        hostileAdminMaintenanceStatusCode: hostileAdminMaintenanceResult.statusCode,
        hostileAdminPrivacyStatusCode: hostileAdminPrivacyResult.statusCode,
        publicAllowedAdminMaintenanceStatusCode: publicAllowedAdminMaintenanceResult.statusCode,
        publicAllowedAdminMaintenancePreflightStatusCode: publicAllowedAdminMaintenancePreflightResult.statusCode,
        adminAllowedOriginMaintenanceStatusCode: adminAllowedOriginMaintenanceResult.statusCode,
        adminAllowedOriginMaintenancePreflightStatusCode: adminAllowedOriginMaintenancePreflightResult.statusCode
      },
      invalidInputs: {
        invalidJsonStatusCode: invalidJsonSearchResult.statusCode,
        invalidJsonErrorCode: invalidJsonSearchResult.body.error.code,
        invalidContentTypeStatusCode: invalidContentTypeSearchResult.statusCode,
        invalidContentTypeErrorCode: invalidContentTypeSearchResult.body.error.code,
        invalidEmailStatusCode: invalidEmailResult.statusCode,
        invalidEmailErrorCode: invalidEmailResult.body.error.code
      },
      largeSearch: {
        statusCode: largeSearchResult.statusCode,
        errorCode: largeSearchResult.body.error.code
      },
      rateLimit: {
        statusCode: limitedResult.statusCode,
        errorCode: limitedResult.body.error.code
      },
      turnstile: {
        missingStatusCode: missingTurnstileResult.statusCode,
        missingErrorCode: missingTurnstileResult.body.error.code,
        successStatusCode: successfulTurnstileResult.statusCode,
        verifyCalled: turnstileVerifyCalled,
        insertCalled: turnstileInsertCalled
      },
      configuredIntake: {
        statusCode: configuredIntakeResult.statusCode,
        tablePath: capturedIntakeUrl.replace("https://example.supabase.co/rest/v1/", ""),
        status: configuredIntakeResult.body.data.status
      },
      invalidIntakeTable: {
        statusCode: invalidTableResult.statusCode,
        errorCode: invalidTableResult.body.error.code,
        fetchCalled: invalidTableFetchCalled
      },
      durableRateLimit: {
        allowed: durableRateLimitResult.allowed,
        source: durableRateLimitResult.source,
        rpc: capturedRateLimitUrl.replace("https://example.supabase.co/rest/v1/rpc/", "")
      },
      databaseSearch: {
        statusCode: databaseSearchResult.statusCode,
        profileSource: databaseSearchResult.body.profileSource,
        matches: databaseSearchResult.body.matches.length
      },
      searchLogging: {
        statusCode: loggedSearchResult.statusCode,
        previewRedacted: capturedSearchLogBody.query_preview?.includes("[email]") === true,
        hashLength: String(capturedSearchLogBody.query_hash || "").length,
        resultProfileIds: capturedSearchLogBody.result_profile_ids?.length || 0
      }
    },
    null,
    2
  )
);
