import * as vscode from "vscode"

const PUTER_TOKEN_KEY = "puter.auth.token.v2"

export async function getPuterToken(context: vscode.ExtensionContext): Promise<string | undefined> {
  return context.secrets.get(PUTER_TOKEN_KEY)
}

export async function setPuterToken(context: vscode.ExtensionContext, token: string): Promise<void> {
  await context.secrets.store(PUTER_TOKEN_KEY, token)
}

export async function clearPuterToken(context: vscode.ExtensionContext): Promise<void> {
  await context.secrets.delete(PUTER_TOKEN_KEY)
}

export async function hasPuterToken(context: vscode.ExtensionContext): Promise<boolean> {
  const token = await getPuterToken(context)
  return !!token
}
