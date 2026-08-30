import { createClient } from "https://esm.sh/@supabase/supabase-js@2.105.0";

let client;
function getClient() {
  if (client) return client;
  const config = globalThis.__BT_CONFIG__ || {};
  if (!config.supabaseUrl || !config.supabaseAnonKey) {
    throw new Error("Supabase runtime configuration is missing");
  }
  client = createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: { experimental: { passkey: true } }
  });
  return client;
}

export async function registerPasskey() {
  const { data, error } = await getClient().auth.registerPasskey();
  if (error) throw error;
  return data;
}

export async function signInWithPasskey() {
  const { data, error } = await getClient().auth.signInWithPasskey();
  if (error) throw error;
  return data;
}

export async function listPasskeys() {
  const { data, error } = await getClient().auth.passkey.list();
  if (error) throw error;
  return data;
}

export async function deletePasskey(passkeyId) {
  const { error } = await getClient().auth.passkey.delete({ passkeyId });
  if (error) throw error;
}
