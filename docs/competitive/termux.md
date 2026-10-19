# Termux and native execution on Android

Reviewed 2026-10-18 by source and documentation reading only. No APK was
installed and no upstream test, compiler or package installation was executed.
The [reference manifest](android-host-references.yaml) pins upstream app and
package trees, separate Play app/package trees, the Play exec wrapper and generic
PRoot. The [reference map](android-host-references.md) records every revision.

## Two distributions, different runtime assumptions

Termux is a terminal and Android-native Unix package environment, not itself a
Linux VM. Its packages target Android/Bionic and Termux paths. YA instead uses
an Alpine/musl guest under PRoot; matching ARM64 does not make those package
sets interchangeable.

The upstream [app README](https://github.com/termux/termux-app/blob/8629e632fcb95da272221be327db653fb24befe9/README.md) describes a distinct
Play build. [Play app sources](https://github.com/termux-play-store/termux-apps/blob/cf69df7a8d2a4c496f5b2464d0365a63a58716c5/README.md) and the
[Play maintainer's status page](https://github.com/termux-play-store) own that
variant. Historical warnings about deprecated Play releases must retain their
dates; they do not establish the status of the 2026 Play variant.

Useful code entry points are upstream
[TermuxInstaller](https://github.com/termux/termux-app/blob/8629e632fcb95da272221be327db653fb24befe9/app/src/main/java/com/termux/app/TermuxInstaller.java)
and [TermuxService](https://github.com/termux/termux-app/blob/8629e632fcb95da272221be327db653fb24befe9/app/src/main/java/com/termux/app/TermuxService.java),
and the separate Play
[installer](https://github.com/termux-play-store/termux-apps/blob/cf69df7a8d2a4c496f5b2464d0365a63a58716c5/termux-app/src/main/java/com/termux/app/TermuxInstaller.java)
and [service](https://github.com/termux-play-store/termux-apps/blob/cf69df7a8d2a4c496f5b2464d0365a63a58716c5/termux-app/src/main/java/com/termux/app/TermuxService.java).
They are source entry points, not measured YA lifecycle evidence.

## System-linker execution workaround

Modern target-SDK apps cannot ordinarily execute a file directly from writable
app-private storage. The Play
[termux-exec description](https://github.com/termux-play-store/termux-exec/blob/47633d5df2db3dfea34cef568c6c82a7ba8dcc2e/README.md) and
[execve wrapper](https://github.com/termux-play-store/termux-exec/blob/47633d5df2db3dfea34cef568c6c82a7ba8dcc2e/src/termux-exec.c)
show a different launch route:

```text
requested: execve("/data/.../usr/bin/program", argv, env)
actual:    execute /system/bin/linker64 with the program path as an argument
```

An `LD_PRELOAD` interceptor rewrites ordinary C-library execution calls. Android
executes the system linker; the linker maps and runs the requested native
program. This is machine-code execution, not CPU emulation or a package-audit
step. Source origin, a central allowlist and Play approval are not checked by
that rewrite. The same mechanism can launch compatible locally compiled code.

Limitations include static binaries, raw execution syscalls that bypass the
C-library wrapper, preservation of the preload environment, shebang handling
and changed `/proc/self/exe` identity. The wrapper's
[exec-family implementation](https://github.com/termux-play-store/termux-exec/blob/47633d5df2db3dfea34cef568c6c82a7ba8dcc2e/src/exec-variants.c)
and `tests/` are useful reading targets; tests were not run in this review.
The Android system linker is not a general loader for Alpine/musl binaries.

## Packages, PRoot and local compilation

Termux maintains packages to handle Android ABI, paths and compatibility.
The [upstream PRoot recipe](https://github.com/termux/termux-packages/blob/43a55ba7623859f5a58bb33b8c9b6bac529d16ad/packages/proot/build.sh)
and [Play PRoot recipe](https://github.com/termux-play-store/termux-packages/blob/57401119f9988f79fa095398a9b33b03380222b3/packages/proot/build.sh)
identify their actual source/archive pins; the Play tree also contains an
[exec interception patch](https://github.com/termux-play-store/termux-packages/blob/57401119f9988f79fa095398a9b33b03380222b3/packages/proot/src-execve-enter.c.patch).
The generic [PRoot manual](https://github.com/proot-me/proot/blob/25dc6a3134891f98a79f57ce1c2c1b23ff15cad1/doc/proot/manual.rst)
is background on syscall/path translation, not a replacement provenance pin
for those Android binaries. PRoot shares the kernel and does not independently
contain an unrestricted same-UID program.

Inside a working Android Alpine/PRoot guest, a compiler can produce Linux
executables and the guest loader can run compatible outputs. This is a
technical capability, not a device test performed here or a confirmed store
exemption. Native offline compiler apps also exist on Play, for example the
[Cxxdroid developer listing](https://play.google.com/store/apps/details?id=ru.iiec.cxxdroid).
User development, native dependency downloads and app/provider self-updates
need separate assessment; compiling downloaded source is not a documented
universal policy exception.

## What this establishes for YA

A basic development host is a credible Play candidate. The references show
working distribution precedents and concrete execution techniques. They do not
reveal Google's private approval rationale or guarantee acceptance of YA's
runtime/provider packaging. We found no published requirement that every Termux
package receive individual Play review. Hosting an auditable repository alone
is not a stated exemption either. The
[YA host topic](../../topics/android-host.md#distribution-and-optional-phone-automation)
owns the policy interpretation and current product direction.

Keep downloaded native-code policy, Android execution enforcement, app UID
permissions and optional phone automation as distinct questions. Removing an
AccessibilityService-based control layer avoids a separate concern; it does
not itself settle runtime distribution.

## License and provenance

The app repositories declare GPL-3.0-only with component exceptions; package
build infrastructure is Apache-2.0, while per-package recipes and patches follow
package licenses. The Play exec wrapper declares Apache-2.0 with file-specific
notices; generic PRoot declares GPL-2.0-or-later. Review the exact component
before reuse or distribution. No source, test fixture or binary was imported
into YA by this research.
