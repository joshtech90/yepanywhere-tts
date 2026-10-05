import { createHash } from "node:crypto";
import { win32 } from "node:path";
import { execute, type Execute } from "./installation.js";
import type { ServerSettingsService } from "../services/ServerSettingsService.js";

export const RETIRED_COMPUTER_CONTROL_ERROR =
  "The legacy component is retired. Install and open the Machine Control desktop app, then select Machine Control in the session's advanced options.";

/** Read only for retiring the former YA-managed workstation component. */
export interface LegacyComputerSettings {
  enabled: boolean;
  preview?: { packageDirectory: string; trustedPublisher: string };
  idleMs: number;
  grantMs: number;
  releaseVersion?: string;
  autoUpdate?: boolean;
}

export type LegacyRetirement =
  | { state: "absent" | "removed" }
  | { state: "pending"; reason: "unsupported-host" | "cleanup-failed" };

/** Never discovers downloads, starts residents, or touches the desktop instance. */
export async function retireLegacyComputerControl(
  settings: Pick<ServerSettingsService, "getSetting" | "updateSettings">,
  dataDir: string,
  dependencies: {
    platform?: NodeJS.Platform;
    environment?: NodeJS.ProcessEnv;
    run?: Execute;
  } = {},
): Promise<LegacyRetirement> {
  const stored = settings.getSetting("computerControl");
  if (!stored) return { state: "absent" };
  // Persist off before attempting removal. Failure retains the exact locator
  // for a later startup retry and never selects the replacement capability.
  await settings.updateSettings({
    computerControl: { ...stored, enabled: false, autoUpdate: false },
  });
  if (!stored.preview) {
    await settings.updateSettings({ computerControl: undefined });
    return { state: "removed" };
  }
  if ((dependencies.platform ?? process.platform) !== "win32")
    return { state: "pending", reason: "unsupported-host" };
  const environment = dependencies.environment ?? process.env;
  const instance = `ya-${createHash("sha256").update(dataDir).digest("hex").slice(0, 20)}`;
  try {
    const preview = stored.preview;
    if (
      !environment.LOCALAPPDATA ||
      typeof preview.packageDirectory !== "string" ||
      typeof preview.trustedPublisher !== "string" ||
      !preview.trustedPublisher.trim() ||
      preview.trustedPublisher.length > 256
    )
      throw new Error("Invalid legacy cleanup locator");
    const packageId = win32.basename(preview.packageDirectory);
    const expected = win32.join(
      environment.LOCALAPPDATA,
      "MachineControl",
      "packages",
      instance,
      "versions",
      packageId,
    );
    if (
      !/^[a-f0-9]{64}$/.test(packageId) ||
      win32.resolve(preview.packageDirectory).toLowerCase() !==
        win32.resolve(expected).toLowerCase()
    )
      throw new Error("Legacy cleanup must name this YA instance's package");
    const code = `
$ErrorActionPreference='Stop';
$p=[Console]::In.ReadToEnd()|ConvertFrom-Json;
$script=Join-Path $p.packageDirectory 'workstation.ps1';
$cursor=$script;
while($cursor){
  $item=Get-Item -LiteralPath $cursor -Force;
  if($item.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Linked legacy cleanup path'};
  $cursor=Split-Path -Parent $cursor;
};
$sig=Get-AuthenticodeSignature -LiteralPath $script;
if($sig.Status -ne 'Valid' -or $null -eq $sig.TimeStamperCertificate -or
  $sig.SignerCertificate.GetNameInfo([Security.Cryptography.X509Certificates.X509NameType]::SimpleName,$false) -cne $p.trustedPublisher){throw 'Unauthenticated legacy manager'};
$root=Split-Path -Parent (Split-Path -Parent $p.packageDirectory);
$active=Get-Item -LiteralPath (Join-Path $root 'active.json') -Force;
if(($active.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $active.Length -gt 16384){throw 'Invalid legacy state file'};
$state=Get-Content -LiteralPath $active.FullName -Raw|ConvertFrom-Json;
if($state.active -cne $p.packageId){throw 'Legacy active package changed'};
$stateRoot=Join-Path $env:LOCALAPPDATA ('MachineControl\\workstation\\'+$p.instance);
$held=$false;
if(Test-Path -LiteralPath $stateRoot){
  $cursor=$stateRoot;
  while($cursor){
    $item=Get-Item -LiteralPath $cursor -Force;
    if($item.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Linked legacy runtime state'};
    $cursor=Split-Path -Parent $cursor;
  };
  foreach($lock in Get-ChildItem -LiteralPath $stateRoot -Filter resident.lock -Recurse){
    if($lock.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Linked legacy lock'};
    try{$stream=[IO.File]::Open($lock.FullName,'Open','ReadWrite','None');$stream.Dispose()}catch{$held=$true};
  };
};
if($held){
  & $script -Action Stop -Instance $p.instance -Package $p.packageDirectory -ExpectedPublisher $p.trustedPublisher|Out-Null;
};
$result=& $script -Action Uninstall -Instance $p.instance -Package $p.packageDirectory -ExpectedPublisher $p.trustedPublisher;
if(-not (($result|ConvertFrom-Json).uninstalled)){throw 'Legacy uninstall not confirmed'};
if(Test-Path -LiteralPath (Join-Path $root 'versions')){throw 'Legacy packages remain'};
if(Test-Path -LiteralPath $stateRoot){throw 'Legacy runtime state remains'};
@{removed=$true}|ConvertTo-Json -Compress;
`;
    const result = JSON.parse(
      await (dependencies.run ?? execute)(
        win32.join(
          environment.SystemRoot ?? "C:\\Windows",
          "System32",
          "WindowsPowerShell",
          "v1.0",
          "powershell.exe",
        ),
        [
          "-NoProfile",
          "-NonInteractive",
          "-EncodedCommand",
          Buffer.from(code, "utf16le").toString("base64"),
        ],
        JSON.stringify({ ...preview, instance, packageId }),
      ),
    );
    if (result.removed !== true) throw new Error("Invalid cleanup result");
    await settings.updateSettings({ computerControl: undefined });
    return { state: "removed" };
  } catch {
    return { state: "pending", reason: "cleanup-failed" };
  }
}
