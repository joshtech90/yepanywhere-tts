import type { RouterLaunch } from "../../services/AgentAuthRouter.js";

/** Transport-only overrides. Never mutate native homes or ambient process.env. */
export function claudeRouterEnvironment(
  route: RouterLaunch,
): Record<string, string> {
  return {
    ANTHROPIC_BASE_URL: route.baseUrl,
    ANTHROPIC_AUTH_TOKEN: route.token,
    ANTHROPIC_API_KEY: "",
    CLAUDE_CODE_OAUTH_TOKEN: "",
    CLAUDE_CODE_USE_BEDROCK: "0",
    CLAUDE_CODE_USE_VERTEX: "0",
    CLAUDE_CODE_USE_FOUNDRY: "0",
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
    CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY: "1",
  };
}
export function codexRouterArguments(route: RouterLaunch): string[] {
  return [
    'model_provider="aar"',
    'model_providers.aar.name="Agent Auth Router"',
    `model_providers.aar.base_url=${JSON.stringify(route.baseUrl)}`,
    'model_providers.aar.wire_api="responses"',
    'model_providers.aar.env_key="AAR_SESSION_TOKEN"',
    "model_providers.aar.requires_openai_auth=false",
    "model_providers.aar.supports_websockets=false",
  ].flatMap((value) => ["-c", value]);
}
export function codexRouterEnvironment(
  env: NodeJS.ProcessEnv,
  route: RouterLaunch,
): NodeJS.ProcessEnv {
  const result = { ...env };
  for (const name of [
    "OPENAI_API_KEY",
    "OPENAI_BASE_URL",
    "CODEX_API_KEY",
    "CODEX_ACCESS_TOKEN",
  ])
    delete result[name];
  result.AAR_SESSION_TOKEN = route.token;
  return result;
}
