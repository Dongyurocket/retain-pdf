import { getOcrProviderDefinition } from "../../config/providers.js";
import {
  credentialOcrToken,
} from "./selectors-port.js";
import { defaultCredentialsStatePort } from "./default-state-port.js";
import { runOcrTokenValidation } from "./validation.js";

export async function ensureOcrCredentialValidationReady({
  apiPrefix,
  state,
  providerId,
  credentials,
  defaultPaddleToken,
  defaultMineruToken,
  validateOcrToken,
  setOcrValidationMessage,
  showResult,
  credentialsStatePort = defaultCredentialsStatePort,
}: any) {
  const definition = getOcrProviderDefinition(providerId);
  const token = credentialOcrToken(credentials, {
    providerId: definition.id,
    defaultPaddleToken,
    defaultMineruToken,
  }).trim();

  if (!token) {
    return {
      ok: false,
      status: "missing_token",
      definition,
      token,
      result: null,
    };
  }

  const hasCachedValidation = credentialsStatePort.hasValidOcrValidationCache?.({
    provider: definition.id,
    token,
  });
  if (hasCachedValidation) {
    return {
      ok: true,
      status: "cached",
      definition,
      token,
      result: null,
    };
  }

  const result = await runOcrTokenValidation({
    apiPrefix,
    state,
    credentialsStatePort,
    providerId: definition.id,
    token,
    providerOptions: credentials?.ocrOptions?.[definition.id],
    validateOcrToken,
    setOcrValidationMessage,
    showResult,
  });
  return {
    ok: !!result.ok,
    status: result.status || "",
    definition,
    token,
    result,
  };
}
