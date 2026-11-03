/* 首屏外观引导：以同源外部脚本读取本机外观设置，避免低调主题启动时闪出黄色。
   不使用 inline script，满足 CSP。 */
(function () {
  var root = document.documentElement;
  var style = 'standard';
  var mode = 'light';
  try {
    var s = window.localStorage.getItem('kaoshiya:style');
    var m = window.localStorage.getItem('kaoshiya:mode');
    if (s === 'standard' || s === 'discreet') style = s;
    if (m === 'light' || m === 'dark') mode = m;
    else if (m === 'system' || m === null) {
      mode = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
  } catch (e) {
    /* localStorage 不可用时使用默认外观，不影响学习数据 */
  }
  root.dataset.style = style;
  root.dataset.mode = mode;
  root.style.colorScheme = mode;
})();
