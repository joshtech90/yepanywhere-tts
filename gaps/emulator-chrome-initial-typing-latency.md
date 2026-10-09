# Stock emulator Chrome sometimes delays initial session typing

The final October 7/8 lifecycle matrix fails its stock-Chrome Doze case's
100 ms input gate. The actual misses occur during initial sequential typing,
three to four seconds **before** the sleep fault: four characters have
combined event/frame delays of 169.4, 182.0, 299.2 and 194.8 ms. All characters
remain present. Most delay is waiting for the next animation frame, not input
event delivery. Sleep recovery itself succeeds after about 35.5 seconds and
server subscribers return to 17.

This is Chrome 124.0.6367.219 on the owned API 35 ARM64 emulator, with stock
background policy and a 50-message session. The same matrix's native app uses
the matching WebView version and passes every Android case. Host load at entry
is 9.24 on 14 cores with about 20 GiB available memory; this does not establish
an overloaded-host cause. The page observer measures acknowledgement, not
physical panel paint. Evidence is retained under the run's android-chrome-doze
result and timeline; the report links the experiment recipe.

Do not weaken the 100 ms limit or call this a sleep-recovery defect. Reduce it
with matched fresh-entry control runs, then trace rendering, frame scheduling
and host/device load if it repeats. Browser connection policy is deliberately
kept as the working baseline during the Android hardening work.

Three fresh control pairs subsequently pass without changing readiness or
the limit: Android maxima 14.1/14.9/71.6 ms; stock Chrome
16.9/19.3/34.5 ms. This bounds repeatability but does not explain or erase the
original failure. No product change is justified from these controls alone.

Found 2026-10-08 while comparing final Android and stock Chrome sleep acceptance.
