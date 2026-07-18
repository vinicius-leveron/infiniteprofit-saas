#!/usr/bin/env node
import { createClient } from "@supabase/supabase-js";
import process from "node:process";

const config = {
  url: required("VITE_SUPABASE_URL"),
  anonKey: required("VITE_SUPABASE_PUBLISHABLE_KEY"),
  workspaceId: required("RLS_WORKSPACE_ID"),
  projectId: required("RLS_PROJECT_ID"),
  memberEmail: required("RLS_MEMBER_EMAIL"),
  memberPassword: required("RLS_MEMBER_PASSWORD"),
  adminEmail: required("RLS_ADMIN_EMAIL"),
  adminPassword: required("RLS_ADMIN_PASSWORD"),
};

if (config.memberEmail.toLowerCase() === config.adminEmail.toLowerCase()) {
  throw new Error("RLS_MEMBER_EMAIL and RLS_ADMIN_EMAIL must be different users.");
}

const member = await authenticatedClient(
  config.memberEmail,
  config.memberPassword,
);
const admin = await authenticatedClient(
  config.adminEmail,
  config.adminPassword,
);

try {
  await assertDirectSecretReadsFail(member, "Member");
  await assertDirectSecretReadsFail(admin, "Admin");
  await assertMemberContracts(member);
  await assertAdminContracts(admin);
  console.log(
    JSON.stringify(
      {
        ok: true,
        workspace_id: config.workspaceId,
        project_id: config.projectId,
        checks: [
          "direct credential tables denied",
          "member webhook tokens redacted",
          "member project sync token denied",
          "admin safe contracts available",
        ],
      },
      null,
      2,
    ),
  );
} finally {
  await Promise.allSettled([
    member.auth.signOut({ scope: "local" }),
    admin.auth.signOut({ scope: "local" }),
  ]);
}

async function authenticatedClient(email, password) {
  const client = createClient(config.url, config.anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  const { data, error } = await client.auth.signInWithPassword({
    email,
    password,
  });
  if (error || !data.session) {
    throw new Error(`RLS QA login failed for ${redactEmail(email)}: ${error?.message ?? "no session"}`);
  }
  return client;
}

async function assertDirectSecretReadsFail(client, roleLabel) {
  const checks = [
    client.from("workspace_integrations").select("workspace_id").limit(1),
    client.from("workspace_meta_accounts").select("id").limit(1),
    client.from("project_checkout_bindings").select("project_id").limit(1),
    client
      .from("projects")
      .select("id, sync_token")
      .eq("id", config.projectId)
      .limit(1),
  ];
  const results = await Promise.all(checks);
  for (const [index, result] of results.entries()) {
    if (!result.error) {
      throw new Error(
        `${roleLabel} direct secret read ${index + 1} unexpectedly succeeded.`,
      );
    }
  }
}

async function assertMemberContracts(client) {
  const [
    integrationResult,
    checkoutResult,
    metaResult,
    syncSettingsResult,
    projectResult,
  ] = await Promise.all([
    client.rpc("get_workspace_integration_safe", {
      _workspace_id: config.workspaceId,
    }),
    client.rpc("get_funnel_checkout_binding_safe", {
      _project_id: config.projectId,
    }),
    client.rpc("list_workspace_meta_accounts_safe", {
      _workspace_id: config.workspaceId,
    }),
    client.rpc("get_project_sync_settings_safe", {
      _project_id: config.projectId,
    }),
    client
      .from("projects")
      .select("id, name, workspace_id")
      .eq("id", config.projectId)
      .single(),
  ]);

  assertNoError(integrationResult, "Member integration safe contract");
  assertNoError(checkoutResult, "Member checkout safe contract");
  assertNoError(metaResult, "Member Meta catalog safe contract");
  assertNoError(projectResult, "Member non-secret project read");

  for (const row of integrationResult.data ?? []) {
    if (row.gateway_webhook_token !== null) {
      throw new Error("Member received a workspace webhook token.");
    }
  }
  for (const row of checkoutResult.data ?? []) {
    if (row.webhook_token !== null) {
      throw new Error("Member received a funnel webhook token.");
    }
  }
  for (const row of metaResult.data ?? []) {
    if (Object.hasOwn(row, "access_token")) {
      throw new Error("Member Meta catalog exposed access_token.");
    }
  }
  if (!syncSettingsResult.error) {
    throw new Error("Member received project sheet synchronization settings.");
  }
}

async function assertAdminContracts(client) {
  const [integrationResult, checkoutResult, metaResult, syncSettingsResult] =
    await Promise.all([
      client.rpc("get_workspace_integration_safe", {
        _workspace_id: config.workspaceId,
      }),
      client.rpc("get_funnel_checkout_binding_safe", {
        _project_id: config.projectId,
      }),
      client.rpc("list_workspace_meta_accounts_safe", {
        _workspace_id: config.workspaceId,
      }),
      client.rpc("get_project_sync_settings_safe", {
        _project_id: config.projectId,
      }),
    ]);

  assertNoError(integrationResult, "Admin integration safe contract");
  assertNoError(checkoutResult, "Admin checkout safe contract");
  assertNoError(metaResult, "Admin Meta catalog safe contract");
  assertNoError(syncSettingsResult, "Admin project sync settings contract");

  for (const row of metaResult.data ?? []) {
    if (Object.hasOwn(row, "access_token")) {
      throw new Error("Admin Meta catalog exposed raw access_token.");
    }
  }
}

function assertNoError(result, label) {
  if (result.error) {
    throw new Error(`${label} failed: ${result.error.message}`);
  }
}

function required(name) {
  const value = String(process.env[name] ?? "").trim();
  if (!value) throw new Error(`${name} is required for the RLS contract gate.`);
  return value;
}

function redactEmail(email) {
  const [local, domain = ""] = email.split("@");
  return `${local.slice(0, 2)}***@${domain}`;
}
