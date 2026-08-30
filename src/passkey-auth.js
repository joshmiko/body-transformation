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


export function mountAuthControls() {
  if (document.getElementById("bt-auth-controls")) return;
  const panel = document.createElement("section");
  panel.id = "bt-auth-controls";
  panel.style.cssText = "position:fixed;top:12px;right:12px;z-index:100;background:var(--card,#fff);color:var(--text,#111);border:1px solid var(--line,#ddd);border-radius:14px;padding:10px;max-width:250px;box-shadow:0 8px 30px rgba(0,0,0,.16);font:12px system-ui";
  panel.innerHTML = `
    <button id="bt-passkey" style="width:100%;padding:9px;border:0;border-radius:9px;background:var(--green,#248a3d);color:#fff;font-weight:700">Sign in with Face ID / passkey</button>
    <button id="bt-register" style="width:100%;margin-top:6px;padding:7px;border:1px solid var(--line,#ddd);border-radius:9px;background:transparent;color:inherit">Register this device</button>
    <details style="margin-top:7px"><summary>Email/password fallback</summary>
      <input id="bt-email" type="email" placeholder="Email" style="width:100%;margin-top:6px;padding:7px">
      <input id="bt-password" type="password" placeholder="Password" style="width:100%;margin-top:5px;padding:7px">
      <button id="bt-password-login" style="width:100%;margin-top:6px;padding:7px">Sign in</button>
    </details>
    <div id="bt-auth-status" style="margin-top:7px;color:var(--muted,#666)">Cloud sign-in is optional until enabled.</div>
  `;
  document.body.append(panel);
  const status = (message, ok=false) => {
    const el = document.getElementById("bt-auth-status");
    if (el) { el.textContent = message; el.style.color = ok ? "var(--green,#248a3d)" : "var(--muted,#666)"; }
  };
  document.getElementById("bt-passkey").onclick = async () => {
    try { const result = await signInWithPasskey(); status(`Signed in as ${result?.user?.email || "your account"}`, true); }
    catch (error) { status(error?.message || "Passkey sign-in failed"); }
  };
  document.getElementById("bt-register").onclick = async () => {
    try { const result = await registerPasskey(); status(`Passkey registered: ${result?.friendly_name || "this device"}`, true); }
    catch (error) { status(error?.message || "Passkey registration failed"); }
  };
  document.getElementById("bt-password-login").onclick = async () => {
    try {
      const email = document.getElementById("bt-email").value.trim();
      const password = document.getElementById("bt-password").value;
      const response = await fetch(`${globalThis.__BT_CONFIG__?.supabaseUrl}/auth/v1/token?grant_type=password`, {
        method: "POST",
        headers: { apikey: globalThis.__BT_CONFIG__?.supabaseAnonKey, "Content-Type": "application/json" },
        body: JSON.stringify({ email, password })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error_description || "Sign-in failed");
      localStorage.setItem("bt_supabase_session", JSON.stringify(data));
      status(`Signed in as ${data.user?.email || email}`, true);
    } catch (error) { status(error?.message || "Password sign-in failed"); }
  };
}
