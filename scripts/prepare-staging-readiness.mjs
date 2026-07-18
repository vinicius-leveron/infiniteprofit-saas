#!/usr/bin/env node
import { appendFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import {
  githubEnvironmentLines,
  validateStagingTarget,
} from "./staging-readiness-fixture-core.mjs";

const target = validateStagingTarget({
  url: required("VITE_SUPABASE_URL"),
  projectRef: required("SUPABASE_PROJECT_REF"),
  acknowledgement: required("STAGING_FIXTURE_ACK"),
});
const anonKey = required("VITE_SUPABASE_PUBLISHABLE_KEY");
const serviceRoleKey = required("SUPABASE_SERVICE_ROLE_KEY");
const memberCredentials = {
  email: required("RLS_MEMBER_EMAIL").toLowerCase(),
  password: required("RLS_MEMBER_PASSWORD"),
  fullName: "Backend Readiness Member",
};
const adminCredentials = {
  email: required("RLS_ADMIN_EMAIL").toLowerCase(),
  password: required("RLS_ADMIN_PASSWORD"),
  fullName: "Backend Readiness Organization Admin",
};

if (memberCredentials.email === adminCredentials.email) {
  throw new Error("Staging Member and Admin must be different users.");
}

const service = createClient(target.url, serviceRoleKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
});

const [memberUser, adminUser] = await Promise.all([
  ensureUser(memberCredentials),
  ensureUser(adminCredentials),
]);
const organization = await ensureOrganization(adminUser.id);
const workspace = await ensureWorkspace(organization.id, adminUser.id);

await ensureMemberships({
  organizationId: organization.id,
  workspaceId: workspace.id,
  memberUserId: memberUser.id,
  adminUserId: adminUser.id,
});
const project = await ensureProject(workspace.id, adminUser.id);
await verifyCredentials(memberCredentials);
await verifyCredentials(adminCredentials);

const report = {
  schema_version: 1,
  environment: "staging",
  completed_at: new Date().toISOString(),
  project_ref: target.projectRef,
  organization_id: organization.id,
  workspace_id: workspace.id,
  project_id: project.id,
  member_user_id: memberUser.id,
  admin_user_id: adminUser.id,
  admin_access_origin: "organization",
  admin_explicit_workspace_membership: false,
  member_access_origin: "workspace",
  credentials_verified: true,
  artifact_url:
    process.env.READINESS_ARTIFACT_URL ??
    "https://github.com/vinicius-leveron/infiniteprofit-saas/actions",
};

if (process.env.GITHUB_ENV) {
  await appendFile(process.env.GITHUB_ENV, githubEnvironmentLines({
    organizationId: organization.id,
    workspaceId: workspace.id,
    projectId: project.id,
  }), "utf8");
}

console.log(JSON.stringify(report, null, 2));

async function ensureUser(credentials) {
  const existing = await findUserByEmail(credentials.email);
  if (existing) {
    const { data, error } = await service.auth.admin.updateUserById(
      existing.id,
      {
        password: credentials.password,
        email_confirm: true,
        user_metadata: { full_name: credentials.fullName },
      },
    );
    if (error || !data.user) {
      throw new Error(
        `Could not update staging user ${redactEmail(credentials.email)}: ${
          error?.message ?? "missing user"
        }`,
      );
    }
    return data.user;
  }

  const { data, error } = await service.auth.admin.createUser({
    email: credentials.email,
    password: credentials.password,
    email_confirm: true,
    user_metadata: { full_name: credentials.fullName },
  });
  if (error || !data.user) {
    throw new Error(
      `Could not create staging user ${redactEmail(credentials.email)}: ${
        error?.message ?? "missing user"
      }`,
    );
  }
  return data.user;
}

async function findUserByEmail(email) {
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await service.auth.admin.listUsers({
      page,
      perPage: 100,
    });
    if (error) throw new Error(`Could not list staging users: ${error.message}`);
    const match = data.users.find(
      (user) => user.email?.toLowerCase() === email,
    );
    if (match) return match;
    if (data.users.length < 100) return null;
  }
  throw new Error("Staging user lookup exceeded 2,000 users.");
}

async function ensureOrganization(adminUserId) {
  const name = "Backend Readiness Organization";
  const { data: existing, error: readError } = await service
    .from("organizations")
    .select("id")
    .eq("created_by", adminUserId)
    .eq("name", name)
    .maybeSingle();
  assertNoError(readError, "read staging organization");
  if (existing) return existing;

  const { data, error } = await service
    .from("organizations")
    .insert({ name, created_by: adminUserId })
    .select("id")
    .single();
  assertNoError(error, "create staging organization");
  return data;
}

async function ensureWorkspace(organizationId, adminUserId) {
  const name = "Backend Readiness Client";
  const { data: existing, error: readError } = await service
    .from("workspaces")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("name", name)
    .maybeSingle();
  assertNoError(readError, "read staging workspace");
  if (existing) return existing;

  const { data, error } = await service
    .from("workspaces")
    .insert({
      organization_id: organizationId,
      name,
      created_by: adminUserId,
    })
    .select("id")
    .single();
  assertNoError(error, "create staging workspace");
  return data;
}

async function ensureMemberships({
  organizationId,
  workspaceId,
  memberUserId,
  adminUserId,
}) {
  const { error: organizationError } = await service
    .from("organization_members")
    .upsert({
      organization_id: organizationId,
      user_id: adminUserId,
      role: "admin",
    }, { onConflict: "organization_id,user_id" });
  assertNoError(organizationError, "upsert staging Organization Admin");

  const { error: memberError } = await service
    .from("workspace_members")
    .upsert({
      workspace_id: workspaceId,
      user_id: memberUserId,
      role: "member",
    }, { onConflict: "workspace_id,user_id" });
  assertNoError(memberError, "upsert staging Member");

  const { error: inheritedError } = await service
    .from("workspace_members")
    .delete()
    .eq("workspace_id", workspaceId)
    .eq("user_id", adminUserId);
  assertNoError(inheritedError, "remove explicit Admin workspace membership");
}

async function ensureProject(workspaceId, adminUserId) {
  const name = "Backend Readiness Funnel";
  const { data: existing, error: readError } = await service
    .from("projects")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("name", name)
    .maybeSingle();
  assertNoError(readError, "read staging project");
  if (existing) return existing;

  const { data, error } = await service
    .from("projects")
    .insert({
      workspace_id: workspaceId,
      user_id: adminUserId,
      name,
      source: "api",
      csv_content: null,
    })
    .select("id")
    .single();
  assertNoError(error, "create staging project");
  return data;
}

async function verifyCredentials(credentials) {
  const client = createClient(target.url, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  const { data, error } = await client.auth.signInWithPassword({
    email: credentials.email,
    password: credentials.password,
  });
  if (error || !data.session) {
    throw new Error(
      `Staging login verification failed for ${
        redactEmail(credentials.email)
      }: ${error?.message ?? "missing session"}`,
    );
  }
  await client.auth.signOut({ scope: "local" });
}

function assertNoError(error, operation) {
  if (error) throw new Error(`${operation} failed: ${error.message}`);
}

function required(name) {
  const value = String(process.env[name] ?? "").trim();
  if (!value) throw new Error(`${name} is required for the staging fixture.`);
  return value;
}

function redactEmail(email) {
  const [local, domain = ""] = email.split("@");
  return `${local.slice(0, 2)}***@${domain}`;
}
