#if DEBUG
  import WebKit

  enum InputAcceptance {
    static func install(_ configuration: WKWebViewConfiguration) {
      guard ProcessInfo.processInfo.arguments.contains("-qa-input-metrics") else { return }
      let script = """
        (() => {
          window.addEventListener('yaKeyboardShown', () => {
            requestAnimationFrame(() => requestAnimationFrame(() => {
              let ready=document.getElementById('qa-keyboard-ready');
              if (!ready) { ready=document.createElement('div');ready.id='qa-keyboard-ready';ready.style.cssText='position:fixed;top:12px;right:0;z-index:99999;font:10px monospace;background:white;color:black';document.body.append(ready); }
              ready.textContent='QA keyboard ready';
            }));
          });
          let count = 0, issued = 0, max = 0, maxKey = 0, domMax = 0, taskMax = 0, dropped = 0, stream = 0;
          new MutationObserver(records => {
            if (issued > 0 && issued < 37 && document.activeElement?.matches?.('textarea[data-composer-input]') && records.some(record => (record.target.closest?.('.message-list') || record.target.parentElement?.closest?.('.message-list')))) stream++;
          }).observe(document, {subtree:true,childList:true,characterData:true});
          document.addEventListener('beforeinput', event => {
            const input = event.target;
            if (!input.matches?.('textarea[data-composer-input]')) return;
            const start = performance.now(), before = input.value, key = ++issued;
            input.addEventListener('input', () => { domMax = Math.max(domMax, performance.now()-start) }, {once:true});
            setTimeout(() => { taskMax = Math.max(taskMax, performance.now()-start) }, 0);
            requestAnimationFrame(() => {
              count++; const latency = performance.now()-start; if (latency>max) {max=latency;maxKey=key}
              if (input.value === before) dropped++;
              let report = document.getElementById('qa-input-metrics');
              if (!report) {
                report = document.createElement('div'); report.id = 'qa-input-metrics';
                report.style.cssText = 'position:fixed;top:0;right:0;z-index:99999;font:10px monospace;background:white;color:black';
                document.body.append(report);
              }
              report.textContent = `QA input=${count};max=${Math.ceil(max)};dropped=${dropped};key=${maxKey};dom=${Math.ceil(domMax)};task=${Math.ceil(taskMax)};stream=${stream}`;
            });
          }, true);
        })();
        """
      configuration.userContentController.addUserScript(
        WKUserScript(source: script, injectionTime: .atDocumentStart, forMainFrameOnly: true))
    }
  }
#endif
